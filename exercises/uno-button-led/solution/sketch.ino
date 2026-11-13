// Reference solution: LED follows the button, "PRESSED" once per press.
const int BUTTON = 2;
const int LED = 13;
bool wasPressed = false;

void setup() {
  pinMode(BUTTON, INPUT);
  pinMode(LED, OUTPUT);
  Serial.begin(115200);
  Serial.println("READY");
}

void loop() {
  bool pressed = digitalRead(BUTTON) == HIGH;
  digitalWrite(LED, pressed ? HIGH : LOW);
  if (pressed && !wasPressed) {
    Serial.println("PRESSED");
  }
  wasPressed = pressed;
  delay(10);
}
