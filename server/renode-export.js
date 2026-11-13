// Translates an engine-neutral test file into Renode files (platform + Robot Framework suite).
// This is the production path for STM32 grading. NOTE: generated as a template in the POC;
// it was not executed here (Renode could not be installed in the build environment).
// Verify keyword names against your Renode version before relying on it.

const hex = (n) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

export function renodeBundle(exercise, checks) {
  const duration = (exercise.duration_ms || 2000) / 1000;
  const repl = [
    'using "platforms/cpus/stm32f103.repl"',
    '',
    'led: Miscellaneous.LED @ gpioPortC 13',
    '',
    'gpioPortC:',
    '    13 -> led@0',
    '',
  ].join('\n');

  const cases = [];
  for (const c of checks) {
    const name = `${c.id}  # ${c.title || ''}`.trim();
    if (c.type === 'serial_contains') {
      cases.push([name, '    Create Machine', '    Start Emulation',
        `    Wait For Line On Uart    ${c.text}    timeout=${(c.within_ms ?? 1000) / 1000}`]);
    } else if (c.type === 'register_bits') {
      cases.push([name, '    Create Machine', `    Execute Command    emulation RunFor "${duration}"`,
        `    \${v}=    Execute Command    sysbus ReadDoubleWord ${hex(c.address)}`,
        `    Should Be True    (int(\${v}.strip(), 16) & ${hex(c.mask)}) == ${hex(c.expect)}`]);
    } else if (c.type === 'pin_toggle_period') {
      const half = c.expect_ms / 1000;
      cases.push([name, '    Create Machine', '    Start Emulation',
        `    Assert LED Is Blinking    testDuration=${(half * (c.samples ?? 4)).toFixed(2)}    onDuration=${half}    offDuration=${half}    tolerance=${(c.tolerance_ms / c.expect_ms).toFixed(2)}`]);
    }
  }

  const robot = [
    '*** Settings ***',
    'Suite Setup       Setup',
    'Suite Teardown    Teardown',
    'Test Teardown     Test Teardown',
    'Resource          ${RENODEKEYWORDS}',
    '',
    '*** Variables ***',
    '${ELF}            ${CURDIR}/firmware.elf',
    '',
    '*** Keywords ***',
    'Create Machine',
    '    Execute Command    mach create',
    '    Execute Command    machine LoadPlatformDescription @${CURDIR}/bluepill.repl',
    '    Execute Command    sysbus LoadELF @${ELF}',
    '    Create Terminal Tester    sysbus.usart1',
    '    Create LED Tester    sysbus.gpioPortC.led',
    '',
    '*** Test Cases ***',
    ...cases.flatMap((lines) => [...lines, '']),
  ].join('\n');

  const note = `# Generated from ${exercise.id}/tests.hidden.yaml\n# Run: renode-test tests.robot (with firmware.elf and bluepill.repl next to it)\n` +
    '# Static checks (static_forbid/require) and compile checks run in the worker before Renode, not in Robot.\n';
  return { 'bluepill.repl': repl, 'tests.robot': note + robot };
}
