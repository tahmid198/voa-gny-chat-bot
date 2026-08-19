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

## Running it

Version 1.1.0 — see [RELEASE_NOTES.md](RELEASE_NOTES.md).

Both halves can run on the maud-ai host, so the assistant is reachable on the
LAN with nothing installed on client machines. That is what `deploy/install.sh`
sets up, and it is the recommended path.

### Quick install — everything on one host

```bash
ssh skunk@10.10.1.165
git clone https://github.com/tahmid198/voa-gny-chat-bot ~/voa-gny-chat-bot
cd ~/voa-gny-chat-bot
./deploy/install.sh
```

Run it as your normal user, not root — it calls `sudo` where it needs to. It:

1. checks vLLM and Qdrant are responding, warning rather than failing if not
2. installs the backend into `/opt/maud-ai` and its Python dependencies
3. installs Node.js 20 if the system Node is older than 18.18
4. builds the frontend in `/opt/maud-ai/voa-gny-chat-bot`, pointed at `localhost:8100`
5. installs and starts both systemd services
6. waits for each to answer, then prints the URL

Then open **http://10.10.1.165:3000** from any machine on the network.

The clone you started from is only a bootstrap — the deployed copy lives at
`/opt/maud-ai/voa-gny-chat-bot`, so you can delete the one in your home
directory afterwards. Updates run from the deployed copy, which pulls and
restarts itself:

```bash
cd /opt/maud-ai/voa-gny-chat-bot
./deploy/install.sh
```

To install a branch other than `main`:

```bash
BRANCH=my-feature-branch ./deploy/install.sh
```

`APP_DIR`, `MAUD_DIR`, `SERVICE_USER`, `FRONTEND_PORT` and `BACKEND_PORT` can be
overridden the same way.

If `ufw` is active, open the port so other machines can reach it:

```bash
sudo ufw allow from 10.10.1.0/24 to any port 3000 proto tcp
```

### Layout

Everything lives under `/opt/maud-ai`, alongside the existing venv and scripts:

```
/opt/maud-ai/
├── venv/                  existing — shared by the CLI and the service
├── documents/             existing — source files for ingest_documents.py
├── rag_chat.py            existing — the interactive CLI, unchanged
├── ingest_documents.py    existing — ingestion, unchanged
├── maud_service/  →  voa-gny-chat-bot/backend/maud_service   (symlink)
└── voa-gny-chat-bot/      this repo, built
```

`maud_service/` is a link into the checkout rather than a copy, so `git pull`
in `voa-gny-chat-bot/` updates the backend too, and there is one copy of the
code on disk rather than two that can drift.

### The CLI and the service

`rag_chat.py` is untouched and still works for terminal use:

```bash
cd /opt/maud-ai
source venv/bin/activate
python3 rag_chat.py
```

The web app does **not** run it. The `maud-ai` service runs
`venv/bin/uvicorn maud_service.main:app` instead — the same retrieval and PTO
logic, reachable over HTTP. It calls the venv's binary by absolute path, which
is why systemd needs no `activate` step: activating only puts `venv/bin` on
`PATH`.

### Services

| Unit                  | Port   | What it runs                        |
| --------------------- | ------ | ----------------------------------- |
| `maud-ai`             | `8100` | FastAPI: embeddings, Qdrant, vLLM   |
| `voa-gny-frontend`    | `3000` | Next.js production server           |

```bash
sudo systemctl restart maud-ai voa-gny-frontend
journalctl -u maud-ai -f
journalctl -u voa-gny-frontend -f
```

---

The rest of this section is the same work done by hand — useful for
understanding what the script does, or for running the frontend on your own
machine instead of the host.

### Prerequisites

These must already be running on the maud-ai host. This app starts neither.

| Service | Port   | Check                                              |
| ------- | ------ | -------------------------------------------------- |
| vLLM    | `8000` | `curl -s localhost:8000/v1/models \| python3 -m json.tool` |
| Qdrant  | `6333` | `curl -s localhost:6333/collections/hr-documents \| python3 -m json.tool` |

The Qdrant collection must already be populated by `ingest_documents.py`.

### 1. Deploy the backend

```bash
ssh skunk@10.10.1.165

git clone https://github.com/tahmid198/voa-gny-chat-bot /tmp/voa-gny-chat-bot
sudo cp -r /tmp/voa-gny-chat-bot/backend/maud_service /opt/maud-ai/
sudo chown -R skunk:skunk /opt/maud-ai/maud_service
```

To update an existing deployment, `git pull` in `/tmp/voa-gny-chat-bot` and
repeat the two `cp`/`chown` lines, then `sudo systemctl restart maud-ai`.

Before installing, confirm the collection's payload keys are what retrieval
expects. A mismatch yields empty context with no error, which reads as the model
refusing to answer rather than a configuration problem:

```bash
cd /opt/maud-ai
venv/bin/python -c "
from qdrant_client import QdrantClient
c = QdrantClient(host='localhost', port=6333)
pts, _ = c.scroll(collection_name='hr-documents', limit=1, with_payload=True)
print(pts[0].payload.keys())
"
```

Must include `file`, `chunkID` and `text`. Then install the web layer —
`sentence-transformers` and `qdrant-client` are already in the venv:

```bash
venv/bin/pip install fastapi 'uvicorn[standard]' httpx
```

### 2. Check it starts

Run it in the foreground first. The embedding model loads at startup, so expect
10–20 seconds before `Application startup complete`:

```bash
cd /opt/maud-ai
venv/bin/uvicorn maud_service.main:app --host 0.0.0.0 --port 8100
```

From another shell:

```bash
curl -s localhost:8100/health | python3 -m json.tool

curl -sN -X POST localhost:8100/chat -H 'Content-Type: application/json' \
  -d '{"question":"How much PTO do I get after 10 years?"}'
```

`/health` should report `"online": true` for both `llm` and `vectorStore`, and a
non-zero chunk count. The PTO question answers from the parsed table rather than
the model, so it returns immediately.

### 3. Install as a service

```bash
sudo cp /tmp/voa-gny-chat-bot/backend/maud-ai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now maud-ai
systemctl status maud-ai
```

Logs: `journalctl -u maud-ai -f`

### 4. Open the port

Either expose it to the LAN:

```bash
sudo ufw allow from 10.10.1.0/24 to any port 8100 proto tcp
```

…or leave it closed and tunnel from wherever the frontend runs:

```bash
ssh -N -L 8100:localhost:8100 skunk@10.10.1.165
```

### 5. Run the frontend

```bash
npm install
cp .env.example .env.local     # set MAUD_API_URL
npm run dev
```

Set `MAUD_API_URL=http://10.10.1.165:8100`, or `http://localhost:8100` if you
tunneled. Open http://localhost:3000 — the status dot turns green once vLLM,
Qdrant and the maud-ai service are all reachable.

For production: `npm run build && npm start`.

### Troubleshooting

| Symptom | Cause |
| ------- | ----- |
| Grey dot, "Service offline" | `maud-ai` isn't running, or port 8100 is unreachable |
| "Model server offline" | vLLM is down; the service itself is fine |
| "Vector store offline" | Qdrant is down or the collection name is wrong |
| "Model not loaded" | vLLM is serving a different model than `MODEL_NAME` |
| Answers say information is unavailable | Retrieval found nothing — check the payload keys above, and that `EMBEDDING_MODEL` matches what built the collection |
| 400 about context length | Budgets exceed vLLM's `--max-model-len`; see [backend/README.md](backend/README.md) |

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
