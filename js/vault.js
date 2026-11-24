// 고민거리 금고: 브라우저 안에서 암호화해서, 서버(Firestore)에는 알아볼 수 없는 글자만 남겨요.
//
//  - 열쇠 두 개(RSA-OAEP 2048): '잠그는 열쇠(공개키)'는 그대로 저장 → 비밀번호 없이도 새 고민거리를 잠글 수 있어요.
//    '여는 열쇠(개인키)'는 비밀번호로 만든 열쇠(PBKDF2-SHA256 → AES-GCM 256)로 한 번 더 잠가서 저장해요.
//  - 고민거리 한 편: 그때마다 새 AES-GCM 열쇠로 글을 잠그고, 그 열쇠를 공개키로 잠가요.
//  - 비밀번호도, 푼 글도 서버·기기 어디에도 저장하지 않아요 (화면을 보는 동안 메모리에만).
//  - 비밀번호를 잊으면 아무도 열 수 없어요 (복구 수단 없음).
// 브라우저와 Node 20(테스트) 모두 Web Crypto(globalThis.crypto.subtle)를 써요.

const subtle = () => globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();
export const ITERATIONS = 600_000; // OWASP 2023 권장 (PBKDF2-SHA256)
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** 비밀번호가 틀렸을 때 */
export class WrongPassword extends Error {
  constructor() { super('비밀번호가 맞지 않아요'); this.name = 'WrongPassword'; }
}

async function passwordKey(password, salt, iterations) {
  const base = await subtle().importKey('raw', te.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrapPrivate(pkcs8, password, iterations) {
  const salt = random(16);
  const iv = random(12);
  const sealed = await subtle().encrypt({ name: 'AES-GCM', iv }, await passwordKey(password, salt, iterations), pkcs8);
  return { salt: toB64(salt), iv: toB64(iv), priv: toB64(sealed), iter: iterations };
}

async function unwrapPrivate(vault, password) {
  try {
    const key = await passwordKey(password, fromB64(vault.salt), vault.iter || ITERATIONS);
    return await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) }, key, fromB64(vault.priv));
  } catch {
    throw new WrongPassword(); // AES-GCM은 열쇠가 틀리면 풀리지 않아요 (= 비밀번호 확인)
  }
}

/** 새 금고 만들기 → 저장할 문서 { v, pub, salt, iv, priv, iter, createdAt } */
export async function createVault(password, iterations = ITERATIONS) {
  const kp = await subtle().generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
  const pub = await subtle().exportKey('spki', kp.publicKey);
  const pkcs8 = await subtle().exportKey('pkcs8', kp.privateKey);
  return { v: 1, pub: toB64(pub), ...(await wrapPrivate(pkcs8, password, iterations)), createdAt: Date.now() };
}

/** 비밀번호로 금고 열기 → 여는 열쇠(밖으로 꺼낼 수 없는 CryptoKey). 틀리면 WrongPassword */
export async function openVault(vault, password) {
  const pkcs8 = await unwrapPrivate(vault, password);
  return subtle().importKey('pkcs8', pkcs8, RSA, false, ['decrypt']);
}

/** 비밀번호가 바뀌었을 때: 예전 비밀번호로 열어서 새 비밀번호로 다시 잠근 금고 (공개키·고민거리는 그대로) */
export async function rewrapVault(vault, oldPassword, newPassword, iterations = vault.iter || ITERATIONS) {
  const pkcs8 = await unwrapPrivate(vault, oldPassword);
  return { ...vault, ...(await wrapPrivate(pkcs8, newPassword, iterations)), rewrappedAt: Date.now() };
}

const pubCache = new Map();
async function publicKey(vault) {
  if (!pubCache.has(vault.pub)) pubCache.set(vault.pub, subtle().importKey('spki', fromB64(vault.pub), RSA, false, ['encrypt']));
  return pubCache.get(vault.pub);
}

/** 글 잠그기 (비밀번호 없이, 공개키로) → { v, k, iv, ct } */
export async function sealText(vault, text) {
  const aes = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = random(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, aes, te.encode(String(text)));
  const k = await subtle().encrypt(RSA, await publicKey(vault), await subtle().exportKey('raw', aes));
  return { v: 1, k: toB64(k), iv: toB64(iv), ct: toB64(ct) };
}

/** 잠긴 글 풀기 (여는 열쇠로) */
export async function openText(privateKey, sealed) {
  const raw = await subtle().decrypt(RSA, privateKey, fromB64(sealed.k));
  const aes = await subtle().importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  return td.decode(await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, aes, fromB64(sealed.ct)));
}

/** 잠긴 글처럼 생겼는지 */
export const isSealed = (x) => !!(x && typeof x === 'object' && x.k && x.iv && x.ct);
