// CHANGE THIS when you deploy the backend somewhere public (e.g. Railway).
// Locally, this points at your own machine; for the link you show recruiters,
// this needs to be your deployed backend's URL instead of localhost.
const API_URL =  process.env.NODE_ENV === "development"
    ? "http://localhost:8000"
    : "https://dependable-connection-production-664c.up.railway.app";

const folderInput = document.getElementById("folderInput");
const openFolderBtn = document.getElementById("openFolderBtn");
const indexBtn = document.getElementById("indexBtn");
const statusEl = document.getElementById("status");
const fileTree = document.getElementById("fileTree");
const filePreview = document.getElementById("filePreview");
const chatPanel = document.getElementById("chatPanel");
const chatWindow = document.getElementById("chatWindow");
const emptyState = document.getElementById("emptyState");
const questionInput = document.getElementById("questionInput");
const askBtn = document.getElementById("askBtn");

let selectedFiles = [];   // raw File objects from the browser, kept for upload + preview
let projectPath = null;   // server-side path returned after upload (used by /index_project, /ask_project)

const LANGUAGE_MAP = {
  ".py": "python", ".js": "javascript", ".html": "html", ".css": "css",
  ".json": "json", ".md": "markdown", ".txt": "plaintext",
};
const PREVIEWABLE_TEXT_EXT = new Set([".py", ".txt", ".md", ".json", ".js", ".html", ".css"]);
const UPLOADABLE_EXTENSIONS = new Set([".py", ".txt", ".md", ".json", ".js", ".html", ".css", ".pdf", ".docx"]);
const MAX_TOTAL_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_UPLOAD_FILE_COUNT = 300;

// ---------- Resizable panels (same as desktop app) ----------
function makeResizable(handle, panel, side) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("dragging");
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;

    function onMouseMove(moveEvent) {
      const delta = moveEvent.clientX - startX;
      panel.style.width = (side === "left" ? startWidth + delta : startWidth - delta) + "px";
    }
    function onMouseUp() {
      handle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}
makeResizable(document.getElementById("resizeLeft"), fileTree, "left");
makeResizable(document.getElementById("resizeRight"), chatPanel, "right");

// ---------- Folder selection (browser-native, no Electron) ----------

openFolderBtn.addEventListener("click", () => folderInput.click());

folderInput.addEventListener("change", () => {
  selectedFiles = Array.from(folderInput.files);
  if (selectedFiles.length === 0) return;

  // Filter down to only files the backend knows how to index.
  selectedFiles = selectedFiles.filter((file) => {
    const ext = "." + file.name.split(".").pop().toLowerCase();
    return UPLOADABLE_EXTENSIONS.has(ext);
  });

  if (selectedFiles.length === 0) {
    statusEl.textContent = "No supported files found in that folder.";
    indexBtn.disabled = true;
    return;
  }

  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  if (selectedFiles.length > MAX_UPLOAD_FILE_COUNT || totalSize > MAX_TOTAL_UPLOAD_SIZE) {
    statusEl.textContent = `Folder too large to upload: ${selectedFiles.length} files, ${(totalSize / (1024 * 1024)).toFixed(1)} MB. Select fewer files or a smaller project.`;
    indexBtn.disabled = true;
    return;
  }

  const rootFolderName = selectedFiles[0].webkitRelativePath.split("/")[0];
  statusEl.textContent = `${rootFolderName} (${selectedFiles.length} files, ${(totalSize / (1024 * 1024)).toFixed(1)} MB) — click Index Project`;
  indexBtn.disabled = false;
  projectPath = null; // needs re-indexing since it's a new selection

  renderFileTree(selectedFiles);
});

// ---------- File tree (built entirely client-side, no server round trip needed) ----------

function renderFileTree(files) {
  fileTree.innerHTML = "";

  // Build a nested object tree from each file's relative path segments
  const root = {};
  for (const file of files) {
    const parts = file.webkitRelativePath.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      if (isFile) {
        node[part] = { __file: file };
      } else {
        node[part] = node[part] || { __children: {} };
        node = node[part].__children;
      }
    });
  }

  fileTree.appendChild(buildTreeElement(root));
}

function buildTreeElement(node) {
  const container = document.createElement("div");
  for (const name of Object.keys(node)) {
    const entry = node[name];
    const row = document.createElement("div");

    if (entry.__file) {
      row.className = "tree-item";
      row.textContent = "📄 " + name;
      row.addEventListener("click", () => previewFile(entry.__file));
      container.appendChild(row);
    } else {
      row.className = "tree-item dir";
      row.textContent = "📁 " + name;
      container.appendChild(row);

      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";
      childrenContainer.appendChild(buildTreeElement(entry.__children));
      container.appendChild(childrenContainer);

      row.addEventListener("click", () => childrenContainer.classList.toggle("open"));
    }
  }
  return container;
}

// ---------- File preview (reads the file directly in-browser, no server needed) ----------

function previewFile(file) {
  const ext = "." + file.name.split(".").pop().toLowerCase();

  if (!PREVIEWABLE_TEXT_EXT.has(ext)) {
    filePreview.innerHTML = `<p class="hint">Preview not supported for this file type, but it will still be indexed for chat.</p>`;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const lang = LANGUAGE_MAP[ext] || "plaintext";
    filePreview.innerHTML = `
      <div class="preview-header">
        <span class="preview-filename">${file.name}</span>
        <button class="copy-btn" id="copyPreviewBtn">Copy</button>
      </div>
      <pre class="code-block"><code class="language-${lang}"></code></pre>
    `;
    const codeEl = filePreview.querySelector("code");
    codeEl.textContent = reader.result;
    if (window.hljs) window.hljs.highlightElement(codeEl);

    filePreview.querySelector("#copyPreviewBtn").addEventListener("click", () => {
      navigator.clipboard.writeText(reader.result);
      flashCopyButton(filePreview.querySelector("#copyPreviewBtn"));
    });
  };
  reader.readAsText(file);
}

function flashCopyButton(btn) {
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = original), 1500);
}

// ---------- Indexing: upload files to the server, then index them ----------

indexBtn.addEventListener("click", async () => {
  if (selectedFiles.length === 0) return;

  indexBtn.disabled = true;
  indexBtn.textContent = "Uploading…";
  statusEl.textContent = "Uploading files to server…";

  try {
    // Step 1: upload every selected file, preserving folder structure via filename
    const formData = new FormData();
    for (const file of selectedFiles) {
      formData.append("files", file, file.webkitRelativePath);
    }

    const uploadRes = await fetch(`${API_URL}/upload_project`, {
      method: "POST",
      body: formData,
    });
    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      throw new Error(`Upload failed (${uploadRes.status}): ${errorText}`);
    }
    const uploadData = await uploadRes.json();
    projectPath = uploadData.project_path;

    // Step 2: index the now-uploaded project on the server
    indexBtn.textContent = "Indexing…";
    statusEl.textContent = "Indexing project — this can take a while the first time";

    const indexRes = await fetch(`${API_URL}/index_project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath }),
    });
    if (!indexRes.ok) {
      const errorText = await indexRes.text();
      throw new Error(`Index failed (${indexRes.status}): ${errorText}`);
    }
    const indexData = await indexRes.json();

    if (indexData.error) {
      statusEl.textContent = "Error: " + indexData.error;
    } else {
      statusEl.textContent = "Ready — ask a question below";
      questionInput.disabled = false;
      askBtn.disabled = false;
      emptyState.querySelector("p").textContent = "Ask anything about this project";
    }
  } catch (err) {
    const message = err.message || "Backend error";
    statusEl.textContent = message;
    console.error(err);
    projectPath = null;
  } finally {
    indexBtn.disabled = false;
    indexBtn.textContent = "Index Project";
  }
});

// ---------- Chat (identical logic to the desktop app) ----------

function addMessage(text, sender, isError = false) {
  emptyState.style.display = "none";
  const row = document.createElement("div");
  row.className = "message-row " + sender;

  const avatar = document.createElement("div");
  avatar.className = "avatar " + sender;
  avatar.textContent = sender === "user" ? "YOU" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble" + (isError ? " error" : "");

  if (isError || sender === "user") {
    bubble.textContent = text;
  } else {
    renderMessageContent(bubble, text);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return row;
}

function renderMessageContent(container, text) {
  const parts = text.split(/```(\w*)\n?/);
  if (parts.length === 1) {
    const p = document.createElement("p");
    p.className = "msg-text";
    p.textContent = text;
    container.appendChild(p);
    return;
  }
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      const chunk = parts[i].trim();
      if (chunk) {
        const p = document.createElement("p");
        p.className = "msg-text";
        p.textContent = chunk;
        container.appendChild(p);
      }
    } else if (i % 3 === 2) {
      const lang = parts[i - 1] || "plaintext";
      container.appendChild(buildCodeBlock(parts[i], lang));
    }
  }
}

function buildCodeBlock(code, lang) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block-wrapper";
  wrapper.innerHTML = `
    <div class="code-block-header">
      <span>${lang}</span>
      <button class="copy-btn">Copy</button>
    </div>
    <pre class="code-block"><code class="language-${lang}"></code></pre>
  `;
  const codeEl = wrapper.querySelector("code");
  codeEl.textContent = code.trim();
  if (window.hljs) window.hljs.highlightElement(codeEl);

  wrapper.querySelector(".copy-btn").addEventListener("click", (e) => {
    navigator.clipboard.writeText(code.trim());
    flashCopyButton(e.target);
  });
  return wrapper;
}

function showTypingIndicator() {
  const row = document.createElement("div");
  row.className = "message-row bot";
  row.innerHTML = `
    <div class="avatar bot">AI</div>
    <div class="bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>
  `;
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return row;
}

async function sendQuestion() {
  const question = questionInput.value.trim();
  if (!projectPath || !question) return;

  addMessage(question, "user");
  questionInput.value = "";
  const typingRow = showTypingIndicator();

  try {
    const res = await fetch(`${API_URL}/ask_project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, question }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      typingRow.remove();
      addMessage(`Backend error: ${res.status} ${errorText}`, "bot", true);
      return;
    }
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      typingRow.remove();
      addMessage(`Backend returned invalid response: ${parseErr.message}`, "bot", true);
      return;
    }
    typingRow.remove();
    if (data.error) addMessage(data.error, "bot", true);
    else addMessage(data.answer, "bot");
  } catch (err) {
    typingRow.remove();
    addMessage(`Could not reach backend: ${err.message}`, "bot", true);
  }
}

askBtn.addEventListener("click", sendQuestion);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendQuestion();
});
