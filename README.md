# voa-gny-chat-bot

A Google-style search page for VOA-Greater New York's HR documents. Ask a
question in plain English; the answer comes back with citations to the source
document, streamed token by token.

Nothing leaves the network. This app is the frontend; retrieval and generation
both happen in the **maud-ai** service on the Ubuntu host (`10.10.1.165`).

## Architecture

```
browser
  │
  ▼
Next.js app (this repo)          ← UI + thin proxy, no AI dependencies
  │  POST /api/chat  (NDJSON)
  ▼
maud-ai service  :8100           ← backend/ in this repo, deployed to /opt/maud-ai
  ├── BAAI/bge-base-en-v1.5      ← embeds the question (sentence-transformers)
  ├── Qdrant       :6333         ← "hr-documents" collection, vector search
  └── vLLM         :8000         ← google/gemma-3-1b-it, OpenAI-compatible API
```

The embedding model is the reason for the middle tier: turning a question into
a query vector requires `sentence-transformers`, which only exists in Python, so
the frontend cannot talk to Qdrant directly.

### How a question is answered

1. The question is expanded into several search queries. Short follow-ups
   ("what about after 10 years?") are rewritten using the previous turn, and PTO
   questions get extra queries aimed at each row of the accrual table.
2. Each query is embedded and searched against Qdrant; results are deduplicated
   by `(file, chunkID)`.
3. PTO questions get a lexical bonus on top of the vector score, because the
   accrual policy is a table and pure vector similarity ranks it below the
   surrounding prose.
4. Top chunks fill a character-budgeted context block, numbered for citations.
5. If the PTO accrual table parsed cleanly, the answer is generated directly from
   the parsed rows — a 1B model reading a table is where hallucinations happen.
   Otherwise the context goes to vLLM and the answer streams back.

## Setup

### Backend (on the maud-ai host)

See [backend/README.md](backend/README.md). In short:

```bash
ssh skunk@10.10.1.165
cd /opt/maud-ai
venv/bin/pip install -r backend/requirements.txt
sudo cp backend/maud-ai.service /etc/systemd/system/
sudo systemctl enable --now maud-ai
```

### Frontend

```bash
npm install
cp .env.example .env.local    # point MAUD_API_URL at the maud-ai host
npm run dev
```

Open http://localhost:3000. The status dot in the top right turns green once
vLLM, Qdrant and the maud-ai service are all reachable.

## Configuration

Everything tunable lives in `.env.local`:

| Variable                 | Default                  | Purpose                                     |
| ------------------------ | ------------------------ | ------------------------------------------- |
| `MAUD_API_URL`           | `http://10.10.1.165:8100` | Base URL of the maud-ai service            |
| `MAUD_HOST`              | `10.10.1.165`            | Used to build the default URL and in errors |
| `MAUD_CHAT_TIMEOUT_MS`   | `300000`                 | Wait for an answer (cold vLLM loads slowly) |
| `MAUD_STATUS_TIMEOUT_MS` | `10000`                  | Wait for health / document-list calls       |

Model, embedding model, collection name and retrieval budgets are all backend
settings — see `backend/.env.example`.

If the maud-ai service isn't exposed on the network, tunnel it instead:

```bash
ssh -N -L 8100:localhost:8100 skunk@10.10.1.165
# then set MAUD_API_URL=http://localhost:8100
```

## Adding documents

Ingestion happens on the maud-ai host, not through this app:

```bash
ssh skunk@10.10.1.165
cd /opt/maud-ai
cp <your files> documents/
venv/bin/python ingest_documents.py
```

Then click **Refresh document list** in the status panel to pick up the change.

## API

| Route            | Method | Purpose                                                  |
| ---------------- | ------ | -------------------------------------------------------- |
| `/api/chat`      | POST   | `{ question, history? }` → newline-delimited JSON stream |
| `/api/documents` | GET    | What's currently in the Qdrant collection                |
| `/api/documents` | POST   | Refresh the cached document inventory                    |
| `/api/health`    | GET    | vLLM + Qdrant reachability, model, collection stats      |

`/api/chat` emits one JSON object per line:

```json
{"type": "sources", "sources": [{"n": 1, "file": "handbook.pdf", "snippet": "…", "score": 0.62}]}
{"type": "delta", "text": "According to the "}
{"type": "done"}
```

`{"type": "error", "message": "…"}` replaces the answer when something upstream
fails, so connection problems render in the UI instead of surfacing as a broken
fetch.

## Notes

- Answers are grounded in retrieved passages, but a 1B model still makes
  mistakes. The citations exist so anything important can be checked against the
  source document.
- PTO answers bypass the model entirely when the accrual table parses. If the
  handbook's wording changes, update `TIER_PATTERNS` in
  `backend/maud_service/pto.py` — an unparseable table falls through to the model
  rather than producing a wrong number.
