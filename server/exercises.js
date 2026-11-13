// Exercise bank: reads exercises/<id>/ from disk.
// Hidden tests stay on the server; only public fields are sent to the browser.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EX_DIR = path.join(ROOT, 'exercises');

async function loadOne(id) {
  const dir = path.join(EX_DIR, id);
  const meta = yaml.load(await readFile(path.join(dir, 'exercise.yaml'), 'utf8'));
  const visible = yaml.load(await readFile(path.join(dir, 'tests.visible.yaml'), 'utf8'));
  const hidden = yaml.load(await readFile(path.join(dir, 'tests.hidden.yaml'), 'utf8'));
  const starter = await readFile(path.join(dir, 'starter', meta.editable), 'utf8');
  const readonly = {};
  for (const [name, rel] of Object.entries(meta.readonly_files || {})) {
    readonly[name] = await readFile(path.join(ROOT, rel), 'utf8');
  }
  return { ...meta, starter, readonly, tests: { visible: visible.checks, hidden: hidden.checks } };
}

let cache = null;
export async function loadExercises() {
  if (cache) return cache;
  const ids = (await readdir(EX_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  cache = {};
  for (const id of ids) cache[id] = await loadOne(id);
  return cache;
}

export function publicView(ex) {
  const { tests, ...rest } = ex;
  return {
    ...rest,
    visibleTests: tests.visible.map(({ id, title, type, marks }) => ({ id, title, type, marks })),
    hiddenTestCount: tests.hidden.filter((c) => c.type !== 'set_input').length,
    hiddenTotalMarks: tests.hidden.reduce((s, c) => s + (c.marks || 0), 0),
  };
}
