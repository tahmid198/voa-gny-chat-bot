This folder is no longer read by the app.

Documents are ingested on the maud-ai host instead:

    ssh skunk@10.10.1.165
    cd /opt/maud-ai
    cp <your files> documents/
    venv/bin/python ingest_documents.py

That embeds each chunk with BAAI/bge-base-en-v1.5 and writes it to the
"hr-documents" collection in Qdrant. Once ingestion finishes, click
"Refresh document list" in the status panel to pick up the new files.
