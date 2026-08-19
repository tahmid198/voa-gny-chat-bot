# maud-ai service

HTTP wrapper around the RAG stack on `10.10.1.165`, refactored out of the
original `/opt/maud-ai/rag_chat.py` CLI. It exists because retrieval needs the
`BAAI/bge-base-en-v1.5` embedding model to turn a question into a query vector,
and that only runs in Python — so the Next.js frontend calls this instead of
talking to Qdrant directly.

Everything the CLI did is preserved: the query expansion, the PTO lexical
re-ranking, and the deterministic PTO table extraction.

## Layout

| File            | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `config.py`     | Env-driven settings; defaults match the current deployment     |
| `retrieval.py`  | Query expansion, Qdrant search, PTO lexical bonus, context fill |
| `pto.py`        | Parses the handbook's accrual table into a direct answer       |
| `llm.py`        | vLLM (OpenAI-compatible) streaming and health                  |
| `main.py`       | FastAPI app and the NDJSON chat protocol                       |

## Deploy

The service is designed to live alongside the existing scripts in
`/opt/maud-ai`, reusing that venv.

```bash
ssh skunk@10.10.1.165
cd /opt/maud-ai

# Copy this directory's contents into /opt/maud-ai, e.g.
git clone <this repo> /tmp/voa-gny-chat-bot
cp -r /tmp/voa-gny-chat-bot/backend/maud_service /opt/maud-ai/
cp /tmp/voa-gny-chat-bot/backend/requirements.txt /opt/maud-ai/

venv/bin/pip install -r requirements.txt

# Check it starts
venv/bin/uvicorn maud_service.main:app --host 0.0.0.0 --port 8100
```

Then install it as a service so it survives reboots:

```bash
sudo cp /tmp/voa-gny-chat-bot/backend/maud-ai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now maud-ai
systemctl status maud-ai
```

The unit assumes vLLM and Qdrant are already running on the same host. It does
not start them.

## Configuration

Env vars, set in the systemd unit or the shell. See `.env.example` for the full
list; the defaults match the current box:

| Variable            | Default                     |
| ------------------- | --------------------------- |
| `QDRANT_HOST`       | `localhost`                 |
| `QDRANT_PORT`       | `6333`                      |
| `QDRANT_COLLECTION` | `hr-documents`              |
| `EMBEDDING_MODEL`   | `BAAI/bge-base-en-v1.5`     |
| `VLLM_BASE_URL`     | `http://localhost:8000/v1`  |
| `MODEL_NAME`        | `google/gemma-3-1b-it`      |
| `PORT`              | `8100`                      |

`EMBEDDING_MODEL` **must** match what `ingest_documents.py` used to build the
collection. A mismatch produces vectors in the wrong space, and search returns
plausible-looking but wrong chunks rather than an error.

## Endpoints

| Route                | Method | Purpose                                         |
| -------------------- | ------ | ----------------------------------------------- |
| `/health`            | GET    | vLLM + Qdrant status, model and collection info |
| `/documents`         | GET    | Files in the collection, with chunk counts      |
| `/documents/refresh` | POST   | Re-scan the collection (does not re-ingest)     |
| `/chat`              | POST   | `{question, history}` → NDJSON answer stream    |

Ingestion is still `ingest_documents.py`; this service only reads.

## Tests

The suite stubs Qdrant, vLLM and the embedding model, so it runs anywhere
without the RAG stack:

```bash
pip install -r requirements.txt pytest
python -m pytest backend/tests -q     # from the repo root
```

Covers the query expansion, the lexical re-ranking that lifts the PTO table
above higher-scoring prose, tier parsing and ordinal formatting, and every
branch of the chat protocol including upstream failures.
