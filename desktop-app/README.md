# Desktop App Setup

This is a separate app from the Chrome extension, but shares the same backend
(`backend/server.py`) — it just calls new endpoints for reading local files
instead of YouTube videos.

## 1. Install the new Python packages (backend side)

With your venv activated:
```bash
pip install pypdf python-docx
```

## 2. Install Node.js (if you don't have it)

Download from https://nodejs.org (LTS version). This is needed to run Electron.

## 3. Install the desktop app's dependencies

```bash
cd desktop-app
npm install
```

## 4. Run everything

**Terminal 1 — backend** (same as before):
```bash
cd backend
python -m uvicorn server:app --reload --port 8000
```

**Terminal 2 — desktop app:**
```bash
cd desktop-app
npm start
```

A window should open with three panels: file explorer (left), file preview
(middle), and chat (right).

## How to use it

1. Click **Open Folder** → pick any project folder (e.g. one of your ML repos)
2. Click a file in the tree to preview it
3. Click **Index Project** → reads every `.py`, `.md`, `.txt`, `.json`, `.pdf`,
   `.docx` file in the folder and embeds them (cached — instant on repeat runs)
4. Ask a question like *"where is the training loop defined?"* or
   *"suggest how to add error handling to data_loader.py"*

## What's new on the backend

Four new endpoints were added to `server.py` (your existing `/index` and
`/ask` for YouTube are untouched):

| Endpoint | Purpose |
|---|---|
| `/list_dir` | Lists files/folders one level deep, for the file tree |
| `/read_file` | Returns a file's raw text, for the preview pane |
| `/index_project` | Reads + embeds every supported file in a folder |
| `/ask_project` | Answers a question using the indexed project, citing source files |

All of this logic lives in the new `file_reading.py` — your video pipeline
files (`translation_and_chunking.py`, `embedding_and_retrieving.py`,
`prompting_llm.py`) weren't touched.

## Known limitations (be aware of these)

- **Large projects will be slow to index the first time** — every file gets
  chunked and embedded via the OpenAI API, so a big repo means many API calls.
  Cached after that, same as the video pipeline.
- **Binary files (images, .exe, etc.) are skipped automatically.**
- **This does not read code shown inside a video** — that's a separate,
  unbuilt feature (would need OCR on video frames) we talked about earlier.
