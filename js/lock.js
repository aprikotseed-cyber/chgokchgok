// 화면 잠금: 이 기기에서 앱 화면을 가리는 용도예요. 데이터 보안은 Firebase 로그인이 맡아요.
// 기기마다 하나를 골라요.
//  · Face ID (생체 인증): 웹 표준 생체 인증(WebAuthn)으로 Face ID·Touch ID·지문·Windows Hello. 얼굴·지문 정보는 기기 밖으로 나가지 않아요.
//  · PIN 4자리: PC처럼 생체 인증이 없는 기기용. 키보드 숫자·숫자패드로도 눌러요. PIN은 그대로 저장하지 않고 해시만 남겨요.

const KEY = 'chgok-lock'; // 이 기기에만: {method: 'webauthn'|'pin', id?, pin?: {salt, hash}, after}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion() ? 0 : ms));

export function lockConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c ? { method: c.pin ? 'pin' : 'webauthn', ...c } : null;
  } catch { return null; }
}
const saveConfig = (c) => localStorage.setItem(KEY, JSON.stringify(c));

export async function lockSupported() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}

/** Face ID로 이 기기 등록 (Face ID 창이 떠요) */
export async function enableLock(email = '') {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: '차곡차곡', id: location.hostname },
      user: { id: rand(16), name: email || '차곡차곡', displayName: '차곡차곡 화면 잠금' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 60_000,
    },
  });
  saveConfig({ method: 'webauthn', id: b64(cred.rawId), after: lockConfig()?.after ?? 1 });
}

async function pinHash(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return b64(buf);
}

/** PIN 4자리로 이 기기 잠그기 (두 번 입력받아 맞으면 저장). 취소하면 false */
export async function enablePin() {
  const pin = await askNewPin();
  if (!pin) return false;
  const salt = b64(rand(16));
  saveConfig({ method: 'pin', pin: { salt, hash: await pinHash(pin, salt) }, after: lockConfig()?.after ?? 1 });
  return true;
}

export function disableLock() { localStorage.removeItem(KEY); }
export function setLockAfter(min) { const c = lockConfig(); if (c) saveConfig({ ...c, after: min }); }

async function verifyWebAuthn() {
  const c = lockConfig();
  await navigator.credentials.get({
    publicKey: {
      challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 60_000,
      allowCredentials: [{ type: 'public-key', id: unb64(c.id), transports: ['internal', 'hybrid'] }],
    },
  });
}

// ───── 잠금 화면 ─────
let dlg;
let locked = false;
let must = false;   // 확인을 통과해야 열리는지 (잠깐 다른 앱에 다녀온 거면 false)
let busy = false;
let hiddenAt = 0;
let isActive = () => false;
const $ = (s) => dlg.querySelector(s);

function show() {
  locked = true;
  $('.lock-actions').hidden = true;
  if (!dlg.open) {
    dlg.classList.remove('leaving');
    dlg.showModal();
  }
}

/** 부드럽게 사라지기 (흐려지며 살짝 커지면서) */
async function close() {
  locked = false;
  must = false;
  pinMode = null;
  if (!dlg.open) return;
  dlg.classList.add('leaving');
  await wait(320);
  if (!locked) { dlg.close(); dlg.classList.remove('leaving'); setPinVisible(false); }
}

async function unlock() {
  if (busy || !locked) return;
  if (lockConfig()?.method === 'pin') return startPin('unlock');
  busy = true;
  setPinVisible(false);
  $('.lock-actions').hidden = true; // Face ID 중에는 로고만
  try {
    await verifyWebAuthn();
    close();
  } catch {
    $('.lock-actions').hidden = false; // 취소·실패: 다시 시도 버튼
  } finally {
    busy = false;
  }
}

// ───── PIN 입력 ─────
let pinMode = null;   // 'unlock' | 'set' | 'confirm' | null
let pinBuf = '';
let firstPin = '';
let tries = 0;
let coolUntil = 0;
let setupDone = null;  // 새 PIN 정하기가 끝나면 부를 함수

const TITLES = { unlock: 'PIN을 입력하세요', set: '새 PIN 4자리를 정하세요', confirm: '한 번 더 입력하세요' };

function setPinVisible(on) {
  $('.pin').hidden = !on;
  dlg.classList.toggle('pin-mode', on);
}

function startPin(mode, title) {
  pinMode = mode;
  pinBuf = '';
  setPinVisible(true);
  $('.pin-title').textContent = title || TITLES[mode];
  $('.pin-cancel').hidden = mode === 'unlock';
  $('.pin-forgot').hidden = mode !== 'unlock';
  drawDots();
  cooldownTick();
}

function drawDots(state = '') {
  const dots = dlg.querySelectorAll('.pin-dots i');
  dots.forEach((d, i) => d.classList.toggle('on', i < pinBuf.length));
  const box = $('.pin-dots');
  box.classList.remove('ok', 'bad');
  if (state) { void box.offsetWidth; box.classList.add(state); } // 애니메이션 다시 시작
}

function cooldownTick() {
  const left = Math.ceil((coolUntil - Date.now()) / 1000);
  if (pinMode !== 'unlock') return;
  if (left > 0) {
    $('.pin-title').textContent = `잠시 뒤에 다시 해 주세요 (${left}초)`;
    setTimeout(cooldownTick, 1000);
  } else if (coolUntil) { coolUntil = 0; $('.pin-title').textContent = TITLES.unlock; }
}

function press(d) {
  if (!pinMode || busy || pinBuf.length >= 4) return;
  if (pinMode === 'unlock' && coolUntil > Date.now()) return;
  pinBuf += d;
  drawDots();
  const key = dlg.querySelector(`.pin-pad [data-d="${d}"]`);
  if (key) { key.classList.remove('hit'); void key.offsetWidth; key.classList.add('hit'); }
  if (pinBuf.length === 4) setTimeout(submit, 140);
}

function back() {
  if (!pinMode || busy || !pinBuf) return;
  pinBuf = pinBuf.slice(0, -1);
  drawDots();
}

async function wrong(title) {
  busy = true;
  drawDots('bad');
  if (navigator.vibrate) navigator.vibrate(60);
  await wait(420);
  pinBuf = '';
  drawDots();
  if (title) $('.pin-title').textContent = title;
  busy = false;
}

async function submit() {
  const pin = pinBuf;
  if (pinMode === 'unlock') {
    const c = lockConfig();
    if (await pinHash(pin, c.pin.salt) === c.pin.hash) {
      tries = 0;
      drawDots('ok');
      await wait(220);
      close();
      return;
    }
    tries++;
    if (tries >= 5) { tries = 0; coolUntil = Date.now() + 30_000; await wrong(); cooldownTick(); return; }
    await wrong(`PIN이 맞지 않아요 (${tries}/5)`);
    return;
  }
  if (pinMode === 'set') {
    if (/^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return wrong('너무 쉬운 PIN이에요. 다른 숫자로 정해 주세요');
    firstPin = pin;
    drawDots('ok');
    await wait(200);
    startPin('confirm');
    return;
  }
  if (pinMode === 'confirm') {
    if (pin !== firstPin) { await wrong(); startPin('set', 'PIN이 달라요. 처음부터 다시 정해 주세요'); return; }
    drawDots('ok');
    await wait(220);
    const done = setupDone;
    setupDone = null;
    await close();
    done?.(pin);
  }
}

/** 새 PIN 정하기 화면 → PIN 또는 null(취소) */
function askNewPin() {
  return new Promise((resolve) => {
    setupDone = resolve;
    locked = true;
    if (!dlg.open) { dlg.classList.remove('leaving'); dlg.showModal(); }
    $('.lock-actions').hidden = true;
    startPin('set');
  });
}

function cancelSetup() {
  const done = setupDone;
  setupDone = null;
  close();
  done?.(null);
}

/** 앱을 열 때·로그인했을 때: 잠금이 켜져 있으면 바로 가리고 확인 */
export function lockNow() {
  if (!lockConfig() || !isActive() || (locked && must)) return;
  show();
  must = true;
  unlock();
}

/** active(): 로그인해서 내용이 보이는 상태인지. onForgot: 잠금을 풀 수 없을 때(다시 로그인) */
export function initLock({ active, onForgot }) {
  isActive = active;
  dlg = document.getElementById('lock');
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (pinMode === 'set' || pinMode === 'confirm') cancelSetup(); }); // Esc: 잠금은 그대로, PIN 정하기만 취소
  document.getElementById('lock-retry').addEventListener('click', unlock);
  const forgot = () => { disableLock(); close(); onForgot(); };
  document.getElementById('lock-forgot').addEventListener('click', forgot);
  $('.pin-forgot').addEventListener('click', forgot);
  $('.pin-cancel').addEventListener('click', cancelSetup);
  $('.pin-pad').addEventListener('click', (e) => {
    const k = e.target.closest('button');
    if (!k) return;
    if (k.dataset.d) press(k.dataset.d);
    if (k.dataset.back != null) back();
  });
  // 키보드 숫자·숫자패드 (NumLock이 꺼져 있어도 숫자패드 위치로 알아들어요)
  document.addEventListener('keydown', (e) => {
    if (!dlg.open || !pinMode) return;
    const d = /^\d$/.test(e.key) ? e.key : (e.code.match(/^Numpad(\d)$/) || [])[1];
    if (d) { e.preventDefault(); press(d); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); back(); }
  }, true);
  document.addEventListener('visibilitychange', () => {
    const c = lockConfig();
    if (!c || !isActive() || setupDone) return;
    if (document.visibilityState === 'hidden') {
      // 다른 앱으로 가면 바로 가려요 (앱 전환 화면에도 내용이 안 보이게)
      if (!locked) { hiddenAt = Date.now(); show(); }
    } else if (locked && !busy) {
      if (must || Date.now() - hiddenAt >= (Number(c.after) || 0) * 60_000) { must = true; unlock(); }
      else close();
    }
  });
}
