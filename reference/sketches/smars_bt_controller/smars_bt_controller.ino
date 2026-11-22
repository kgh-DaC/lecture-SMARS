/*
  SMARS + Adafruit Motor Shield v1 (AFMotor.h)
  Bluetooth A1=RX, A0=TX  ← 핀 수정
  - 단문: F/f B/b L/l R/r S/s (대소문자 무관)
  - 좌표: "x,y\n" -> 차동 믹싱
*/

#include <AFMotor.h>
#include <SoftwareSerial.h>

// ★ 핀 수정: RX=A1, TX=A0
#define BT_RX A1
#define BT_TX A0
SoftwareSerial BT(BT_RX, BT_TX);

AF_DCMotor motorL(1, MOTOR12_64KHZ);
AF_DCMotor motorR(2, MOTOR12_64KHZ);

const uint16_t     BT_BAUD     = 9600;
uint8_t            maxSpeedPct = 80;
const unsigned long CMD_TIMEOUT = 600;

char    lineBuf[40];
uint8_t lineIdx  = 0;
unsigned long lastCmdMs = 0;

// ── 모터 ─────────────────────────────────────────────────────────────────────
void applyMotor(AF_DCMotor &m, int s) {
  int mag = abs(s);
  if (mag > 255) mag = 255;
  m.setSpeed(mag);
  if      (s > 0) m.run(FORWARD);
  else if (s < 0) m.run(BACKWARD);
  else            m.run(RELEASE);
}

void stopAll() {
  applyMotor(motorL, 0);
  applyMotor(motorR, 0);
}

int pctToPwm(int pct) {
  pct = constrain(pct, 0, 100);
  return (pct * 255) / 100;
}

// ── 차동 구동 (x,y = -100~+100) ──────────────────────────────────────────────
void driveFromXY(int x, int y) {
  int  base  = map(abs(y), 0, 100, 0, pctToPwm(maxSpeedPct));
  long turn  = (long)x * base / 100;
  int  sgn   = (y >= 0) ? +1 : -1;
  long left  = (long)sgn * (base - turn);
  long right = (long)sgn * (base + turn);
  applyMotor(motorL, (int)constrain(left,  -255, 255));
  applyMotor(motorR, (int)constrain(right, -255, 255));
}

// ── 단문 명령 (대/소문자 통합) ────────────────────────────────────────────────
void handleCharCmd(char c) {
  c = (char)tolower(c);
  lastCmdMs = millis();
  switch (c) {
    case 'f': case 'u': {
      int p = pctToPwm(maxSpeedPct);
      applyMotor(motorL, +p); applyMotor(motorR, +p);
    } break;
    case 'b': case 'd': {
      int p = pctToPwm(maxSpeedPct);
      applyMotor(motorL, -p); applyMotor(motorR, -p);
    } break;
    case 'l': {
      int p = pctToPwm(maxSpeedPct);
      applyMotor(motorL, -p); applyMotor(motorR, +p);
    } break;
    case 'r': {
      int p = pctToPwm(maxSpeedPct);
      applyMotor(motorL, +p); applyMotor(motorR, -p);
    } break;
    case 's': case 'n':
      stopAll();
      break;
    default:
      if (c >= '0' && c <= '9') {
        int d = c - '0';
        maxSpeedPct = (d == 9) ? 100 : (d * 10);
      }
      break;
  }
}

// ── 정수 2개 추출 ─────────────────────────────────────────────────────────────
bool extractTwoInts(const char* s, long &a, long &b) {
  bool gotA=false, gotB=false, neg=false, inNum=false;
  long val = 0;
  for (const char* p = s; *p; ++p) {
    char ch = *p;
    if (ch == '-' && !inNum) { neg=true; inNum=true; val=0; continue; }
    if (ch >= '0' && ch <= '9') {
      if (!inNum) { inNum=true; neg=false; val=0; }
      val = val*10 + (ch-'0');
    } else {
      if (inNum) {
        long out = neg ? -val : val;
        if (!gotA)      { a=out; gotA=true; }
        else if (!gotB) { b=out; gotB=true; break; }
        inNum=false; val=0; neg=false;
      }
    }
  }
  if (inNum && !gotB) {
    long out = neg ? -val : val;
    if (!gotA) { a=out; gotA=true; }
    else       { b=out; gotB=true; }
  }
  return gotA && gotB;
}

// ── 라인 파싱 ─────────────────────────────────────────────────────────────────
void handleLine(const char* s) {
  if (!s || !s[0]) return;

  // 한 글자 → 단문 명령
  if (!s[1]) { handleCharCmd(s[0]); return; }

  // 좌표 파싱
  long xRaw=0, yRaw=0;
  if (extractTwoInts(s, xRaw, yRaw)) {
    lastCmdMs = millis();
    if (xRaw>=0 && xRaw<=255 && yRaw>=0 && yRaw<=255) {
      driveFromXY((int)((xRaw-128)*100/127), (int)((yRaw-128)*100/127));
    } else {
      driveFromXY((int)constrain(xRaw,-100,100),
                  (int)constrain(yRaw,-100,100));
    }
  }
}

// ── setup / loop ──────────────────────────────────────────────────────────────
void setup() {
  BT.begin(BT_BAUD);
  stopAll();
  lastCmdMs = millis();
  // Serial.begin(115200); // 디버깅용
}

void loop() {
  // ★ 핵심 수정: peek() 단문 처리 제거 → 항상 라인 버퍼 사용
  //   (peek()로 단문 즉시 처리하면 좌표 문자열의 첫 글자가 단문으로 오인됨)
  while (BT.available() > 0) {
    char c = (char)BT.read();
    if (c == '\n' || c == '\r') {
      if (lineIdx > 0) {
        lineBuf[lineIdx] = '\0';
        handleLine(lineBuf);
        lineIdx = 0;
      }
    } else {
      if (lineIdx < (uint8_t)(sizeof(lineBuf) - 1)) {
        lineBuf[lineIdx++] = c;
      } else {
        lineIdx = 0; // 오버런 방지
      }
    }
  }

  // 타임아웃 안전 정지
  if (millis() - lastCmdMs > CMD_TIMEOUT) {
    stopAll();
  }
}
