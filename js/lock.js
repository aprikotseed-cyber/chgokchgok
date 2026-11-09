// Face ID(생체 인증) 화면 잠금: 이 기기에서 앱 화면을 가리는 용도예요. 데이터 보안은 Firebase 로그인이 맡아요.
// 웹 표준 생체 인증(WebAuthn, 패스키와 같은 기술)으로 아이폰 Face ID·Touch ID, PC 지문·Windows Hello를 불러요.
// 얼굴·지문 정보는 기기 밖으로 나가지 않고, 앱은 '본인 확인됨'이라는 결과만 받아요.

const KEY = 'chgok-lock'; // 이 기기에만: {id: 등록한 인증 키 id, after: 다시 잠그기까지 분}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export function lockConfig() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export async function lockSupported() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}

/** 이 기기 등록 (Face ID 창이 떠요) */
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
  localStorage.setItem(KEY, JSON.stringify({ id: b64(cred.rawId), after: lockConfig()?.after ?? 1 }));
}

export function disableLock() { localStorage.removeItem(KEY); }
export function setLockAfter(min) { const c = lockConfig(); if (c) localStorage.setItem(KEY, JSON.stringify({ ...c, after: min })); }

async function verify() {
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
let must = false;   // Face ID를 통과해야 열리는지 (잠깐 다른 앱에 다녀온 거면 false)
let busy = false;
let hiddenAt = 0;
let isActive = () => false;

function show() {
  locked = true;
  dlg.querySelector('.lock-actions').hidden = true;
  if (!dlg.open) dlg.showModal();
}
function close() {
  locked = false;
  must = false;
  if (dlg.open) dlg.close();
}

async function unlock() {
  if (busy || !locked) return;
  busy = true;
  dlg.querySelector('.lock-actions').hidden = true; // Face ID 중에는 로고만
  try {
    await verify();
    close();
  } catch {
    dlg.querySelector('.lock-actions').hidden = false; // 취소·실패: 다시 시도 버튼
  } finally {
    busy = false;
  }
}

/** 앱을 열 때·로그인했을 때: 잠금이 켜져 있으면 바로 가리고 Face ID */
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
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc로 닫히지 않게
  document.getElementById('lock-retry').addEventListener('click', unlock);
  document.getElementById('lock-forgot').addEventListener('click', () => { disableLock(); close(); onForgot(); });
  document.addEventListener('visibilitychange', () => {
    const c = lockConfig();
    if (!c || !isActive()) return;
    if (document.visibilityState === 'hidden') {
      // 다른 앱으로 가면 바로 가려요 (앱 전환 화면에도 내용이 안 보이게)
      if (!locked) { hiddenAt = Date.now(); show(); }
    } else if (locked && !busy) {
      if (must || Date.now() - hiddenAt >= (Number(c.after) || 0) * 60_000) { must = true; unlock(); }
      else close();
    }
  });
}
