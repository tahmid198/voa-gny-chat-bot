# Release notes

## 1.1.0 — 2026-08-19

Deployment. Both halves now run on the maud-ai host under systemd, so the
assistant is reachable on the LAN at **http://10.10.1.165:3000** with nothing
installed on client machines — no Node, no clone, no branch checkout.

1.0.0 required each user to build and run the frontend on their own machine,
which put a development toolchain between staff and an HR question. This
release removes that.

### Added

- `deploy/install.sh` — installs and starts the whole stack on a host that
  already runs vLLM and Qdrant. It checks both are responding, installs the
  backend's Python dependencies, builds the frontend into `/opt/maud-ai/voa-gny-chat-bot`,
  installs both systemd units, and waits for each to answer before printing the
  URL. Run it as a normal user; it calls `sudo` where it needs to.
- `deploy/voa-gny-frontend.service` — runs the Next.js production server on
  port 3000, bound to all interfaces and pointed at the backend over loopback.
  It invokes `next` directly rather than through `npm`, so systemd supervises
  the server itself instead of a wrapper that forwards signals.
- Node.js 20 is installed only when the system Node is older than 18.18, so
  Ubuntu 24.04's 18.19 is left alone.
- Everything is installed under `/opt/maud-ai`, next to the existing venv,
  `documents/` and `rag_chat.py`. `maud_service/` is a symlink into
  `/opt/maud-ai/voa-gny-chat-bot/backend/`, so `git pull` updates the backend and there is
  one copy of the code rather than two.
- `/opt/maud-ai/README.md`, written by the installer — a plain-language guide
  to that directory: what each file and folder is for, which service needs it,
  how to re-ingest documents, and what must never be deleted.

### Changed

- Re-running `deploy/install.sh` is the update path: it pulls, rebuilds and
  restarts both services. When the pull changes the installer itself, it
  re-executes the pulled copy rather than continuing through a file that
  changed underneath it — bash reads scripts by byte offset, so carrying on
  can resume at the wrong place. `BRANCH`, `APP_DIR`, `MAUD_DIR`, `SERVICE_USER`,
  `FRONTEND_PORT` and `BACKEND_PORT` override the defaults.
- The service reports its own package version at `/health` rather than a
  hardcoded string.
- README leads with the single-host install; the per-machine frontend setup is
  kept as the alternative.

### Removed

- The `serverExternalPackages` entry for `unpdf`, `mammoth` and `xlsx`. Those
  packages were dropped in 1.0.0 when parsing moved to the backend, leaving the
  setting with nothing to exclude.

### Notes

- `rag_chat.py` is untouched and still runs from the terminal. The service is a
  second entry point to the same logic, not a replacement — nothing invokes the
  CLI.
- Because the checkout now lives under `/opt/maud-ai`, anything that scans that
  directory wholesale would reach `web/node_modules`. `ingest_documents.py`
  should read `documents/` only; the installer warns if it cannot confirm that.
- 1.0.0 was never deployed as a running version — it was verified by hand
  against the live stack, then this release packaged that same setup. Nothing
  in the retrieval or answering path changed.
- The 2048-token context window remains the main quality constraint. See
  **Known limitations** under 1.0.0.

### Verified against

The production server run exactly as the systemd unit invokes it
(`node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3000`), answering
`/api/health` and a PTO question through the backend. The installer's Node
version gate and systemd unit rewriting were tested directly; the script has
not yet been run end to end against a host, since it needs sudo and a real
`/opt/maud-ai` venv.

## 1.0.0 — 2026-08-19

First release that answers questions from the real HR corpus. The app now runs
against the **maud-ai** stack on `10.10.1.165`: 100 documents, 413 embedded
chunks, retrieval through Qdrant and generation through vLLM.

Version 0.1.0 was a prototype that indexed documents inside the Next.js process
and called Ollama on a Jetson Nano. It was never pointed at this corpus. This
release replaces that entire path, so the jump to 1.0.0 marks the first version
that does the job it exists for rather than a small increment on the old one.

### Highlights

- **Real retrieval.** Questions are embedded with `BAAI/bge-base-en-v1.5` and
  searched against the `hr-documents` collection in Qdrant — the same index
  `ingest_documents.py` builds — instead of the BM25 index the app used to
  rebuild in memory on every boot.
- **PTO answers bypass the model.** The handbook states PTO accrual as a table,
  which is exactly where a 1B model invents numbers. When the table parses, the
  answer is generated from the parsed rows. "How much PTO after 10 years?"
  returns 26 workdays (208 hours), from the 11th-year tier, with a citation.
- **The frontend has no AI dependencies.** It renders and proxies; everything
  else happens in the backend service.

### Added

- `backend/` — a FastAPI service (`maud_service`) wrapping the `rag_chat.py`
  pipeline as HTTP, with `/health`, `/documents`, `/documents/refresh` and a
  streaming `/chat`. Ships with a systemd unit and 28 tests that run without
  Qdrant, vLLM or the embedding model.
- Status panel now reports vLLM, Qdrant, the embedding model, the collection
  name and chunk counts, and distinguishes "service offline" from "model server
  offline" from "vector store offline".
- Source cards show the chunk id alongside the file name.

### Changed

- Retrieval, generation and document inventory all moved behind
  `MAUD_API_URL`. The Next.js API routes are now thin proxies.
- `/api/health` reports `llm` and `vectorStore` instead of `jetson`.
- "Re-index documents" became "Refresh document list" — it re-reads the Qdrant
  collection. Ingestion stays on the host, where it always was.
- Conversation history is capped at 2 turns with long prior answers truncated,
  so history cannot crowd out the retrieved context.

### Removed

- `lib/store.ts`, `lib/search.ts`, `lib/extract.ts`, `lib/ollama.ts` — the local
  index, BM25 ranker, document parsers and Ollama client. All superseded.
- `mammoth`, `unpdf` and `xlsx` dependencies. Document parsing belongs to
  `ingest_documents.py`.
- The Jetson Nano and Ollama are no longer part of the system.

### Fixed

- **Ordinal suffixes in PTO answers.** `rag_chat.py` produced "2th year",
  "3th year" and "21th year". Now 2nd, 3rd, 21st.
- **Context window overflow.** Generation budgets were sized larger than the
  deployed vLLM's `--max-model-len 2048`, which would have returned a 400 on the
  first question carrying real context. Budgets now fit, and the cap is enforced
  both when retrieval selects chunks and when the prompt is assembled.
- **Misleading source snippets.** Two separate faults made citations look
  unrelated to the answer they supported. Windows were ranked by total
  query-term count, so for "bereavement leave" a paragraph repeating "leave"
  outranked the one defining bereavement leave; and the winning window was
  chosen at 40 words but displayed at 240 characters, so the term that won it
  could be truncated away. Excerpts are now scored exactly as displayed, ranked
  by distinct terms matched before total occurrences.

### Known limitations

- **The 2048-token window is the binding constraint.** One handbook chunk fills
  the context budget, so most questions retrieve a single chunk. Questions whose
  answer spans two sections will find the right material and then have to drop
  most of it. Restarting vLLM with `--max-model-len 8192` and raising
  `MAX_CONTEXT_CHARS` to 12000 is the single biggest available quality win; see
  [backend/README.md](backend/README.md).
- PDF page numbers leak into extracted text ("a leave of absence with 22 pay"),
  which occasionally surfaces in answers. That comes from ingestion, upstream of
  this release.
- `indexed_vectors_count` reads 0 in Qdrant. Expected — 413 points is below the
  10000 indexing threshold, so search is exact rather than HNSW.
- PTO extraction is keyed to the 2025 handbook's wording. If it changes, update
  `TIER_PATTERNS` in `backend/maud_service/pto.py`; an unparseable table falls
  through to the model rather than producing a wrong number.

### Verified against

The deployed stack on `10.10.1.165` — vLLM serving `google/gemma-3-1b-it`
(`max_model_len` 2048), Qdrant holding 413 points at 768 dimensions, cosine
distance. Both the table-parsing path and the streaming vLLM path were
exercised end to end against the 2025 handbook. Frontend typechecks and builds;
28 backend tests pass.
