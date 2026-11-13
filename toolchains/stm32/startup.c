/*
 * Minimal startup for STM32F103 (Blue Pill). Read-only for students.
 * Copies .data from flash, zeroes .bss, calls main().
 */
#include <stdint.h>

extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss, _estack;
int main(void);

void Reset_Handler(void)
{
    uint32_t *src = &_sidata;
    for (uint32_t *dst = &_sdata; dst < &_edata;) *dst++ = *src++;
    for (uint32_t *dst = &_sbss; dst < &_ebss;) *dst++ = 0;
    main();
    while (1) {}
}

void Default_Handler(void) { while (1) {} }

__attribute__((section(".isr_vector"), used))
const void *const vector_table[16] = {
    &_estack,          /* Initial stack pointer */
    Reset_Handler,     /* Reset */
    Default_Handler,   /* NMI */
    Default_Handler,   /* HardFault */
    Default_Handler,   /* MemManage */
    Default_Handler,   /* BusFault */
    Default_Handler,   /* UsageFault */
    0, 0, 0, 0,        /* Reserved */
    Default_Handler,   /* SVCall */
    Default_Handler,   /* DebugMon */
    0,                 /* Reserved */
    Default_Handler,   /* PendSV */
    Default_Handler,   /* SysTick */
};
