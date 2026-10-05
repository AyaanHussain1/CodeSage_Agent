# CodeSage

An AI agent that answers questions about YouTube tutorials and your own codebase — available as a Chrome extension, a desktop app, and a web app, all powered by one shared backend.

**Live demo:** https://code-sage-agent-seven.vercel.app/

---

## What it does

CodeSage is a Retrieval-Augmented Generation (RAG) system with two capabilities:

- **YouTube mode** — paste a video ID, and ask questions about what's covered in the transcript. Handles auto-translation, so it works on non-English videos too.
- **Project mode** — point it at a codebase (local folder or uploaded files), and ask questions about your own code, docs, or PDFs. Answers cite which file the information came from.

Same underlying pipeline (chunk → embed → retrieve → generate) powers three different front-ends, so you can use whichever fits the moment — browsing YouTube, working in your IDE, or sharing a link with someone else.

---

## Architecture

```
                        ┌─────────────────────┐
                        │   FastAPI Backend    │
                        │ (separate Python host)│
                        │                       │
                        │  YouTube pipeline:    │
                        │   translate → chunk   │
                        │   → embed → retrieve  │
                        │                       │
                        │  Project pipeline:    │
                        │   read files → chunk  │
                        │   → embed → retrieve  │
                        └───────────┬───────────┘
                                    │
         ┌──────────────────┬──────┴──────┬──────────────────┐
         │                  │              │                  │
  ┌──────▼──────┐   ┌───────▼───────┐   ┌─▼──────────────┐
  │   Chrome     │   │   Desktop App  │   │    Web App      │
  │  Extension   │   │   (Electron)   │   │ (deployed:      │
  │              │   │                │   │  Vercel)        │
  │ YouTube      │   │ Local file     │   │ Upload files,   │
  │ transcript   │   │ system access, │   │ browser-based,  │
  │ Q&A          │   │ IDE-style UI   │   │ shareable link   │
  └──────────────┘   └────────────────┘   └──────────────────┘
```

All three clients are plain HTML/CSS/JS — no framework — talking to the same REST API.

---

## Tech stack

- **Backend:** FastAPI, LangChain, OpenAI (`gpt` + embeddings), FAISS (vector store)
- **Transcript handling:** `youtube-transcript-api`, `deep-translator`
- **File parsing:** `pypdf`, `python-docx`
- **Desktop app:** Electron
- **Frontends:** Vanilla HTML/CSS/JS, `highlight.js` for syntax highlighting
- **Deployment:** Python-capable host (backend), Vercel static hosting (web app)

---

## Project structure

```
CodeSage/
├── backend/
│   └── server.py              # FastAPI app — all endpoints for all 3 clients
├── translation_and_chunking.py # YouTube transcript fetch + translate + chunk
├── embedding_and_retrieving.py # YouTube embedding + FAISS + retriever
├── prompting_llm.py            # YouTube RAG chain (prompt | model | parser)
├── file_reading.py             # Project-file reading, chunking, embedding, RAG chain
├── extensions/                 # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── popup.html / .css / .js
├── desktop-app/                 # Electron IDE-style app
│   ├── main.js / preload.js
│   ├── index.html / style.css / renderer.js
├── web-app/                     # Deployed web version
│   ├── index.html / style.css / app.js
│   └── DEPLOYMENT.md
├── requirements.txt
└── .gitignore
```

---

## Features

- **Auto-translation** — works on non-English YouTube transcripts, auto-detects source language
- **Smart caching** — transcripts, embeddings, and FAISS indexes are cached to disk; re-querying the same video/project is instant and doesn't re-hit the OpenAI API
- **Multi-format file support** — `.py`, `.js`, `.html`, `.css`, `.md`, `.json`, `.pdf`, `.docx`
- **IDE-style desktop UI** — resizable file tree, syntax-highlighted preview, chat panel
- **Code-aware chat** — responses with code render as proper, copyable syntax-highlighted blocks (not flattened plain text)
- **Coding help** — ask for explanations, debugging guidance, or code proposals based on the indexed project; chat does not modify uploaded files
- **Source attribution** — project-mode answers cite which file they came from

---

## Running it locally

### 1. Backend

```bash
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux

pip install -r requirements.txt

# Create a .env file in the repository root with:
# OPENAI_API_KEY=your-key-here

python -m uvicorn backend.server:app --reload --port 8000
```

### 2. Chrome extension
1. Go to `chrome://extensions`
2. Enable Developer Mode
3. **Load unpacked** → select the `extensions/` folder

To use the YouTube transcript chat as a local webpage instead of opening the
Chrome extension, keep the backend running, then serve the extension files:

```powershell
cd extensions
py -m http.server 8081 --bind 127.0.0.1
```

Open http://localhost:8081/popup.html and paste the YouTube video ID. In this
local mode, the page uses the backend at http://localhost:8000.

### 3. Desktop app
```bash
cd desktop-app
npm install
npm start
```

### 4. Web app
```bash
cd web-app
python -m http.server 8080
```
Open http://localhost:8080. The web app expects the backend to be running on
http://localhost:8000 when served from localhost.

---

## API endpoints

| Endpoint | Used by | Purpose |
|---|---|---|
| `POST /index` | Extension | Index a YouTube video's transcript |
| `POST /ask` | Extension | Ask a question about an indexed video |
| `POST /list_dir` | Desktop app | List a folder's contents (file tree) |
| `POST /read_file` | Desktop app | Read a single file's content (preview) |
| `POST /index_project` | Desktop app | Index all files in a local folder |
| `POST /ask_project` | Desktop app, Web app | Ask a question about an indexed project |
| `POST /upload_project` | Web app | Upload files (browser can't read local paths directly) |

---

## What I'd build next

- OCR-based code extraction from video frames (currently only reads spoken transcript, not on-screen code)
- Persistent chat history across sessions (currently resets when the backend restarts)
- Scheduled cleanup of uploaded project folders on the web app's backend

---

## License

MIT
