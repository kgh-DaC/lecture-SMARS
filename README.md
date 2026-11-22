# SMARS 로봇 AI 코딩 수업 교재

SMARS 로봇을 이용해 AI 코딩 수업용 웹 교재입니다. 
아두이노 기초부터 모터·센서·블루투스를 거쳐 디지털트윈 통합 실습까지, 한 페이지(`lesson.html`)로 진행합니다.

## 바로 열기

- **수업 교재:** https://kgh-dac.github.io/lecture-SMARS/
- **디지털트윈 웹 콘솔 (시뮬레이션):** https://kgh-dac.github.io/lecture-SMARS/twin/smars_console.html?sim=1

로봇과 USB로 연결해 쓰는 기능(미니 시리얼 모니터, 웹 콘솔 실물 연결)은 Web Serial을 쓰므로 **Chrome 또는 Edge**에서 여세요.

## 수업 구성

| 모듈 | 내용 |
| --- | --- |
| M0 | 오리엔테이션 |
| M1 | 아두이노·브레드보드·바이브코딩 입문 (보드, 신호선과 전원선, 전원 공급, 시리얼 통신, 브레드보드, IDE) |
| M2 | DC모터·H-bridge·PWM |
| M3 | 부저 |
| M4 | 초음파 센서 |
| M5 | 적외선 라인센서 (선택) |
| M6 | 블루투스 (HC-05) |
| M7 | 디지털트윈 통합 실습 |
| 정리 | 정리 |

각 모듈 카드는 원리(인터랙티브 그림), 배선, AI에게 줄 프롬프트, 예제 코드, 코드 검사표, 확인 문제로 되어 있습니다.

## 폴더 구성

| 경로 | 내용 |
| --- | --- |
| `lesson.html` | 수업 교재 (파일 하나, 더블클릭으로 열림) |
| `examples/` | 모듈별 예제 스케치 (`m1_blink` … `m6_bt`, arduino-cli로 컴파일 확인) |
| `twin/` | 디지털트윈 웹 콘솔 + 통합 펌웨어 (`smars_firmware`), three.js r160 로컬 번들 포함 |
| `reference/sketches/` | 참고용 점검 스케치 (`ultra_test`는 다른 쉴드 기준이라 그대로 쓰지 않음) |

## 오프라인으로 쓰기

인터넷이 없는 실습실에서는 저장소를 내려받아(Code → Download ZIP) 폴더째 복사한 뒤 `lesson.html`을 더블클릭하면 됩니다. 디지털트윈의 three.js도 `twin/vendor/`에 들어 있어 인터넷 없이 동작합니다.

## 하드웨어 기준

- 보드: Arduino UNO R3 + L298P 모터 쉴드
- USB 시리얼 57600bps, HC-05 블루투스 9600bps (SoftwareSerial, TXD→A1, RXD←A0)
- 핀 배치는 교재의 각 모듈 카드에 나온 표를 기준으로 합니다.

## 라이선스

- `twin/vendor/three-r160-bundle.js`: three.js (MIT License, `twin/vendor/three.LICENSE.txt`)
