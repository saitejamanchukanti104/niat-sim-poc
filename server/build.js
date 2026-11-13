// Compile service. Each build runs in a fresh temp folder with a time limit.
// Production: run this inside a throwaway container (no network, CPU/memory caps).
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TC = path.join(ROOT, 'toolchains');
const BUILD_TIMEOUT_MS = 20_000;

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: BUILD_TIMEOUT_MS, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim(), timedOut: err?.killed === true });
    });
  });
}

// Make compiler output readable: strip temp paths.
function tidy(log, dir) {
  return log.split(dir + path.sep).join('').split(TC + path.sep).join('');
}

export async function buildStm32(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'stm32-'));
  try {
    await writeFile(path.join(dir, 'main.c'), files['main.c'] ?? '');
    const cc = await run('arm-none-eabi-gcc', [
      '-mcpu=cortex-m3', '-mthumb', '-O0', '-g', '-Wall', '-ffreestanding', '-nostdlib', '-nostartfiles',
      '-T', path.join(TC, 'stm32', 'linker.ld'),
      path.join(TC, 'stm32', 'startup.c'), 'main.c', '-lgcc', '-o', 'firmware.elf',
    ], dir);
    const log = tidy(cc.out, dir);
    if (!cc.ok) return { ok: false, log: cc.timedOut ? 'Build timed out' : log, warnings: countWarnings(log), dir };
    const oc = await run('arm-none-eabi-objcopy', ['-O', 'binary', 'firmware.elf', 'firmware.bin'], dir);
    if (!oc.ok) return { ok: false, log: oc.out, warnings: 0, dir };
    return { ok: true, log, warnings: countWarnings(log), dir, bin: path.join(dir, 'firmware.bin') };
  } catch (e) {
    return { ok: false, log: String(e), warnings: 0, dir };
  }
}

export async function buildUno(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'uno-'));
  try {
    const sketch = files['sketch.ino'] ?? '';
    await writeFile(path.join(dir, 'sketch.cpp'), `#include "Arduino.h"\n#line 1 "sketch.ino"\n${sketch}`);
    const cc = await run('avr-g++', [
      '-mmcu=atmega328p', '-DF_CPU=16000000UL', '-Os', '-Wall', '-std=gnu++11', '-fno-exceptions',
      '-I', path.join(TC, 'uno'), 'sketch.cpp', path.join(TC, 'uno', 'arduino_lite.cpp'), '-o', 'firmware.elf',
    ], dir);
    const log = tidy(cc.out, dir);
    if (!cc.ok) return { ok: false, log: cc.timedOut ? 'Build timed out' : log, warnings: countWarnings(log), dir };
    const oc = await run('avr-objcopy', ['-O', 'ihex', '-R', '.eeprom', 'firmware.elf', 'firmware.hex'], dir);
    if (!oc.ok) return { ok: false, log: oc.out, warnings: 0, dir };
    const hex = await readFile(path.join(dir, 'firmware.hex'), 'utf8');
    return { ok: true, log, warnings: countWarnings(log), dir, hex };
  } catch (e) {
    return { ok: false, log: String(e), warnings: 0, dir };
  }
}

function countWarnings(log) {
  return (log.match(/warning:/g) || []).length;
}

export async function cleanup(build) {
  if (build?.dir) await rm(build.dir, { recursive: true, force: true });
}

export const BUILDERS = { stm32: buildStm32, uno: buildUno };
