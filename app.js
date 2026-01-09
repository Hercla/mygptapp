// Phase 2.1 — UI + local persistence (no real audio yet)

const STORAGE_KEYS = {
  notes: "mygptapp_notes_v1",
  tasks: "mygptapp_tasks_v1",
};

const $ = (id) => document.getElementById(id);

const state = {
  recording: false,
  notes: [],
  tasks: [],
};

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
function setRecording(on) {
  state.recording = on;
  $("btnStart").disabled = on;
  $("btnStop").disabled = !on;
  $("recordingHint").textContent = on
    ? "Recording (mock)… You can type notes and save."
    : "Ready.";
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
  };

  state.notes.unshift(note);
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
  $("btnStart").addEventListener("click", () => setRecording(true));
  $("btnStop").addEventListener("click", () => setRecording(false));
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
  bindEvents();
  setRecording(false);
  renderNotes();
  renderTasks();
  setGlobalStatus("OK: Phase 2.1 loaded (UI + local persistence).");
})();
