# voa-gny-chat-bot

A Google-style search page for your company documents. Ask a question in plain
English; the backend finds the relevant passages in your files and a model
running on the Jetson Nano writes the answer, with citations back to the source
documents.

Nothing leaves your network — the documents stay on the web server and the model
runs on the Jetson.

## How it works

1. On first request the server walks `DOCS_DIR`, extracts text from every
   supported file, and splits it into overlapping chunks (cached in memory).
2. Each question is scored against those chunks with BM25 keyword ranking.
3. The top chunks are sent to Ollama on the Jetson as context, with instructions
   to answer only from that context and cite sources.
4. The answer streams back token by token.

Supported file types: `.txt` `.md` `.log` `.json` `.csv` `.tsv` `.pdf` `.docx`
`.xlsx` `.xls` `.xlsm`. Subfolders are indexed too.

## Setup

```bash
npm install
cp .env.example .env.local   # already done if .env.local exists
npm run dev
```

Open http://localhost:3000.

Drop your files into the `documents/` folder (or point `DOCS_DIR` somewhere
else). Use the status menu in the top right to re-index after adding files.

## Configuration

Everything tunable lives in `.env.local`:

| Variable             | Default                      | Purpose                                      |
| -------------------- | ---------------------------- | -------------------------------------------- |
| `OLLAMA_HOST`        | `http://192.168.3.153:11434` | Where the Jetson's Ollama API lives           |
| `OLLAMA_MODEL`       | `llama3.2:3b`                | Model to run — must be pulled on the Jetson  |
| `OLLAMA_TIMEOUT_MS`  | `180000`                     | How long to wait for a response               |
| `JETSON_IP`          | `192.168.3.153`              | Used to build the default host and in errors  |
| `JETSON_SSH_USER`    | `admin`                      | Reference only; the app doesn't SSH           |
| `DOCS_DIR`           | `./documents`                | Folder to index                               |
| `MAX_FILE_SIZE_MB`   | `25`                         | Skip files larger than this                   |
| `MAX_CONTEXT_CHUNKS` | `8`                          | Passages sent to the model per question       |

Changing the IP or model is a `.env.local` edit plus a restart — no code changes.

## Jetson Nano setup

SSH in as `admin@192.168.3.153`, then:

```bash
# Install Ollama if it isn't there yet
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model small enough for the Nano's RAM
ollama pull llama3.2:3b
```

By default Ollama only listens on `127.0.0.1`, so this app can't reach it across
the network. Bind it to all interfaces:

```bash
sudo systemctl edit ollama
```

Add:

```
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Then:

```bash
sudo systemctl restart ollama
```

Verify from the machine running this app:

```bash
curl http://192.168.3.153:11434/api/tags
```

The status dot in the app's top-right corner turns green once the Jetson is
reachable and the configured model is present.

## API

| Route            | Method | Purpose                                                  |
| ---------------- | ------ | -------------------------------------------------------- |
| `/api/chat`      | POST   | `{ question, history? }` → newline-delimited JSON stream |
| `/api/documents` | GET    | What's currently indexed                                  |
| `/api/documents` | POST   | Force a re-index                                          |
| `/api/health`    | GET    | Jetson reachability, available models, index stats        |

## Notes

- The index is held in memory and built lazily. Restarting the server or hitting
  the re-index button picks up file changes.
- Retrieval is keyword-based (BM25) — fast, no embedding model needed, and no
  extra load on the Jetson. If you later want semantic matching, `lib/search.ts`
  is the only file that needs to change.
- Answers are grounded in retrieved passages, but small models still make
  mistakes. The citations are there so anything important can be checked against
  the source.
