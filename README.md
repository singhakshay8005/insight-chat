# Conversational AI for Instant Business Intelligence Dashboard

Upload a CSV, ask a question in plain English, and get an interactive chart with a short explanation.

## How it works

1. The user uploads a CSV file.
2. The **Python backend (FastAPI + pandas)** cleans the data and builds a schema and cleaning report.
3. The user asks a question. The backend sends it to **Gemini**, which returns a SQL plan.
4. The SQL runs on the cleaned data and the result is drawn as a chart (Recharts) with a short summary.

## Tech stack

| Part | Technology |
|------|------------|
| Backend | **Python**, FastAPI, pandas |
| AI | Google Gemini API |
| Frontend | React, TypeScript, Vite, Tailwind CSS, Recharts |
| SQL execution | alasql (in the browser, for now) |

## Project structure

```
backend/   Python API (FastAPI): /clean and /chat endpoints
src/       React + TypeScript frontend
```

## Run locally

**Backend** (port 8000)
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        
pip install -r requirements.txt
# create backend/.env with: GEMINI_API_KEY=your_key_here
uvicorn app.main:app --reload --port 8000
```

**Frontend** (port 8080)
```bash
npm install
npm run dev
```

The frontend reads the backend address from `VITE_API_URL` in `.env` (default `http://localhost:8000`).

