# Daily Voice Notes & Task Planner (Phase 1)

A single-page, offline-first daily execution OS that runs by opening `index.html` in any modern browser. No build step, no backend.

## Features

- Voice notes with MediaRecorder (start/stop + timer + playback).
- Save notes with title, annotation, and audio data stored as Data URLs.
- Manual and voice-driven task creation.
- Deterministic prioritization engine with P1/P2/P3 grouping.
- Daily weighted progress score with live updates.
- Archive of past days with read-only mode.

## Run

Open `index.html` directly in your browser.

## Notes

- Microphone permissions are required for recording.
- State persists locally in `localStorage` under `dvntp:v1`.
