/*
  SMARS integrated firmware (fw=3) - L298P motor shield
  -----------------------------------------------------
  Board   : Arduino UNO (arduino:avr:uno)
  Library : SoftwareSerial, EEPROM (both built-in). No other libraries.
  Protocol: .claude/skills/smars-protocol/SKILL.md (single source of truth)

  Links (both accept the same commands, reply goes back to the sender):
    USB  : hardware Serial, 57600 bps (D0/D1)  (CH340 driver on this PC fails to open at 115200)
    BT   : HC-05 on SoftwareSerial, 9600 bps (RX=A1, TX=A0)

  Pin table (defaults; changeable at runtime with PIN, stored in EEPROM)
  | Function        | Terminal                    | Arduino pin (PIN keys)        |
  |-----------------|-----------------------------|-------------------------------|
  | Left motor (B)  | DIR / BRAKE / PWM           | D12 / D9 / D10 (ldir/lbrk/lpwm)|
  | Right motor (A) | DIR / BRAKE / PWM           | D13 / -1 unused / D11 (rdir/rbrk/rpwm)|
  | Ultrasonic      | Trig(T) / Echo(R) / + / G   | D7 / D8 / 5V / GND (trig/echo)|
  | Buzzer (active) | signal / GND                | D4 / GND, HIGH = on (buz)     |
  | IR line sensor  | DO / VCC / GND              | A2 / 5V / GND, digital (line) |
  | HC-05 (fixed)   | TXD-> / RXD<-               | A1 (RX) / A0 (TX)             |
  | USB (fixed)     | -                           | D0 / D1                       |

  Notes
  - D8 is shared: the shield's BRAKE_A and the ultrasonic Echo. D8 is used ONLY
    as INPUT (Echo). Right motor stops with PWM 0 + DIR kept (rbrk = -1).
    If the right motor does not turn or distance readings look wrong, this
    assumption is wrong for your shield.
  - Active buzzer: frequency cannot change. BUZ <on>: 0=off, >=1=on.
    tone() is NOT used (Timer2 would break D11 PWM).
  - No delay() in loop(). Buzzer duration, streaming, watchdog and AUTO are
    millis()-based. The only short blocking is pulseIn() (<= ~25 ms timeout).

  Commands (one ASCII line, '\n' terminated, case-insensitive, space separated)
    PING                 -> PONG
    INFO                 -> INFO fw=3 shield=L298P
    PIN                  -> PIN buz=4 trig=7 echo=8 ldir=12 lbrk=9 lpwm=10 rdir=13 rbrk=-1 rpwm=11 line=16
    PIN <key> <n>        -> OK PIN <key> <n> | ERR PIN RESERVED | ERR PIN NOPWM
                            | ERR PIN CONFLICT <otherkey> | ERR ARG
                            (n: 2..19 digital/analog, -1 only for lbrk/rbrk;
                             0,1,14,15 reserved; lpwm/rpwm in 3,5,6,9,10,11)
    PIN RESET            -> OK PIN RESET, then one PIN ... line
                            (PIN changes stop motors, AUTO/USW/LNW off, old pin -> INPUT)
    LINK                 -> LINK USB | LINK BT
    MOVE <F|B|L|R|S> [%] -> OK MOVE <d> <%>        (default 80)
    M <l> <r>            -> OK M <l> <r>           (-100..100)
    BUZ <on> <ms>        -> OK BUZ <on> <ms>       (auto off after ms)
    US                   -> DIST <cm> | DIST -1
    USW <0|1>            -> OK USW <0|1>, then DIST every 100 ms
    LINE                 -> LINE <0|1>             (raw digitalRead of the line sensor)
    LNW <0|1>            -> OK LNW <0|1>, then LINE <v> on change (>=20 ms apart) and every 250 ms
    SAFE <cm>            -> OK SAFE <cm>; EVT SAFESTOP when triggered
    AUTO <0|1>           -> OK AUTO <0|1>
    STAT                 -> STAT l=<l> r=<r> buz=<0|1> dist=<cm> safe=<cm> auto=<0|1> usw=<0|1> line=<0|1> lnw=<0|1>
                            (dist=-1 if last reading older than 1000 ms)
    errors               -> ERR UNKNOWN | ERR ARG | ERR SAFE <cm>
    watchdog             -> EVT WATCHDOG (600 ms without command after MOVE/M,
                            or 3000 ms without any command while AUTO)
  Detail rules (QA round 1)
  - SAFE hold: MOVE F / M with both >0 while SAFE>0 measures first; if
    dist<=SAFE the motors stay stopped and the reply is ERR SAFE <cm>.
  - MOVE/M while AUTO: AUTO off, EVT AUTOOFF, then the command runs.
  - BUZ 1 0: on until BUZ 0.
  - Unsolicited output (DIST stream, EVT ...) goes to each link (USB, BT) that
    has received at least one complete command line since boot.
*/

#include <SoftwareSerial.h>
#include <EEPROM.h>

// ---------------- Pins (defaults; runtime values live in pins[]) ----------------
#define DEF_BUZ    4
#define DEF_TRIG   7
#define DEF_ECHO   8
#define DEF_LDIR  12   // left motor (shield B)
#define DEF_LBRK   9
#define DEF_LPWM  10
#define DEF_RDIR  13   // right motor (shield A)
#define DEF_RBRK  -1   // BRAKE_A (D8) is the US echo -> unused
#define DEF_RPWM  11
#define DEF_LINE  16   // A2, IR line sensor DO (digital input)

// Bluetooth is fixed (SoftwareSerial pins are set at construction).
#define BT_RX    A1
#define BT_TX    A0

enum PinKey { P_BUZ, P_TRIG, P_ECHO, P_LDIR, P_LBRK, P_LPWM, P_RDIR, P_RBRK, P_RPWM, P_LINE, PIN_COUNT };
#define PIN_COUNT_V1 9   // EEPROM version 1 (fw=2) stored the first 9 keys only
const char *const PIN_NAMES[PIN_COUNT] = {
  "buz", "trig", "echo", "ldir", "lbrk", "lpwm", "rdir", "rbrk", "rpwm", "line" };
const int8_t PIN_DEFAULTS[PIN_COUNT] = {
  DEF_BUZ, DEF_TRIG, DEF_ECHO, DEF_LDIR, DEF_LBRK, DEF_LPWM, DEF_RDIR, DEF_RBRK, DEF_RPWM, DEF_LINE };
int8_t pins[PIN_COUNT];

#define EE_MAGIC_ADDR  0
#define EE_VER_ADDR    1
#define EE_PINS_ADDR   2
#define EE_MAGIC       0x53   // 'S'
#define EE_VERSION     2   // 2 = 10 keys (line added); 1 = 9 keys, migrated on load

// ---------------- Options ----------------
#define INVERT_LEFT   0   // set 1 if the left wheel turns the wrong way
#define INVERT_RIGHT  0   // set 1 if the right wheel turns the wrong way

#define USB_BAUD  57600
#define BT_BAUD   9600

const unsigned long WATCHDOG_MS     = 600;
const unsigned long AUTO_LINK_TIMEOUT_MS = 3000;
const unsigned long USW_PERIOD_MS   = 100;
const unsigned long LNW_PERIOD_MS   = 250;   // LINE heartbeat while streaming
const unsigned long LNW_MIN_GAP_MS  = 20;    // min gap between change reports
const unsigned long SENSE_PERIOD_MS = 60;     // SAFE / AUTO measuring period
const unsigned long ECHO_TIMEOUT_US = 25000UL; // ~4 m
const int DEFAULT_SPEED = 80;

// AUTO tuning
const int AUTO_SPEED      = 60;
const int AUTO_TURN_SPEED = 70;
const int AUTO_OBSTACLE_CM = 20;
const unsigned long AUTO_BACK_MS = 400;
const unsigned long AUTO_TURN_MS = 450;

SoftwareSerial BT(BT_RX, BT_TX);

// ---------------- State ----------------
enum LinkId { LINK_USB = 0, LINK_BT = 1 };

int  curL = 0, curR = 0;          // -100..100
bool buzOn = false;
unsigned long buzOffAt = 0;
bool buzTimed = false;
int  lastDist = -1;               // cm, -1 = none
int  safeCm = 0;
bool autoOn = false;
bool uswOn = false;
bool lnwOn = false;               // line sensor streaming
int  lastLineSent = -1;
unsigned long lastLineMs = 0;
bool driveActive = false;         // motors set by MOVE/M (watchdog armed)

unsigned long lastCmdMs = 0;
unsigned long lastUswMs = 0;
unsigned long lastSenseMs = 0;

unsigned long lastDistMs = 0;     // when lastDist was measured
bool everMeasured = false;

enum AutoState { AUTO_FWD, AUTO_BACK, AUTO_TURN };
AutoState autoState = AUTO_FWD;
unsigned long autoStateAt = 0;

char usbBuf[48]; uint8_t usbIdx = 0;
char btBuf[48];  uint8_t btIdx = 0;

// ---------------- Output ----------------
Stream &linkStream(LinkId l) {
  if (l == LINK_BT) return BT;
  return Serial;
}

// Unsolicited messages (EVT, DIST stream) go only to links that have received
// at least one command line since boot. SoftwareSerial TX blocks interrupts
// (~1 ms/byte at 9600), which would corrupt USB input if always sent.
bool usbSeen = false;
bool btSeen  = false;

void emitBoth(const __FlashStringHelper *msg) {
  if (usbSeen) Serial.println(msg);
  if (btSeen)  BT.println(msg);
}

void emitLineBoth(int v) {
  if (usbSeen) { Serial.print(F("LINE ")); Serial.println(v); }
  if (btSeen)  { BT.print(F("LINE "));     BT.println(v); }
}

int readLine() { return digitalRead(pins[P_LINE]) == HIGH ? 1 : 0; }

void emitDistBoth(int d) {
  if (usbSeen) { Serial.print(F("DIST ")); Serial.println(d); }
  if (btSeen)  { BT.print(F("DIST "));     BT.println(d); }
}

// ---------------- Motors ----------------
void driveRight(int pct) {
  pct = constrain(pct, -100, 100);
  int pwm = (abs(pct) * 255) / 100;
  bool fwd = pct >= 0;
  if (INVERT_RIGHT) fwd = !fwd;
  if (pct == 0) {
    if (pins[P_RBRK] >= 0) digitalWrite(pins[P_RBRK], HIGH);
    analogWrite(pins[P_RPWM], 0);  // DIR kept
    return;
  }
  if (pins[P_RBRK] >= 0) digitalWrite(pins[P_RBRK], LOW);
  digitalWrite(pins[P_RDIR], fwd ? HIGH : LOW);
  analogWrite(pins[P_RPWM], pwm);
}

void driveLeft(int pct) {
  pct = constrain(pct, -100, 100);
  int pwm = (abs(pct) * 255) / 100;
  bool fwd = pct >= 0;
  if (INVERT_LEFT) fwd = !fwd;
  if (pct == 0) {
    if (pins[P_LBRK] >= 0) digitalWrite(pins[P_LBRK], HIGH);
    analogWrite(pins[P_LPWM], 0);
    return;
  }
  if (pins[P_LBRK] >= 0) digitalWrite(pins[P_LBRK], LOW);
  digitalWrite(pins[P_LDIR], fwd ? HIGH : LOW);
  analogWrite(pins[P_LPWM], pwm);
}

void setMotors(int l, int r) {
  curL = constrain(l, -100, 100);
  curR = constrain(r, -100, 100);
  driveLeft(curL);
  driveRight(curR);
}

void stopMotors() { setMotors(0, 0); }

// ---------------- Buzzer ----------------
void setBuzzer(bool on, unsigned long ms) {
  buzOn = on;
  digitalWrite(pins[P_BUZ], on ? HIGH : LOW);
  buzTimed = on && ms > 0;
  if (buzTimed) buzOffAt = millis() + ms;
}

// ---------------- Ultrasonic ----------------
int measureCm() {
  digitalWrite(pins[P_TRIG], LOW);
  delayMicroseconds(2);
  digitalWrite(pins[P_TRIG], HIGH);
  delayMicroseconds(10);
  digitalWrite(pins[P_TRIG], LOW);
  unsigned long us = pulseIn(pins[P_ECHO], HIGH, ECHO_TIMEOUT_US);
  lastDistMs = millis();
  everMeasured = true;
  if (us == 0) { lastDist = -1; return -1; }
  lastDist = (int)(us / 58UL);
  return lastDist;
}

// Distance for STAT: -1 if the last reading is older than 1000 ms.
int freshDist() {
  if (!everMeasured || millis() - lastDistMs > 1000UL) return -1;
  return lastDist;
}

// SAFE hold: before a forward command, measure; true = blocked (reply sent).
bool safeBlocks(Stream &out) {
  if (safeCm <= 0) return false;
  int d = measureCm();
  if (d >= 0 && d <= safeCm) {
    stopMotors();
    driveActive = false;
    out.print(F("ERR SAFE ")); out.println(d);
    return true;
  }
  return false;
}

// MOVE / M while AUTO: turn AUTO off and announce it before executing.
void cancelAutoForManual() {
  if (autoOn) {
    autoOn = false;
    stopMotors();
    emitBoth(F("EVT AUTOOFF"));
  }
}

bool parseInt(const char *s, long &out);

// ---------------- Runtime pin configuration ----------------
enum PinCheck { PC_OK, PC_ARG, PC_RESERVED, PC_NOPWM, PC_CONFLICT };

bool isBrakeKey(uint8_t k) { return k == P_LBRK || k == P_RBRK; }
bool isPwmPin(int v) { return v == 3 || v == 5 || v == 6 || v == 9 || v == 10 || v == 11; }

// Validate value v for key k against cfg (other keys). conflictKey set on PC_CONFLICT.
// Returns a PinCheck value (uint8_t so the Arduino prototype generator copes).
uint8_t checkPin(uint8_t k, long v, const int8_t *cfg, uint8_t &conflictKey) {
  if (v < -1 || v > 19) return PC_ARG;
  if (v == -1) return isBrakeKey(k) ? PC_OK : PC_ARG;
  if (v == 0 || v == 1 || v == 14 || v == 15) return PC_RESERVED;
  if ((k == P_LPWM || k == P_RPWM) && !isPwmPin((int)v)) return PC_NOPWM;
  for (uint8_t i = 0; i < PIN_COUNT; i++) {
    if (i != k && cfg[i] == v) { conflictKey = i; return PC_CONFLICT; }
  }
  return PC_OK;
}

void configurePin(uint8_t k) {
  int p = pins[k];
  if (p < 0) return;
  if (k == P_ECHO || k == P_LINE) { pinMode(p, INPUT); return; }
  pinMode(p, OUTPUT);
  digitalWrite(p, LOW);
}

void releasePin(int p) {
  if (p < 0) return;
  digitalWrite(p, LOW);   // also turns PWM off
  pinMode(p, INPUT);
}

void savePins() {
  EEPROM.update(EE_MAGIC_ADDR, EE_MAGIC);
  EEPROM.update(EE_VER_ADDR, EE_VERSION);
  for (uint8_t i = 0; i < PIN_COUNT; i++) EEPROM.update(EE_PINS_ADDR + i, (uint8_t)pins[i]);
}

// Load from EEPROM; any invalid content -> defaults.
void loadPins() {
  uint8_t ver = EEPROM.read(EE_VER_ADDR);
  bool ok = EEPROM.read(EE_MAGIC_ADDR) == EE_MAGIC && (ver == EE_VERSION || ver == 1);
  uint8_t stored = (ver == 1) ? PIN_COUNT_V1 : PIN_COUNT;
  int8_t tmp[PIN_COUNT];
  for (uint8_t i = 0; i < PIN_COUNT; i++)
    tmp[i] = (ok && i < stored) ? (int8_t)EEPROM.read(EE_PINS_ADDR + i) : PIN_DEFAULTS[i];
  for (uint8_t i = 0; ok && i < PIN_COUNT; i++) {
    uint8_t ck;
    if (checkPin(i, tmp[i], tmp, ck) != PC_OK) ok = false;
  }
  for (uint8_t i = 0; i < PIN_COUNT; i++) pins[i] = ok ? tmp[i] : PIN_DEFAULTS[i];
  // v1 -> v2 migration: line got its default (a collision already failed the check above -> all defaults)
  if (ok && ver == 1) savePins();
}

// Same stop as the watchdog, plus AUTO and USW off. No EVT is sent.
void quiesceForPinChange() {
  stopMotors();
  driveActive = false;
  autoOn = false;
  uswOn = false;
  lnwOn = false;
}

void printPins(Stream &out) {
  out.print(F("PIN"));
  for (uint8_t i = 0; i < PIN_COUNT; i++) {
    out.print(' '); out.print(PIN_NAMES[i]); out.print('='); out.print(pins[i]);
  }
  out.println();
}

void handlePin(char **tok, uint8_t n, bool extra, Stream &out) {
  if (n == 1) { printPins(out); return; }
  if (extra || n > 3) { out.println(F("ERR ARG")); return; }

  if (n == 2) {
    if (strcmp(tok[1], "RESET") != 0) { out.println(F("ERR ARG")); return; }
    quiesceForPinChange();
    setBuzzer(false, 0);
    for (uint8_t i = 0; i < PIN_COUNT; i++) releasePin(pins[i]);
    for (uint8_t i = 0; i < PIN_COUNT; i++) { pins[i] = PIN_DEFAULTS[i]; configurePin(i); }
    stopMotors();
    savePins();
    out.println(F("OK PIN RESET"));
    printPins(out);
    return;
  }

  // n == 3: PIN <key> <num>
  uint8_t k = PIN_COUNT;
  for (uint8_t i = 0; i < PIN_COUNT; i++) {
    if (strcasecmp(tok[1], PIN_NAMES[i]) == 0) { k = i; break; }
  }
  long v;
  if (k == PIN_COUNT || !parseInt(tok[2], v)) { out.println(F("ERR ARG")); return; }
  uint8_t ck = 0;
  switch (checkPin(k, v, pins, ck)) {
    case PC_ARG:      out.println(F("ERR ARG")); return;
    case PC_RESERVED: out.println(F("ERR PIN RESERVED")); return;
    case PC_NOPWM:    out.println(F("ERR PIN NOPWM")); return;
    case PC_CONFLICT: out.print(F("ERR PIN CONFLICT ")); out.println(PIN_NAMES[ck]); return;
    default: break;
  }

  quiesceForPinChange();
  if (k == P_BUZ) setBuzzer(false, 0);
  if (pins[k] != v) {
    releasePin(pins[k]);
    pins[k] = (int8_t)v;
    configurePin(k);
  }
  stopMotors();            // re-apply stop state with the new pin set
  savePins();
  out.print(F("OK PIN ")); out.print(PIN_NAMES[k]); out.print(' '); out.println(v);
}

// ---------------- Parsing helpers ----------------
// Strict integer parse; returns false on empty / garbage.
bool parseInt(const char *s, long &out) {
  if (!s || !*s) return false;
  char *end;
  out = strtol(s, &end, 10);
  return *end == '\0';
}

// ---------------- Command handling ----------------
void handleLine(char *line, LinkId src) {
  // uppercase
  for (char *p = line; *p; ++p) *p = toupper(*p);

  char *tok[4] = { NULL, NULL, NULL, NULL };
  uint8_t n = 0;
  char *t = strtok(line, " \t");
  while (t && n < 4) { tok[n++] = t; t = strtok(NULL, " \t"); }
  if (n == 0) return;
  bool extra = (t != NULL);       // more than 4 tokens

  Stream &out = linkStream(src);
  lastCmdMs = millis();
  const char *cmd = tok[0];

  if (!strcmp(cmd, "PING")) {
    out.println(F("PONG"));
  }
  else if (!strcmp(cmd, "INFO")) {
    out.println(F("INFO fw=3 shield=L298P"));
  }
  else if (!strcmp(cmd, "LINK")) {
    out.println(src == LINK_BT ? F("LINK BT") : F("LINK USB"));
  }
  else if (!strcmp(cmd, "MOVE")) {
    if (n < 2 || n > 3 || extra || strlen(tok[1]) != 1) { out.println(F("ERR ARG")); return; }
    long sp = DEFAULT_SPEED;
    if (n == 3 && (!parseInt(tok[2], sp) || sp < 0 || sp > 100)) { out.println(F("ERR ARG")); return; }
    char d = tok[1][0];
    if (d != 'F' && d != 'B' && d != 'L' && d != 'R' && d != 'S') { out.println(F("ERR ARG")); return; }
    int s = (int)sp;
    cancelAutoForManual();
    if (d == 'F' && s > 0 && safeBlocks(out)) return;
    switch (d) {
      case 'F': setMotors( s,  s); break;
      case 'B': setMotors(-s, -s); break;
      case 'L': setMotors(-s,  s); break;
      case 'R': setMotors( s, -s); break;
      case 'S': stopMotors(); s = 0; break;
    }
    driveActive = (d != 'S');
    out.print(F("OK MOVE ")); out.print(d); out.print(' '); out.println(s);
  }
  else if (!strcmp(cmd, "M")) {
    long l, r;
    if (n != 3 || extra || !parseInt(tok[1], l) || !parseInt(tok[2], r) ||
        l < -100 || l > 100 || r < -100 || r > 100) { out.println(F("ERR ARG")); return; }
    cancelAutoForManual();
    if (l > 0 && r > 0 && safeBlocks(out)) return;
    setMotors((int)l, (int)r);
    driveActive = (l != 0 || r != 0);
    out.print(F("OK M ")); out.print(l); out.print(' '); out.println(r);
  }
  else if (!strcmp(cmd, "BUZ")) {
    long on, ms;
    if (n != 3 || extra || !parseInt(tok[1], on) || !parseInt(tok[2], ms) ||
        on < 0 || ms < 0) { out.println(F("ERR ARG")); return; }
    setBuzzer(on >= 1, (unsigned long)ms);
    out.print(F("OK BUZ ")); out.print(on); out.print(' '); out.println(ms);
  }
  else if (!strcmp(cmd, "US")) {
    if (n != 1) { out.println(F("ERR ARG")); return; }
    int d = measureCm();
    out.print(F("DIST ")); out.println(d);
  }
  else if (!strcmp(cmd, "USW")) {
    long v;
    if (n != 2 || extra || !parseInt(tok[1], v) || (v != 0 && v != 1)) { out.println(F("ERR ARG")); return; }
    uswOn = (v == 1);
    lastUswMs = millis() - USW_PERIOD_MS;   // first sample right away
    out.print(F("OK USW ")); out.println(v);
  }
  else if (!strcmp(cmd, "LINE")) {
    if (n != 1) { out.println(F("ERR ARG")); return; }
    out.print(F("LINE ")); out.println(readLine());
  }
  else if (!strcmp(cmd, "LNW")) {
    long v;
    if (n != 2 || extra || !parseInt(tok[1], v) || (v != 0 && v != 1)) { out.println(F("ERR ARG")); return; }
    lnwOn = (v == 1);
    lastLineSent = -1;                       // first report right away
    out.print(F("OK LNW ")); out.println(v);
  }
  else if (!strcmp(cmd, "SAFE")) {
    long v;
    if (n != 2 || extra || !parseInt(tok[1], v) || v < 0 || v > 400) { out.println(F("ERR ARG")); return; }
    safeCm = (int)v;
    out.print(F("OK SAFE ")); out.println(v);
  }
  else if (!strcmp(cmd, "AUTO")) {
    long v;
    if (n != 2 || extra || !parseInt(tok[1], v) || (v != 0 && v != 1)) { out.println(F("ERR ARG")); return; }
    autoOn = (v == 1);
    driveActive = false;
    if (autoOn) { autoState = AUTO_FWD; autoStateAt = millis(); }
    else stopMotors();
    out.print(F("OK AUTO ")); out.println(v);
  }
  else if (!strcmp(cmd, "PIN")) {
    handlePin(tok, n, extra, out);
  }
  else if (!strcmp(cmd, "STAT")) {
    out.print(F("STAT l="));    out.print(curL);
    out.print(F(" r="));        out.print(curR);
    out.print(F(" buz="));      out.print(buzOn ? 1 : 0);
    out.print(F(" dist="));     out.print(freshDist());
    out.print(F(" safe="));     out.print(safeCm);
    out.print(F(" auto="));     out.print(autoOn ? 1 : 0);
    out.print(F(" usw="));      out.print(uswOn ? 1 : 0);
    out.print(F(" line="));     out.print(readLine());
    out.print(F(" lnw="));      out.println(lnwOn ? 1 : 0);
  }
  else {
    out.println(F("ERR UNKNOWN"));
  }
}

void pollLink(Stream &s, char *buf, uint8_t &idx, uint8_t cap, LinkId id) {
  while (s.available() > 0) {
    char c = (char)s.read();
    if (c == '\n' || c == '\r') {
      if (idx > 0) {
        buf[idx] = '\0';
        if (id == LINK_BT) btSeen = true; else usbSeen = true;
        handleLine(buf, id);
        idx = 0;
      }
    } else if (idx < cap - 1) {
      buf[idx++] = c;
    } else {
      idx = 0;                     // overrun: drop line
    }
  }
}

// ---------------- Background tasks ----------------
void runAuto(unsigned long now) {
  switch (autoState) {
    case AUTO_FWD:
      if (lastDist >= 0 && lastDist <= AUTO_OBSTACLE_CM) {
        setMotors(-AUTO_SPEED, -AUTO_SPEED);
        autoState = AUTO_BACK; autoStateAt = now;
      } else if (curL != AUTO_SPEED || curR != AUTO_SPEED) {
        setMotors(AUTO_SPEED, AUTO_SPEED);
      }
      break;
    case AUTO_BACK:
      if (now - autoStateAt >= AUTO_BACK_MS) {
        setMotors(AUTO_TURN_SPEED, -AUTO_TURN_SPEED);   // spin right
        autoState = AUTO_TURN; autoStateAt = now;
      }
      break;
    case AUTO_TURN:
      if (now - autoStateAt >= AUTO_TURN_MS) {
        autoState = AUTO_FWD; autoStateAt = now;
      }
      break;
  }
}

// ---------------- setup / loop ----------------
void setup() {
  loadPins();                       // EEPROM or defaults
  for (uint8_t i = 0; i < PIN_COUNT; i++) configurePin(i);

  stopMotors();

  Serial.begin(USB_BAUD);
  BT.begin(BT_BAUD);

  lastCmdMs = millis();
}

void loop() {
  pollLink(Serial, usbBuf, usbIdx, sizeof(usbBuf), LINK_USB);
  pollLink(BT,     btBuf,  btIdx,  sizeof(btBuf),  LINK_BT);

  unsigned long now = millis();

  // Buzzer auto-off
  if (buzTimed && (long)(now - buzOffAt) >= 0) {
    setBuzzer(false, 0);
  }

  // Motor watchdog (MOVE / M only)
  if (driveActive && now - lastCmdMs > WATCHDOG_MS) {
    stopMotors();
    driveActive = false;
    emitBoth(F("EVT WATCHDOG"));
  }

  // AUTO link watchdog: no command at all for 3000 ms -> AUTO off + stop
  if (autoOn && now - lastCmdMs > AUTO_LINK_TIMEOUT_MS) {
    autoOn = false;
    stopMotors();
    emitBoth(F("EVT WATCHDOG"));
  }

  // Ultrasonic streaming
  bool measured = false;
  if (uswOn && now - lastUswMs >= USW_PERIOD_MS) {
    lastUswMs = now;
    int d = measureCm();
    measured = true;
    lastSenseMs = now;
    emitDistBoth(d);
  }

  // Line sensor streaming: on change (>= LNW_MIN_GAP_MS apart) or heartbeat
  if (lnwOn) {
    int v = readLine();
    unsigned long gap = now - lastLineMs;
    if ((v != lastLineSent && gap >= LNW_MIN_GAP_MS) || gap >= LNW_PERIOD_MS) {
      lastLineSent = v; lastLineMs = now;
      emitLineBoth(v);
    }
  }

  // Background sensing for SAFE / AUTO
  bool forward = (curL > 0 && curR > 0);
  bool needSense = autoOn || (safeCm > 0 && forward);
  if (needSense && !measured && now - lastSenseMs >= SENSE_PERIOD_MS) {
    lastSenseMs = now;
    measureCm();
    measured = true;
  }

  // SAFE stop
  if (measured && safeCm > 0 && forward && !autoOn &&
      lastDist >= 0 && lastDist <= safeCm) {
    stopMotors();
    driveActive = false;
    emitBoth(F("EVT SAFESTOP"));
  }

  if (autoOn) runAuto(now);
}
