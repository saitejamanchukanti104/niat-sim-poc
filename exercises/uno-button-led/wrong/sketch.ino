// Common mistake: prints PRESSED on every loop while the button is held.
void setup() {
  pinMode(2, INPUT);
  pinMode(13, OUTPUT);
  Serial.begin(115200);
  Serial.println("READY");
}

void loop() {
  if (digitalRead(2) == HIGH) {
    digitalWrite(13, HIGH);
    Serial.println("PRESSED");
  } else {
    digitalWrite(13, LOW);
  }
  delay(100);
}
