// Arduino Uno engine core (avr8js). Shared by the browser (live runs) and
// the server (headless grading), so practice and grading behave the same.
// Emits the same event shapes as the STM32 engine (see README, "Engine contract").
import {
  CPU, avrInstruction, AVRTimer, timer0Config, AVRUSART, usart0Config,
  AVRIOPort, portBConfig, portDConfig, PinState,
} from 'avr8js';

export const UNO_HZ = 16_000_000;

export function parseIntelHex(hex) {
  const bytes = new Uint8Array(0x8000);
  for (const line of hex.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue;
    const count = parseInt(line.substr(1, 2), 16);
    const addr = parseInt(line.substr(3, 4), 16);
    const type = parseInt(line.substr(7, 2), 16);
    if (type !== 0) continue;
    for (let i = 0; i < count; i++) bytes[addr + i] = parseInt(line.substr(9 + i * 2, 2), 16);
  }
  return new Uint16Array(bytes.buffer);
}

// Arduino pin name ("D13") -> [port, bit]
function pinToPort(pin) {
  const n = parseInt(String(pin).replace(/^D/i, ''), 10);
  if (Number.isNaN(n) || n < 0 || n > 13) throw new Error(`Unknown Uno pin ${pin}`);
  return n < 8 ? ['D', n] : ['B', n - 8];
}

export class UnoBoard {
  constructor(hex, onEvent) {
    this.cpu = new CPU(parseIntelHex(hex));
    this.timer0 = new AVRTimer(this.cpu, timer0Config);
    this.usart = new AVRUSART(this.cpu, usart0Config, UNO_HZ);
    this.ports = { B: new AVRIOPort(this.cpu, portBConfig), D: new AVRIOPort(this.cpu, portDConfig) };
    this.onEvent = onEvent;
    this.levels = {};
    this.usart.onByteTransmit = (b) => this.emit({ ev: 'uart', port: 'serial', data: String.fromCharCode(b) });
    for (const [name, port] of Object.entries(this.ports)) {
      port.addListener(() => this.scanPort(name));
    }
  }

  tMs() { return Math.round((this.cpu.cycles / UNO_HZ) * 1000 * 1000) / 1000; }

  emit(ev) { this.onEvent({ ...ev, t: this.tMs() }); }

  scanPort(name) {
    const port = this.ports[name];
    const count = name === 'B' ? 6 : 8;
    for (let bit = 0; bit < count; bit++) {
      const pin = `D${name === 'B' ? bit + 8 : bit}`;
      const st = port.pinState(bit);
      if (st !== PinState.High && st !== PinState.Low) continue;   // only driven outputs
      const v = st === PinState.High ? 1 : 0;
      if (this.levels[pin] !== v) {
        this.levels[pin] = v;
        this.emit({ ev: 'gpio', pin, v });
      }
    }
  }

  setInput(pin, v) {
    const [name, bit] = pinToPort(pin);
    this.ports[name].setPin(bit, !!v);
  }

  runCycles(n) {
    const end = this.cpu.cycles + n;
    while (this.cpu.cycles < end) {
      avrInstruction(this.cpu);
      this.cpu.tick();
    }
  }
}

// Headless batch run used by the grader.
export function runUnoBatch(hex, { durationMs, inputs = [] }) {
  const events = [];
  const board = new UnoBoard(hex, (e) => events.push(e));
  const queue = [...inputs].sort((a, b) => a.at_ms - b.at_ms);
  const stepCycles = UNO_HZ / 1000;   // 1 ms slices
  while (board.tMs() < durationMs) {
    while (queue.length && queue[0].at_ms <= board.tMs()) {
      const i = queue.shift();
      board.setInput(i.pin, i.v);
    }
    board.runCycles(stepCycles);
  }
  events.push({ ev: 'end', t: board.tMs(), regs: {} });
  return events;
}
