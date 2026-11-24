#!/usr/bin/env node
// 볼앤빔 교재 a1장 "아두이노 기초와 사용법" = SMARS 수업 교재 M1~M6 부분만 두 저장소 사이에서 양방향 동기화한다.
//
//   SMARS 저장소 (kgh-DaC/lecture-SMARS)      볼앤빔 저장소 (kgh-DaC/ball-and-beam)
//   a1/a1.js, a1/a1.css                  ↔    app/smars-lesson/a1/a1.js, a1.css      (M1~M6 목차·인터랙티브·카드 내용·스타일)
//   examples/m1_* … m6_*                 ↔    app/smars-lesson/examples/m1_* … m6_*  (예제 스케치 원본)
//   tools/sync_lesson.mjs (이 파일)       ↔    tools/sync_lesson.mjs
//
// 동기화하지 않는 것: 각 저장소의 페이지 틀(SMARS lesson.html = 틀 + M0·M7·정리, 볼앤빔 app/smars-lesson/lesson.html = 틀만).
// 두 틀은 a1/a1.css·a1/a1.js 를 읽어 M1~M6 카드를 그린다. 볼앤빔 a1장은 위젯 smars-lesson 이 그 틀 페이지를 iframe 으로 연다.
//
// 예제: examples/mN_*/*.ino 가 원본이다. a1.js 의 A1_EXAMPLES 블록(@examples:begin~end)은 이 스크립트가 .ino 로 다시 만든다.
//
// 방향 판단: 마지막 동기화 때의 파일 해시(tools/sync_lesson.state.json, 두 저장소에 같은 내용)를 기준으로
//   - 한쪽만 바뀌었으면 → 바뀐 쪽을 다른 쪽으로 복사(삭제도 반영)
//   - 양쪽이 다르게 바뀌었으면 → 충돌. 아무것도 쓰지 않고 멈춘다(--prefer smars|bb 로 한쪽을 골라 해결).
// 해시는 줄바꿈(CRLF/LF)을 무시하고 계산한다(Windows autocrlf 대비).
//
// 사용법 (어느 저장소에서 실행해도 된다. 다른 저장소 위치는 옆 폴더 smars_web / ball_and_beam 으로 추정):
//   node tools/sync_lesson.mjs                 # 동기화 실행
//   node tools/sync_lesson.mjs --check         # 확인만(바꿀 것이 있거나 충돌이면 종료 코드 1)
//   node tools/sync_lesson.mjs --other <경로>   # 다른 저장소 위치 지정
//   node tools/sync_lesson.mjs --prefer smars  # 충돌 시 SMARS 쪽을 기준으로(bb = 볼앤빔)
// 환경 변수 SMARS_DIR / BALLBEAM_DIR 로도 위치를 줄 수 있다. Node 18 이상, 외부 패키지 없음.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const CHECK = args.includes('--check');
const PREFER = opt('--prefer');
if (PREFER && !['smars', 'bb'].includes(PREFER)) { console.error('--prefer 는 smars 또는 bb'); process.exit(2); }

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isBB = (d) => existsSync(join(d, 'curriculum', 'toc.json'));
const isSmars = (d) => existsSync(join(d, 'lesson.html')) && !isBB(d);
let smarsRoot, bbRoot;
if (isBB(here)) {
  bbRoot = here;
  smarsRoot = resolve(opt('--other') || process.env.SMARS_DIR || join(here, '..', 'smars_web'));
} else if (isSmars(here)) {
  smarsRoot = here;
  bbRoot = resolve(opt('--other') || process.env.BALLBEAM_DIR || join(here, '..', 'ball_and_beam'));
} else { console.error('이 스크립트가 있는 저장소를 알아볼 수 없습니다:', here); process.exit(2); }
if (!isSmars(smarsRoot)) { console.error('SMARS 저장소(lesson.html)를 찾지 못했습니다:', smarsRoot, '\n  --other 또는 SMARS_DIR 로 위치를 주세요.'); process.exit(2); }
if (!isBB(bbRoot)) { console.error('볼앤빔 저장소(curriculum/toc.json)를 찾지 못했습니다:', bbRoot, '\n  --other 또는 BALLBEAM_DIR 로 위치를 주세요.'); process.exit(2); }

// 동기화 범위: a1/ 전체, examples/m1_~m6_ 폴더, 이 스크립트
const SELF = '@tools/sync_lesson.mjs';
const inScope = (k) => k === SELF || k.startsWith('a1/') || /^examples\/m[1-6]_[^/]+\//.test(k);
const base = (side) => (side === 'smars' ? smarsRoot : join(bbRoot, 'app', 'smars-lesson'));
const pathOf = (side, key) => key === SELF
  ? join(side === 'smars' ? smarsRoot : bbRoot, 'tools', 'sync_lesson.mjs')
  : join(base(side), key);
const STATE = (side) => join(side === 'smars' ? smarsRoot : bbRoot, 'tools', 'sync_lesson.state.json');

function walk(root, rel, out) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  if (statSync(abs).isFile()) { out.add(rel.split(sep).join('/')); return; }
  for (const e of readdirSync(abs)) walk(root, join(rel, e), out);
}
const keys = new Set([SELF]);
for (const side of ['smars', 'bb']) { walk(base(side), 'a1', keys); walk(base(side), 'examples', keys); }
for (const k of [...keys]) if (!inScope(k)) keys.delete(k);

// a1.js 의 예제 블록을 그 저장소의 examples/*.ino 로 다시 만든 내용(바뀔 것이 없으면 원문 그대로)
const BEGIN = '/* @examples:begin */', END = '/* @examples:end */';
function regenA1(side) {
  const p = pathOf(side, 'a1/a1.js');
  if (!existsSync(p)) return null;
  const src = readFileSync(p, 'utf8');
  const i = src.indexOf(BEGIN), j = src.indexOf(END);
  if (i < 0 || j < i) return src;
  const ex = [];
  const dir = join(base(side), 'examples');
  if (existsSync(dir)) for (const d of readdirSync(dir).sort()) {
    const m = /^(m[1-6])_/.exec(d); if (!m) continue;
    for (const f of readdirSync(join(dir, d)).sort()) if (f.endsWith('.ino')) {
      const code = readFileSync(join(dir, d, f), 'utf8').replace(/\r\n/g, '\n');
      ex.push(`  { mod: ${JSON.stringify(m[1])}, file: ${JSON.stringify(`examples/${d}/${f}`)},\n    code: ${JSON.stringify(code)} },`);
    }
  }
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const block = [BEGIN, '/* 아래는 examples 폴더의 .ino 파일에서 자동 생성 — 예제는 .ino 를 고친다 */', 'const A1_EXAMPLES = [', ...ex, '];', ''].join('\n').replace(/\n/g, eol);
  return src.slice(0, i) + block + src.slice(j);
}
const content = { smars: {}, bb: {} };
for (const side of ['smars', 'bb']) { const c = regenA1(side); if (c !== null) content[side]['a1/a1.js'] = c; }
const TEXT = /\.(html?|ino|mjs|js|css|md|json|txt|svg|h|cpp)$/i;
function bytesOf(side, k) {
  if (k in content[side]) return Buffer.from(content[side][k], 'utf8');
  const p = pathOf(side, k);
  return existsSync(p) ? readFileSync(p) : null;
}
function hashOf(side, k) {
  let buf = bytesOf(side, k);
  if (!buf) return null;
  if (TEXT.test(k)) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

const readState = (side) => { try { return JSON.parse(readFileSync(STATE(side), 'utf8')).files || {}; } catch { return null; } };
const sS = readState('smars'), sB = readState('bb');
const baseHash = {};
for (const k of new Set([...Object.keys(sS || {}), ...Object.keys(sB || {})])) {
  if (!inScope(k)) continue;                       // 예전 범위(lesson.html 전체 등)의 기록은 버린다
  const a = sS && sS[k], b = sB && sB[k];
  if (sS && sB) { if (a === b) baseHash[k] = a; } else baseHash[k] = a ?? b;
}
for (const k of Object.keys(baseHash)) keys.add(k);

const actions = [], conflicts = [], next = {};
for (const k of [...keys].sort()) {
  const a = hashOf('smars', k), b = hashOf('bb', k), o = k in baseHash ? baseHash[k] : undefined;
  if (a === b) { if (a) next[k] = a; continue; }
  let dir = null;
  if (o !== undefined && b === o) dir = 'smars→bb';
  else if (o !== undefined && a === o) dir = 'bb→smars';
  else if (o === undefined && a && !b) dir = 'smars→bb';        // 새 파일(한쪽에만)
  else if (o === undefined && b && !a) dir = 'bb→smars';
  else if (PREFER) dir = PREFER === 'smars' ? 'smars→bb' : 'bb→smars';
  if (!dir) { conflicts.push(k); if (o) next[k] = o; continue; }
  const h = dir === 'smars→bb' ? a : b;
  actions.push({ k, dir, del: h === null });
  if (h) next[k] = h;
}

const show = (x) => `  ${x.dir}  ${x.del ? '(삭제) ' : ''}${x.k}`;
console.log(`SMARS: ${smarsRoot}\n볼앤빔: ${bbRoot}`);
if (!actions.length && !conflicts.length) console.log('두 저장소의 a1(M1~M6) 파일이 같습니다.');
if (actions.length) console.log(`${CHECK ? '바꿀 것' : '반영'} ${actions.length}개:\n` + actions.map(show).join('\n'));
if (conflicts.length) {
  console.error(`충돌 ${conflicts.length}개 — 양쪽이 마지막 동기화 뒤 서로 다르게 바뀌었습니다:\n` + conflicts.map((k) => '  ' + k).join('\n') +
    '\n  한쪽 내용으로 합친 뒤 다시 실행하거나, --prefer smars | --prefer bb 로 기준을 고르세요. (아무 파일도 쓰지 않았습니다)');
  process.exit(1);
}
const regenDirty = ['smars', 'bb'].filter((s) => 'a1/a1.js' in content[s] && content[s]['a1/a1.js'] !== readFileSync(pathOf(s, 'a1/a1.js'), 'utf8'));
if (CHECK) {
  if (regenDirty.length) console.log('a1.js 예제 블록 갱신 필요: ' + regenDirty.join(', '));
  process.exit(actions.length || regenDirty.length ? 1 : 0);
}

for (const s of regenDirty) writeFileSync(pathOf(s, 'a1/a1.js'), content[s]['a1/a1.js']);
for (const x of actions) {
  const [from, to] = x.dir === 'smars→bb' ? ['smars', 'bb'] : ['bb', 'smars'];
  const dst = pathOf(to, x.k);
  if (x.del) { rmSync(dst, { force: true }); continue; }
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, bytesOf(from, x.k));
}
const state = JSON.stringify({
  note: 'tools/sync_lesson.mjs 가 쓰는 마지막 동기화 기록(a1 = M1~M6 범위). 두 저장소에 같은 내용으로 둔다. 손으로 고치지 않는다.',
  files: Object.fromEntries(Object.entries(next).sort()),
}, null, 2) + '\n';
for (const side of ['smars', 'bb']) {
  const p = STATE(side);
  if (!existsSync(p) || readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== state) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, state); }
}
console.log('동기화 완료.' + (actions.length || regenDirty.length ? ' 두 저장소에서 각각 커밋하세요.' : ''));
