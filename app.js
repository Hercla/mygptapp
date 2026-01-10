// Phase 2.1 — UI + local persistence (no real audio yet)

const STORAGE_KEYS = {
  notes: "mygptapp_notes_v1",
  tasks: "mygptapp_tasks_v1",
};

const PRIORITY_VALUES = [1, 2, 3, 4, 5];
const MODE_UI = {
  IMMEDIATE: { icon: "", label: "Immediate", cls: "is-immediate" },
  QUICK: { icon: "⚡", label: "Quick", cls: "is-quick" },
  SCHEDULED: { icon: "", label: "Scheduled", cls: "is-scheduled" },
  ERRAND: { icon: "", label: "Errand", cls: "is-errand" },
  REMEMBER: { icon: "", label: "Remember", cls: "is-remember" },
  WAITING: { icon: "⏳", label: "Waiting", cls: "is-waiting" },
};
const RECURRENCE_LABELS = {
  NONE: "None",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
};

// ---------- IndexedDB (Audio Store) ----------
const DB_NAME = "mygptapp_db";
const DB_VERSION = 2;
const AUDIO_STORE = "audio";
const ATTACH_STORE = "attachments";

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
      if (!db.objectStoreNames.contains(ATTACH_STORE)) {
        db.createObjectStore(ATTACH_STORE);
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

async function putAttachment(attId, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACH_STORE, "readwrite");
    tx.objectStore(ATTACH_STORE).put(blob, attId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getAttachment(attId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACH_STORE, "readonly");
    const req = tx.objectStore(ATTACH_STORE).get(attId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteAttachment(attId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACH_STORE, "readwrite");
    tx.objectStore(ATTACH_STORE).delete(attId);
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
let currentAttachments = [];
let currentTaskMode = "IMMEDIATE";
let currentPriorityLevel = 3;
let currentTimeView = "ALL";
let hideDone = true;
const POMO_DEFAULT_SECONDS = 25 * 60;
const POMO_DEEP_SECONDS = 50 * 60;
const pomodoroTimers = {};
let activePomodoroId = null;
let pomodoroInterval = null;

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

function ensureSubtasks(task) {
  if (!Array.isArray(task.subtasks)) task.subtasks = [];
}

function normalizePriorityLevel(task) {
  if (MODE_UI[task.priority]) {
    task.mode = task.mode || task.priority;
  }
  if (task.priority && String(task.priority).startsWith("P")) {
    const parsed = Number(String(task.priority).slice(1));
    if (!Number.isNaN(parsed)) {
      task.priorityLevel = parsed;
    }
  }
  if (typeof task.priorityLevel !== "number") {
    task.priorityLevel = 3;
  }
  if (!PRIORITY_VALUES.includes(task.priorityLevel)) {
    task.priorityLevel = 3;
  }
}

function normalizeMode(task) {
  const legacyMode = { HIGH: "IMMEDIATE", MEDIUM: "QUICK", LOW: "WAITING" };
  if (!task.mode && legacyMode[task.priority]) {
    task.mode = legacyMode[task.priority];
  }
  if (!task.mode || !MODE_UI[task.mode]) {
    task.mode = "IMMEDIATE";
  }
}

function normalizeRecurrence(task) {
  if (!task.recurrence || typeof task.recurrence !== "object") {
    task.recurrence = { type: "NONE", interval: 1 };
    return;
  }
  if (!RECURRENCE_LABELS[task.recurrence.type]) {
    task.recurrence.type = "NONE";
  }
  if (typeof task.recurrence.interval !== "number" || task.recurrence.interval < 1) {
    task.recurrence.interval = 1;
  }
}

function defaultPriorityForMode(mode) {
  switch (mode) {
    case "IMMEDIATE":
      return 1;
    case "SCHEDULED":
      return 2;
    case "WAITING":
      return 2;
    case "ERRAND":
      return 3;
    case "QUICK":
      return 4;
    case "REMEMBER":
      return 4;
    default:
      return 3;
  }
}

function applyPriorityFromMode(task) {
  if (task.priorityLocked) return;
  normalizeMode(task);
  task.priorityLevel = defaultPriorityForMode(task.mode);
}

function computeProgress(task) {
  ensureSubtasks(task);
  if (!task.subtasks.length) return 0;
  const done = task.subtasks.filter((s) => s.done).length;
  return Math.round((done / task.subtasks.length) * 100);
}

function dateToTs(dateStr) {
  if (!dateStr) return null;
  const ts = Date.parse(`${dateStr}T00:00:00`);
  return Number.isNaN(ts) ? null : ts;
}

function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymdToDate(ymd) {
  if (!ymd) return null;
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function addDaysYMD(ymd, days) {
  const dt = ymdToDate(ymd);
  if (!dt) return null;
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function matchesTimeView(task, timeView, today) {
  const doD = task.doDate || null;
  const dueD = task.dueDate || null;

  if (timeView === "ALL") return true;

  if (timeView === "NODATE") {
    return !doD && !dueD;
  }

  if (timeView === "TODAY") {
    return doD === today;
  }

  if (timeView === "OVERDUE") {
    return !!dueD && dueD < today && !task.done;
  }

  if (timeView === "WEEK") {
    if (!doD) return false;
    const end = addDaysYMD(today, 7);
    return doD >= today && doD <= end;
  }

  return true;
}

function taskSortKey(task, today) {
  const due = task.dueDate || null;
  const doD = task.doDate || null;
  const isOver = !!due && due < today && !task.done;
  const overdueRank = isOver ? 0 : 1;
  const dueRank = due || "9999-12-31";
  const doRank = doD || "9999-12-31";
  const pRank = typeof task.priorityLevel === "number" ? task.priorityLevel : 3;
  return { overdueRank, dueRank, doRank, pRank };
}

function compareTaskKeys(a, b) {
  if (a.overdueRank !== b.overdueRank) return a.overdueRank - b.overdueRank;
  if (a.dueRank !== b.dueRank) return a.dueRank < b.dueRank ? -1 : 1;
  if (a.doRank !== b.doRank) return a.doRank < b.doRank ? -1 : 1;
  return a.pRank - b.pRank;
}

// ---------- DatePicker (Custom OLED) ----------
function createDatePicker() {
  let overlay = null;
  let activeInput = null;
  let viewYear = null;
  let viewMonth = null;
  let selectedYMD = null;

  const DOW = ["L", "M", "M", "J", "V", "S", "D"];

  function ymdFromDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function dateFromYMD(ymd) {
    if (!ymd) return null;
    const [y, m, d] = ymd.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function daysInMonth(y, m0) {
    return new Date(y, m0 + 1, 0).getDate();
  }

  function mondayIndex(jsDate) {
    const js = jsDate.getDay();
    return (js + 6) % 7;
  }

  function ensureOverlay() {
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.className = "dpOverlay";
    overlay.innerHTML = `
      <div class="dpCard" role="dialog" aria-modal="true">
        <div class="dpHeader">
          <div class="dpMonth" id="dpMonthLabel"></div>
          <div class="dpNav">
            <button type="button" class="btn tiny ghost" id="dpPrev">◀</button>
            <button type="button" class="btn tiny ghost" id="dpNext">▶</button>
          </div>
        </div>

        <div class="dpGrid" id="dpGrid"></div>

        <div class="dpFooter">
          <button type="button" class="btn tiny ghost" id="dpToday">Today</button>
          <button type="button" class="btn tiny ghost" id="dpPlus1">+1d</button>
          <button type="button" class="btn tiny ghost" id="dpPlus7">+7d</button>
          <button type="button" class="btn tiny ghost" id="dpPlus30">+30d</button>
          <button type="button" class="btn tiny ghost" id="dpClear">Clear</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    document.addEventListener("keydown", (e) => {
      if (!overlay || overlay.style.display === "none") return;
      if (e.key === "Escape") close();
    });

    overlay.querySelector("#dpPrev").addEventListener("click", () => {
      viewMonth -= 1;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear -= 1;
      }
      render();
    });

    overlay.querySelector("#dpNext").addEventListener("click", () => {
      viewMonth += 1;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear += 1;
      }
      render();
    });

    overlay.querySelector("#dpToday").addEventListener("click", () => {
      const t = new Date();
      setSelected(ymdFromDate(t));
    });

    overlay.querySelector("#dpPlus1").addEventListener("click", () => {
      const base = dateFromYMD(selectedYMD) || new Date();
      base.setDate(base.getDate() + 1);
      setSelected(ymdFromDate(base));
    });

    overlay.querySelector("#dpPlus7").addEventListener("click", () => {
      const base = dateFromYMD(selectedYMD) || new Date();
      base.setDate(base.getDate() + 7);
      setSelected(ymdFromDate(base));
    });

    overlay.querySelector("#dpPlus30").addEventListener("click", () => {
      const base = dateFromYMD(selectedYMD) || new Date();
      base.setDate(base.getDate() + 30);
      setSelected(ymdFromDate(base));
    });

    overlay.querySelector("#dpClear").addEventListener("click", () => {
      if (activeInput) activeInput.value = "";
      close();
    });
  }

  function setSelected(ymd) {
    selectedYMD = ymd;

    if (activeInput) {
      activeInput.value = ymd;
      activeInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const d = dateFromYMD(ymd);
    if (d) {
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
    }

    render();
    close();
  }

  function render() {
    if (!overlay) return;

    const monthLabel = overlay.querySelector("#dpMonthLabel");
    const grid = overlay.querySelector("#dpGrid");
    grid.innerHTML = "";

    DOW.forEach((d) => {
      const el = document.createElement("div");
      el.className = "dpDow";
      el.textContent = d;
      grid.appendChild(el);
    });

    const first = new Date(viewYear, viewMonth, 1);
    const firstIdx = mondayIndex(first);
    const dim = daysInMonth(viewYear, viewMonth);

    const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    const prevDim = daysInMonth(prevYear, prevMonth);

    const today = ymdFromDate(new Date());

    for (let i = 0; i < 42; i++) {
      const cell = document.createElement("div");
      cell.className = "dpDay";

      let dayNum;
      let y;
      let m0;
      let isMuted = false;

      if (i < firstIdx) {
        dayNum = prevDim - (firstIdx - 1 - i);
        y = prevYear;
        m0 = prevMonth;
        isMuted = true;
      } else if (i >= firstIdx + dim) {
        dayNum = i - (firstIdx + dim) + 1;
        y = viewMonth === 11 ? viewYear + 1 : viewYear;
        m0 = viewMonth === 11 ? 0 : viewMonth + 1;
        isMuted = true;
      } else {
        dayNum = i - firstIdx + 1;
        y = viewYear;
        m0 = viewMonth;
      }

      const d = new Date(y, m0, dayNum);
      const ymd = ymdFromDate(d);

      cell.textContent = String(dayNum);
      if (isMuted) cell.classList.add("is-muted");
      if (ymd === today) cell.classList.add("is-today");
      if (selectedYMD && ymd === selectedYMD) cell.classList.add("is-selected");

      cell.addEventListener("click", () => setSelected(ymd));
      grid.appendChild(cell);
    }

    const monthName = new Date(viewYear, viewMonth, 1).toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    });
    monthLabel.textContent = monthName;
  }

  function openFor(inputEl) {
    ensureOverlay();
    activeInput = inputEl;

    const current = (inputEl.value || "").trim();
    selectedYMD = current || null;

    const base = dateFromYMD(selectedYMD) || new Date();
    viewYear = base.getFullYear();
    viewMonth = base.getMonth();

    overlay.style.display = "flex";
    render();
  }

  function close() {
    if (!overlay) return;
    overlay.style.display = "none";
    activeInput = null;
  }

  function initHidden() {
    ensureOverlay();
    overlay.style.display = "none";
  }

  return { openFor, close, initHidden };
}

function advanceDate(dateStr, recurrenceType) {
  if (!dateStr) return null;
  const ts = dateToTs(dateStr);
  if (ts === null) return null;
  const d = new Date(ts);
  if (recurrenceType === "DAILY") d.setDate(d.getDate() + 1);
  if (recurrenceType === "WEEKLY") d.setDate(d.getDate() + 7);
  if (recurrenceType === "MONTHLY") d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function isOverdue(task, todayTs) {
  const dueTs = dateToTs(task.dueDate);
  return !task.done && dueTs !== null && dueTs < todayTs;
}

function getPomodoro(taskId) {
  if (!pomodoroTimers[taskId]) {
    pomodoroTimers[taskId] = {
      duration: POMO_DEFAULT_SECONDS,
      remaining: POMO_DEFAULT_SECONDS,
      running: false,
    };
  }
  return pomodoroTimers[taskId];
}

function formatSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stopPomodoroInterval() {
  if (pomodoroInterval) {
    clearInterval(pomodoroInterval);
    pomodoroInterval = null;
  }
}

function updatePomodoroUI(taskId) {
  const root = document.querySelector(`.pomo[data-task='${taskId}']`);
  if (!root) return;
  const timer = getPomodoro(taskId);
  const timeEl = root.querySelector("[data-role='pomoTime']");
  const fill = root.querySelector("[data-role='pomoFill']");
  const toggleBtn = root.querySelector("[data-action='pomoToggle']");
  const durationBtn = root.querySelector("[data-action='pomoDuration']");

  if (timeEl) timeEl.textContent = formatSeconds(timer.remaining);
  if (fill) {
    const percent = Math.round((timer.remaining / timer.duration) * 100);
    fill.style.width = `${percent}%`;
  }
  if (toggleBtn) toggleBtn.textContent = timer.running ? "Pause" : "Start";
  if (durationBtn) durationBtn.textContent = timer.duration === POMO_DEEP_SECONDS ? "50" : "25";
}

function tickPomodoro() {
  if (!activePomodoroId) {
    stopPomodoroInterval();
    return;
  }
  const timer = pomodoroTimers[activePomodoroId];
  if (!timer || !timer.running) {
    stopPomodoroInterval();
    return;
  }
  timer.remaining = Math.max(0, timer.remaining - 1);
  updatePomodoroUI(activePomodoroId);
  if (timer.remaining === 0) {
    timer.running = false;
    stopPomodoroInterval();
    activePomodoroId = null;
    setGlobalStatus("Pomodoro complete.");
  }
}

function startPomodoro(taskId) {
  const timer = getPomodoro(taskId);
  if (activePomodoroId && activePomodoroId !== taskId) {
    const activeTimer = pomodoroTimers[activePomodoroId];
    if (activeTimer) activeTimer.running = false;
    updatePomodoroUI(activePomodoroId);
  }
  activePomodoroId = taskId;
  timer.running = true;
  if (!pomodoroInterval) {
    pomodoroInterval = setInterval(tickPomodoro, 1000);
  }
  updatePomodoroUI(taskId);
  setGlobalStatus("Pomodoro started.");
}

function pausePomodoro(taskId) {
  const timer = getPomodoro(taskId);
  timer.running = false;
  if (activePomodoroId === taskId) {
    activePomodoroId = null;
  }
  stopPomodoroInterval();
  updatePomodoroUI(taskId);
  setGlobalStatus("Pomodoro paused.");
}

function togglePomodoro(taskId) {
  const timer = getPomodoro(taskId);
  if (timer.running) {
    pausePomodoro(taskId);
  } else {
    startPomodoro(taskId);
  }
}

function resetPomodoro(taskId) {
  const timer = getPomodoro(taskId);
  timer.running = false;
  timer.remaining = timer.duration;
  if (activePomodoroId === taskId) {
    activePomodoroId = null;
  }
  stopPomodoroInterval();
  updatePomodoroUI(taskId);
  setGlobalStatus("Pomodoro reset.");
}

function togglePomodoroDuration(taskId) {
  const timer = getPomodoro(taskId);
  if (timer.running) {
    setGlobalStatus("Pause to change duration.");
    return;
  }
  timer.duration = timer.duration === POMO_DEEP_SECONDS ? POMO_DEFAULT_SECONDS : POMO_DEEP_SECONDS;
  timer.remaining = timer.duration;
  updatePomodoroUI(taskId);
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

    if (note.attachments?.length) {
      const attWrap = document.createElement("div");
      attWrap.className = "attachments";

      note.attachments.forEach((attId) => {
        getAttachment(attId).then((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);

          const div = document.createElement("div");
          div.className = "thumb";
          div.innerHTML = `<img src="${url}" />`;
          attWrap.appendChild(div);
        });
      });

      li.appendChild(attWrap);
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

  const today = todayYMD();
  let tasksToRender = state.tasks.slice();
  tasksToRender.forEach((task) => {
    normalizePriorityLevel(task);
    applyPriorityFromMode(task);
    normalizeRecurrence(task);
  });
  if (hideDone) tasksToRender = tasksToRender.filter((t) => !t.done);
  tasksToRender = tasksToRender.filter((t) => matchesTimeView(t, currentTimeView, today));
  tasksToRender.sort((A, B) => compareTaskKeys(taskSortKey(A, today), taskSortKey(B, today)));
  const meta = $("timeMeta");
  if (meta) {
    meta.textContent = `Time view: ${currentTimeView} - Showing ${tasksToRender.length}`;
  }

  for (const task of tasksToRender) {
    const m = MODE_UI[task.mode] || { icon: "", label: String(task.mode), cls: "" };
    const p = task.priorityLevel ?? 3;
    const pClass = `p${p}`;
    const li = document.createElement("li");
    li.className = "item";
    const overdue = task.dueDate && task.dueDate < today && !task.done;
    const dateLine = `
      <div class="itemMeta">
        ${task.doDate ? `Do: ${escapeHtml(task.doDate)} ` : ""}
        ${task.dueDate ? `- Due: ${escapeHtml(task.dueDate)} ` : ""}
        ${task.recurrence?.type && task.recurrence.type !== "NONE" ? `- Repeat: ${RECURRENCE_LABELS[task.recurrence.type] || task.recurrence.type} ` : ""}
        ${overdue ? '- <span class="badge overdue">OVERDUE</span>' : ""}
      </div>
    `;
    const showPomodoro = task.mode === "IMMEDIATE" || task.mode === "SCHEDULED";
    const timer = showPomodoro ? getPomodoro(task.id) : null;
    const pomodoroHtml = showPomodoro
      ? `
        <div class="pomo" data-task="${task.id}">
          <div class="pomoTop">
            <span class="pomoTime" data-role="pomoTime">${formatSeconds(timer.remaining)}</span>
            <button class="btn tiny ghost" data-action="pomoToggle" data-id="${task.id}">
              ${timer.running ? "Pause" : "Start"}
            </button>
            <button class="btn tiny ghost" data-action="pomoReset" data-id="${task.id}">Reset</button>
            <button class="btn tiny ghost" data-action="pomoDuration" data-id="${task.id}">
              ${timer.duration === POMO_DEEP_SECONDS ? "50" : "25"}
            </button>
          </div>
          <div class="pomoBar">
            <div class="pomoFill" data-role="pomoFill" style="width:${Math.round(
              (timer.remaining / timer.duration) * 100
            )}%"></div>
          </div>
        </div>
      `
      : "";

    li.innerHTML = `
      <div class="itemTop">
        <div>
          <p class="itemTitle">${escapeHtml(task.title || "Untitled task")}</p>
          <div class="modeBadge ${m.cls}">${m.icon} ${m.label}</div>
          <div class="itemMeta">${escapeHtml(task.createdAt)}</div>
          ${dateLine}
        </div>

        <div class="itemActions">
          <select class="pSelect" data-action="setP" data-id="${task.id}">
            ${[1, 2, 3, 4, 5]
              .map((n) => `<option value="${n}" ${n === p ? "selected" : ""}>P${n}</option>`)
              .join("")}
          </select>
          <span class="pBadge ${pClass}">P${p}</span>
          <button class="btn tiny ghost" data-action="toggleDone" data-id="${task.id}">
            ${task.done ? "Undone" : "Done"}
          </button>
          <button class="btn tiny ghost" data-action="deleteTask" data-id="${task.id}">Delete</button>
        </div>
      </div>

      ${task.details ? `<p class="itemText">${escapeHtml(task.details)}</p>` : ""}
      ${pomodoroHtml}
    `;

    if (task.done) {
      li.style.opacity = "0.62";
    }

    ensureSubtasks(task);
    const progress = computeProgress(task);

    if (task.subtasks.length) {
      li.innerHTML += `
        <div class="progress">
          <div style="width:${progress}%"></div>
        </div>

        <div class="subtasks">
          ${task.subtasks
            .map(
              (st) => `
            <label class="subtask">
              <input type="checkbox" data-subtask="${st.id}" ${st.done ? "checked" : ""} />
              ${escapeHtml(st.title)}
            </label>
          `
            )
            .join("")}
        </div>
      `;
    }

    li.innerHTML += `
      <div class="row">
        <button class="btn tiny ghost" data-action="addSubtask" data-id="${task.id}">
          + Sub-task
        </button>
      </div>
    `;

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

function resetCurrentAttachments() {
  currentAttachments = [];
  if ($("noteAttachments")) {
    $("noteAttachments").innerHTML = "";
  }
}

function discardNoteInputs() {
  $("noteTitle").value = "";
  $("noteText").value = "";
}

function renderCurrentAttachments() {
  const wrap = $("noteAttachments");
  wrap.innerHTML = "";

  for (const attId of currentAttachments) {
    getAttachment(attId).then((blob) => {
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const div = document.createElement("div");
      div.className = "thumb";

      div.innerHTML = `
        <img src="${url}" />
        <button data-id="${attId}">✕</button>
      `;

      div.querySelector("button").onclick = async () => {
        await deleteAttachment(attId);
        currentAttachments = currentAttachments.filter((x) => x !== attId);
        renderCurrentAttachments();
      };

      wrap.appendChild(div);
    });
  }
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
    attachments: [...currentAttachments],
  };

  state.notes.unshift(note);
  currentAudioBlob = null;
  currentAudioUrl = null;
  currentAudioId = null;
  currentAttachments = [];
  $("audioPreview").hidden = true;
  $("audioPlayer").src = "";
  $("noteAttachments").innerHTML = "";
  save();
  renderNotes();
  discardNoteInputs();
  setGlobalStatus("Note saved.");
}

function addTask() {
  const titleEl = $("taskTitle");
  const detailsEl = $("taskDetails");
  const doEl = $("doDate");
  const dueEl = $("dueDate");
  const recurrenceEl = $("taskRecurrence");
  const title = (titleEl?.value || "").trim();
  const details = (detailsEl?.value || "").trim();
  const doDate = doEl?.value || null;
  const dueDate = dueEl?.value || null;
  const recurrence = { type: recurrenceEl?.value || "NONE", interval: 1 };

  if (!title) {
    setGlobalStatus("Task not added: title required.");
    return;
  }

  const mode = typeof currentTaskMode === "string" && currentTaskMode ? currentTaskMode : "IMMEDIATE";
  const pUser = Number(currentPriorityLevel);
  const hasUserChosen = [1, 2, 3, 4, 5].includes(pUser) && pUser !== 3;

  const task = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title,
    details,
    priority: mode,
    priorityLevel: hasUserChosen ? pUser : null,
    priorityLocked: hasUserChosen,
    mode,
    doDate,
    dueDate,
    recurrence,
    done: false,
    createdAt: nowLabel(),
    subtasks: [],
    attachments: [],
  };

  applyPriorityFromMode(task);

  state.tasks.unshift(task);
  save();
  renderTasks();

  if (titleEl) titleEl.value = "";
  if (detailsEl) detailsEl.value = "";
  if (doEl) doEl.value = "";
  if (dueEl) dueEl.value = "";
  if (recurrenceEl) recurrenceEl.value = "NONE";
  currentTaskMode = "IMMEDIATE";
  currentPriorityLevel = 3;
  const picker = $("modePicker");
  if (picker) {
    const defaultBtn = picker.querySelector('button[data-mode="IMMEDIATE"]');
    if (defaultBtn) {
      picker.querySelectorAll(".modeChip").forEach((b) => {
        b.classList.remove("is-selected", ...Object.values(MODE_UI).map((x) => x.cls));
      });
      defaultBtn.classList.add("is-selected", MODE_UI.IMMEDIATE.cls);
    }
  }
  const pPicker = $("pPicker");
  if (pPicker) {
    pPicker.querySelectorAll(".pChip").forEach((b) => b.classList.remove("is-selected"));
    const def = pPicker.querySelector('button[data-p="3"]');
    if (def) def.classList.add("is-selected");
  }

  setGlobalStatus("Task added.");
}

function deleteNote(id) {
  const n = state.notes.find((x) => x.id === id);
  if (n?.audioId) {
    deleteAudio(n.audioId);
  }
  if (n?.attachments?.length) {
    n.attachments.forEach((attId) => deleteAttachment(attId));
  }
  state.notes = state.notes.filter((n) => n.id !== id);
  save();
  renderNotes();
  setGlobalStatus("Note deleted.");
}

function deleteTask(id) {
  if (pomodoroTimers[id]) {
    delete pomodoroTimers[id];
  }
  if (activePomodoroId === id) {
    activePomodoroId = null;
    stopPomodoroInterval();
  }
  state.tasks = state.tasks.filter((t) => t.id !== id);
  save();
  renderTasks();
  setGlobalStatus("Task deleted.");
}

function toggleTaskDone(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  normalizeRecurrence(t);
  if (t.done && t.recurrence.type !== "NONE") {
    const hadDo = !!t.doDate;
    const hadDue = !!t.dueDate;
    if (hadDo) {
      t.doDate = advanceDate(t.doDate, t.recurrence.type);
    } else if (hadDue) {
      t.dueDate = advanceDate(t.dueDate, t.recurrence.type);
    }
    t.done = false;
    setGlobalStatus("Recurring task advanced.");
  }
  save();
  renderTasks();
  if (t.recurrence.type === "NONE") {
    setGlobalStatus(t.done ? "Task marked done." : "Task marked undone.");
  }
}

function addSubtask(taskId) {
  const title = prompt("Sub-task title");
  if (!title) return;

  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;

  ensureSubtasks(task);

  task.subtasks.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title,
    done: false,
  });

  save();
  renderTasks();
}

function toggleSubtask(taskId, subId, done) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;

  ensureSubtasks(task);

  const sub = task.subtasks.find((s) => s.id === subId);
  if (!sub) return;

  sub.done = done;

  if (computeProgress(task) === 100) {
    task.done = true;
  }

  save();
  renderTasks();
}

// ---------- Init ----------
function bindEvents() {
  const dp = createDatePicker();
  dp.initHidden();

  $("doDateBtn")?.addEventListener("click", () => dp.openFor($("doDate")));
  $("dueDateBtn")?.addEventListener("click", () => dp.openFor($("dueDate")));
  $("doDate")?.addEventListener("click", () => dp.openFor($("doDate")));
  $("dueDate")?.addEventListener("click", () => dp.openFor($("dueDate")));
  $("doDateClear")?.addEventListener("click", () => {
    const el = $("doDate");
    if (el) el.value = "";
  });
  $("dueDateClear")?.addEventListener("click", () => {
    const el = $("dueDate");
    if (el) el.value = "";
  });

  function validateDoDue() {
    const doV = $("doDate")?.value || "";
    const dueV = $("dueDate")?.value || "";
    const warn = $("dateWarning");
    if (doV && dueV && doV > dueV) {
      setGlobalStatus("Warning: Do date is after Due date.");
      if (warn) {
        warn.innerHTML = `Do > Due. <button type="button" class="btn tiny ghost" id="swapDatesBtn">Swap dates</button>`;
        const swapBtn = $("swapDatesBtn");
        if (swapBtn) {
          swapBtn.addEventListener("click", () => {
            const doEl = $("doDate");
            const dueEl = $("dueDate");
            if (!doEl || !dueEl) return;
            const tmp = doEl.value;
            doEl.value = dueEl.value;
            dueEl.value = tmp;
            if (warn) warn.textContent = "";
            setGlobalStatus("Dates swapped.");
          });
        }
      }
    } else if (warn) {
      warn.textContent = "";
    }
  }
  $("doDate")?.addEventListener("change", validateDoDue);
  $("dueDate")?.addEventListener("change", validateDoDue);
  const tv = $("timeViews");
  if (tv) {
    tv.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-timeview]");
      if (!btn) return;
      currentTimeView = btn.dataset.timeview;
      tv.querySelectorAll(".timeChip").forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      renderTasks();
    });
  }
  const hd = $("hideDoneToggle");
  if (hd) {
    hideDone = hd.checked;
    hd.addEventListener("change", () => {
      hideDone = hd.checked;
      renderTasks();
    });
  }
  const picker = $("modePicker");
  if (picker) {
    picker.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn) return;

      const mode = btn.dataset.mode;
      if (!MODE_UI[mode]) return;

      currentTaskMode = mode;

      picker.querySelectorAll(".modeChip").forEach((b) => {
        b.classList.remove("is-selected", ...Object.values(MODE_UI).map((x) => x.cls));
      });

      btn.classList.add("is-selected", MODE_UI[mode].cls);
    });

    const defaultBtn = picker.querySelector('button[data-mode="IMMEDIATE"]');
    if (defaultBtn) defaultBtn.classList.add("is-selected", MODE_UI.IMMEDIATE.cls);
  }
  const pPicker = $("pPicker");
  if (pPicker) {
    pPicker.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-p]");
      if (!btn) return;

      const p = Number(btn.dataset.p);
      if (![1, 2, 3, 4, 5].includes(p)) return;

      currentPriorityLevel = p;
      pPicker.querySelectorAll(".pChip").forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });

    const def = pPicker.querySelector('button[data-p="3"]');
    if (def) def.classList.add("is-selected");
  }
  $("noteImageInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const attId = crypto.randomUUID ? crypto.randomUUID() : "att_" + Date.now();

    await putAttachment(attId, file);
    currentAttachments.push(attId);

    renderCurrentAttachments();
    e.target.value = "";
  });

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
    if (action === "addSubtask") addSubtask(id);
    if (action === "pomoToggle") togglePomodoro(id);
    if (action === "pomoReset") resetPomodoro(id);
    if (action === "pomoDuration") togglePomodoroDuration(id);
  });

  $("tasksList").addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-action='setP']");
    if (sel) {
      const id = sel.dataset.id;
      const p = Number(sel.value);
      const t = state.tasks.find((x) => x.id === id);
      if (!t) return;
      t.priorityLevel = [1, 2, 3, 4, 5].includes(p) ? p : 3;
      t.priorityLocked = true;
      save();
      renderTasks();
      return;
    }

    if (e.target.matches("input[data-subtask]")) {
      const subId = e.target.dataset.subtask;
      const taskEl = e.target.closest(".item");
      const taskId = taskEl?.querySelector("[data-action='addSubtask']")?.dataset.id;

      if (taskId) {
        toggleSubtask(taskId, subId, e.target.checked);
      }
    }
  });
}

(function init() {
  load();
  let changed = false;
  state.tasks.forEach((t) => {
    const before = t.priorityLevel;
    normalizePriorityLevel(t);
    applyPriorityFromMode(t);
    normalizeRecurrence(t);
    if (before !== t.priorityLevel) changed = true;
  });
  if (changed) save();
  openDB().catch(() => {});
  bindEvents();
  cleanupRecording();
  resetCurrentAttachments();
  renderNotes();
  renderTasks();
  setGlobalStatus("OK: Phase 2.1 loaded (UI + local persistence).");
})();









