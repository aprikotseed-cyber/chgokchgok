import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, openVault, rewrapVault, sealText, openText, isSealed, WrongPassword } from '../js/vault.js';

const ITER = 1000; // 테스트는 빠르게 (실제는 600,000번)

test('금고: 맞는 비밀번호로만 열리고, 잠근 글은 서버에 알아볼 수 없게', async () => {
  const vault = await createVault('비밀번호1!', ITER);
  assert.equal(vault.v, 1);
  for (const k of ['pub', 'salt', 'iv', 'priv']) assert.equal(typeof vault[k], 'string');
  assert.ok(!JSON.stringify(vault).includes('비밀번호1!'));

  const sealed = await sealText(vault, '요즘 수업 준비가 너무 벅차다\n잠을 못 잠');
  assert.ok(isSealed(sealed));
  const stored = JSON.stringify(sealed);
  assert.ok(!stored.includes('수업') && !stored.includes('벅차'));

  const key = await openVault(vault, '비밀번호1!');
  assert.equal(await openText(key, sealed), '요즘 수업 준비가 너무 벅차다\n잠을 못 잠');
  await assert.rejects(openVault(vault, '비밀번호2!'), WrongPassword);
  await assert.rejects(openVault(vault, ''), WrongPassword);
});

test('같은 글도 잠글 때마다 다른 암호문', async () => {
  const vault = await createVault('pw', ITER);
  const a = await sealText(vault, '같은 글');
  const b = await sealText(vault, '같은 글');
  assert.notEqual(a.ct, b.ct);
  const key = await openVault(vault, 'pw');
  assert.equal(await openText(key, a), '같은 글');
  assert.equal(await openText(key, b), '같은 글');
});

test('비밀번호가 바뀌면 다시 잠가도 예전 고민거리가 열려요', async () => {
  const vault = await createVault('old-pw', ITER);
  const sealed = await sealText(vault, '예전 고민');
  const next = await rewrapVault(vault, 'old-pw', 'new-pw');
  assert.equal(next.pub, vault.pub);
  assert.equal(await openText(await openVault(next, 'new-pw'), sealed), '예전 고민');
  await assert.rejects(openVault(next, 'old-pw'), WrongPassword);
  await assert.rejects(rewrapVault(vault, 'wrong', 'x'), WrongPassword);
});

test('다른 금고의 열쇠로는 못 열어요', async () => {
  const a = await createVault('pw', ITER);
  const b = await createVault('pw', ITER);
  const sealed = await sealText(a, '비밀');
  await assert.rejects(openText(await openVault(b, 'pw'), sealed));
});
