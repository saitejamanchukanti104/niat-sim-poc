// NIAT Embedded Lab — POC front end.
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import '@wokwi/elements';
import { UnoBoard, UNO_HZ } from '../../shared/uno-core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

let exercise = null;
let editor = null;
let files = {};          // name -> content (editable file kept in sync)
let activeFile = null;
let live = null;         // { stop() , input(pin,v) }
const drafts = {};       // exercise id -> student's code (kept while switching)

// ---------------- editor ----------------
function showFile(name) {
  if (editor && activeFile === exercise.editable) files[activeFile] = editor.state.doc.toString();
  activeFile = name;
  const readOnly = name !== exercise.editable;
  const state = EditorState.create({
    doc: files[name],
    extensions: [basicSetup, cpp(), EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
      EditorView.updateListener.of((u) => { if (u.docChanged && !readOnly) { files[name] = u.state.doc.toString(); drafts[exercise.id] = files[name]; } })],
  });
  if (!editor) editor = new EditorView({ state, parent: $('editor') }); else editor.setState(state);
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.name === name);
}
function source() { return files[exercise.editable]; }

// ---------------- boards ----------------
function bluePillSvg() {
  const pins = (y) => Array.from({ length: 20 }, (_, i) => `<rect x="${58 + i * 12.6}" y="${y}" width="6" height="6" fill="#d4b14a"/>`).join('');
  return `<svg width="470" height="186" viewBox="0 0 380 150" role="img" aria-label="STM32 Blue Pill board">
    <rect x="20" y="20" width="340" height="110" rx="6" fill="#1f4fa8" stroke="#163a7d" stroke-width="2"/>
    ${pins(26)}${pins(118)}
    <rect x="4" y="58" width="28" height="34" rx="3" fill="#b8bfca" stroke="#8a93a2"/>
    <rect x="150" y="47" width="58" height="58" rx="3" fill="#1b1d22"/>
    <text x="179" y="72" fill="#cfd5df" font-size="7.5" text-anchor="middle" font-family="monospace">STM32</text>
    <text x="179" y="83" fill="#cfd5df" font-size="7.5" text-anchor="middle" font-family="monospace">F103C8T6</text>
    <rect x="236" y="56" width="24" height="10" rx="2" fill="#e5e7eb"/>
    <circle id="led-pwr" cx="78" cy="58" r="5" fill="#ef4444"/>
    <text x="78" y="76" fill="#dbe4ff" font-size="8" text-anchor="middle">PWR</text>
    <circle id="led-pc13-glow" cx="104" cy="58" r="11" fill="#4ade80" opacity="0"/>
    <circle id="led-pc13" cx="104" cy="58" r="5" fill="#14532d" stroke="#0b2e19"/>
    <text x="104" y="76" fill="#dbe4ff" font-size="8" text-anchor="middle">PC13</text>
    <rect x="292" y="50" width="34" height="18" rx="2" fill="#e2e8f0"/><rect x="298" y="54" width="9" height="10" fill="#334155"/><rect x="311" y="54" width="9" height="10" fill="#334155"/>
    <text x="190" y="140" fill="#64748b" font-size="10" text-anchor="middle">Blue Pill (STM32F103C8) · LED on PC13 is active-low</text>
  </svg>`;
}

function setPc13(level) {
  const lit = level === 0;             // active-low LED
  const led = document.getElementById('led-pc13');
  const glow = document.getElementById('led-pc13-glow');
  if (!led) return;
  led.setAttribute('fill', lit ? '#4ade80' : '#14532d');
  glow.setAttribute('opacity', lit ? '0.45' : '0');
}

function renderBoard() {
  const c = $('canvas');
  if (exercise.board === 'uno') {
    c.innerHTML = `<wokwi-arduino-uno id="uno"></wokwi-arduino-uno>
      <div class="btnwrap"><wokwi-pushbutton id="btn" color="green" label="D2"></wokwi-pushbutton>Hold to press (pin 2 → HIGH)</div>`;
    $('canvas-note').textContent = 'Arduino Uno runs fully in your browser (avr8js). LED "L" is pin 13.';
    $('reglog-title').textContent = 'Simulator messages';
  } else {
    c.innerHTML = bluePillSvg();
    $('canvas-note').textContent = 'STM32 runs on the server and streams pin and UART changes here. Register writes appear in the log.';
    $('reglog-title').textContent = 'Register log';
  }
}

// ---------------- consoles ----------------
function serialClear() { $('serial').textContent = ''; }
function serialAppend(s) { const el = $('serial'); el.textContent += s; el.scrollTop = el.scrollHeight; }
function logClear() { $('reglog').innerHTML = ''; }
function logLine(html) { const el = $('reglog'); el.insertAdjacentHTML('beforeend', `<div>${html}</div>`); el.scrollTop = el.scrollHeight; }
function setStatus(text, running = false) { const s = $('status'); s.textContent = text; s.classList.toggle('running', running); }
function setRunning(on) { $('run').disabled = on; $('stop').disabled = !on; }

function handleEvent(e) {
  if (e.ev === 'uart') serialAppend(e.data);
  else if (e.ev === 'gpio') {
    if (exercise.board === 'uno' && e.pin === 'D13') { const u = $('uno'); if (u) u.led13 = !!e.v; }
    if (exercise.board !== 'uno' && e.pin === 'PC13') setPc13(e.v);
  } else if (e.ev === 'reglog') {
    logLine(`<span class="t">${e.t.toFixed(1)} ms</span> ${esc(e.reg)} ← ${esc(e.val)}${e.note ? ` <span class="w">(${esc(e.note)})</span>` : ''}`);
  } else if (e.ev === 'warn') logLine(`<span class="w">⚠ ${esc(e.msg)}</span>`);
  else if (e.ev === 'fault') { logLine(`<span class="f">✖ ${esc(e.msg)}${e.pc ? ` at ${e.pc}` : ''}</span>`); }
  else if (e.ev === 'status') setStatus(e.msg, e.msg === 'Running');
  else if (e.ev === 'build' && !e.ok) { serialAppend(`Build failed:\n${e.log}\n`); setStatus('Build failed'); setRunning(false); }
  else if (e.ev === 'stopped') { setStatus('Stopped'); setRunning(false); }
}

// ---------------- live run ----------------
async function runUnoLive() {
  setStatus('Compiling…');
  const r = await fetch('/api/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: exercise.id, source: source() }) }).then((x) => x.json());
  if (!r.ok) { serialAppend(`Build failed:\n${r.log}\n`); setStatus('Build failed'); setRunning(false); return; }
  if (r.warnings) logLine(`<span class="w">⚠ ${r.warnings} compiler warning(s)</span>`);
  const board = new UnoBoard(r.hex, handleEvent);
  const btn = $('btn');
  const press = () => board.setInput('D2', 1); const release = () => board.setInput('D2', 0);
  btn.addEventListener('button-press', press); btn.addEventListener('button-release', release);
  let stopped = false; let last = performance.now();
  const frame = (now) => {
    if (stopped) return;
    const dt = Math.min(now - last, 50); last = now;
    board.runCycles(Math.floor((UNO_HZ * dt) / 1000));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setStatus('Running', true);
  live = { stop() { stopped = true; btn.removeEventListener('button-press', press); btn.removeEventListener('button-release', release); setStatus('Stopped'); setRunning(false); } };
}

function runStm32Live() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/live`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'start', id: exercise.id, source: source() }));
  ws.onmessage = (m) => handleEvent(JSON.parse(m.data));
  ws.onclose = () => { setRunning(false); if ($('status').textContent === 'Running') setStatus('Stopped'); };
  live = { stop() { try { ws.send(JSON.stringify({ type: 'stop' })); } catch {} ws.close(); } };
}

async function run() {
  stopLive();
  serialClear(); logClear(); renderBoard(); setRunning(true);
  if (exercise.board === 'uno') await runUnoLive(); else runStm32Live();
}
function stopLive() { if (live) { live.stop(); live = null; } }

// ---------------- evaluation ----------------
async function evaluate(mode) {
  const btns = [$('practice'), $('submit')];
  btns.forEach((b) => { b.disabled = true; });
  $('results').innerHTML = `<p class="muted">${mode === 'graded' ? 'Grading against hidden tests' : 'Running practice tests'}…</p>`;
  const r = await fetch('/api/evaluate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: exercise.id, source: source(), mode, student: $('student').value.trim() || 'demo-student' }),
  }).then((x) => x.json());
  btns.forEach((b) => { b.disabled = false; });
  if (r.error) { $('results').innerHTML = `<div class="warns">${esc(r.error)}</div>`; return; }
  const rows = r.checks.map((c) => `<tr>
      <td><span class="st ${c.status}">${{ pass: 'PASS', fail: 'FAIL', step: 'STEP', skipped: 'SKIP' }[c.status]}</span></td>
      <td>${esc(c.title)}${c.hint ? `<div class="hint">Hint: ${esc(c.hint)}</div>` : ''}</td>
      <td>${c.max === null ? '' : `${c.marks}/${c.max}`}</td>
      <td>${esc(c.expected)}</td><td>${esc(c.actual)}</td></tr>`).join('');
  const attempts = mode === 'graded' ? ` · graded attempt ${r.attemptsUsed}, ${r.attemptsLeft} left` : ' · practice run (not recorded)';
  $('results').innerHTML = `
    <div class="score"><b>${r.score}</b><span class="of">/ ${r.total} marks${attempts}</span></div>
    ${r.zeroTotal ? '<div class="warns">A rule check failed, so this attempt scores 0.</div>' : ''}
    <table class="res"><thead><tr><th></th><th>Check</th><th>Marks</th><th>Expected</th><th>Actual</th></tr></thead><tbody>${rows}</tbody></table>
    ${r.warnings?.length ? `<div class="warns"><b>Simulator notes</b><br>${r.warnings.map(esc).join('<br>')}</div>` : ''}
    <details><summary>Serial output during the test</summary><pre>${esc(r.serial) || '(none)'}</pre></details>
    ${r.buildLog ? `<details><summary>Build log</summary><pre>${esc(r.buildLog)}</pre></details>` : ''}`;
}

// ---------------- exercise loading ----------------
async function loadExercise(id) {
  stopLive();
  exercise = await fetch(`/api/exercises/${id}`).then((r) => r.json());
  $('title').textContent = exercise.title;
  $('board-pill').textContent = exercise.board === 'uno' ? 'Arduino Uno' : 'STM32F103 Blue Pill';
  $('course-pill').textContent = exercise.course;
  $('task-text').textContent = exercise.task;
  files = { [exercise.editable]: drafts[id] ?? exercise.starter, ...exercise.readonly };
  $('tabs').innerHTML = Object.keys(files).map((n) => `<button class="tab" data-name="${n}">${n}${n !== exercise.editable ? '<span class="lock">🔒</span>' : ''}</button>`).join('');
  for (const t of document.querySelectorAll('.tab')) t.onclick = () => showFile(t.dataset.name);
  activeFile = null;
  showFile(exercise.editable);
  renderBoard(); serialClear(); logClear(); setStatus('Idle'); setRunning(false);
  $('results').innerHTML = '';
  $('eval-note').textContent = `Practice runs ${exercise.visibleTests.length} visible tests. Grading runs ${exercise.hiddenTestCount} hidden checks worth ${exercise.hiddenTotalMarks} marks, ${exercise.attempts} attempts.`;
}

async function init() {
  const list = await fetch('/api/exercises').then((r) => r.json());
  $('exercise').innerHTML = list.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join('');
  $('exercise').onchange = (e) => loadExercise(e.target.value);
  $('run').onclick = run;
  $('stop').onclick = stopLive;
  $('practice').onclick = () => evaluate('practice');
  $('submit').onclick = () => evaluate('graded');
  const first = new URLSearchParams(location.search).get('ex') || list[0].id;
  $('exercise').value = first;
  await loadExercise(first);
}
init();

// Test hook used by scripts/ui-check.js (headless browser checks).
window.niatLab = {
  setCode(text) { activeFile = null; files[exercise.editable] = text; drafts[exercise.id] = text; showFile(exercise.editable); },
  load: loadExercise,
};
