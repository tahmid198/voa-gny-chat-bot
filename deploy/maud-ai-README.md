# /opt/maud-ai

This machine answers questions about VOA-Greater New York's HR documents.
Everything runs here — no document text or question ever leaves the network.

> Installed by `deploy/install.sh`. To change it, edit
> `voa-gny-chat-bot/deploy/maud-ai-README.md` and re-run the installer.

## What is running

Four processes, in the order a question flows through them:

| Process            | Port   | What it does                                          |
| ------------------ | ------ | ----------------------------------------------------- |
| `voa-gny-frontend` | `3000` | The web page staff use. A browser and nothing else.   |
| `maud-ai`          | `8100` | Finds the relevant document passages and writes the answer. |
| Qdrant             | `6333` | Database of embedded document text. The searchable index. |
| vLLM               | `8000` | Runs the language model, `google/gemma-3-1b-it`.      |

**Staff use http://10.10.1.165:3000.** The other three are internal; nobody
needs to visit them directly.

A question goes: browser → frontend → `maud-ai` → Qdrant (find passages) →
vLLM (write the answer) → back to the browser.

## What is in this folder

| Path                  | What it is                                    | Needed by            |
| --------------------- | --------------------------------------------- | -------------------- |
| `venv/`               | Python environment with all the AI libraries  | `maud-ai`, every script |
| `qdrant_storage/`     | Qdrant's database files — **the actual index** | Qdrant               |
| `documents/`          | The source PDFs, Word and Excel files         | `ingest_documents.py` |
| `ingest_documents.py` | Reads `documents/` and builds the search index | You, when documents change |
| `maud_service/`       | The API's code — a shortcut into `voa-gny-chat-bot/` | `maud-ai`      |
| `voa-gny-chat-bot/`   | The web app's code, already built              | `voa-gny-frontend`   |
| `rag_chat.py`         | Ask questions from the terminal instead of a browser | You, optionally |
| `search.py`           | Debugging: show which passages a question finds | You, optionally     |
| `find_pto.py`         | Debugging: find every passage mentioning PTO   | You, optionally      |
| `check_chunks.py`     | Debugging: print specific passages by number   | You, optionally      |
| `postgres_data/`      | Not used by the assistant — left from something earlier | —           |
| `__pycache__/`        | Python's compiled cache. Safe to delete; it comes back | —            |

## Everyday tasks

### Use it

Open **http://10.10.1.165:3000**. Nothing to install.

The coloured dot in the top right is the health check — green means all four
processes are working. Click it to see which one is unhappy if it is not green.

### Add or change documents

Copy the files in, then rebuild the index:

```bash
cd /opt/maud-ai
cp /path/to/new-file.pdf documents/
source venv/bin/activate
python3 ingest_documents.py
```

PDF, Word (`.docx`) and Excel (`.xlsx`) are read; anything else is skipped.
Subfolders are included.

**This rebuilds the whole index from scratch.** It deletes the existing one
first, so while it runs the assistant will report that no documents are
available. It takes a few minutes for a hundred documents. Do it when nobody
is relying on the assistant.

When it finishes, click **Refresh document list** in the web page's status
panel so it picks up the new file count.

### Ask from the terminal

```bash
cd /opt/maud-ai
source venv/bin/activate
python3 rag_chat.py
```

Same documents, same model, no browser. Type `quit` to leave.

This is the original script and is kept as-is. The web app is the maintained
version and has since had fixes the script does not — ordinal wording
("21st year" rather than "21th year"), better source excerpts, and a context
budget that matches the model's window. Prefer the web app when the answer
matters.

### Restart, or check logs

```bash
sudo systemctl restart maud-ai voa-gny-frontend

journalctl -u maud-ai -f            # the answering API
journalctl -u voa-gny-frontend -f   # the web page
```

Both start automatically on boot. `maud-ai` takes 10–20 seconds to become
ready because it loads the embedding model first.

### Update the app

```bash
cd /opt/maud-ai/voa-gny-chat-bot
./deploy/install.sh
```

Pulls the latest code, rebuilds and restarts both services. Documents and the
index are untouched.

## Debugging scripts

All three need `source venv/bin/activate` first. None of them change anything —
they only read.

```bash
python3 search.py        # top 5 passages for a question (edit the question inside)
python3 find_pto.py      # every passage mentioning PTO or vacation
python3 check_chunks.py  # specific passages by number (edit the list inside)
```

`check_chunks.py` only looks at the first 200 passages, so it will not find
anything beyond that without editing.

## Do not delete

- **`qdrant_storage/`** — this is the index. Delete it and the assistant knows
  nothing until `ingest_documents.py` is run again.
- **`venv/`** — the Python environment. Everything here needs it.
- **`documents/`** — the originals. Needed to rebuild the index.

Deleting `__pycache__/` is harmless.

## When something is wrong

Start with the status panel in the web page — it names the failing piece.

| Panel says            | Meaning                                            |
| --------------------- | -------------------------------------------------- |
| Service offline       | `maud-ai` is not running — `systemctl status maud-ai` |
| Model server offline  | vLLM is not running on port 8000                   |
| Vector store offline  | Qdrant is not running on port 6333                 |
| Model not loaded      | vLLM is running a different model than expected    |

If the page itself will not load, `voa-gny-frontend` is down.

Answers that say the information is unavailable usually mean the document was
never ingested — check the document count in the status panel.
