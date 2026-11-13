// 비서 점검 질문 모음(tests/assistant-cases.json)을 모두 돌려 봐요.
// 새 개선 요청이 오면 그 질문을 assistant-cases.json에 한 줄 더하면 돼요.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ask } from '../js/assistant.js';
import { NOW, DATA, MARKET, AGENDA, MEMOS } from './fixtures/assistant-fixture.mjs';

const { cases } = JSON.parse(readFileSync(new URL('./assistant-cases.json', import.meta.url), 'utf8'));

export function check(c) {
  const r = ask(c.q, DATA, MARKET, NOW, AGENDA, MEMOS);
  const text = `${r.text}${r.action ? `\n${JSON.stringify(r.action)}` : ''}`;
  const errs = [];
  const want = [].concat(c.via);
  if (!want.includes(r.via)) errs.push(`답 종류 ${r.via} (원한 것 ${want.join('/')})`);
  for (const h of c.has || []) if (!new RegExp(h).test(text)) errs.push(`'${h}' 없음`);
  for (const h of c.not || []) if (new RegExp(h).test(text)) errs.push(`'${h}' 있으면 안 됨`);
  return { r, errs };
}

test(`비서 점검 질문 ${cases.length}개`, () => {
  const bad = [];
  for (const c of cases) {
    const { r, errs } = check(c);
    if (errs.length) bad.push(`· [${c.group}] ${c.q}\n   ${errs.join(', ')}\n   답: ${r.text.split('\n').slice(0, 3).join(' / ')}`);
  }
  assert.equal(bad.length, 0, `${bad.length}개가 엉뚱하게 답했어요\n${bad.join('\n')}`);
});
