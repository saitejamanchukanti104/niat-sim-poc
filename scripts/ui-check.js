// Headless UI check: drives the real page in Chrome and saves screenshots to docs/screenshots.
import puppeteer from 'puppeteer-core';
import { readFile, mkdir } from 'node:fs/promises';

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = 'docs/screenshots';
await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (p) => readFile(p, 'utf8');

// 1. STM32: run reference solution live, then grade it
await page.goto(`${BASE}/?ex=stm32-blink-hello`, { waitUntil: 'networkidle0' });
await page.evaluate(async (c) => window.niatLab.setCode(c), await code('exercises/stm32-blink-hello/solution/main.c'));
await page.click('#run');
await page.waitForFunction(() => document.getElementById('serial').textContent.includes('READY'), { timeout: 15000 });
let lit = false;
for (let i = 0; i < 20 && !lit; i++) { await sleep(100); lit = await page.evaluate(() => document.getElementById('led-pc13').getAttribute('fill') === '#4ade80'); }
console.log('STM32 live: READY seen, PC13 LED lit at some point =', lit);
await page.click('#submit');
await page.waitForSelector('.score', { timeout: 30000 });
console.log('STM32 graded score:', await page.$eval('.score', (e) => e.textContent.trim()));
await page.screenshot({ path: `${OUT}/1-stm32-solution-graded.png`, fullPage: true });
await page.click('#stop');

// 2. STM32: wrong solution (1000 ms blink) practice + graded
await page.evaluate(async (c) => window.niatLab.setCode(c), await code('exercises/stm32-blink-hello/wrong/main.c'));
await page.click('#submit');
await page.waitForFunction(() => document.querySelector('.score')?.textContent.includes('attempt 2'), { timeout: 30000 });
console.log('STM32 wrong graded:', await page.$eval('.score', (e) => e.textContent.trim()));
await page.screenshot({ path: `${OUT}/2-stm32-wrong-graded.png`, fullPage: true });

// 2b. STM32: common mistake — GPIOC clock never enabled. The register log should explain it.
const noClock = (await code('exercises/stm32-blink-hello/solution/main.c')).replace('RCC_APB2ENR |= (1u << 2) | (1u << 4) | (1u << 14);', 'RCC_APB2ENR |= (1u << 2) | (1u << 14);   /* forgot GPIOC (bit 4) */');
await page.evaluate(async (c) => window.niatLab.setCode(c), noClock);
await page.click('#run');
await page.waitForFunction(() => document.getElementById('reglog').textContent.includes('clock is off'), { timeout: 15000 });
await sleep(800);
console.log('STM32 no-clock live warning shown:', (await page.$eval('#reglog', (e) => e.textContent)).includes('GPIOC clock is off'));
await page.click('#practice');
await page.waitForSelector('.score', { timeout: 30000 });
await page.screenshot({ path: `${OUT}/2b-stm32-forgot-clock.png`, fullPage: true });
await page.click('#stop');

// 3. Uno: run reference solution live, press the button
await page.select('#exercise', 'uno-button-led');
await page.waitForFunction(() => document.getElementById('board-pill').textContent === 'Arduino Uno');
await page.evaluate(async (c) => window.niatLab.setCode(c), await code('exercises/uno-button-led/solution/sketch.ino'));
await page.click('#run');
await page.waitForFunction(() => document.getElementById('serial').textContent.includes('READY'), { timeout: 15000 });
await page.evaluate(() => document.getElementById('btn').dispatchEvent(new Event('button-press')));
await sleep(400);
const led = await page.evaluate(() => document.getElementById('uno').led13);
console.log('Uno live: LED13 on while pressed =', led, '| serial =', JSON.stringify(await page.$eval('#serial', (e) => e.textContent)));
await page.screenshot({ path: `${OUT}/3-uno-live-pressed.png`, fullPage: true });
await page.evaluate(() => document.getElementById('btn').dispatchEvent(new Event('button-release')));
await page.click('#stop');

// 4. Uno: wrong solution graded
await page.evaluate(async (c) => window.niatLab.setCode(c), await code('exercises/uno-button-led/wrong/sketch.ino'));
await page.click('#submit');
await page.waitForSelector('.score', { timeout: 30000 });
await sleep(300);
console.log('Uno wrong graded:', await page.$eval('.score', (e) => e.textContent.trim()));
await page.screenshot({ path: `${OUT}/4-uno-wrong-graded.png`, fullPage: true });

// 5. Instructor view
await page.goto(`${BASE}/instructor.html`, { waitUntil: 'networkidle0' });
await sleep(500);
await page.screenshot({ path: `${OUT}/5-instructor-view.png`, fullPage: true });

console.log('Browser console:', logs.filter((l) => !l.startsWith('log:')).join('\n') || '(clean)');
await browser.close();
