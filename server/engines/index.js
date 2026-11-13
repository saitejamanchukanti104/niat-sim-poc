// Engine adapters. Every engine implements the same contract:
//   runBatch(build, { durationMs, inputs }) -> Promise<Event[]>   (grading)
//   startLive(build, onEvent) -> { input(pin, v), stop() }         (live practice; Uno runs live in the browser)
// Events: gpio | uart | reglog | warn | fault | end  (see README).
// To move to production, add a RenodeEngine with the same two methods and
// point the stm32 boards at it in BOARD_ENGINES.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUnoBatch } from '../../shared/uno-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STM32_ENGINE = path.join(ROOT, 'engines', 'stm32_engine.py');
const RUN_TIMEOUT_MS = 30_000;

function parseLines(text) {
  return text.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export const Stm32PocEngine = {
  name: 'stm32-poc (Unicorn) — stand-in for Renode',
  runBatch(build, { durationMs, inputs = [] }) {
    return new Promise((resolve) => {
      const p = spawn('python3', [STM32_ENGINE, build.bin, '--mode', 'batch',
        '--duration-ms', String(durationMs), '--inputs', JSON.stringify(inputs)]);
      let out = '';
      const timer = setTimeout(() => p.kill('SIGKILL'), RUN_TIMEOUT_MS);
      p.stdout.on('data', (d) => { out += d; });
      p.on('close', () => {
        clearTimeout(timer);
        const events = parseLines(out);
        if (!events.some((e) => e.ev === 'end')) events.push({ ev: 'fault', t: 0, msg: 'Simulation did not finish (time limit).' });
        resolve(events);
      });
    });
  },
  startLive(build, onEvent) {
    const p = spawn('python3', [STM32_ENGINE, build.bin, '--mode', 'live']);
    let buf = '';
    const killer = setTimeout(() => p.kill('SIGKILL'), 5 * 60_000);   // idle session limit
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const e of parseLines(lines.join('\n'))) onEvent(e);
    });
    p.on('close', () => { clearTimeout(killer); onEvent({ ev: 'stopped' }); });
    return {
      input(pin, v) { p.stdin.write(JSON.stringify({ ev: 'input', pin, v }) + '\n'); },
      stop() { try { p.stdin.write('{"ev":"stop"}\n'); } catch {} setTimeout(() => p.kill('SIGKILL'), 500); },
    };
  },
};

export const UnoEngine = {
  name: 'avr8js',
  async runBatch(build, opts) { return runUnoBatch(build.hex, opts); },
};

export const BOARD_ENGINES = {
  'stm32f103-bluepill': Stm32PocEngine,
  'uno': UnoEngine,
};
