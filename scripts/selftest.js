// Self-test: every exercise's reference solution must score full marks on the
// hidden tests, and the known-wrong solution must lose marks on the expected check.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExercises } from '../server/exercises.js';
import { grade } from '../server/grader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECT_WRONG_FAILS = { 'stm32-blink-hello': 'blink_500ms', 'uno-button-led': 'pressed_once' };

let failures = 0;
const exercises = await loadExercises();
for (const ex of Object.values(exercises)) {
  for (const variant of ['solution', 'wrong', 'starter']) {
    const src = await readFile(path.join(ROOT, 'exercises', ex.id, variant, ex.editable), 'utf8');
    const t0 = Date.now();
    const r = await grade(ex, src, ex.tests.hidden);
    const ms = Date.now() - t0;
    console.log(`\n${ex.id} / ${variant}: ${r.score}/${r.total}  (${ms} ms)`);
    for (const c of r.checks) console.log(`  [${c.status.padEnd(7)}] ${c.title} — ${c.actual}`);
    if (r.warnings.length) console.log('  warnings:', r.warnings.join(' | '));
    if (variant === 'solution' && r.score !== r.total) { failures++; console.log('  !! reference solution did not get full marks'); }
    if (variant === 'wrong') {
      const c = r.checks.find((x) => x.id === EXPECT_WRONG_FAILS[ex.id]);
      if (!c || c.status !== 'fail') { failures++; console.log('  !! wrong solution was not caught'); }
    }
    if (variant === 'starter' && r.score >= r.total) { failures++; console.log('  !! starter code should not pass'); }
  }
}
console.log(failures ? `\nSELFTEST FAILED (${failures})` : '\nSELFTEST PASSED');
process.exit(failures ? 1 : 0);
