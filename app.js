// Phase 2.1 — UI + local persistence (no real audio yet)

const STORAGE_KEYS = {
  notes: "mygptapp_notes_v1",
  tasks: "mygptapp_tasks_v1",
};

// ---------- IndexedDB (Audio Store) ----------
const DB_NAME = "mygptapp_db";
const DB_VERSION = 1;
const AUDIO_STORE = "audio";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

async function putAudio(audioId, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, "readwrite");
    tx.objectStore(AUDIO_STORE).put(blob, audioId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getAudio(audioId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, "readonly");
    const req = tx.objectStore(AUDIO_STORE).get(audioId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteAudio(audioId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, "readwrite");
    tx.objectStore(AUDIO_STORE).delete(audioId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

const $ = (id) => document.getElementById(id);

const state = {
  recording: false,
  notes: [],
  tasks: [],
};

let mediaStream = null;
let mediaRecorder = null;
let audioChunks = [];
let currentAudioBlob = null;
let currentAudioUrl = null;
let currentAudioId = null;

// ---------- Storage ----------
function load() {
  try {
    state.notes = JSON.parse(localStorage.getItem(STORAGE_KEYS.notes) || "[]");
    state.tasks = JSON.parse(localStorage.getItem(STORAGE_KEYS.tasks) || "[]");
  } catch {
    state.notes = [];
    state.tasks = [];
  }
}
function save() {
  localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(state.notes));
  localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(state.tasks));
}

// ---------- Utils ----------
function nowLabel() {
  const d = new Date();
  return d.toLocaleString();
}
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function setGlobalStatus(msg) {
  $("globalStatus").textContent = msg;
}

// ---------- Render ----------
function renderNotes() {
  const ul = $("notesList");
  ul.innerHTML = "";

  if (!state.notes.length) {
    ul.innerHTML = `<li class="item"><p class="itemText">No notes yet.</p></li>`;
    return;
  }

  for (const note of state.notes) {
    const li = document.createElement("li");
    li.className = "item";

    li.innerHTML = `
      <div class="itemTop">
        <div>
          <p class="itemTitle">${escapeHtml(note.title || "Untitled")}</p>
          <div class="itemMeta">${escapeHtml(note.createdAt)}</div>
        </div>

        <div class="itemActions">
          <button class="btn tiny ghost" data-action="deleteNote" data-id="${note.id}">Delete</button>
        </div>
      </div>

      <p class="itemText">${escapeHtml(note.text || "")}</p>
    `;

    ul.appendChild(li);

    if (note.audioId) {
      getAudio(note.audioId)
        .then((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);

          const wrap = document.createElement("div");
          wrap.className = "audioPreview";

          const audio = document.createElement("audio");
          audio.controls = true;
          audio.src = url;

          wrap.appendChild(audio);
          li.appendChild(wrap);
        })
        .catch(() => {});
    }
  }
}

function renderTasks() {
  const ul = $("tasksList");
  ul.innerHTML = "";

  if (!state.tasks.length) {
    ul.innerHTML = `<li class="item"><p class="itemText">No tasks yet.</p></li>`;
    return;
  }

  for (const task of state.tasks) {
    const li = document.createElement("li");
    li.className = "item";

    li.innerHTML = `
      <div class="itemTop">
        <div>
          <p class="itemTitle">${escapeHtml(task.title || "Untitled task")}</p>
          <div class="itemMeta">${escapeHtml(task.createdAt)} · <span class="badge ${task.priority}">${task.priority}</span></div>
        </div>

        <div class="itemActions">
          <button class="btn tiny ghost" data-action="toggleDone" data-id="${task.id}">
            ${task.done ? "Undone" : "Done"}
          </button>
          <button class="btn tiny ghost" data-action="deleteTask" data-id="${task.id}">Delete</button>
        </div>
      </div>

      ${task.details ? `<p class="itemText">${escapeHtml(task.details)}</p>` : ""}
    `;

    if (task.done) {
      li.style.opacity = "0.62";
    }

    ul.appendChild(li);
  }
}

// ---------- Actions ----------
async function startRecording() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      setGlobalStatus("Micro not supported in this browser.");
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    currentAudioBlob = null;
    currentAudioId = null;

    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      currentAudioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });

      const audioId = crypto.randomUUID ? crypto.randomUUID() : "aud_" + Date.now();

      await putAudio(audioId, currentAudioBlob);

      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);

      currentAudioUrl = URL.createObjectURL(currentAudioBlob);
      currentAudioId = audioId;

      const preview = $("audioPreview");
      const player = $("audioPlayer");
      player.src = currentAudioUrl;
      preview.hidden = false;

      setGlobalStatus("Recording stopped. Audio saved (IndexedDB) + preview ready.");
    };

    mediaRecorder.start();

    state.recording = true;
    $("btnStart").disabled = true;
    $("btnStop").disabled = false;
    $("recordingHint").textContent = "Recording… Speak now.";
    $("audioPreview").hidden = true;

    setGlobalStatus("Recording started.");
  } catch (err) {
    setGlobalStatus("Micro permission denied or unavailable.");
    console.error(err);
    cleanupRecording();
  }
}

function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  } finally {
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) track.stop();
    }
    state.recording = false;
    $("btnStart").disabled = false;
    $("btnStop").disabled = true;
    $("recordingHint").textContent = "Ready.";
  }
}

function cleanupRecording() {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
  }
  mediaStream = null;
  mediaRecorder = null;
  audioChunks = [];
  state.recording = false;

  $("btnStart").disabled = false;
  $("btnStop").disabled = true;
  $("recordingHint").textContent = "Ready.";

  $("audioPreview").hidden = true;
  $("audioPlayer").src = "";
}

function discardNoteInputs() {
  $("noteTitle").value = "";
  $("noteText").value = "";
}

function addNote() {
  const title = $("noteTitle").value.trim();
  const text = $("noteText").value.trim();

  if (!title && !text) {
    setGlobalStatus("Note not saved: title or notes required.");
    return;
  }

  const note = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title,
    text,
    createdAt: nowLabel(),
    audioId: currentAudioId || null,
  };

  state.notes.unshift(note);
  currentAudioBlob = null;
  currentAudioUrl = null;
  currentAudioId = null;
  $("audioPreview").hidden = true;
  $("audioPlayer").src = "";
  save();
  renderNotes();
  discardNoteInputs();
  setGlobalStatus("Note saved.");
}

function addTask() {
  const title = $("taskTitle").value.trim();
  const details = $("taskDetails").value.trim();
  const priority = $("taskPriority").value;

  if (!title) {
    setGlobalStatus("Task not added: title required.");
    return;
  }

  const task = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title,
    details,
    priority,
    done: false,
    createdAt: nowLabel(),
  };

  state.tasks.unshift(task);
  save();
  renderTasks();

  $("taskTitle").value = "";
  $("taskDetails").value = "";
  $("taskPriority").value = "MEDIUM";

  setGlobalStatus("Task added.");
}

function deleteNote(id) {
  const n = state.notes.find((x) => x.id === id);
  if (n?.audioId) {
    deleteAudio(n.audioId);
  }
  state.notes = state.notes.filter((n) => n.id !== id);
  save();
  renderNotes();
  setGlobalStatus("Note deleted.");
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  save();
  renderTasks();
  setGlobalStatus("Task deleted.");
}

function toggleTaskDone(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  save();
  renderTasks();
  setGlobalStatus(t.done ? "Task marked done." : "Task marked undone.");
}

// ---------- Init ----------
function bindEvents() {
  $("btnStart").addEventListener("click", startRecording);
  $("btnStop").addEventListener("click", stopRecording);
  $("btnSaveNote").addEventListener("click", addNote);
  $("btnDiscardNote").addEventListener("click", discardNoteInputs);

  $("btnAddTask").addEventListener("click", addTask);

  $("btnClearNotes").addEventListener("click", () => {
    state.notes = [];
    save();
    renderNotes();
    setGlobalStatus("All notes cleared.");
  });

  $("btnClearTasks").addEventListener("click", () => {
    state.tasks = [];
    save();
    renderTasks();
    setGlobalStatus("All tasks cleared.");
  });

  $("notesList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === "deleteNote") deleteNote(id);
  });

  $("tasksList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === "deleteTask") deleteTask(id);
    if (action === "toggleDone") toggleTaskDone(id);
  });
}

(function init() {
  load();
  openDB().catch(() => {});
  bindEvents();
  cleanupRecording();
  renderNotes();
  renderTasks();
  setGlobalStatus("OK: Phase 2.1 loaded (UI + local persistence).");
})();
