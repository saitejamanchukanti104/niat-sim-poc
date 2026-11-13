#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define RCC_APB2ENR  REG(0x40021018)
#define GPIOA_CRH    REG(0x40010804)
#define GPIOC_CRH    REG(0x40011004)
#define GPIOC_ODR    REG(0x4001100C)
#define USART1_SR    REG(0x40013800)
#define USART1_DR    REG(0x40013804)
#define USART1_BRR   REG(0x40013808)
#define USART1_CR1   REG(0x4001380C)
#define SYST_CSR     REG(0xE000E010)
#define SYST_RVR     REG(0xE000E014)
#define SYST_CVR     REG(0xE000E018)

int main(void)
{
    // TODO 1: enable clocks for GPIOA, GPIOC and USART1 (RCC_APB2ENR)
    // TODO 2: set PC13 as push-pull output (GPIOC_CRH)
    // TODO 3: set PA9 as alternate-function output, init USART1 at 115200
    // TODO 4: print "READY\r\n"
    // TODO 5: configure SysTick for a 1 ms tick (poll COUNTFLAG, no interrupt)

    while (1) {
        // TODO 6: toggle PC13 every 500 ms
    }
}
