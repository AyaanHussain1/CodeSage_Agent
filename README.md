# CodeSage

**An AI agent that answers questions about YouTube tutorials and your own codebase.** One shared RAG backend powers a Chrome extension, an IDE-style desktop app, and a deployed web app.

https://www.linkedin.com/feed/update/urn:li:activity:7512941216662208512/

---

## Overview

CodeSage is a Retrieval-Augmented Generation (RAG) system with two modes:

- **YouTube mode:** give it a video ID and ask questions about what the video covers. Transcripts are auto-translated, so non-English videos work too.
- **Project mode:** point it at a codebase (a local folder in the desktop app, or uploaded files in the web app) and ask about your code, docs, or PDFs. Answers cite the file they came from.

Both modes share one pipeline (chunk, embed, retrieve, generate), so the same backend serves all three front ends.

---

## Screenshots

<!-- Replace the paths below with your own screenshots -->

| Desktop app (IDE-style) | Chrome extension | Web app |
|---|---|---|
| ![Desktop](docs/screenshots/desktop.png) | ![Extension](docs/screenshots/extension.png) | ![Web](docs/screenshots/web.png) |

---

## Architecture

```
                      ┌────────────────────────┐
                      │     FastAPI Backend     │
                      │  (Docker container)     │
                      │                         │
                      │  YouTube pipeline:      │
                      │   translate → chunk     │
                      │   → embed → retrieve    │
                      │                         │
                      │  Project pipeline:      │
                      │   read files → chunk    │
                      │   → embed → retrieve    │
                      └────────────┬────────────┘
                                   │  REST API
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
 ┌───────▼────────┐      ┌─────────▼────────┐      ┌─────────▼────────┐
 │ Chrome         │      │ Desktop app      │      │ Web app          │
 │ extension      │      │ (Electron)       │      │ (static site)    │
 │                │      │                  │      │                  │
 │ YouTube        │      │ Local folder     │      │ Upload files,    │
 │ transcript Q&A │      │ access, file     │      │ shareable link   │
 │                │      │ tree, preview    │      │                  │
 └────────────────┘      └──────────────────┘      └──────────────────┘
```

All three clients are plain HTML, CSS, and JavaScript with no framework, and talk to the same REST API.

---

## Features

- **Auto-translation:** detects the transcript language and translates it, so non-English videos work.
- **Smart caching:** transcripts, embeddings, and FAISS indexes are cached on disk (`transcript_cache/`, `Embedding_vector_store/`, `Project_vector_store/`). Re-querying the same video or project is instant and does not re-call the OpenAI API.
- **Multi-format file support:** `.py`, `.js`, `.html`, `.css`, `.md`, `.json`, `.pdf`, `.docx`.
- **IDE-style desktop UI:** resizable file tree, syntax-highlighted preview, and a chat panel.
- **Code-aware chat:** code in answers renders as copyable, syntax-highlighted blocks instead of flattened text.
- **Coding help:** explanations, debugging guidance, and code proposals based on the indexed project. Chat never modifies your files.
- **Source attribution:** project-mode answers cite the file they came from.

---

## Tech stack

| Layer | Tools |
|---|---|
| Backend | FastAPI, LangChain, OpenAI (chat model and embeddings), FAISS |
| Transcripts | `youtube-transcript-api`, `deep-translator` |
| File parsing | `pypdf`, `python-docx` |
| Desktop app | Electron |
| Front ends | Vanilla HTML/CSS/JS, `highlight.js` |
| Packaging | Docker (backend), static web app |

---

## Project structure

```
CodeSage_Agent/
├── backend/
│   └── server.py                    # FastAPI app: endpoints for all 3 clients
├── translation_and_chunking.py      # YouTube transcript fetch, translate, chunk
├── embedding_and_retrieving.py      # YouTube embeddings, FAISS index, retriever
├── prompting_llm.py                 # YouTube RAG chain (prompt | model | parser)
├── file_reading.py                  # Project file reading, chunking, embedding, RAG chain
├── extensions/                      # Chrome extension (Manifest V3)
│   ├── manifest.json
│   └── popup.html / popup.css / popup.js
├── desktop-app/                     # Electron IDE-style app
│   ├── main.js / preload.js
│   └── index.html / style.css / renderer.js
├── web-app/                         # Deployed web version
│   ├── index.html / style.css / app.js
│   └── DEPLOYMENT.md
├── Dockerfile                       # Backend container
├── requirements.txt
└── .gitignore
```

---

## Run it locally

### Prerequisites

- Python 3.10 or newer
- Node.js (for the desktop app)
- An OpenAI API key

### 1. Backend

```bash
python -m venv venv
venv\Scripts\activate            # Windows
# source venv/bin/activate       # Mac/Linux

pip install -r requirements.txt
```

Create a `.env` file in the repository root:

```
OPENAI_API_KEY=your-key-here
```

Start the server:

```bash
python -m uvicorn backend.server:app --reload --port 8000
```

Keep this terminal open. All three clients need the backend running.

### 2. Chrome extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extensions/` folder.
3. Open a YouTube video, click the CodeSage icon, and ask a question.

**Run the extension UI as a local web page instead:**

```bash
cd extensions
python -m http.server 8081 --bind 127.0.0.1
```

Then open http://localhost:8081/popup.html and paste a YouTube video ID. In this mode the page talks to the backend at http://localhost:8000.

### 3. Desktop app

```bash
cd desktop-app
npm install
npm start
```

Choose a project folder to index, then browse files and chat about your code.

### 4. Web app

```bash
cd web-app
python -m http.server 8080
```

Open **http://localhost:8080** in your browser.

> `python -m http.server` does not always print a clickable link. Once the terminal says "Serving HTTP on … port 8080", open the address above yourself and keep the terminal running. If the page cannot reach the API, check that the backend is running on port 8000.

---

## Deployment

CodeSage is built to run locally. The backend ships with a `Dockerfile`, and the web app is a static site that can be hosted anywhere (for example Vercel), but it needs a running backend to answer questions.

To build and run the backend container yourself:

```bash
docker build -t codesage-backend .
docker run --env-file .env -p 8000:8000 codesage-backend   # adjust the port to match the Dockerfile
```

Set `OPENAI_API_KEY` as an environment variable on your host. Never commit your `.env` file.

---

## API endpoints

| Endpoint | Used by | Purpose |
|---|---|---|
| `POST /index` | Extension | Index a YouTube video's transcript |
| `POST /ask` | Extension | Ask a question about an indexed video |
| `POST /list_dir` | Desktop app | List a folder's contents (file tree) |
| `POST /read_file` | Desktop app | Read a single file's content (preview) |
| `POST /index_project` | Desktop app | Index all files in a local folder |
| `POST /ask_project` | Desktop app, web app | Ask a question about an indexed project |
| `POST /upload_project` | Web app | Upload files (browsers cannot read local paths) |

---

## Known limitations

- **YouTube on hosted servers:** YouTube often blocks transcript requests that come from cloud-provider IP addresses, so YouTube mode works best when the backend runs locally. Project mode is not affected.
- **Local folders:** reading a local folder works only in the desktop app. The web app uses file upload instead.
- **Spoken content only:** YouTube mode reads the transcript, not code shown on screen.
- **Chat history:** it resets when the backend restarts.

---

## Roadmap

- OCR-based code extraction from video frames
- Persistent chat history across sessions
- Scheduled cleanup of uploaded project folders on the hosted backend

---

## License

MIT
