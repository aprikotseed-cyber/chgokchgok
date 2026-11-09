import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrades, apiError, matchTrades, estimate, yahooSymbols, recentMonths } from '../scripts/market-lib.mjs';

const xml = `<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>
<item><aptNm>정자동 한솔마을(주공4단지)</aptNm><dealAmount>    82,500</dealAmount><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>3</dealDay><excluUseAr>59.88</excluUseAr><floor>7</floor><umdNm>정자동</umdNm><cdealType> </cdealType></item>
<item><aptNm>정자동 한솔마을(주공4단지)</aptNm><dealAmount>85,000</dealAmount><dealYear>2026</dealYear><dealMonth>10</dealMonth><dealDay>21</dealDay><excluUseAr>59.88</excluUseAr><floor>12</floor><umdNm>정자동</umdNm><cdealType>O</cdealType></item>
<item><aptNm>정자동 한솔마을(주공4단지)</aptNm><dealAmount>120,000</dealAmount><dealYear>2026</dealYear><dealMonth>10</dealMonth><dealDay>5</dealDay><excluUseAr>84.9</excluUseAr><floor>3</floor><umdNm>정자동</umdNm><cdealType></cdealType></item>
<item><aptNm>느티마을3단지</aptNm><dealAmount>99,000</dealAmount><dealYear>2026</dealYear><dealMonth>10</dealMonth><dealDay>1</dealDay><excluUseAr>59.9</excluUseAr><floor>2</floor><umdNm>정자동</umdNm></item>
</items><totalCount>4</totalCount></body></response>`;

test('XML 파싱: 금액은 원 단위, 해제 거래 표시', () => {
  const t = parseTrades(xml);
  assert.equal(t.length, 4);
  assert.equal(t[0].price, 825_000_000);
  assert.equal(t[0].date, '2026-09-03');
  assert.equal(t[1].cancelled, true);
});

test('매칭: 단지명 일부 + 면적 ±2㎡, 해제 거래 제외', () => {
  const m = matchTrades(parseTrades(xml), { aptName: '한솔마을 주공4단지', area: 59 });
  assert.equal(m.length, 1);
  assert.equal(m[0].price, 825_000_000);
});

test('추정 시세와 월별 중앙값', () => {
  const m = matchTrades(parseTrades(xml), { aptName: '한솔', area: 0 });
  const e = estimate(m, new Date(2026, 10, 9));
  assert.equal(e.estimate, Math.round((825_000_000 + 1_200_000_000) / 2));
  assert.deepEqual(e.monthly.map((x) => x.ym), ['2026-09', '2026-10']);
});

test('API 오류 감지', () => {
  assert.equal(apiError(xml), null);
  assert.equal(apiError('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>'), 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
});

test('종목코드 변환과 월 목록', () => {
  assert.deepEqual(yahooSymbols('005930'), ['005930.KS', '005930.KQ']);
  assert.deepEqual(yahooSymbols('aapl'), ['AAPL']);
  assert.deepEqual(recentMonths(3, new Date(2026, 0, 15)), ['202601', '202512', '202511']);
});
