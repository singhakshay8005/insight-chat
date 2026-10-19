import os
import asyncio
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:8080").split(",")

app = FastAPI(title="Insight Chat API")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS,
                   allow_methods=["*"], allow_headers=["*"])


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]


def build_contents(messages: list[Message]) -> list[dict]:
    """Gemini ke liye history saaf karo: khaali messages hatao,
    ek hi role ke lagataar messages jodo, aur pehla message 'user' ka rakho."""
    contents: list[dict] = []
    for m in messages:
        if m.role == "system" or not (m.content or "").strip():
            continue
        role = "model" if m.role == "assistant" else "user"
        if contents and contents[-1]["role"] == role:
            contents[-1]["parts"][0]["text"] += "\n\n" + m.content
        else:
            contents.append({"role": role, "parts": [{"text": m.content}]})
    while contents and contents[0]["role"] != "user":
        contents.pop(0)
    return contents


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/chat")
async def chat(req: ChatRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(500, "GEMINI_API_KEY is not configured")

    system = "\n\n".join(m.content for m in req.messages if m.role == "system")
    contents = build_contents(req.messages)
    if not contents:
        raise HTTPException(400, "No user message in request")

    body = {"contents": contents, "generationConfig": {"temperature": 0.1}}
    if system:
        body["system_instruction"] = {"parts": [{"text": system}]}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    async with httpx.AsyncClient(timeout=60) as client:
        for _ in range(3):
            r = await client.post(url, json=body, headers={"x-goog-api-key": GEMINI_API_KEY})
            if r.status_code not in (500, 503):
                break
            await asyncio.sleep(1.5)

    if r.status_code == 429:
        raise HTTPException(429, "Rate limit exceeded")
    if r.status_code != 200:
        print("Gemini error:", r.status_code, r.text[:500])
        raise HTTPException(502, f"Gemini error {r.status_code}: {r.text[:300]}")

    data = r.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts)
    except (KeyError, IndexError):
        print("Gemini returned no text:", str(data)[:500])
        raise HTTPException(502, f"Gemini returned no text: {str(data)[:300]}")

    # Frontend jo shape padhta hai: result.choices[0].message.content
    return {"choices": [{"message": {"role": "assistant", "content": text}}]}