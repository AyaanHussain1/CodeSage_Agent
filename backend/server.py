"""
Simple backend server for the Chrome extension.

This exposes your existing RAG functions (get_indexed_video, answer_query)
as two web endpoints the extension can call:
  POST /index  -> indexes a video (translate, chunk, embed, cache)
  POST /ask    -> answers a question about an already-indexed video

Run with:
    uvicorn server:app --reload --port 8000
"""

import sys
import os

# server.py lives in backend/, but embedding_and_retrieving.py and prompting_llm.py
# live one folder up (the project root) — this line adds that folder to Python's
# search path so the imports below can find them.
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import uuid
import shutil

# --- Import your existing pipeline functions ---
# get_vector_store lives in embedding_and_retrieving.py
# answer_query lives in prompting_llm.py
from embedding_and_retrieving import get_vector_store
from prompting_llm import answer_query

# --- Desktop app: local file / project reading ---
from file_reading import list_directory, index_project, answer_project_query, read_file_text

app = FastAPI()

# Chrome extensions run on a different "origin" than localhost web pages,
# so we need to allow cross-origin requests from the extension.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all local origins during development
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Request schemas (what the extension sends us) ----------

class IndexRequest(BaseModel):
    video_id: str
    to_translate: str = "en"


class AskRequest(BaseModel):
    video_id: str
    question: str
    to_translate: str = "en"


# --- Desktop app request schemas ---

class ListDirRequest(BaseModel):
    path: str


class ReadFileRequest(BaseModel):
    path: str


class IndexProjectRequest(BaseModel):
    path: str
    force_refresh: bool = False


class AskProjectRequest(BaseModel):
    path: str
    question: str


# ---------- Endpoints ----------

@app.post("/index")
def index_video(req: IndexRequest):
    """
    Indexes a video: translates transcript, chunks it, embeds it,
    and caches everything to disk (handled inside get_vector_store).

    We check the cache folder ourselves BEFORE calling get_vector_store so we
    can tell the extension whether this was a fresh index or an instant
    cache hit — get_vector_store itself doesn't report that distinction.
    """
    from embedding_and_retrieving import embedding_dir as _embedding_dir
    index_path = os.path.join(_embedding_dir, f"{req.video_id}_{req.to_translate}_faiss")
    already_indexed = os.path.exists(index_path)

    result = get_vector_store(req.video_id, req.to_translate)

    if isinstance(result, str):  # error message case
        return {"error": result}

    return {"status": "already_indexed" if already_indexed else "indexed"}


@app.post("/ask")
def ask_question(req: AskRequest):
    """
    Answers a question about an already-indexed video.
    """
    answer = answer_query(req.video_id, req.question, req.to_translate)

    if answer.startswith("Error") or answer.startswith("No transcript") or answer.startswith("No chunk"):
        return {"error": answer}

    return {"answer": answer}


# ---------- Desktop app endpoints (local files / project folders) ----------

@app.post("/list_dir")
def list_dir(req: ListDirRequest):
    """
    Returns the contents of a folder (one level deep) for the file-explorer sidebar.
    """
    items = list_directory(req.path)
    if isinstance(items, dict) and "error" in items:
        return items
    return {"items": items}


@app.post("/read_file")
def read_file(req: ReadFileRequest):
    """
    Returns the raw text content of a single file, for previewing in the UI.
    """
    text = read_file_text(req.path)
    if text is None:
        return {"error": "Could not read this file (unsupported type or read error)"}
    return {"content": text}


@app.post("/index_project")
def index_project_endpoint(req: IndexProjectRequest):
    """
    Indexes every supported file in a project folder so questions can be
    asked about the whole codebase at once.
    """
    result = index_project(req.path, req.force_refresh)
    if isinstance(result, str):  # error case
        return {"error": result}
    return {"status": "indexed"}


@app.post("/ask_project")
def ask_project(req: AskProjectRequest):
    """
    Answers a question about the indexed project, citing which files it used.
    """
    try:
        answer = answer_project_query(req.path, req.question)
    except Exception as e:
        return {"error": f"Server error: {str(e)}"}

    if isinstance(answer, str) and answer.startswith("No readable files"):
        return {"error": answer}
    return {"answer": answer}


# ---------- Web app: upload a project folder (instead of reading a local path) ----------
# Browsers can't read arbitrary paths off my disk like Electron could — so the
# web app uploads the selected files here, we save them into a temp folder on
# the SERVER, and hand back that server-side path. Everything downstream
# (index_project, ask_project) works exactly the same from that point on.

uploads_base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploaded_projects")
os.makedirs(uploads_base_dir, exist_ok=True)

MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB
MAX_UPLOAD_FILE_COUNT = 300

@app.post("/upload_project")
async def upload_project(files: List[UploadFile] = File(...)):
    """
    Saves uploaded files into a fresh folder on the server, preserving their
    relative folder structure (the browser sends each file's relative path
    as its "filename", e.g. "src/utils/helper.py").
    Returns the server-side path to use with /index_project and /ask_project.
    """
    if len(files) > MAX_UPLOAD_FILE_COUNT:
        raise HTTPException(
            status_code=413,
            detail=f"Too many files uploaded ({len(files)}). Maximum is {MAX_UPLOAD_FILE_COUNT}.",
        )

    total_size = 0
    for upload in files:
        total_size += len(await upload.read())
        if total_size > MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Upload too large ({total_size / (1024 * 1024):.1f} MB). Maximum is {MAX_UPLOAD_SIZE_BYTES / (1024 * 1024):.0f} MB.",
            )
        await upload.seek(0)

    project_id = str(uuid.uuid4())
    project_dir = os.path.join(uploads_base_dir, project_id)
    os.makedirs(project_dir, exist_ok=True)

    for upload in files:
        # upload.filename may contain forward slashes representing subfolders
        relative_path = upload.filename.replace("\\", "/")
        dest_path = os.path.join(project_dir, *relative_path.split("/"))
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)

        with open(dest_path, "wb") as out_file:
            shutil.copyfileobj(upload.file, out_file)

    return {"project_path": os.path.abspath(project_dir)}


# Railway (and most hosts) give you the port to bind to via an environment
# variable — this lets the same code run locally (defaults to 8000) and on
# the server (uses whatever port the host assigns).
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)