import test from 'node:test';
import assert from 'node:assert/strict';
import { autoRefreshPlan } from '../js/github.js';

const kst = (d, h, m = 0) => Date.UTC(2026, 10, d, h - 9, m); // 2026-11-d h:m (한국)
test('앱을 열 때 시세 새로 받기 판단', () => {
  // 화(10일) 오전 7시, 아침 업데이트가 어제 것 → 전체
  assert.equal(autoRefreshPlan(kst(10, 7), kst(9, 15, 43), kst(9, 6, 20)), 'full');
  // 오전 10시, 아침 업데이트는 됐고 주가 1시간 넘음 → 주가만
  assert.equal(autoRefreshPlan(kst(10, 10, 30), kst(10, 9, 13), kst(10, 6, 30)), 'quotes');
  // 장중이지만 30분 전에 받음 → 그대로
  assert.equal(autoRefreshPlan(kst(10, 10, 30), kst(10, 10, 0), kst(10, 6, 30)), null);
  // 장 마감 뒤 저녁, 마감가 아직 → 주가
  assert.equal(autoRefreshPlan(kst(10, 20), kst(10, 13), kst(10, 6, 30)), 'quotes');
  // 저녁, 마감가 받았음 → 그대로
  assert.equal(autoRefreshPlan(kst(10, 20), kst(10, 15, 43), kst(10, 6, 30)), null);
  // 토요일(14일) 낮 → 아침 업데이트만 챙기고 장중 규칙은 없음
  assert.equal(autoRefreshPlan(kst(14, 13), kst(13, 15, 43), kst(14, 6, 30)), null);
  // 새벽 5시 → 아직 아침 업데이트 시각 전
  assert.equal(autoRefreshPlan(kst(10, 5), kst(9, 15, 43), kst(9, 6, 20)), null);
});
