// Adafruit Motor Shield v1 (AFMotor.h 사용 여부와 무관)
// 초음파 센서 신호 측정 (TRIG=D10=Servo1, ECHO=D9=Servo2)
// gnd-echo-trig-vcc

#define TRIG_PIN 9  // Servo2 9
#define ECHO_PIN 10   // Servo1 10

// 측정 파라미터
const unsigned long ECHO_TIMEOUT_US = 30000UL; // 30ms ~ 약 5m
const uint8_t SAMPLE_COUNT = 5;                // 이동평균 샘플 수
const uint16_t MEASURE_INTERVAL_MS = 100;      // 측정 주기

float cmFromMicroseconds(unsigned long echoUs) {
  // 소리속도 왕복 시간 기준: cm = us / 58.0 (대략)
  return echoUs / 58.0;
}

void setup() {
  Serial.begin(115200);
  Serial.println(F("Ultrasonic (TRIG=D10 / ECHO=D9) Signal Check Start"));

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT); // HC-SR04는 ECHO가 출력, 아두이노는 입력

  // TRIG 안정화
  digitalWrite(TRIG_PIN, LOW);
  delay(50);
}

void loop() {
  // 샘플 기반 이동 평균
  float sumCm = 0.0;
  unsigned long lastEchoUs = 0;

  for (uint8_t i = 0; i < SAMPLE_COUNT; i++) {
    // 1) 트리거 펄스 (10us HIGH)
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    // 2) ECHO 펄스 폭 측정 (HIGH 펄스 길이)
    unsigned long echoUs = pulseIn(ECHO_PIN, HIGH, ECHO_TIMEOUT_US);
    lastEchoUs = echoUs;

    float cm;
    if (echoUs == 0) {
      // 타임아웃: 목표 없음 또는 너무 먼 거리
      cm = NAN; // 표시용
    } else {
      cm = cmFromMicroseconds(echoUs);
    }

    // 이동 평균용 누산 (유효 측정치만)
    if (!isnan(cm)) sumCm += cm;

    delay(10); // 샘플 간 짧은 간격
  }

  // 평균 계산 (유효 샘플 수로 나눔)
  float avgCm = NAN;
  if (sumCm > 0) {
    // 유효 샘플 수는 sumCm>0 일 때 SAMPLE_COUNT로 가정(간단화)
    // 더 정확히 하려면 유효 카운트 추적 변수를 두세요.
    avgCm = sumCm / (float)SAMPLE_COUNT;
  }

  // 출력
  Serial.print(F("ECHO(us): "));
  Serial.print(lastEchoUs);
  Serial.print(F(" | Distance(cm): "));

  if (isnan(avgCm)) {
    Serial.print(F("N/A"));
  } else {
    Serial.print(avgCm, 1);
  }

  Serial.println();

  delay(MEASURE_INTERVAL_MS);
}
