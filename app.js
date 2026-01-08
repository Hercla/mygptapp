const STORAGE_KEY = "dvntp:v1";

const state = loadStateOrDefault();
let recordingState = {
  recorder: null,
  chunks: [],
  startTime: null,
  timerId: null,
  dataUrl: null,
};

const elements = {
  recorder: document.getElementById("recorder"),
  notes: document.getElementById("notes"),
  taskForm: document.getElementById("task-form"),
  tasks: document.getElementById("tasks"),
  archiveList: document.getElementById("archive-list"),
  archiveStatus: document.getElementById("archive-status"),
  scorePercent: document.getElementById("score-percent"),
  scoreProgress: document.getElementById("score-progress"),
  scoreMeta: document.getElementById("score-meta"),
  newDayButton: document.getElementById("new-day"),
};

const persistStateDebounced = debounce(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Storage quota reached", error);
    alert("Storage limit reached. Consider deleting old voice notes or tasks.");
  }
}, 300);

function loadStateOrDefault() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const todayKey = getDayKey(new Date());
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.version === 1 && parsed.days) {
        if (!parsed.days[todayKey]) {
          parsed.days[todayKey] = createEmptyDay();
        }
        parsed.activeDayKey = todayKey;
        return parsed;
      }
    } catch (error) {
      console.warn("Failed to parse saved state", error);
    }
  }
  return {
    version: 1,
    activeDayKey: todayKey,
    days: {
      [todayKey]: createEmptyDay(),
    },
  };
}

function createEmptyDay() {
  return {
    notes: [],
    tasks: [],
  };
}

function getDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function getUniqueArchiveKey(baseKey) {
  let index = 1;
  let key = `${baseKey}-archive-${index}`;
  while (state.days[key]) {
    index += 1;
    key = `${baseKey}-archive-${index}`;
  }
  return key;
}

function recomputeTask(task) {
  const score = computePriorityScore(task);
  const clamped = clamp(score, 0, 100);
  return {
    ...task,
    score: clamped,
    priority: scoreToPriority(clamped),
  };
}

function isViewingArchive() {
  return state.activeDayKey !== getDayKey(new Date());
}

function guardReadOnly() {
  if (!isViewingArchive()) {
    return false;
  }
  alert("Archived days are read-only. Switch back to today to edit.");
  return true;
}

function addNote(note) {
  if (guardReadOnly()) return;
  state.days[state.activeDayKey].notes.unshift(note);
  render();
}

function updateNote(noteId, updates) {
  if (guardReadOnly()) return;
  const notes = state.days[state.activeDayKey].notes;
  const index = notes.findIndex((note) => note.id === noteId);
  if (index === -1) return;
  notes[index] = { ...notes[index], ...updates };
  render();
}

function deleteNote(noteId) {
  if (guardReadOnly()) return;
  const day = state.days[state.activeDayKey];
  day.notes = day.notes.filter((note) => note.id !== noteId);
  day.tasks = day.tasks.filter((task) => task.noteId !== noteId);
  render();
}

function createTask(task) {
  if (guardReadOnly()) return;
  state.days[state.activeDayKey].tasks.unshift(task);
  render();
}

function updateTask(taskId, updates) {
  if (guardReadOnly()) return;
  const tasks = state.days[state.activeDayKey].tasks;
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return;
  tasks[index] = recomputeTask({
    ...tasks[index],
    ...updates,
  });
  render();
}

function deleteTask(taskId) {
  if (guardReadOnly()) return;
  state.days[state.activeDayKey].tasks = state.days[state.activeDayKey].tasks.filter(
    (task) => task.id !== taskId
  );
  render();
}

function toggleTaskDone(taskId) {
  if (guardReadOnly()) return;
  const tasks = state.days[state.activeDayKey].tasks;
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return;
  tasks[index] = { ...tasks[index], done: !tasks[index].done };
  render();
}

function promoteNoteToTask(noteId) {
  if (guardReadOnly()) return;
  const day = state.days[state.activeDayKey];
  const note = day.notes.find((entry) => entry.id === noteId);
  if (!note) return;

  const existing = day.tasks.find((task) => task.noteId === noteId);
  if (existing) {
    const confirmed = confirm(
      "A task already exists for this note. Create another one?"
    );
    if (!confirmed) return;
  }

  const task = buildTask({
    title: note.title,
    details: note.annotation,
    dueDate: "",
    source: "voice",
    noteId,
    boost: 10,
  });
  createTask(task);
}

function newDayArchive(targetDayKey, options = {}) {
  if (targetDayKey) {
    if (!state.days[targetDayKey]) {
      state.days[targetDayKey] = createEmptyDay();
    }
    state.activeDayKey = targetDayKey;
    if (!options.silent) {
      render();
    }
    return;
  }
  const todayKey = getDayKey(new Date());
  if (state.activeDayKey === todayKey) {
    const archiveKey = getUniqueArchiveKey(todayKey);
    state.days[archiveKey] = state.days[todayKey];
    state.days[archiveKey]._archivedAt = new Date().toISOString();
    state.days[archiveKey]._sourceDay = todayKey;
    state.days[todayKey] = createEmptyDay();
  } else if (!state.days[todayKey]) {
    state.days[todayKey] = createEmptyDay();
  }
  state.activeDayKey = todayKey;
  render();
}

function render() {
  renderRecorder();
  renderNotes();
  renderTaskForm();
  renderTasks();
  renderDailyScore();
  renderArchive();
  persistStateDebounced();
}

function renderRecorder() {
  const isArchive = isViewingArchive();
  elements.recorder.innerHTML = "";

  const container = document.createElement("div");
  container.className = "recorder";

  const controls = document.createElement("div");
  controls.className = "controls";

  const recordButton = document.createElement("button");
  recordButton.className = "primary";
  recordButton.textContent =
    recordingState.recorder && recordingState.recorder.state === "recording"
      ? "Stop Recording"
      : "Start Recording";
  recordButton.disabled = isArchive;
  recordButton.addEventListener("click", handleRecordToggle);

  const timer = document.createElement("span");
  timer.className = "badge";
  timer.textContent = formatElapsed(recordingState.startTime);

  controls.append(recordButton, timer);

  const audioWrapper = document.createElement("div");
  audioWrapper.className = "controls";
  const audioLabel = document.createElement("span");
  audioLabel.className = "label";
  audioLabel.textContent = "Last recording";
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = recordingState.dataUrl || "";
  audio.disabled = !recordingState.dataUrl;
  audioWrapper.append(audioLabel, audio);

  const titleField = document.createElement("div");
  const titleLabel = document.createElement("div");
  titleLabel.className = "label";
  titleLabel.textContent = "Note title";
  const titleInput = document.createElement("input");
  titleInput.placeholder = "Summarize this note...";
  titleInput.id = "note-title";
  titleField.append(titleLabel, titleInput);

  const annotationField = document.createElement("div");
  const annotationLabel = document.createElement("div");
  annotationLabel.className = "label";
  annotationLabel.textContent = "Annotation (optional)";
  const annotationInput = document.createElement("textarea");
  annotationInput.placeholder = "Add context or follow-up thoughts...";
  annotationInput.id = "note-annotation";
  annotationField.append(annotationLabel, annotationInput);

  const saveButton = document.createElement("button");
  saveButton.className = "primary";
  saveButton.textContent = "Save note";
  saveButton.disabled = isArchive || !recordingState.dataUrl;
  saveButton.addEventListener("click", () => {
    const title = titleInput.value.trim();
    if (!title) {
      alert("Please provide a title for your note.");
      return;
    }
    const note = {
      id: crypto.randomUUID(),
      title,
      annotation: annotationInput.value.trim(),
      audioDataUrl: recordingState.dataUrl,
      createdAt: new Date().toISOString(),
    };
    addNote(note);
    titleInput.value = "";
    annotationInput.value = "";
    recordingState.dataUrl = null;
    renderRecorder();
  });

  if (isArchive) {
    const warning = document.createElement("div");
    warning.className = "warning-text";
    warning.textContent = "Archive mode: recording and edits are disabled.";
    container.append(warning);
  }

  container.append(controls, audioWrapper, titleField, annotationField, saveButton);
  elements.recorder.replaceWith(container);
  elements.recorder = container;
}

function handleRecordToggle() {
  if (recordingState.recorder?.state === "recording") {
    recordingState.recorder.stop();
    return;
  }

  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      const recorder = new MediaRecorder(stream);
      recordingState.recorder = recorder;
      recordingState.chunks = [];
      recordingState.startTime = Date.now();
      recordingState.timerId = window.setInterval(() => {
        renderRecorder();
      }, 500);

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          recordingState.chunks.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        window.clearInterval(recordingState.timerId);
        recordingState.timerId = null;
        recordingState.startTime = null;
        const blob = new Blob(recordingState.chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          recordingState.dataUrl = reader.result;
          renderRecorder();
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((track) => track.stop());
      });

      recorder.start();
      renderRecorder();
    })
    .catch(() => {
      alert("Microphone access is required to record notes.");
    });
}

function renderNotes() {
  elements.notes.innerHTML = "";
  const day = state.days[state.activeDayKey];

  if (!day.notes.length) {
    const empty = document.createElement("div");
    empty.className = "note-card";
    empty.textContent = "No voice notes saved yet.";
    elements.notes.append(empty);
    return;
  }

  day.notes.forEach((note) => {
    const card = document.createElement("div");
    card.className = "note-card";

    const header = document.createElement("div");
    header.className = "note-header";
    const titleInput = document.createElement("input");
    titleInput.value = note.title;
    titleInput.addEventListener("change", (event) => {
      updateNote(note.id, { title: event.target.value.trim() || note.title });
    });

    const meta = document.createElement("div");
    meta.className = "note-meta";
    meta.textContent = new Date(note.createdAt).toLocaleString();

    header.append(titleInput, meta);

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = note.audioDataUrl;

    const actions = document.createElement("div");
    actions.className = "note-actions";
    const createTaskButton = document.createElement("button");
    createTaskButton.textContent = "Create task";
    createTaskButton.addEventListener("click", () => promoteNoteToTask(note.id));
    const deleteButton = document.createElement("button");
    deleteButton.className = "danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteNote(note.id));

    if (isViewingArchive()) {
      titleInput.disabled = true;
      createTaskButton.disabled = true;
      deleteButton.disabled = true;
    }

    actions.append(createTaskButton, deleteButton);
    card.append(header);
    if (note.annotation) {
      const annotation = document.createElement("div");
      annotation.className = "note-meta";
      annotation.textContent = note.annotation;
      card.append(annotation);
    }
    card.append(audio, actions);
    elements.notes.append(card);
  });
}

function renderTaskForm() {
  elements.taskForm.innerHTML = "";
  const isArchive = isViewingArchive();

  const container = document.createElement("div");
  const titleLabel = document.createElement("div");
  titleLabel.className = "label";
  titleLabel.textContent = "Task title";
  const titleInput = document.createElement("input");
  titleInput.placeholder = "What must get done today?";

  const detailsLabel = document.createElement("div");
  detailsLabel.className = "label";
  detailsLabel.textContent = "Details (optional)";
  const detailsInput = document.createElement("textarea");
  detailsInput.placeholder = "Add any extra context or links...";

  const dueLabel = document.createElement("div");
  dueLabel.className = "label";
  dueLabel.textContent = "Due date (optional)";
  const dueInput = document.createElement("input");
  dueInput.type = "date";

  const addButton = document.createElement("button");
  addButton.className = "primary";
  addButton.textContent = "Add task";
  addButton.addEventListener("click", () => {
    const title = titleInput.value.trim();
    if (!title) {
      alert("Please enter a task title.");
      return;
    }
    const task = buildTask({
      title,
      details: detailsInput.value.trim(),
      dueDate: dueInput.value,
      source: "manual",
    });
    createTask(task);
    titleInput.value = "";
    detailsInput.value = "";
    dueInput.value = "";
  });

  if (isArchive) {
    addButton.disabled = true;
    titleInput.disabled = true;
    detailsInput.disabled = true;
    dueInput.disabled = true;
  }

  container.append(titleLabel, titleInput, detailsLabel, detailsInput, dueLabel, dueInput, addButton);
  elements.taskForm.append(container);
}

function renderTasks() {
  elements.tasks.innerHTML = "";
  const day = state.days[state.activeDayKey];
  if (!day.tasks.length) {
    const empty = document.createElement("div");
    empty.className = "task-card";
    empty.textContent = "No tasks yet. Add one to start planning.";
    elements.tasks.append(empty);
    return;
  }

  const grouped = {
    P1: [],
    P2: [],
    P3: [],
  };

  day.tasks.forEach((task) => {
    grouped[task.priority].push(task);
  });

  Object.entries(grouped).forEach(([priority, tasks]) => {
    const group = document.createElement("div");
    group.className = "task-group";
    const heading = document.createElement("h3");
    heading.textContent = `${priority} Priority`;
    group.append(heading);

    tasks
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return (a.dueDate || "").localeCompare(b.dueDate || "");
      })
      .forEach((task) => {
        const card = document.createElement("div");
        card.className = `task-card ${task.done ? "done" : ""}`;

        const title = document.createElement("strong");
        title.textContent = task.title;

        const meta = document.createElement("div");
        meta.className = "task-meta";
        const dueText = task.dueDate ? `Due ${task.dueDate}` : "No due date";
        meta.textContent = `${dueText} · Score ${task.score}`;

        const actions = document.createElement("div");
        actions.className = "task-actions";
        const toggleButton = document.createElement("button");
        toggleButton.textContent = task.done ? "Mark undone" : "Mark done";
        toggleButton.addEventListener("click", () => toggleTaskDone(task.id));
        const deleteButton = document.createElement("button");
        deleteButton.className = "danger";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteTask(task.id));

        if (isViewingArchive()) {
          toggleButton.disabled = true;
          deleteButton.disabled = true;
        }

        actions.append(toggleButton, deleteButton);

        const badgeRow = document.createElement("div");
        badgeRow.className = "note-actions";
        const sourceBadge = document.createElement("span");
        sourceBadge.className = "badge";
        sourceBadge.textContent = task.source === "voice" ? "Voice task" : "Manual";
        badgeRow.append(sourceBadge);

        card.append(title, meta);
        if (task.details) {
          const details = document.createElement("div");
          details.className = "task-meta";
          details.textContent = task.details;
          card.append(details);
        }
        card.append(badgeRow, actions);
        group.append(card);
      });

    elements.tasks.append(group);
  });
}

function renderDailyScore() {
  const day = state.days[state.activeDayKey];
  const weights = { P1: 5, P2: 3, P3: 1 };
  const totalPossible = day.tasks.reduce((sum, task) => sum + weights[task.priority], 0);
  const completed = day.tasks.reduce(
    (sum, task) => sum + (task.done ? weights[task.priority] : 0),
    0
  );
  const percent = totalPossible ? Math.round((completed / totalPossible) * 100) : 0;

  elements.scorePercent.textContent = `${percent}%`;
  elements.scoreProgress.style.width = `${percent}%`;
  elements.scoreMeta.textContent =
    totalPossible === 0
      ? "No tasks yet"
      : `${completed} / ${totalPossible} weighted points completed`;
}

function renderArchive() {
  elements.archiveList.innerHTML = "";
  const todayKey = getDayKey(new Date());
  const keys = Object.keys(state.days).sort().reverse();
  elements.archiveStatus.textContent =
    state.activeDayKey === todayKey
      ? "You are viewing today."
      : `Viewing ${state.activeDayKey} (read-only)`;

  keys.forEach((key) => {
    const day = state.days[key];
    const item = document.createElement("div");
    item.className = "archive-item";
    const heading = document.createElement("strong");
    heading.textContent = key === todayKey ? `${key} (Today)` : key;
    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = `${day.notes.length} notes · ${day.tasks.length} tasks`;
    const button = document.createElement("button");
    button.className = "ghost";
    button.textContent = key === state.activeDayKey ? "Viewing" : "Open";
    button.disabled = key === state.activeDayKey;
    button.addEventListener("click", () => {
      newDayArchive(key);
    });
    item.append(heading, meta, button);
    elements.archiveList.append(item);
  });
}

function buildTask({ title, details, dueDate, source, noteId, boost = 0 }) {
  const baseTask = {
    id: crypto.randomUUID(),
    title,
    details,
    dueDate,
    done: false,
    source,
    noteId: noteId || null,
  };
  const boosted = {
    ...baseTask,
    _boost: boost,
  };
  const recomputed = recomputeTask(boosted);
  const boostedScore = clamp(recomputed.score + boost, 0, 100);
  const { _boost, ...cleanTask } = recomputed;
  return {
    ...cleanTask,
    score: boostedScore,
    priority: scoreToPriority(boostedScore),
  };
}

function computePriorityScore(task) {
  const now = new Date();
  const text = `${task.title} ${task.details}`.toLowerCase();
  let score = 50;

  if (task.dueDate) {
    const due = new Date(task.dueDate + "T00:00:00");
    const diffMs = due - new Date(now.toDateString());
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) {
      score += 25;
    } else if (diffDays < 3) {
      score += 15;
    } else if (diffDays < 7) {
      score += 10;
    }
  }

  if (containsAny(text, ["urgent", "asap", "now"])) score += 15;
  if (containsAny(text, ["must", "critical"])) score += 10;
  if (containsAny(text, ["call", "send", "pay"])) score += 5;
  if (containsAny(text, ["maybe", "someday"])) score -= 10;

  return clamp(score, 0, 100);
}

function computePriorityLabel(task) {
  return scoreToPriority(computePriorityScore(task));
}

function scoreToPriority(score) {
  if (score >= 70) return "P1";
  if (score >= 40) return "P2";
  return "P3";
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatElapsed(startTime) {
  if (!startTime) return "00:00";
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => fn(...args), wait);
  };
}

function checkForNewDay() {
  const todayKey = getDayKey(new Date());
  newDayArchive(todayKey, { silent: true });
}

elements.newDayButton.addEventListener("click", () => {
  const confirmed = confirm("Archive today and start a new day?");
  if (!confirmed) return;
  newDayArchive();
});

window.addEventListener("storage", () => {
  const updated = loadStateOrDefault();
  Object.assign(state, updated);
  render();

  const toast = document.createElement("div");
  toast.className = "warning-text";
  toast.textContent = "Data updated from another tab.";
  document.body.append(toast);

  window.setTimeout(() => toast.remove(), 2500);
});

checkForNewDay();
render();
