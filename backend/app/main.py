import os
import time
import asyncio
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# /clean tabhi chalega jab backend/app/services/cleaning.py bana ho.
# Na bana ho to bhi /chat bina error ke chalta rahega.
try:
    from app.services.cleaning import run_pipeline
except ImportError:
    run_pipeline = None

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:8080").split(",")
# Optional: .env mein THINKING_LEVEL=low likhoge to hi bheja jayega (khali = nahi bheja jayega)
THINKING_LEVEL = os.getenv("THINKING_LEVEL", "").strip()

# Ek hi client sabhi requests ke liye (har baar nayi connection nahi banti)
http = httpx.AsyncClient(timeout=60)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await http.aclose()


app = FastAPI(title="Insight Chat API", lifespan=lifespan)
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


@app.post("/clean")
async def clean(file: UploadFile = File(...)):
    if run_pipeline is None:
        raise HTTPException(501, "Cleaning module not installed (backend/app/services/cleaning.py missing)")
    content = await file.read()
    if not content:
        raise HTTPException(400, "The file is empty")
    try:
        return run_pipeline(content)
    except ValueError as e:
        raise HTTPException(400, f"Could not clean file: {e}")


@app.post("/chat")
async def chat(req: ChatRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(500, "GEMINI_API_KEY is not configured")

    system = "\n\n".join(m.content for m in req.messages if m.role == "system")
    contents = build_contents(req.messages)
    if not contents:
        raise HTTPException(400, "No user message in request")

    generation_config: dict = {"temperature": 0.1}
    if THINKING_LEVEL:
        generation_config["thinkingConfig"] = {"thinkingLevel": THINKING_LEVEL}

    body: dict = {"contents": contents, "generationConfig": generation_config}
    if system:
        body["system_instruction"] = {"parts": [{"text": system}]}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    for _ in range(3):
        t0 = time.perf_counter()
        r = await http.post(url, json=body, headers={"x-goog-api-key": GEMINI_API_KEY})
        print(f"Gemini call took {time.perf_counter() - t0:.1f}s (status {r.status_code})")
        if r.status_code not in (500, 503):
            break
        await asyncio.sleep(1.5)

    if r.status_code == 429:
        print("Gemini 429:", r.text[:500])
        raise HTTPException(429, f"Rate limit exceeded: {r.text[:300]}")
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