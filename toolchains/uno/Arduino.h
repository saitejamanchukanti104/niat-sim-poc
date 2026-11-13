/*
 * Arduino-lite for the POC: a small subset of the Arduino API for the Uno
 * (ATmega328P @ 16 MHz), built with plain avr-gcc.
 * Production uses arduino-cli with the official Arduino AVR core instead.
 */
#pragma once
#include <avr/io.h>
#include <avr/interrupt.h>
#include <stdint.h>
#include <stdbool.h>

#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define LED_BUILTIN 13

void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t value);
int digitalRead(uint8_t pin);
unsigned long millis(void);
void delay(unsigned long ms);

class SerialLite {
public:
    void begin(unsigned long baud);
    void write(char c);
    void print(const char *s);
    void print(long n);
    void print(int n) { print((long)n); }
    void print(unsigned long n) { print((long)n); }
    void println(const char *s) { print(s); print("\r\n"); }
    void println(long n) { print(n); print("\r\n"); }
    void println(int n) { println((long)n); }
    void println(void) { print("\r\n"); }
};
extern SerialLite Serial;

void setup(void);
void loop(void);
