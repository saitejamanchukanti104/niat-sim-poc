/* Reference solution: STM32F103 bare metal, 8 MHz HSI, no HAL. */
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

static void uart_putc(char c)
{
    while (!(USART1_SR & (1u << 7))) {}   /* wait for TXE */
    USART1_DR = (uint32_t)c;
}

static void uart_puts(const char *s)
{
    while (*s) uart_putc(*s++);
}

static void delay_ms(uint32_t ms)
{
    while (ms--) {
        while (!(SYST_CSR & (1u << 16))) {}   /* COUNTFLAG = 1 ms passed */
    }
}

int main(void)
{
    /* 1. Clocks: GPIOA (bit 2), GPIOC (bit 4), USART1 (bit 14) */
    RCC_APB2ENR |= (1u << 2) | (1u << 4) | (1u << 14);

    /* 2. PC13 = general-purpose output, push-pull, 2 MHz (MODE=10, CNF=00) */
    GPIOC_CRH = (GPIOC_CRH & ~(0xFu << 20)) | (0x2u << 20);

    /* 3. PA9 = USART1 TX, alternate-function push-pull, 50 MHz (MODE=11, CNF=10) */
    GPIOA_CRH = (GPIOA_CRH & ~(0xFu << 4)) | (0xBu << 4);
    USART1_BRR = 0x45;                       /* 8 MHz / 115200 = 69.4 */
    USART1_CR1 = (1u << 13) | (1u << 3);     /* UE | TE */

    /* 4. Say hello */
    uart_puts("READY\r\n");

    /* 5. SysTick: 1 ms tick from the 8 MHz processor clock, no interrupt */
    SYST_RVR = 8000u - 1u;
    SYST_CVR = 0;
    SYST_CSR = (1u << 2) | (1u << 0);        /* CLKSOURCE | ENABLE */

    /* 6. Blink */
    while (1) {
        GPIOC_ODR ^= (1u << 13);
        delay_ms(1000);
    }
}
