// Address of your local Python backend (see backend/server.py)
const API_URL =  process.env.NODE_ENV === "development"
    ? "http://localhost:8000"
    : "https://dependable-connection-production-664c.up.railway.app";

// --- Grab all the HTML elements we need ---
const videoIdInput = document.getElementById("videoIdInput");
const loadBtn = document.getElementById("loadBtn");
const loadSpinner = document.getElementById("loadSpinner");
const statusEl = document.getElementById("status");
const chatWindow = document.getElementById("chatWindow");
const emptyState = document.getElementById("emptyState");
const questionInput = document.getElementById("questionInput");
const askBtn = document.getElementById("askBtn");

let currentVideoId = null;

// ---------- Helpers ----------

// Adds one chat bubble (with a small avatar) to the chat window
function addMessage(text, sender, isError = false) {
  emptyState.style.display = "none";

  const row = document.createElement("div");
  row.className = "message-row " + sender;

  const avatar = document.createElement("div");
  avatar.className = "avatar " + sender;
  avatar.textContent = sender === "user" ? "YOU" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble" + (isError ? " error" : "");
  bubble.textContent = text;

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  return row;
}

// Shows an animated "typing..." bubble while waiting for the backend to respond.
// Returns the row element so we can remove it once the real answer arrives.
function showTypingIndicator() {
  const row = document.createElement("div");
  row.className = "message-row bot";
  row.innerHTML = `
    <div class="avatar bot">AI</div>
    <div class="bubble">
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return row;
}

function setLoadingState(isLoading) {
  loadBtn.disabled = isLoading;
  loadSpinner.classList.toggle("active", isLoading);
}

// Briefly swaps the Load button's text (e.g. to "Already Indexed"),
// then reverts it back to "Load" after a couple seconds.
const loadBtnLabel = loadBtn.querySelector(".btn-label");
function flashLoadButton(message) {
  const original = loadBtnLabel.textContent;
  loadBtnLabel.textContent = message;
  setTimeout(() => {
    loadBtnLabel.textContent = original;
  }, 2000);
}

function enableChat(enabled) {
  questionInput.disabled = !enabled;
  askBtn.disabled = !enabled;
}

// ---------- Auto-detect the current YouTube video ----------

// Pulls the "v=..." video ID out of a YouTube URL.
// Works for both youtube.com/watch?v=ID and youtu.be/ID formats.
function extractVideoId(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("youtube.com")) {
      return parsed.searchParams.get("v"); // youtube.com/watch?v=ID
    }
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1); // youtu.be/ID
    }
  } catch (e) {
    // not a valid URL — ignore
  }
  return null;
}

// Checks the currently active browser tab. If it's a YouTube video,
// fills in the video ID automatically and loads it right away.
async function autoDetectVideo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  const videoId = extractVideoId(tab.url);

  if (videoId) {
    videoIdInput.value = videoId;
    statusEl.textContent = "Detected video from current tab";
    loadBtn.click(); // auto-load, no manual click needed
  } else {
    statusEl.textContent = "Not a YouTube tab — paste a YouTube video ID to load one manually";
  }
}

// ---------- Step 1: Load / index a video ----------
loadBtn.addEventListener("click", async () => {
  const videoId = videoIdInput.value.trim();
  if (!videoId) {
    statusEl.textContent = "Please paste a video ID first.";
    return;
  }

  currentVideoId = videoId;
  chatWindow.innerHTML = "";
  chatWindow.appendChild(emptyState);
  emptyState.style.display = "block";
  emptyState.querySelector("p").textContent = "Indexing video…";

  statusEl.textContent = "Indexing video — this can take a minute the first time.";
  setLoadingState(true);
  enableChat(false);

  try {
    const response = await fetch(`${API_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId }),
    });
    const data = await response.json();

    if (data.error) {
      statusEl.textContent = "Error: " + data.error;
      emptyState.querySelector("p").textContent = "Couldn't index this video";
    } else if (data.status === "already_indexed") {
      statusEl.textContent = "This video was already indexed — loaded instantly";
      emptyState.querySelector("p").textContent = "Ask anything about this video";
      enableChat(true);
      flashLoadButton("Already Indexed");
    } else {
      statusEl.textContent = "Ready — ask a question below";
      emptyState.querySelector("p").textContent = "Ask anything about this video";
      enableChat(true);
      flashLoadButton("Indexed");
    }
  } catch (err) {
    statusEl.textContent = "Could not reach backend. Is server.py running?";
  } finally {
    setLoadingState(false);
  }
});

// ---------- Step 2: Ask a question ----------
async function sendQuestion() {
  const question = questionInput.value.trim();
  if (!currentVideoId || !question) return;

  addMessage(question, "user");
  questionInput.value = "";

  const typingRow = showTypingIndicator();

  try {
    const response = await fetch(`${API_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: currentVideoId, question: question }),
    });
    const data = await response.json();

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
videoIdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadBtn.click();
});

// Run detection the moment the popup opens
autoDetectVideo();
