// Grader: one engine-neutral test file per exercise, any board.
// Flow: static checks -> compile -> engine batch run (with scheduled inputs) -> score each check on the trace.
import { BUILDERS, cleanup } from './build.js';
import { BOARD_ENGINES } from './engines/index.js';

const BOARD_TOOLCHAIN = { 'stm32f103-bluepill': 'stm32', uno: 'uno' };

// ---- trace helpers ----
function serialStream(events) {
  return events.filter((e) => e.ev === 'uart');
}
function serialText(events, fromMs = 0, toMs = Infinity) {
  return serialStream(events).filter((e) => e.t >= fromMs && e.t <= toMs).map((e) => e.data).join('');
}
function levelAt(events, pin, atMs) {
  let level = null;
  for (const e of events) {
    if (e.ev === 'gpio' && e.pin === pin && e.t <= atMs) level = e.v;
  }
  return level;
}
function toggleTimes(events, pin) {
  return events.filter((e) => e.ev === 'gpio' && e.pin === pin).map((e) => e.t);
}
const show = (s) => JSON.stringify(s.length > 60 ? `${s.slice(0, 60)}…` : s);
const hex = (n) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

// ---- check evaluators: return { pass, expected, actual } ----
const EVALUATORS = {
  serial_contains(c, ctx) {
    const from = c.after_ms ?? 0;
    const to = c.within_ms ?? Infinity;
    const text = serialText(ctx.events, from, to);
    const window = `${from}–${to === Infinity ? 'end' : to} ms`;
    return { pass: text.includes(c.text), expected: `"${c.text}" on serial (${window})`, actual: text ? `got ${show(text)}` : 'nothing printed in that window' };
  },
  serial_count(c, ctx) {
    const all = serialText(ctx.events);
    const n = all.split(c.text).length - 1;
    return { pass: n === c.expect, expected: `"${c.text}" printed ${c.expect} time(s)`, actual: `printed ${n} time(s)` };
  },
  pin_state(c, ctx) {
    const lv = levelAt(ctx.events, c.pin, c.at_ms);
    const name = (v) => (v === 1 ? 'HIGH' : v === 0 ? 'LOW' : 'not driven');
    return { pass: lv === c.value, expected: `${c.pin} ${name(c.value)} at ${c.at_ms} ms`, actual: `${c.pin} was ${name(lv)}` };
  },
  pin_toggle_period(c, ctx) {
    const times = toggleTimes(ctx.events, c.pin);
    const intervals = [];
    for (let i = 1; i < times.length && intervals.length < (c.samples ?? 4); i++) intervals.push(+(times[i] - times[i - 1]).toFixed(1));
    const ok = intervals.length >= (c.samples ?? 4) && intervals.every((d) => Math.abs(d - c.expect_ms) <= c.tolerance_ms);
    const actual = intervals.length === 0
      ? `${c.pin} never toggled`
      : `toggled every ${intervals.join(', ')} ms${intervals.length < (c.samples ?? 4) ? ` (only ${intervals.length} toggles seen)` : ''}`;
    return { pass: ok, expected: `toggle every ${c.expect_ms} ± ${c.tolerance_ms} ms`, actual };
  },
  register_bits(c, ctx) {
    const end = ctx.events.find((e) => e.ev === 'end');
    const key = hex(c.address);
    const v = end?.regs?.[key];
    if (v === undefined) return { pass: false, expected: `${key} & ${hex(c.mask)} = ${hex(c.expect)}`, actual: 'register not available on this board' };
    const got = (v & c.mask) >>> 0;
    return { pass: got === (c.expect >>> 0), expected: `${key} & ${hex(c.mask)} = ${hex(c.expect)}`, actual: `read ${hex(v)} → masked ${hex(got)}` };
  },
};

function staticCheck(c, source) {
  const found = source.includes(c.pattern);
  if (c.type === 'static_forbid') return { pass: !found, expected: `code must not contain "${c.pattern}"`, actual: found ? 'found it' : 'not found' };
  return { pass: found, expected: `code must contain "${c.pattern}"`, actual: found ? 'found' : 'missing' };
}

export async function grade(exercise, source, checks) {
  const toolchain = BOARD_TOOLCHAIN[exercise.board];
  const engine = BOARD_ENGINES[exercise.board];
  const results = [];
  let zeroTotal = false;

  // 1. static checks (before build)
  for (const c of checks.filter((x) => x.type.startsWith('static_'))) {
    const r = staticCheck(c, source);
    if (!r.pass && c.on_fail === 'zero_total') zeroTotal = true;
    results.push({ c, ...r });
  }

  // 2. build
  const build = await BUILDERS[toolchain]({ [exercise.editable]: source });
  for (const c of checks.filter((x) => x.type === 'compiles')) {
    results.push({ c, pass: build.ok, expected: 'builds without errors', actual: build.ok ? `built (${build.warnings} warning(s))` : 'build failed — see build log' });
  }

  // 3. run once with all scheduled inputs
  const runtime = checks.filter((x) => EVALUATORS[x.type]);
  const inputs = checks.filter((x) => x.type === 'set_input').map((x) => ({ at_ms: x.at_ms, pin: x.pin, v: x.value }));
  let events = [];
  if (build.ok && runtime.length) {
    const lastAt = Math.max(0, ...checks.map((x) => x.at_ms ?? x.within_ms ?? 0).filter(Number.isFinite));
    const durationMs = Math.max(exercise.duration_ms || 2000, lastAt + 200);
    events = await engine.runBatch(build, { durationMs, inputs });
  }
  await cleanup(build);

  for (const c of checks.filter((x) => x.type === 'set_input')) {
    results.push({ c, step: true, pass: true, expected: `${c.pin} → ${c.value ? 'HIGH' : 'LOW'} at ${c.at_ms} ms`, actual: 'applied' });
  }
  for (const c of runtime) {
    if (!build.ok) { results.push({ c, skipped: true, pass: false, expected: '', actual: 'not run: build failed' }); continue; }
    results.push({ c, ...EVALUATORS[c.type](c, { events }) });
  }

  // keep the instructor's order
  const order = new Map(checks.map((c, i) => [c, i]));
  results.sort((a, b) => order.get(a.c) - order.get(b.c));

  const total = checks.reduce((s, c) => s + (c.marks || 0), 0);
  let score = results.reduce((s, r) => s + (r.pass && !r.step ? (r.c.marks || 0) : 0), 0);
  if (zeroTotal) score = 0;

  return {
    score, total, zeroTotal,
    checks: results.map((r) => ({
      id: r.c.id, title: r.c.title || r.c.id, type: r.c.type,
      status: r.step ? 'step' : r.skipped ? 'skipped' : r.pass ? 'pass' : 'fail',
      marks: r.step ? null : (r.pass ? (r.c.marks || 0) : 0), max: r.step ? null : (r.c.marks || 0),
      expected: r.expected, actual: r.actual,
      hint: !r.pass && !r.step ? r.c.hint || null : null,
    })),
    buildLog: build.log,
    serial: serialText(events),
    warnings: events.filter((e) => e.ev === 'warn' || e.ev === 'fault').map((e) => e.msg),
  };
}
