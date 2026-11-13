// NIAT Online Embedded Simulator — POC server.
// REST: exercises, build, evaluate (practice/graded), gradebook, Renode export.
// WebSocket /ws/live: live STM32 sessions (engine on the server, events streamed to the canvas).
import express from 'express';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadExercises, publicView } from './exercises.js';
import { grade } from './grader.js';
import { buildStm32, buildUno, cleanup } from './build.js';
import { Stm32PocEngine } from './engines/index.js';
import { renodeBundle } from './renode-export.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRADEBOOK = path.join(ROOT, 'data', 'gradebook.json');
const PORT = Number(process.env.PORT || 8080);

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(ROOT, 'web', 'public')));

async function readGradebook() {
  try { return JSON.parse(await readFile(GRADEBOOK, 'utf8')); } catch { return {}; }
}
async function writeGradebook(gb) {
  await mkdir(path.dirname(GRADEBOOK), { recursive: true });
  await writeFile(GRADEBOOK, JSON.stringify(gb, null, 2));
}

app.get('/api/exercises', async (_req, res) => {
  const ex = await loadExercises();
  res.json(Object.values(ex).map((e) => ({ id: e.id, title: e.title, course: e.course, board: e.board })));
});

app.get('/api/exercises/:id', async (req, res) => {
  const ex = (await loadExercises())[req.params.id];
  if (!ex) return res.status(404).json({ error: 'not found' });
  res.json(publicView(ex));
});

// Build only (used for the Uno, whose engine runs live in the browser).
app.post('/api/build', async (req, res) => {
  const ex = (await loadExercises())[req.body.id];
  if (!ex) return res.status(404).json({ error: 'not found' });
  const files = { [ex.editable]: String(req.body.source ?? '') };
  const b = ex.board === 'uno' ? await buildUno(files) : await buildStm32(files);
  await cleanup(b);
  res.json({ ok: b.ok, log: b.log, warnings: b.warnings, hex: b.hex });
});

app.post('/api/evaluate', async (req, res) => {
  const { id, source, mode = 'practice', student = 'demo-student' } = req.body;
  const ex = (await loadExercises())[id];
  if (!ex) return res.status(404).json({ error: 'not found' });
  const graded = mode === 'graded';
  const gb = await readGradebook();
  const entry = (gb[student] ??= {})[id] ??= { attempts: [] };
  if (graded && entry.attempts.length >= ex.attempts) {
    return res.status(429).json({ error: `No graded attempts left (limit ${ex.attempts}).` });
  }
  const result = await grade(ex, String(source ?? ''), graded ? ex.tests.hidden : ex.tests.visible);
  if (graded) {
    entry.attempts.push({ at: new Date().toISOString(), score: result.score, total: result.total });
    entry.best = Math.max(entry.best ?? 0, result.score);
    entry.total = result.total;
    await writeGradebook(gb);
    result.attemptsUsed = entry.attempts.length;
    result.attemptsLeft = ex.attempts - entry.attempts.length;
  }
  res.json({ mode, ...result });
});

app.get('/api/gradebook', async (_req, res) => {
  const [gb, ex] = [await readGradebook(), await loadExercises()];
  res.json({ exercises: Object.values(ex).map((e) => ({ id: e.id, title: e.title })), gradebook: gb });
});

// Instructor/dev view: the Renode translation of an exercise's hidden tests.
app.get('/api/exercises/:id/renode', async (req, res) => {
  const ex = (await loadExercises())[req.params.id];
  if (!ex || !ex.board.startsWith('stm32')) return res.status(404).json({ error: 'STM32 exercises only' });
  res.json(renodeBundle(ex, ex.tests.hidden));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/live' });

wss.on('connection', (ws) => {
  let session = null;
  let build = null;
  const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const stop = async () => { session?.stop(); session = null; await cleanup(build); build = null; };

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'start') {
      await stop();
      const ex = (await loadExercises())[msg.id];
      if (!ex || !ex.board.startsWith('stm32')) return send({ ev: 'fault', msg: 'Live server sessions are for STM32 boards' });
      send({ ev: 'status', msg: 'Compiling…' });
      build = await buildStm32({ [ex.editable]: String(msg.source ?? '') });
      send({ ev: 'build', ok: build.ok, log: build.log, warnings: build.warnings });
      if (!build.ok) return;
      send({ ev: 'status', msg: 'Running' });
      session = Stm32PocEngine.startLive(build, send);
    } else if (msg.type === 'input') {
      session?.input(msg.pin, msg.v);
    } else if (msg.type === 'stop') {
      await stop();
    }
  });
  ws.on('close', stop);
});

server.listen(PORT, () => console.log(`NIAT simulator POC on http://localhost:${PORT}`));
