#include "Arduino.h"

/* Pin map: D0-D7 = PORTD bits 0-7, D8-D13 = PORTB bits 0-5 */
static volatile uint8_t *ddr_of(uint8_t pin) { return pin < 8 ? &DDRD : &DDRB; }
static volatile uint8_t *port_of(uint8_t pin) { return pin < 8 ? &PORTD : &PORTB; }
static volatile uint8_t *pinreg_of(uint8_t pin) { return pin < 8 ? &PIND : &PINB; }
static uint8_t bit_of(uint8_t pin) { return pin < 8 ? pin : pin - 8; }

void pinMode(uint8_t pin, uint8_t mode)
{
    if (pin > 13) return;
    uint8_t m = 1 << bit_of(pin);
    if (mode == OUTPUT) {
        *ddr_of(pin) |= m;
    } else {
        *ddr_of(pin) &= ~m;
        if (mode == INPUT_PULLUP) *port_of(pin) |= m; else *port_of(pin) &= ~m;
    }
}

void digitalWrite(uint8_t pin, uint8_t value)
{
    if (pin > 13) return;
    uint8_t m = 1 << bit_of(pin);
    if (value) *port_of(pin) |= m; else *port_of(pin) &= ~m;
}

int digitalRead(uint8_t pin)
{
    if (pin > 13) return LOW;
    return (*pinreg_of(pin) & (1 << bit_of(pin))) ? HIGH : LOW;
}

/* Timer0 in CTC mode: 16 MHz / 64 / 250 = 1 kHz tick */
static volatile unsigned long ms_count = 0;
ISR(TIMER0_COMPA_vect) { ms_count++; }

unsigned long millis(void)
{
    uint8_t s = SREG;
    cli();
    unsigned long m = ms_count;
    SREG = s;
    return m;
}

void delay(unsigned long ms)
{
    unsigned long start = millis();
    while (millis() - start < ms) {}
}

SerialLite Serial;

void SerialLite::begin(unsigned long baud)
{
    uint16_t ubrr = (uint16_t)((F_CPU / 8 / baud) - 1);   /* double speed */
    UCSR0A = (1 << U2X0);
    UBRR0H = ubrr >> 8;
    UBRR0L = ubrr & 0xFF;
    UCSR0B = (1 << TXEN0) | (1 << RXEN0);
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
}

void SerialLite::write(char c)
{
    while (!(UCSR0A & (1 << UDRE0))) {}
    UDR0 = c;
}

void SerialLite::print(const char *s)
{
    while (*s) write(*s++);
}

void SerialLite::print(long n)
{
    char buf[12];
    int i = 0;
    bool neg = n < 0;
    unsigned long v = neg ? -n : n;
    do { buf[i++] = '0' + (v % 10); v /= 10; } while (v);
    if (neg) write('-');
    while (i) write(buf[--i]);
}

int main(void)
{
    TCCR0A = (1 << WGM01);                 /* CTC */
    OCR0A = 249;
    TCCR0B = (1 << CS01) | (1 << CS00);    /* /64 */
    TIMSK0 = (1 << OCIE0A);
    sei();
    setup();
    for (;;) loop();
}
