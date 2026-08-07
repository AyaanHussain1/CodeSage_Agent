const API_URL =
    window.location.hostname === "localhost"
        ? "http://localhost:8000"
        : "https://dependable-connection-production-41ff.up.railway.app";

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

let currentFolder = null;

// ---------- Resizable panels (drag the dividers to resize, like VS Code) ----------

function makeResizable(handle, panel, side) {
  // side: "left" means dragging grows/shrinks the panel on the LEFT of the handle (fileTree)
  //       "right" means it grows/shrinks the panel on the RIGHT of the handle (chatPanel)
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("dragging");

    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;

    function onMouseMove(moveEvent) {
      const delta = moveEvent.clientX - startX;
      const newWidth = side === "left" ? startWidth + delta : startWidth - delta;
      panel.style.width = newWidth + "px";
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

// ---------- Folder selection ----------

openFolderBtn.addEventListener("click", async () => {
  const folderPath = await window.electronAPI.selectFolder();
  if (!folderPath) return;

  currentFolder = folderPath;
  statusEl.textContent = folderPath;
  indexBtn.disabled = false;

  fileTree.innerHTML = "";
  const rootList = await buildTree(folderPath);
  fileTree.appendChild(rootList);
});

// ---------- File tree ----------

// Fetches one folder level from the backend and builds a <ul> for it.
async function buildTree(folderPath) {
  const res = await fetch(`${API_URL}/list_dir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: folderPath }),
  });
  const data = await res.json();

  const list = document.createElement("div");
  if (data.error) {
    list.innerHTML = `<p class="hint">${data.error}</p>`;
    return list;
  }

  for (const item of data.items) {
    const row = document.createElement("div");
    row.className = "tree-item" + (item.is_dir ? " dir" : "");
    row.textContent = (item.is_dir ? "📁 " : "📄 ") + item.name;
    list.appendChild(row);

    if (item.is_dir) {
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";
      list.appendChild(childrenContainer);

      let loaded = false;
      row.addEventListener("click", async () => {
        childrenContainer.classList.toggle("open");
        if (!loaded) {
          const childTree = await buildTree(item.path);
          childrenContainer.appendChild(childTree);
          loaded = true;
        }
      });
    } else {
      row.addEventListener("click", () => previewFile(item.path));
    }
  }

  return list;
}

// ---------- File preview ----------

// Maps file extensions to highlight.js language names
const LANGUAGE_MAP = {
  ".py": "python", ".js": "javascript", ".html": "html", ".css": "css",
  ".json": "json", ".md": "markdown", ".txt": "plaintext",
};

async function previewFile(filePath) {
  filePreview.innerHTML = `<p class="hint">Loading…</p>`;
  const res = await fetch(`${API_URL}/read_file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  const data = await res.json();

  if (data.error) {
    filePreview.innerHTML = `<p class="hint">${data.error}</p>`;
    return;
  }

  const fileName = filePath.split(/[\\/]/).pop();
  const ext = "." + fileName.split(".").pop();
  const lang = LANGUAGE_MAP[ext] || "plaintext";

  // Header bar (filename) + copy button, like a proper code editor tab
  filePreview.innerHTML = `
    <div class="preview-header">
      <span class="preview-filename">${fileName}</span>
      <button class="copy-btn" id="copyPreviewBtn">Copy</button>
    </div>
    <pre class="code-block"><code class="language-${lang}"></code></pre>
  `;

  const codeEl = filePreview.querySelector("code");
  codeEl.textContent = data.content; // set as text first (avoids HTML injection)

  if (window.hljs) {
    window.hljs.highlightElement(codeEl);
  }

  filePreview.querySelector("#copyPreviewBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(data.content);
    flashCopyButton(filePreview.querySelector("#copyPreviewBtn"));
  });
}

function flashCopyButton(btn) {
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = original), 1500);
}

// ---------- Indexing the whole project ----------

indexBtn.addEventListener("click", async () => {
  if (!currentFolder) return;

  indexBtn.disabled = true;
  indexBtn.textContent = "Indexing…";
  statusEl.textContent = "Indexing project — this can take a while the first time";

  try {
    const res = await fetch(`${API_URL}/index_project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentFolder }),
    });
    const data = await res.json();

    if (data.error) {
      statusEl.textContent = "Error: " + data.error;
    } else {
      statusEl.textContent = currentFolder + " — ready";
      questionInput.disabled = false;
      askBtn.disabled = false;
      emptyState.querySelector("p").textContent = "Ask anything about this project";
    }
  } catch (err) {
    statusEl.textContent = "Could not reach backend. Is server.py running?";
  } finally {
    indexBtn.disabled = false;
    indexBtn.textContent = "Index Project";
  }
});

// ---------- Chat ----------

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
    bubble.textContent = text; // plain text, no code parsing needed
  } else {
    renderMessageContent(bubble, text); // may contain code blocks
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return row;
}

// Splits an AI response on ``` fences and renders each part appropriately:
// plain text as a paragraph, code as a highlighted block with a copy button.
// Handles both fenced ```python code``` and, as a fallback, unfenced answers
// that are clearly just code (e.g. the model forgot to add fences).
function renderMessageContent(container, text) {
  const parts = text.split(/```(\w*)\n?/);
  // parts alternates: [plainText, lang, code, plainText, lang, code, ...]

  if (parts.length === 1) {
    // No code fences found — just render as plain wrapped text
    const p = document.createElement("p");
    p.className = "msg-text";
    p.textContent = text;
    container.appendChild(p);
    return;
  }

  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      // plain text segment
      const chunk = parts[i].trim();
      if (chunk) {
        const p = document.createElement("p");
        p.className = "msg-text";
        p.textContent = chunk;
        container.appendChild(p);
      }
    } else if (i % 3 === 2) {
      // code segment (parts[i-1] is the language, parts[i] is the code)
      const lang = parts[i - 1] || "plaintext";
      const code = parts[i];
      container.appendChild(buildCodeBlock(code, lang));
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
  if (!currentFolder || !question) return;

  addMessage(question, "user");
  questionInput.value = "";
  const typingRow = showTypingIndicator();

  try {
    const res = await fetch(`${API_URL}/ask_project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentFolder, question }),
    });
    const data = await res.json();
    typingRow.remove();

    if (data.error) {
      addMessage(data.error, "bot", true);
    } else {
      addMessage(data.answer, "bot");
    }
  } catch (err) {
    typingRow.remove();
    addMessage("Could not reach backend.", "bot", true);
  }
}

askBtn.addEventListener("click", sendQuestion);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendQuestion();
});
