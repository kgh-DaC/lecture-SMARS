// 부저 D4 확인용 (L298P 쉴드 온보드 부저 후보)
// 능동형/수동형 모두 들리도록: 0.5초 2kHz 사각파 → 0.3초 HIGH 유지 → 1초 쉼, 반복
#define BUZZER 4

void setup() {
  pinMode(BUZZER, OUTPUT);
  // 모터가 움직이지 않도록 L298P 모터 핀을 정지 상태로 둔다
  pinMode(10, OUTPUT); digitalWrite(10, LOW);
  pinMode(11, OUTPUT); digitalWrite(11, LOW);
}

void loop() {
  unsigned long t = millis();
  while (millis() - t < 500) {
    digitalWrite(BUZZER, HIGH); delayMicroseconds(250);
    digitalWrite(BUZZER, LOW);  delayMicroseconds(250);
  }
  digitalWrite(BUZZER, HIGH); delay(300);
  digitalWrite(BUZZER, LOW);  delay(1000);
}
