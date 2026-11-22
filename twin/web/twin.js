// SMARS 디지털 트윈 (Three.js r160)
// 사용: const twin = createTwin(el); twin.setState({...}); twin.addPathPoint({x,y}); ...
// 상태 객체 정의: smars-protocol 스킬 "트윈 상태 객체" + smars-twin-model "월드 맵 통합" 참조.
// 월드 좌표: 1cm = 0.5 단위. 맵 (x, y)cm -> 3D (x*0.5, 0, -y*0.5). theta=0 이 +x, 반시계 +.
// 로봇 모델 내부(robot 그룹 로컬)는 1 단위 = 1 cm 로 만들고 그룹 전체를 0.5 배 축소한다.
// 로봇 로컬: 전방 = +X, 위 = +Y, 오른쪽 = +Z, 왼쪽 = -Z.
//
// 일반 <script src="web/twin.js"> 로 불러오는 classic 스크립트다 (file:// 로 열어도 동작하도록).
// 사용: const { createTwin } = await window.loadSMARSTwin();  three 는 vendor/three-r160-bundle.js(로컬, 인터넷 불필요)가 있으면 그것, 없으면 import map 으로 CDN 에서 동적 import.
(function () {
'use strict';
let loading = null;
window.loadSMARSTwin = () => loading || (loading = (async () => {
// 오프라인: vendor/three-r160-bundle.js(smars_console.html 기준, classic script)가 먼저 실렸으면 그것을 쓰고, 없으면 import map(CDN)으로 받는다.
const LOCAL = window.SMARS_THREE;
const THREE = LOCAL ? LOCAL.THREE : await import('three');
const { OrbitControls } = LOCAL ? LOCAL : await import('three/addons/controls/OrbitControls.js');

const DEFAULT_STATE = {
  left: 0,
  right: 0,
  buzzer: false,
  distance: null,
  ultrasonicOn: false,
  linkType: null,
  connected: false,
  auto: false,
  safeStop: false,
  line: null,          // 'black' | 'white' | null
  lineOn: false,       // 라인 센서 읽는 중
};

const MAX_TRACK_SPEED = 14;   // cm/s at 100%
const TRACK_GAP = 7.6;        // 좌우 궤도 중심 간격 (cm)
const WHEEL_R = 1.7;
const WHEEL_X = 3.9;          // 앞/뒤 바퀴 x 위치 (±)
const LINK_COUNT = 30;
const S = 0.5;                // 월드 축척: 1cm -> 0.5 단위
const MAX_CONE_LEN = 200;     // 콘 최대 표시 길이 (로봇 로컬 cm)
const CONE_HALF_ANGLE = THREE.MathUtils.degToRad(15);
const GRID_CELL = 10 * S;     // 격자 한 칸 = 10cm
const GRID_SIZE = 600;        // 격자 크기(단위) = 12m, 로봇 근처로 칸 단위 스냅
const WALL_CELL = 5;          // 벽 양자화 셀 (cm)
const WALL_MAX = 2000;
const PATH_MAX = 20000;
const PATH_MIN_STEP = 0.5;    // cm, 이보다 가까운 점은 생략
const HIGHLIGHT_SEC = 0.8;
const CAM_OFFSET = new THREE.Vector3(-14, 13, 16);

const COLORS = {
  chassis: 0xe8e8e8,
  edgeOn: 0x38d6ff,
  edgeOff: 0x555a60,
  track: 0x26282c,
  wheel: 0xf2b134,
  motor: 0xb8bcc2,
  motorGlow: 0xff7a1a,
  shield: 0x1f7a3a,
  ledGreen: 0x34ff6a,
  ledAuto: 0xb06bff,
  usBoard: 0x1b4fa0,
  usEye: 0xcfd3d8,
  usGlow: 0x3ef2e0,
  buzzer: 0x1a1a1a,
  buzzerGlow: 0xffd400,
  btBoard: 0x2a4bd0,
  btLed: 0x3d7dff,
  coneIdle: 0x2ad4c8,
  coneHit: 0xff3b3b,
  wall: 0xb48a6a,
  wallNew: 0xffb347,
  path: 0x3d8bff,
  safe: 0xff2020,
  lineBoard: 0x15365c,
  lineLed: 0xff3b3b,
  lineBlack: 0x050505,
  lineWhite: 0xf4f6f8,
  lineRingBlack: 0xff8a1f,
  lineRingWhite: 0x5fd8ff,
};

function clampNum(v, lo, hi, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

function createTwin(containerEl) {
  if (!containerEl) throw new Error('createTwin: container element required');

  const state = { ...DEFAULT_STATE };
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0f1318, 1);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  if (getComputedStyle(containerEl).position === 'static') {
    containerEl.style.position = 'relative';
  }
  containerEl.appendChild(renderer.domElement);

  const overlay = document.createElement('div');
  overlay.textContent = '미연결';
  Object.assign(overlay.style, {
    position: 'absolute', left: '50%', top: '12px', transform: 'translateX(-50%)',
    padding: '4px 12px', borderRadius: '999px', font: '600 13px system-ui, sans-serif',
    color: '#ffd7d7', background: 'rgba(120,20,20,0.75)', pointerEvents: 'none',
    letterSpacing: '0.05em',
  });
  containerEl.appendChild(overlay);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0f1318, 60, 140);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 3000);
  camera.position.copy(CAM_OFFSET);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.minDistance = 4;
  controls.maxDistance = 800;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x20242a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-10, 25, 12);
  scene.add(sun);

  // ---------- 월드 고정 바닥 격자 (로봇 근처로 칸 단위 스냅해 무한처럼 보이게) ----------
  const grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE / GRID_CELL, 0x2e3a46, 0x1f262e);
  track(grid.geometry); track(grid.material);
  scene.add(grid);
  // 원점 표시 (빨강 = 맵 +x)
  const axes = new THREE.AxesHelper(6);
  axes.position.y = 0.02;
  track(axes.geometry); track(axes.material);
  scene.add(axes);
  const groundGeo = track(new THREE.PlaneGeometry(GRID_SIZE * 2, GRID_SIZE * 2));
  const groundMat = track(new THREE.MeshStandardMaterial({ color: 0x12171d, roughness: 1 }));
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  // ---------- helpers ----------
  const emissiveMats = []; // {mat, base}
  function stdMat(color, opts = {}) {
    const m = track(new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...opts }));
    return m;
  }
  function mesh(geo, mat) {
    track(geo);
    return new THREE.Mesh(geo, mat);
  }

  // ---------- robot ----------
  const robot = new THREE.Group();
  robot.scale.setScalar(S);
  scene.add(robot);

  // 섀시
  const chassisMat = stdMat(COLORS.chassis, { emissive: 0x000000 });
  const chassisGeo = new THREE.BoxGeometry(9.6, 3.0, 5.8);
  const chassis = mesh(chassisGeo, chassisMat);
  chassis.position.set(0, 2.6, 0);
  robot.add(chassis);
  const edgeMat = track(new THREE.LineBasicMaterial({ color: COLORS.edgeOff }));
  const edges = new THREE.LineSegments(track(new THREE.EdgesGeometry(chassisGeo)), edgeMat);
  chassis.add(edges);

  // 궤도/바퀴/모터 (좌/우)
  const sides = {};
  const linkGeo = track(new THREE.BoxGeometry(0.9, 0.35, 1.9));
  const trackMat = stdMat(COLORS.track, { roughness: 0.9 });
  const wheelMat = stdMat(COLORS.wheel);
  const spokeMat = stdMat(0x8a5a10);
  const motorMat = stdMat(COLORS.motor, { metalness: 0.6, roughness: 0.35, emissive: 0x000000 });
  const wheelGeo = track(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 1.5, 24));
  wheelGeo.rotateX(Math.PI / 2);
  const toothGeo = track(new THREE.BoxGeometry(0.45, 0.5, 1.5));
  const spokeGeo = track(new THREE.BoxGeometry(WHEEL_R * 1.7, 0.3, 1.6));
  const motorGeo = track(new THREE.CylinderGeometry(0.65, 0.65, 2.4, 16));
  motorGeo.rotateX(Math.PI / 2);
  const gearboxGeo = track(new THREE.BoxGeometry(1.2, 1.2, 0.9));

  const straightLen = WHEEL_X * 2;
  const trackR = WHEEL_R + 0.2;
  const pathLen = 2 * straightLen + 2 * Math.PI * trackR;

  // s(0..pathLen) -> {x,y,angle}: 위쪽 직선(뒤→앞), 앞 반원(아래로), 아래 직선(앞→뒤), 뒤 반원(위로)
  function pathPoint(s) {
    s = ((s % pathLen) + pathLen) % pathLen;
    const cy = WHEEL_R;
    const arc = Math.PI * trackR;
    if (s < straightLen) {
      return { x: -WHEEL_X + s, y: cy + trackR, a: 0 };
    }
    s -= straightLen;
    if (s < arc) {
      const th = s / trackR; // 0..PI, 위에서 아래로 시계방향
      return { x: WHEEL_X + Math.sin(th) * trackR, y: cy + Math.cos(th) * trackR, a: -th };
    }
    s -= arc;
    if (s < straightLen) {
      return { x: WHEEL_X - s, y: cy - trackR, a: -Math.PI };
    }
    s -= straightLen;
    const th = s / trackR;
    return { x: -WHEEL_X - Math.sin(th) * trackR, y: cy - Math.cos(th) * trackR, a: -Math.PI - th };
  }

  for (const side of ['left', 'right']) {
    const z = side === 'left' ? -TRACK_GAP / 2 : TRACK_GAP / 2;
    const g = new THREE.Group();
    g.position.z = z;
    robot.add(g);

    const wheels = [];
    for (const wx of [-WHEEL_X, 0, WHEEL_X]) {
      const wg = new THREE.Group();
      wg.position.set(wx, WHEEL_R, 0);
      const small = wx === 0;
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      if (small) w.scale.set(0.75, 0.75, 1);
      wg.add(w);
      const sp1 = new THREE.Mesh(spokeGeo, spokeMat);
      const sp2 = new THREE.Mesh(spokeGeo, spokeMat);
      sp2.rotation.z = Math.PI / 2;
      if (small) { sp1.scale.set(0.75, 1, 1); sp2.scale.set(0.75, 1, 1); }
      wg.add(sp1, sp2);
      if (!small) {
        for (let i = 0; i < 10; i++) {
          const t = new THREE.Mesh(toothGeo, wheelMat);
          const a = (i / 10) * Math.PI * 2;
          t.position.set(Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R, 0);
          t.rotation.z = a;
          wg.add(t);
        }
      }
      g.add(wg);
      wheels.push({ group: wg, r: small ? WHEEL_R * 0.75 : WHEEL_R });
    }

    const links = new THREE.InstancedMesh(linkGeo, trackMat, LINK_COUNT);
    links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.add(links);

    // 모터: 궤도 안쪽, 뒤 바퀴 축에 연결
    const inward = side === 'left' ? 1 : -1;
    const motorMatSide = motorMat.clone();
    track(motorMatSide);
    const motor = new THREE.Mesh(motorGeo, motorMatSide);
    motor.position.set(-WHEEL_X, WHEEL_R, z + inward * 2.3);
    const gearbox = new THREE.Mesh(gearboxGeo, stdMat(0xd8c070));
    gearbox.position.set(-WHEEL_X, WHEEL_R, z + inward * 1.0);
    robot.add(motor, gearbox);
    emissiveMats.push(motorMatSide);

    sides[side] = { group: g, wheels, links, motor, motorMat: motorMatSide, offset: 0, speed: 0 };
  }

  const tmpObj = new THREE.Object3D();
  function updateLinks(side) {
    const sd = sides[side];
    for (let i = 0; i < LINK_COUNT; i++) {
      const p = pathPoint(sd.offset + (i / LINK_COUNT) * pathLen);
      tmpObj.position.set(p.x, p.y, 0);
      tmpObj.rotation.set(0, 0, p.a);
      tmpObj.updateMatrix();
      sd.links.setMatrixAt(i, tmpObj.matrix);
    }
    sd.links.instanceMatrix.needsUpdate = true;
  }
  updateLinks('left');
  updateLinks('right');

  // 모터 쉴드 (PCB) + LED
  const shield = mesh(new THREE.BoxGeometry(7.0, 0.18, 5.3), stdMat(COLORS.shield, { roughness: 0.5 }));
  shield.position.set(0.3, 4.4, 0);
  robot.add(shield);
  const chipGeo = track(new THREE.BoxGeometry(1.6, 0.5, 1.6));
  const chip = new THREE.Mesh(chipGeo, stdMat(0x111111));
  chip.position.set(0.5, 4.7, 0);
  robot.add(chip);
  const headerGeo = track(new THREE.BoxGeometry(5.5, 0.6, 0.3));
  const headerMat = stdMat(0x101010);
  for (const hz of [-2.3, 2.3]) {
    const h = new THREE.Mesh(headerGeo, headerMat);
    h.position.set(0.3, 4.8, hz);
    robot.add(h);
  }
  const ledGeo = track(new THREE.SphereGeometry(0.22, 12, 8));
  const pwrLedMat = stdMat(0x0d3317, { emissive: COLORS.ledGreen, emissiveIntensity: 0 });
  const pwrLed = new THREE.Mesh(ledGeo, pwrLedMat);
  pwrLed.position.set(3.4, 4.6, -1.6);
  robot.add(pwrLed);
  const autoLedMat = stdMat(0x24133a, { emissive: COLORS.ledAuto, emissiveIntensity: 0 });
  const autoLed = new THREE.Mesh(ledGeo, autoLedMat);
  autoLed.position.set(3.4, 4.6, -0.9);
  robot.add(autoLed);

  // 초음파 센서 (HC-SR04): 전방 보드 + 두 눈
  const usBoard = mesh(new THREE.BoxGeometry(0.25, 2.1, 4.6), stdMat(COLORS.usBoard));
  usBoard.position.set(5.0, 3.0, 0);
  robot.add(usBoard);
  const eyeGeo = track(new THREE.CylinderGeometry(0.8, 0.8, 1.3, 20));
  eyeGeo.rotateZ(Math.PI / 2);
  const eyeMat = stdMat(COLORS.usEye, { metalness: 0.7, roughness: 0.3, emissive: COLORS.usGlow, emissiveIntensity: 0 });
  const meshGeo = track(new THREE.CircleGeometry(0.62, 20));
  meshGeo.rotateY(Math.PI / 2);
  const meshMat = stdMat(0x333333, { emissive: COLORS.usGlow, emissiveIntensity: 0 });
  const eyeZ = [-1.3, 1.3];
  for (const ez of eyeZ) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(5.75, 3.0, ez);
    robot.add(e);
    const m = new THREE.Mesh(meshGeo, meshMat);
    m.position.set(6.41, 3.0, ez);
    robot.add(m);
  }
  const SENSOR_ORIGIN = new THREE.Vector3(6.45, 3.0, 0);

  // 감지 콘: 꼭짓점이 원점, +X 방향으로 길이 1
  const coneGeo = track(new THREE.ConeGeometry(Math.tan(CONE_HALF_ANGLE), 1, 32, 1, true));
  coneGeo.translate(0, -0.5, 0);
  coneGeo.rotateZ(Math.PI / 2);
  const coneMat = track(new THREE.MeshBasicMaterial({
    color: COLORS.coneIdle, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false,
  }));
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.copy(SENSOR_ORIGIN);
  cone.scale.setScalar(MAX_CONE_LEN);
  cone.visible = false;
  robot.add(cone);
  // 콘 중심선
  const beamGeo = track(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)]));
  const beamMat = track(new THREE.LineBasicMaterial({ color: COLORS.coneIdle, transparent: true, opacity: 0.6 }));
  const beam = new THREE.Line(beamGeo, beamMat);
  beam.position.copy(SENSOR_ORIGIN);
  beam.scale.set(MAX_CONE_LEN, 1, 1);
  beam.visible = false;
  robot.add(beam);

  // 거리 라벨 (로봇 로컬 좌표, 콘 끝 위)
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const labelCtx = labelCanvas.getContext('2d');
  const labelTex = track(new THREE.CanvasTexture(labelCanvas));
  labelTex.colorSpace = THREE.SRGBColorSpace;
  const labelMat = track(new THREE.SpriteMaterial({ map: labelTex, depthTest: false, transparent: true }));
  const label = new THREE.Sprite(labelMat);
  label.scale.set(20, 5, 1);
  label.renderOrder = 10;
  label.visible = false;
  robot.add(label);
  let labelText = '';
  function drawLabel(text) {
    if (text === labelText) return;
    labelText = text;
    const c = labelCtx;
    c.clearRect(0, 0, 512, 128);
    c.fillStyle = 'rgba(20,10,10,0.82)';
    const r = 28;
    c.beginPath();
    c.moveTo(r, 8); c.lineTo(512 - r, 8); c.quadraticCurveTo(504, 8, 504, 8 + r);
    c.lineTo(504, 120 - r); c.quadraticCurveTo(504, 120, 512 - r, 120);
    c.lineTo(r, 120); c.quadraticCurveTo(8, 120, 8, 120 - r);
    c.lineTo(8, 8 + r); c.quadraticCurveTo(8, 8, r, 8);
    c.fill();
    c.strokeStyle = '#ff5a5a';
    c.lineWidth = 4;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = '600 52px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 256, 66);
    labelTex.needsUpdate = true;
  }

  // 부저 + 소리 파동 링
  const buzzerMat = stdMat(COLORS.buzzer, { emissive: COLORS.buzzerGlow, emissiveIntensity: 0 });
  const buzzer = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.9, 20), buzzerMat);
  buzzer.position.set(-3.0, 5.0, 1.3);
  robot.add(buzzer);
  const buzzerHole = mesh(new THREE.CircleGeometry(0.15, 10), stdMat(0x444444));
  buzzerHole.rotation.x = -Math.PI / 2;
  buzzerHole.position.set(-3.0, 5.46, 1.3);
  robot.add(buzzerHole);
  const ringGeo = track(new THREE.RingGeometry(0.9, 1.05, 40));
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const rm = track(new THREE.MeshBasicMaterial({
      color: COLORS.buzzerGlow, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    }));
    const ring = new THREE.Mesh(ringGeo, rm);
    ring.position.set(-3.0, 5.5, 1.3);
    ring.visible = false;
    robot.add(ring);
    rings.push({ mesh: ring, mat: rm, phase: i / 3 });
  }

  // 블루투스 모듈 (HC-05) + LED
  const btBoard = mesh(new THREE.BoxGeometry(2.8, 0.15, 1.3), stdMat(COLORS.btBoard));
  btBoard.position.set(-2.4, 4.75, -1.4);
  robot.add(btBoard);
  const btChip = mesh(new THREE.BoxGeometry(1.4, 0.25, 0.9), stdMat(0x9aa3ad, { metalness: 0.7, roughness: 0.3 }));
  btChip.position.set(-2.0, 4.93, -1.4);
  robot.add(btChip);
  const btLedMat = stdMat(0x0b1a3a, { emissive: COLORS.btLed, emissiveIntensity: 0 });
  const btLed = new THREE.Mesh(ledGeo, btLedMat);
  btLed.scale.setScalar(0.8);
  btLed.position.set(-3.5, 4.95, -1.4);
  robot.add(btLed);

  // ---------- 적외선 라인 센서 (앞쪽 아래, A2 디지털) + 바닥 판정 원판 ----------
  const LINE_X = 8.4;                       // 로봇 로컬 cm (앞 범퍼 아래 팔 끝, 위에서도 보이게 궤도보다 앞)
  const lineBoard = mesh(new THREE.BoxGeometry(1.6, 0.15, 1.2), stdMat(COLORS.lineBoard));
  lineBoard.position.set(LINE_X, 1.1, 0);
  robot.add(lineBoard);
  const lineArm = mesh(new THREE.BoxGeometry(3.4, 0.25, 0.5), stdMat(0x3a3f46));
  lineArm.position.set(LINE_X - 2.2, 1.3, 0);
  robot.add(lineArm);
  const irGeo = track(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12));
  const irMats = [stdMat(0x1a1a1a), stdMat(0x2a5a9a, { emissive: 0x2244ff, emissiveIntensity: 0 })];
  [-0.3, 0.3].forEach((z, i) => {
    const e = new THREE.Mesh(irGeo, irMats[i]);
    e.position.set(LINE_X + 0.3, 0.8, z);
    robot.add(e);
  });
  const lineLedMat = stdMat(0x3a0b0b, { emissive: COLORS.lineLed, emissiveIntensity: 0 });
  const lineLed = new THREE.Mesh(ledGeo, lineLedMat);
  lineLed.scale.setScalar(0.6);
  lineLed.position.set(LINE_X - 0.5, 1.3, 0.4);
  robot.add(lineLed);
  // 바닥 원판 + 테두리 (센서 바로 아래)
  const lineDiscMat = track(new THREE.MeshStandardMaterial({ color: COLORS.lineWhite, roughness: 0.9, emissive: 0x000000 }));
  const lineDisc = new THREE.Mesh(track(new THREE.CircleGeometry(3.0, 40)), lineDiscMat);
  lineDisc.rotation.x = -Math.PI / 2;
  lineDisc.position.set(LINE_X + 0.3, 0.08, 0);
  lineDisc.visible = false;
  robot.add(lineDisc);
  const lineRingMat = track(new THREE.MeshBasicMaterial({ color: COLORS.lineRingWhite, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  const lineRing = new THREE.Mesh(track(new THREE.RingGeometry(3.0, 3.9, 48)), lineRingMat);
  lineRing.rotation.x = -Math.PI / 2;
  lineRing.position.set(LINE_X + 0.3, 0.1, 0);
  lineRing.visible = false;
  robot.add(lineRing);
  // 판정 라벨
  const lineLabelCanvas = document.createElement('canvas');
  lineLabelCanvas.width = 256; lineLabelCanvas.height = 64;
  const lineLabelTex = track(new THREE.CanvasTexture(lineLabelCanvas));
  lineLabelTex.colorSpace = THREE.SRGBColorSpace;
  const lineLabel = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: lineLabelTex, depthTest: false, transparent: true })));
  lineLabel.scale.set(8, 2, 1);
  lineLabel.renderOrder = 11;
  lineLabel.visible = false;
  lineLabel.position.set(LINE_X + 1.5, 8.0, 0);
  robot.add(lineLabel);
  let lineLabelText = '';
  function drawLineLabel(text, black) {
    const key = text + black;
    if (key === lineLabelText) return;
    lineLabelText = key;
    const c = lineLabelCanvas.getContext('2d');
    c.clearRect(0, 0, 256, 64);
    c.fillStyle = black ? 'rgba(10,10,10,0.9)' : 'rgba(245,247,250,0.92)';
    c.strokeStyle = black ? '#ff8a1f' : '#5fd8ff';
    c.lineWidth = 4;
    c.beginPath();
    if (c.roundRect) c.roundRect(4, 4, 248, 56, 16); else c.rect(4, 4, 248, 56);
    c.fill(); c.stroke();
    c.fillStyle = black ? '#ffffff' : '#111111';
    c.font = '700 30px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 128, 34);
    lineLabelTex.needsUpdate = true;
  }

  // ---------- 경로 (증분, 버퍼 2배씩 증가) ----------
  const pathMat = track(new THREE.LineBasicMaterial({ color: COLORS.path }));
  let pathCap = 1024;
  let pathCount = 0;
  let pathArr = new Float32Array(pathCap * 3);
  let pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute('position', new THREE.BufferAttribute(pathArr, 3).setUsage(THREE.DynamicDrawUsage));
  pathGeo.setDrawRange(0, 0);
  const pathLine = new THREE.Line(pathGeo, pathMat);
  pathLine.frustumCulled = false;
  pathLine.position.y = 0.05;
  scene.add(pathLine);
  const pathBox = new THREE.Box3(); // 월드 단위
  let lastPx = NaN;
  let lastPy = NaN;

  function setPathBuffer(arr, cap) {
    pathGeo.dispose();
    pathGeo = new THREE.BufferGeometry();
    pathArr = arr;
    pathCap = cap;
    pathGeo.setAttribute('position', new THREE.BufferAttribute(pathArr, 3).setUsage(THREE.DynamicDrawUsage));
    pathGeo.setDrawRange(0, pathCount);
    pathLine.geometry = pathGeo;
  }

  function addPathPoint(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (pathCount > 0 && Math.hypot(p.x - lastPx, p.y - lastPy) < PATH_MIN_STEP) return;
    if (pathCount >= PATH_MAX) {
      // 한도 초과: 점을 하나 걸러 솎아 절반으로 줄인다(전체 형태 유지)
      let w = 0;
      for (let r = 0; r < pathCount; r += 2, w++) {
        pathArr[w * 3] = pathArr[r * 3];
        pathArr[w * 3 + 1] = pathArr[r * 3 + 1];
        pathArr[w * 3 + 2] = pathArr[r * 3 + 2];
      }
      pathCount = w;
      pathGeo.attributes.position.needsUpdate = true;
    } else if (pathCount >= pathCap) {
      const cap = Math.min(pathCap * 2, PATH_MAX);
      const arr = new Float32Array(cap * 3);
      arr.set(pathArr.subarray(0, pathCount * 3));
      setPathBuffer(arr, cap);
    }
    const i = pathCount * 3;
    pathArr[i] = p.x * S;
    pathArr[i + 1] = 0;
    pathArr[i + 2] = -p.y * S;
    pathCount++;
    lastPx = p.x;
    lastPy = p.y;
    const attr = pathGeo.attributes.position;
    attr.needsUpdate = true;
    pathGeo.setDrawRange(0, pathCount);
    pathBox.expandByPoint(new THREE.Vector3(pathArr[i], 0, pathArr[i + 2]));
  }

  function clearPath() {
    pathCount = 0;
    lastPx = lastPy = NaN;
    pathBox.makeEmpty();
    if (pathCap > 1024) setPathBuffer(new Float32Array(1024 * 3), 1024);
    pathGeo.setDrawRange(0, 0);
  }

  // ---------- 벽 (5cm 셀 양자화, InstancedMesh 하나) ----------
  // 로컬: X = 두께(2cm, 로봇 진행 방향), Y = 높이(15cm), Z = 가로(5cm, 진행 방향에 수직)
  const wallGeo = track(new THREE.BoxGeometry(2 * S, 15 * S, 5 * S));
  wallGeo.translate(0, 7.5 * S, 0);
  const wallMat = track(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.8, transparent: true, opacity: 0.72,
  }));
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, WALL_MAX);
  walls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  walls.count = 0;
  walls.frustumCulled = false;
  const wallBaseColor = new THREE.Color(COLORS.wall);
  const wallNewColor = new THREE.Color(COLORS.wallNew);
  const tmpColor = new THREE.Color();
  walls.setColorAt(0, wallBaseColor); // instanceColor 버퍼 생성
  scene.add(walls);
  const wallCells = new Set();
  const wallBox = new THREE.Box3();
  let wallHighlights = []; // {index, t0}

  function addObstacle(o) {
    if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return false;
    if (walls.count >= WALL_MAX) return false;
    const cx = Math.round(o.x / WALL_CELL);
    const cy = Math.round(o.y / WALL_CELL);
    const key = cx + ',' + cy;
    if (wallCells.has(key)) return false;
    wallCells.add(key);
    const idx = walls.count;
    tmpObj.position.set(cx * WALL_CELL * S, 0, -cy * WALL_CELL * S);
    tmpObj.rotation.set(0, Number.isFinite(o.theta) ? o.theta : 0, 0);
    tmpObj.scale.set(1, 1, 1);
    tmpObj.updateMatrix();
    walls.setMatrixAt(idx, tmpObj.matrix);
    walls.setColorAt(idx, wallNewColor);
    walls.count = idx + 1;
    walls.instanceMatrix.needsUpdate = true;
    walls.instanceColor.needsUpdate = true;
    wallBox.expandByPoint(tmpObj.position);
    wallHighlights.push({ index: idx, t0: elapsed });
    return true;
  }

  function clearObstacles() {
    walls.count = 0;
    wallCells.clear();
    wallBox.makeEmpty();
    wallHighlights = [];
  }

  function updateWallHighlights() {
    if (!wallHighlights.length) return;
    const keep = [];
    for (const h of wallHighlights) {
      const t = (elapsed - h.t0) / HIGHLIGHT_SEC;
      if (t >= 1) {
        walls.setColorAt(h.index, wallBaseColor);
      } else {
        tmpColor.copy(wallNewColor).lerp(wallBaseColor, t);
        walls.setColorAt(h.index, tmpColor);
        keep.push(h);
      }
    }
    wallHighlights = keep;
    walls.instanceColor.needsUpdate = true;
  }

  // ---------- 카메라: 따라가기 / 전체 보기 / 초기화 ----------
  let follow = true;
  const robotTarget = new THREE.Vector3();
  const camDelta = new THREE.Vector3();

  function robotFocus(out) {
    return out.set(robot.position.x, 1, robot.position.z);
  }

  function setFollow(on) {
    follow = !!on;
  }

  function resetView() {
    follow = true;
    robotFocus(controls.target);
    camera.position.copy(controls.target).add(CAM_OFFSET);
    controls.update();
  }

  function fitAll() {
    const box = new THREE.Box3();
    box.expandByPoint(robot.position);
    if (!pathBox.isEmpty()) box.union(pathBox);
    if (!wallBox.isEmpty()) box.union(wallBox);
    box.expandByScalar(8);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.5 * Math.SQRT2;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = Math.min(controls.maxDistance, Math.max(20, radius / Math.sin(Math.min(vfov, hfov) / 2)));
    follow = false; // 전체 보기 후 카메라를 고정(따라가기는 setFollow(true)/resetView()로 복귀)
    controls.target.set(center.x, 0, center.z);
    const dir = new THREE.Vector3(-0.35, 1, 0.55).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
  }

  function toDataURL(type = 'image/png', quality) {
    renderer.render(scene, camera); // 같은 태스크에서 읽으므로 preserveDrawingBuffer 불필요
    return renderer.domElement.toDataURL(type, quality);
  }

  // ---------- 상태 반영 ----------
  const pose = { x: 0, y: 0, theta: 0 }; // cm, cm, rad (웹 odometryStep 이 유일한 출처)
  let safeFlashUntil = 0;
  let prevSafe = false;
  let elapsed = 0;

  function applyStatic() {
    const on = !!state.connected;
    overlay.style.display = on ? 'none' : 'block';
    edgeMat.color.setHex(on ? COLORS.edgeOn : COLORS.edgeOff);
    hemi.intensity = on ? 0.9 : 0.45;
    sun.intensity = on ? 1.4 : 0.7;

    const d = state.distance;
    const hasDist = typeof d === 'number' && Number.isFinite(d) && d >= 0;
    const usActive = on && (state.ultrasonicOn || hasDist);
    cone.visible = usActive;
    beam.visible = usActive;
    if (hasDist && on) {
      // 로봇 로컬은 1단위=1cm 이고 그룹이 S배 축소되므로 콘 길이(cm)가 월드 벽 위치와 일치한다.
      const len = Math.min(d, MAX_CONE_LEN);
      cone.scale.setScalar(Math.max(len, 0.01));
      beam.scale.set(Math.max(len, 0.01), 1, 1);
      coneMat.color.setHex(COLORS.coneHit);
      coneMat.opacity = 0.28;
      beamMat.color.setHex(COLORS.coneHit);
      label.visible = true;
      label.position.set(SENSOR_ORIGIN.x + len, 16, 0);
      drawLabel(`물체 감지 · ${d.toFixed(1)} cm`);
    } else {
      cone.scale.setScalar(MAX_CONE_LEN);
      beam.scale.set(MAX_CONE_LEN, 1, 1);
      coneMat.color.setHex(COLORS.coneIdle);
      coneMat.opacity = 0.14;
      beamMat.color.setHex(COLORS.coneIdle);
      label.visible = false;
    }

    // 라인 센서: 판정이 있으면 바닥 원판·테두리·라벨 표시
    const lineKnown = on && (state.line === 'black' || state.line === 'white');
    const isBlack = state.line === 'black';
    lineDisc.visible = lineKnown;
    lineRing.visible = lineKnown;
    lineLabel.visible = lineKnown;
    if (lineKnown) {
      lineDiscMat.color.setHex(isBlack ? COLORS.lineBlack : COLORS.lineWhite);
      lineDiscMat.emissive.setHex(isBlack ? 0x000000 : 0x555555);
      lineRingMat.color.setHex(isBlack ? COLORS.lineRingBlack : COLORS.lineRingWhite);
      drawLineLabel(isBlack ? '라인: 검정' : '라인: 흰색', isBlack);
    }

    if (state.safeStop && !prevSafe) safeFlashUntil = elapsed + 0.5;
    prevSafe = !!state.safeStop;
  }

  function applyPose() {
    robot.position.set(pose.x * S, 0, -pose.y * S);
    robot.rotation.y = pose.theta;
  }

  function setState(partial) {
    if (!partial || typeof partial !== 'object') return;
    if (partial.pose && typeof partial.pose === 'object') {
      const p = partial.pose;
      if (Number.isFinite(p.x)) pose.x = p.x;
      if (Number.isFinite(p.y)) pose.y = p.y;
      if (Number.isFinite(p.theta)) pose.theta = p.theta;
      applyPose();
    }
    for (const k of Object.keys(DEFAULT_STATE)) {
      if (!(k in partial)) continue;
      const v = partial[k];
      switch (k) {
        case 'left':
        case 'right':
          state[k] = clampNum(v, -100, 100, 0); break;
        case 'distance':
          state.distance = (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? v : null; break;
        case 'line':
          state.line = (v === 'black' || v === 'white') ? v : null; break;
        case 'linkType':
          state.linkType = ['serial', 'bluetooth', 'sim'].includes(v) ? v : null; break;
        default:
          state[k] = !!v;
      }
    }
    applyStatic();
  }

  // ---------- 애니메이션 ----------
  const clock = new THREE.Clock();
  let rafId = 0;

  function frame() {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;
    const on = !!state.connected;

    // 모터 출력(부드럽게 따라감)
    const k = 1 - Math.exp(-dt * 10);
    for (const side of ['left', 'right']) {
      const sd = sides[side];
      const target = on ? (state[side] / 100) * MAX_TRACK_SPEED : 0;
      sd.speed += (target - sd.speed) * k;
      if (Math.abs(sd.speed) < 1e-3) sd.speed = 0;
      sd.offset += sd.speed * dt;
      for (const w of sd.wheels) w.group.rotation.z -= (sd.speed / w.r) * dt;
      updateLinks(side);
      const running = on && state[side] !== 0;
      sd.motorMat.emissive.setHex(COLORS.motorGlow);
      sd.motorMat.emissiveIntensity = running ? 0.5 + 0.6 * Math.min(1, Math.abs(state[side]) / 100) : 0;
      // 구동 중 약간 진동
      sd.motor.position.y = WHEEL_R + (running ? Math.sin(elapsed * 90) * 0.03 : 0);
    }

    // 차체 위치/방향은 setState({pose})로만 바뀐다. 격자는 월드 고정이고 칸 단위로만 스냅.
    const step = GRID_CELL * 2;
    grid.position.x = Math.round(controls.target.x / step) * step;
    grid.position.z = Math.round(controls.target.z / step) * step;
    ground.position.x = grid.position.x;
    ground.position.z = grid.position.z;

    // 카메라 따라가기: 타깃을 부드럽게 옮기고 카메라도 같은 만큼 이동(사용자가 정한 각도 유지)
    if (follow) {
      robotFocus(robotTarget);
      const kf = 1 - Math.exp(-dt * 4);
      camDelta.subVectors(robotTarget, controls.target).multiplyScalar(kf);
      controls.target.add(camDelta);
      camera.position.add(camDelta);
    }
    const camDist = camera.position.distanceTo(controls.target);
    scene.fog.near = camDist * 1.5;
    scene.fog.far = camDist * 4 + 60;

    updateWallHighlights();

    // 쉴드 LED
    pwrLedMat.emissiveIntensity = on ? 1.6 : 0;
    autoLedMat.emissiveIntensity = on && state.auto ? 1.2 + 0.6 * Math.sin(elapsed * 4) : 0;

    // 초음파
    const usActive = on && (state.ultrasonicOn || state.distance !== null);
    const pulse = usActive ? 0.8 + 0.5 * (0.5 + 0.5 * Math.sin(elapsed * 12)) : 0;
    eyeMat.emissiveIntensity = usActive ? 0.35 : 0;
    meshMat.emissiveIntensity = pulse;
    if (cone.visible) {
      const base = state.distance !== null ? 0.24 : 0.12;
      coneMat.opacity = base + 0.06 * Math.sin(elapsed * 6);
    }

    // 부저
    const buzzing = on && state.buzzer;
    buzzerMat.emissiveIntensity = buzzing ? 1.0 + 0.5 * Math.sin(elapsed * 30) : 0;
    for (const r of rings) {
      r.mesh.visible = buzzing;
      if (!buzzing) continue;
      const t = (elapsed * 1.2 + r.phase) % 1;
      const s = 1 + t * 4;
      r.mesh.scale.set(s, 1, s);
      r.mesh.position.y = 5.5 + t * 0.6;
      r.mat.opacity = 0.75 * (1 - t);
    }

    // 라인 센서: 읽는 중이면 IR LED 은은하게, 검정 인식 시 상태 LED·테두리 펄스
    const lineActive = on && (state.lineOn || state.line !== null);
    irMats[1].emissiveIntensity = lineActive ? 0.6 + 0.3 * Math.sin(elapsed * 10) : 0;
    const lineBlackNow = on && state.line === 'black';
    lineLedMat.emissiveIntensity = lineBlackNow ? 2.0 : 0;
    if (lineRing.visible) {
      const t = 0.5 + 0.5 * Math.sin(elapsed * (lineBlackNow ? 8 : 3));
      lineRingMat.opacity = lineBlackNow ? 0.55 + 0.45 * t : 0.5 + 0.2 * t;
      const sc = lineBlackNow ? 1 + 0.12 * t : 1;
      lineRing.scale.set(sc, sc, 1);
    }

    // 블루투스
    const bt = on && state.linkType === 'bluetooth';
    btLedMat.emissiveIntensity = bt ? ((elapsed % 1) < 0.5 ? 2.0 : 0.1) : 0;

    // SAFE 정지 깜빡임 / 연결 하이라이트
    if (elapsed < safeFlashUntil) {
      const blink = (elapsed * 12) % 1 < 0.5;
      chassisMat.emissive.setHex(COLORS.safe);
      chassisMat.emissiveIntensity = blink ? 0.9 : 0.2;
      edgeMat.color.setHex(blink ? COLORS.safe : (on ? COLORS.edgeOn : COLORS.edgeOff));
    } else {
      chassisMat.emissiveIntensity = 0;
      edgeMat.color.setHex(on ? COLORS.edgeOn : COLORS.edgeOff);
    }

    controls.update();
    renderer.render(scene, camera);
  }

  // ---------- 크기 ----------
  function resize() {
    const w = containerEl.clientWidth || 1;
    const h = containerEl.clientHeight || 340;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(containerEl);

  resize();
  applyStatic();
  frame();

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(rafId);
    if (ro) ro.disconnect();
    controls.dispose();
    for (const d of disposables) {
      try { d.dispose(); } catch (_) { /* ignore */ }
    }
    for (const sd of Object.values(sides)) sd.links.dispose();
    walls.dispose();
    pathGeo.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    overlay.remove();
  }

  return {
    setState, resize, dispose,
    addPathPoint, clearPath, addObstacle, clearObstacles,
    fitAll, setFollow, resetView, toDataURL,
  };
}

return { createTwin, default: createTwin };
})());
})();
