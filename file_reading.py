"""
Reads and indexes local files (.py, .txt, .md, .json, .pdf, .docx) so the
desktop app can answer questions about an entire project folder — same RAG
pattern as the YouTube pipeline, but for files on disk instead of transcripts.
"""

import os
import json
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from pypdf import PdfReader
from docx import Document

embedding = OpenAIEmbeddings()
model = ChatOpenAI()

# File types we know how to read. Anything else gets skipped when indexing a folder.
SUPPORTED_EXTENSIONS = {".py", ".txt", ".md", ".json", ".js", ".html", ".css", ".pdf", ".docx"}

# Folders to always skip when walking a project (huge, irrelevant, or binary-heavy)
IGNORE_DIRS = {".git", "__pycache__", "node_modules", "venv", ".venv", "chatbot", "dist", "build"}

project_index_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Project_vector_store")
os.makedirs(project_index_dir, exist_ok=True)


def _project_index_path(folder_path):
    # Turn the folder path into a safe filename by replacing path separators
    safe_name = folder_path.replace(":", "").replace("\\", "_").replace("/", "_")
    return os.path.join(project_index_dir, f"{safe_name}_faiss")


def read_file_text(file_path):
    """
    Reads a single file and returns its text content.
    Returns None if the file type isn't supported or reading fails.
    """
    ext = os.path.splitext(file_path)[1].lower()

    try:
        if ext == ".pdf":
            reader = PdfReader(file_path)
            return "\n".join(page.extract_text() or "" for page in reader.pages)

        if ext == ".docx":
            doc = Document(file_path)
            return "\n".join(p.text for p in doc.paragraphs)

        if ext in SUPPORTED_EXTENSIONS:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()

    except Exception as e:
        print(f"Could not read {file_path}: {e}")
        return None

    return None  # unsupported extension


def list_directory(folder_path):
    """
    Returns a simple tree of a folder's contents for the file explorer UI.
    Only goes one level deep per call — the UI expands folders on click.
    """
    items = []
    try:
        for entry in sorted(os.listdir(folder_path)):
            if entry in IGNORE_DIRS or entry.startswith("."):
                continue
            full_path = os.path.join(folder_path, entry)
            items.append({
                "name": entry,
                "path": full_path,
                "is_dir": os.path.isdir(full_path),
            })
    except Exception as e:
        return {"error": str(e)}
    return items


def index_project(folder_path, force_refresh=False):
    """
    Walks the whole project folder, reads every supported file, chunks and
    embeds them all into one FAISS store — same caching pattern as the video
    pipeline, so re-indexing an unchanged project is instant.
    Each chunk keeps a "source" metadata field so answers can cite the file.
    """
    index_path = _project_index_path(folder_path)

    if os.path.exists(index_path) and not force_refresh:
        return FAISS.load_local(index_path, embeddings=embedding, allow_dangerous_deserialization=True)

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000, chunk_overlap=200, separators=["\n\n", "\n", " ", ""]
    )

    all_chunks = []
    all_metadata = []

    for root, dirs, files in os.walk(folder_path):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]

        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue

            full_path = os.path.join(root, filename)
            text = read_file_text(full_path)
            if not text:
                continue

            chunks = text_splitter.split_text(text)
            for chunk in chunks:
                all_chunks.append(chunk)
                all_metadata.append({"source": os.path.relpath(full_path, folder_path)})

    if not all_chunks:
        return "No readable files found in this folder"

    vector_store = FAISS.from_texts(all_chunks, embedding, metadatas=all_metadata)
    vector_store.save_local(index_path)
    return vector_store


# ---------- Answering questions about the project (with conversation memory) ----------

# Keeps recent Q&A turns per project folder, in memory, so follow-up questions
# like "what about the one you just mentioned" actually have context to work with.
# Resets when the server restarts — this is session memory, not permanent storage.
_chat_histories = {}
MAX_HISTORY_TURNS = 6  # how many past Q&A pairs to keep feeding back into the prompt

prompt = PromptTemplate(
    template="""
    You are a coding assistant answering questions about the user's own project files.
    Use the context below (code and docs from their project) to answer.
    Use the conversation history to understand follow-up questions
    (e.g. "that function", "the one you just mentioned").

    Formatting rules:
    - When you include any code, ALWAYS wrap it in triple backticks with the
      language name, like ```python ... ```
    - Keep explanations outside the code block, in plain text.
    - If the answer isn't in the context, say so plainly instead of guessing.

    Conversation history:
    {history}

    Context (from files: {sources}):
    {context}

    Question: {question}

    Answer:
    """,
    input_variables=["history", "context", "sources", "question"],
)
parser = StrOutputParser()
chain = prompt | model | parser


def _format_history(folder_path):
    history = _chat_histories.get(folder_path, [])
    if not history:
        return "(no previous questions yet)"
    return "\n".join(f"Q: {q}\nA: {a}" for q, a in history)


def clear_project_history(folder_path):
    """Call this when the user opens a different project / wants a fresh session."""
    _chat_histories.pop(folder_path, None)


def answer_project_query(folder_path, query, k=5):
    """
    Retrieves relevant chunks from the indexed project and answers the question,
    citing which files the context came from.
    """
    vector_store = index_project(folder_path)
    if isinstance(vector_store, str):  # error case
        return vector_store

    retriever = vector_store.as_retriever(search_kwargs={"k": k})
    results = retriever.invoke(query)

    if not results:
        return "I couldn't find anything relevant in this project."

    context = "\n\n".join(doc.page_content for doc in results)
    sources = ", ".join(sorted(set(doc.metadata.get("source", "unknown") for doc in results)))
    history = _format_history(folder_path)

    return chain.invoke({"history": history, "context": context, "sources": sources, "question": query})
