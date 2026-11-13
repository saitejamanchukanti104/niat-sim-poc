tail -5 /tmp/niat-server.log; curl -s localhost:8080/api/exercises | head -c 200; echo; ls web/public
# NIAT Embedded Lab: hands-on in 5 minutes

The simulator starts by itself. A browser tab opens with the lab.
If it doesn't, open the **Ports** tab at the bottom and click the globe icon next to port **8080**.

## Exercise 1: STM32 Blue Pill, bare metal
1. Pick **STM32 bare metal: Blink and Hello** at the top.
2. Read the task, fill in the TODOs in `main.c` (registers only, no HAL), then click **Run**.
   You should see READY in the serial monitor and the PC13 LED blinking.
   The register log shows every register your code wrote.
3. Click **Run practice tests**, then **Submit for grading** (5 graded attempts).
   Stuck? The answer is in `exercises/stm32-blink-hello/solution/main.c`.
   Try deleting the GPIOC clock bit `(1u << 4)` to see how the lab explains the mistake.

## Exercise 2: Arduino Uno, button and LED
1. Pick **Arduino Uno: Button controls LED**.
2. Write the sketch, click **Run**, then hold the green button. LED "L" should light.
3. Submit and check your marks.

## Instructor view
Click **Instructor view** (top right) for the gradebook and the Renode test export.

Read `README.md` for the architecture, how it maps to the PRD, and how to add exercises.
If the page doesn't load: run `npm start` in the terminal.
