# Release notes

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
