#!/usr/bin/env python3
"""
POC STM32F103 (Blue Pill) engine.

Stand-in for Renode in this proof of concept. It runs a real bare-metal
binary built with arm-none-eabi-gcc on an emulated Cortex-M3 (Unicorn) and
models the peripherals the first labs need: RCC, GPIOA/B/C, USART1, SysTick.

It speaks the same "engine contract" the production Renode adapter must
implement (see README, "Engine contract"):

  stdout: one JSON event per line
    {"ev":"gpio","t":ms,"pin":"PC13","v":0|1}
    {"ev":"uart","t":ms,"port":"usart1","data":"R"}
    {"ev":"reglog","t":ms,"op":"W","reg":"RCC_APB2ENR","addr":"0x40021018","val":"0x00004014"}
    {"ev":"warn","t":ms,"msg":"..."}
    {"ev":"fault","t":ms,"msg":"...","pc":"0x..."}
    {"ev":"end","t":ms,"regs":{"0x40021018":16404,...}}
  stdin (live mode): {"ev":"input","pin":"PA0","v":1} | {"ev":"stop"}

Limitations (production Renode does not have these):
  * instruction-count timing (1 instruction = 1 cycle), not cycle-exact
  * no interrupts / NVIC (polling only)
  * only the peripherals listed above
"""
import argparse
import json
import sys
import threading
import time

from unicorn import Uc, UcError, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS
from unicorn.arm_const import UC_ARM_REG_PC, UC_ARM_REG_SP, UC_CPU_ARM_CORTEX_M3

FLASH_BASE, FLASH_SIZE = 0x08000000, 0x10000
RAM_BASE, RAM_SIZE = 0x20000000, 0x5000
PERIPH_BASE, PERIPH_SIZE = 0x40000000, 0x30000
SCS_BASE, SCS_SIZE = 0xE000E000, 0x1000

RCC = 0x40021000
GPIO = {"A": 0x40010800, "B": 0x40010C00, "C": 0x40011000}
GPIO_EN_BIT = {"A": 2, "B": 3, "C": 4}
USART1 = 0x40013800
SYST = 0xE000E010

REG_NAMES = {
    RCC + 0x00: "RCC_CR", RCC + 0x04: "RCC_CFGR", RCC + 0x14: "RCC_AHBENR",
    RCC + 0x18: "RCC_APB2ENR", RCC + 0x1C: "RCC_APB1ENR",
    USART1 + 0x00: "USART1_SR", USART1 + 0x04: "USART1_DR", USART1 + 0x08: "USART1_BRR",
    USART1 + 0x0C: "USART1_CR1", USART1 + 0x10: "USART1_CR2", USART1 + 0x14: "USART1_CR3",
    SYST + 0x0: "SYST_CSR", SYST + 0x4: "SYST_RVR", SYST + 0x8: "SYST_CVR",
}
for p, base in GPIO.items():
    for off, n in ((0x0, "CRL"), (0x4, "CRH"), (0x8, "IDR"), (0xC, "ODR"), (0x10, "BSRR"), (0x14, "BRR")):
        REG_NAMES[base + off] = f"GPIO{p}_{n}"

MAX_REGLOG = 300
CHUNK = 2000  # instructions per emulation slice


class Board:
    def __init__(self, out, live):
        self.out = out
        self.live = live
        self.cycles = 0
        self.regs = {}
        self.reglog_count = 0
        self.warned = set()
        self.ext_inputs = {}          # pin name -> level driven from outside (buttons)
        self.pin_levels = {}          # pin name -> last emitted level
        self.systick_start = 0
        self.systick_wraps_seen = 0
        self.poll_count = 0          # consecutive SysTick CSR polls with no other I/O
        self.skipped = False         # set when idle-wait fast-forward jumped time
        self.uc = None
        self.reset()

    # ---------- helpers ----------
    def reset(self):
        r = self.regs
        r[RCC + 0x00] = 0x00000083       # HSION | HSIRDY
        r[RCC + 0x04] = 0
        r[RCC + 0x14] = 0x14
        r[RCC + 0x18] = 0
        r[RCC + 0x1C] = 0
        for base in GPIO.values():
            r[base + 0x0] = 0x44444444
            r[base + 0x4] = 0x44444444
            r[base + 0x8] = 0
            r[base + 0xC] = 0
        for off in (0x0, 0x4, 0x8, 0xC, 0x10, 0x14):
            r[USART1 + off] = 0
        r[USART1 + 0x0] = 0xC0           # TXE | TC
        r[SYST + 0x0] = 0
        r[SYST + 0x4] = 0
        r[SYST + 0x8] = 0

    def t_ms(self):
        return round(self.cycles * 1000.0 / self.sysclk(), 3)

    def emit(self, ev):
        ev.setdefault("t", self.t_ms())
        self.out.write(json.dumps(ev) + "\n")
        if self.live:
            self.out.flush()

    def warn_once(self, key, msg):
        if key not in self.warned:
            self.warned.add(key)
            self.emit({"ev": "warn", "msg": msg})

    def reglog(self, op, addr, val, note=None):
        if self.reglog_count >= MAX_REGLOG:
            return
        self.reglog_count += 1
        ev = {"ev": "reglog", "op": op, "reg": REG_NAMES.get(addr, hex(addr)),
              "addr": f"0x{addr:08X}", "val": f"0x{val & 0xFFFFFFFF:08X}"}
        if note:
            ev["note"] = note
        self.emit(ev)

    def sysclk(self):
        cfgr = self.regs[RCC + 0x04]
        sw = cfgr & 0x3
        if sw == 0:
            return 8_000_000                  # HSI
        if sw == 1:
            return 8_000_000                  # HSE (Blue Pill crystal)
        pllsrc = (cfgr >> 16) & 1
        mul = min(((cfgr >> 18) & 0xF) + 2, 16)
        src = 8_000_000 if pllsrc else 4_000_000
        return src * mul

    def clock_on(self, bit):
        return bool(self.regs[RCC + 0x18] & (1 << bit))

    # ---------- GPIO ----------
    def pin_mode(self, port, n):
        base = GPIO[port]
        reg = self.regs[base + (0x4 if n >= 8 else 0x0)]
        nib = (reg >> ((n % 8) * 4)) & 0xF
        return nib & 0x3, (nib >> 2) & 0x3   # MODE, CNF

    def recompute_pins(self, port):
        base = GPIO[port]
        odr = self.regs[base + 0xC]
        idr = 0
        for n in range(16):
            name = f"P{port}{n}"
            mode, cnf = self.pin_mode(port, n)
            if mode != 0 and cnf in (0, 1):      # general-purpose output
                level = (odr >> n) & 1
            elif mode == 0:                      # input
                level = self.ext_inputs.get(name, 0)
            else:                                # alternate function output
                level = self.pin_levels.get(name, 1)
            idr |= level << n
            if self.pin_levels.get(name) != level:
                if name in self.pin_levels or level == 1 or mode != 0:
                    self.emit({"ev": "gpio", "pin": name, "v": level})
                self.pin_levels[name] = level
        self.regs[base + 0x8] = idr

    # ---------- SysTick ----------
    def systick_elapsed(self):
        csr = self.regs[SYST]
        if not csr & 1:
            return None
        div = 1 if csr & 0x4 else 8
        return (self.cycles - self.systick_start) // div

    def systick_read(self, off):
        rvr = self.regs[SYST + 0x4] & 0xFFFFFF
        el = self.systick_elapsed()
        if off == 0x0:
            csr = self.regs[SYST] & ~(1 << 16)
            if el is not None and rvr > 0:
                wraps = el // (rvr + 1)
                if wraps > self.systick_wraps_seen:
                    self.systick_wraps_seen = wraps
                    self.poll_count = 0
                    csr |= 1 << 16           # COUNTFLAG, clears on read
                else:
                    # Idle-wait fast-forward: the CPU is only polling COUNTFLAG,
                    # so jump simulated time to the next SysTick wrap.
                    self.poll_count += 1
                    if self.poll_count >= 3 and self.uc is not None:
                        div = 1 if csr & 0x4 else 8
                        target = self.systick_start + (self.systick_wraps_seen + 1) * (rvr + 1) * div
                        if target > self.cycles:
                            self.cycles = target
                            self.skipped = True
                            self.poll_count = 0
                            self.uc.emu_stop()
            return csr
        if off == 0x8:
            if el is None or rvr == 0:
                return self.regs[SYST + 0x8]
            return rvr - (el % (rvr + 1))
        return self.regs[SYST + off]

    def systick_write(self, off, val):
        if off == 0x0:
            was_on = self.regs[SYST] & 1
            self.regs[SYST] = val & 0x7
            if val & 1 and not was_on:
                self.systick_start = self.cycles
                self.systick_wraps_seen = 0
            if val & 0x2:
                self.warn_once("tickint", "SysTick interrupt (TICKINT) enabled: interrupts are not "
                               "simulated in this POC engine. Poll COUNTFLAG instead (Renode supports interrupts).")
        elif off == 0x4:
            self.regs[SYST + 0x4] = val & 0xFFFFFF
        elif off == 0x8:
            self.regs[SYST + 0x8] = 0
            self.systick_start = self.cycles
            self.systick_wraps_seen = 0

    # ---------- MMIO ----------
    def periph_read(self, uc, offset, size, _ud):
        self.poll_count = 0
        addr = PERIPH_BASE + offset
        aligned = addr & ~3
        if aligned == RCC + 0x00:
            cr = self.regs[aligned]
            cr |= (cr & 1) << 1 | ((cr >> 16) & 1) << 17 | ((cr >> 24) & 1) << 25   # *RDY follow *ON
            return cr
        if aligned == RCC + 0x04:
            cfgr = self.regs[aligned]
            return (cfgr & ~0xC) | ((cfgr & 0x3) << 2)        # SWS follows SW
        for port, base in GPIO.items():
            if base <= aligned < base + 0x18:
                if not self.clock_on(GPIO_EN_BIT[port]):
                    self.warn_once(f"rd{port}", f"Read from GPIO{port} while its clock is off "
                                   f"(set RCC_APB2ENR bit {GPIO_EN_BIT[port]}). Reads return 0.")
                    return 0
                return self.regs.get(aligned, 0)
        if aligned == USART1 + 0x0:
            return 0xC0
        return self.regs.get(aligned, 0)

    def periph_write(self, uc, offset, size, value, _ud):
        self.poll_count = 0
        addr = PERIPH_BASE + offset
        aligned = addr & ~3
        value &= 0xFFFFFFFF
        for port, base in GPIO.items():
            if base <= aligned < base + 0x18:
                if not self.clock_on(GPIO_EN_BIT[port]):
                    self.reglog("W", aligned, value, "ignored: GPIO clock off")
                    self.warn_once(f"wr{port}", f"Write to {REG_NAMES.get(aligned)} ignored: GPIO{port} clock "
                                   f"is off. Enable it with RCC_APB2ENR bit {GPIO_EN_BIT[port]} first.")
                    return
                off = aligned - base
                if off == 0x10:                       # BSRR
                    odr = self.regs[base + 0xC]
                    odr |= value & 0xFFFF
                    odr &= ~((value >> 16) & 0xFFFF)
                    self.regs[base + 0xC] = odr
                elif off == 0x14:                     # BRR
                    self.regs[base + 0xC] &= ~(value & 0xFFFF)
                elif off == 0x8:
                    return                            # IDR is read-only
                else:
                    self.regs[aligned] = value
                if off in (0x0, 0x4):
                    self.reglog("W", aligned, value)
                self.recompute_pins(port)
                return
        if aligned == USART1 + 0x4:
            self.uart_tx(value & 0xFF)
            return
        self.regs[aligned] = value
        self.reglog("W", aligned, value)

    def uart_tx(self, byte):
        if not self.clock_on(14):
            self.warn_once("u1clk", "USART1_DR written but USART1 clock is off (RCC_APB2ENR bit 14). Character lost.")
            return
        cr1 = self.regs[USART1 + 0xC]
        if not (cr1 & (1 << 13) and cr1 & (1 << 3)):
            self.warn_once("u1en", "USART1_DR written but USART1 is not enabled (CR1: UE bit 13 and TE bit 3). "
                           "Character lost.")
            return
        mode, cnf = self.pin_mode("A", 9)
        if not (self.clock_on(2) and mode != 0 and cnf in (2, 3)):
            self.warn_once("pa9", "USART1 is sending but PA9 (TX) is not set as alternate-function output "
                           "(GPIOA_CRH bits 7:4 = 0xB). Nothing reaches the pin.")
            return
        brr = self.regs[USART1 + 0x8]
        if brr == 0:
            self.warn_once("brr0", "USART1_BRR is 0: baud rate not set. Character lost.")
            return
        baud = self.sysclk() / brr
        if abs(baud - 115200) / 115200 > 0.03:
            self.warn_once("baud", f"Baud rate is about {baud:.0f}, but the serial monitor runs at 115200. "
                           "Output will look garbled.")
            byte = 0x3F  # '?'
        self.emit({"ev": "uart", "port": "usart1", "data": chr(byte)})

    def scs_read(self, uc, offset, size, _ud):
        addr = SCS_BASE + offset
        aligned = addr & ~3
        if SYST <= aligned < SYST + 0xC:
            return self.systick_read(aligned - SYST)
        return 0

    def scs_write(self, uc, offset, size, value, _ud):
        addr = SCS_BASE + offset
        aligned = addr & ~3
        if SYST <= aligned < SYST + 0xC:
            self.reglog("W", aligned, value)
            self.systick_write(aligned - SYST, value & 0xFFFFFFFF)

    def set_input(self, pin, level):
        self.ext_inputs[pin] = 1 if level else 0
        port = pin[1]
        if port in GPIO:
            self.recompute_pins(port)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bin")
    ap.add_argument("--mode", choices=["live", "batch"], default="batch")
    ap.add_argument("--duration-ms", type=float, default=3000)
    ap.add_argument("--inputs", default="[]", help='JSON list: [{"at_ms":1000,"pin":"PA0","v":1}]')
    args = ap.parse_args()

    out = sys.stdout
    board = Board(out, live=args.mode == "live")
    fw = open(args.bin, "rb").read()
    if len(fw) > FLASH_SIZE:
        board.emit({"ev": "fault", "msg": "Firmware larger than 64 KB flash"})
        return

    uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    uc.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M3)
    uc.mem_map(0x00000000, FLASH_SIZE)           # boot alias of flash
    uc.mem_map(FLASH_BASE, FLASH_SIZE)
    uc.mem_map(RAM_BASE, RAM_SIZE)
    uc.mem_write(0x00000000, fw)
    uc.mem_write(FLASH_BASE, fw)
    uc.mmio_map(PERIPH_BASE, PERIPH_SIZE, board.periph_read, None, board.periph_write, None)
    uc.mmio_map(SCS_BASE, SCS_SIZE, board.scs_read, None, board.scs_write, None)

    sp = int.from_bytes(fw[0:4], "little")
    pc = int.from_bytes(fw[4:8], "little")
    uc.reg_write(UC_ARM_REG_SP, sp)
    board.uc = uc
    for port in GPIO:
        board.recompute_pins(port)

    inputs = sorted(json.loads(args.inputs), key=lambda x: x["at_ms"])
    stop = {"flag": False}

    if board.live:
        def reader():
            for line in sys.stdin:
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if msg.get("ev") == "input":
                    board.pending_inputs.append(msg)
                elif msg.get("ev") == "stop":
                    stop["flag"] = True
                    return
            stop["flag"] = True
        board.pending_inputs = []
        threading.Thread(target=reader, daemon=True).start()

    wall_start = time.monotonic()
    duration = args.duration_ms if not board.live else float("inf")
    while board.t_ms() < duration and not stop["flag"]:
        while inputs and inputs[0]["at_ms"] <= board.t_ms():
            i = inputs.pop(0)
            board.set_input(i["pin"], i["v"])
        if board.live:
            while board.pending_inputs:
                i = board.pending_inputs.pop(0)
                board.set_input(i["pin"], i["v"])
        try:
            uc.emu_start(pc | 1, 0xFFFFFFFF, count=CHUNK)
        except UcError as e:
            cur = uc.reg_read(UC_ARM_REG_PC)
            board.emit({"ev": "fault", "msg": f"CPU fault: {e}. Check for bad pointers or "
                        "unsupported peripherals.", "pc": f"0x{cur:08X}"})
            break
        pc = uc.reg_read(UC_ARM_REG_PC)
        if board.skipped:
            board.skipped = False      # time already advanced to the SysTick wrap
        else:
            board.cycles += CHUNK
        if board.live:
            ahead = board.t_ms() / 1000.0 - (time.monotonic() - wall_start)
            if ahead > 0.005:
                time.sleep(ahead)

    regs = {f"0x{a:08X}": v for a, v in board.regs.items()}
    regs[f"0x{SYST:08X}"] = board.regs[SYST]
    board.emit({"ev": "end", "regs": regs})
    out.flush()


if __name__ == "__main__":
    main()
