import test from 'node:test';
import assert from 'node:assert/strict';
import { addFeedback, maskNumbers, feedbackText } from '../js/feedback.js';

test('같은 질문은 하나만, 최신 내용으로', () => {
  let l = addFeedback([], { q: '대출 얼마', kind: 'wrong' });
  l = addFeedback(l, { q: '대출 얼마', kind: 'wrong', want: '신용대출 상환일' });
  assert.equal(l.length, 1);
  assert.equal(l[0].want, '신용대출 상환일');
});

test('복사할 때 금액·숫자는 가린다', () => {
  assert.equal(maskNumbers('12월 17일 (목) 1,989,534원 · 32회차'), '12월 17일 (목) N원 · 32회차');
  assert.equal(maskNumbers('평가 $14,986.10 · 수익 +3,185,610원 (+17.98%)'), '평가 $N · 수익 N원 (+N%)');
});

test('붙여넣기용 글 형식', () => {
  const t = feedbackText([{ q: '보금자리 이번달 원금', kind: 'wrong', a: '아낌e보금자리론: 12월 17일 1,989,534원\n원금 0원', want: '이번 달 원금만' }], '2026-11-09');
  assert.match(t, /^\[차곡차곡 비서 개선 요청\] 2026-11-09 · 1건/);
  assert.match(t, /질문: 보금자리 이번달 원금/);
  assert.match(t, /비서 답: 아낌e보금자리론: 12월 17일 N원 \/ 원금 N원/);
  assert.match(t, /원래 원한 것: 이번 달 원금만/);
});
