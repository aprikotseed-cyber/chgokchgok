// 주식 매수·매도. 증권사 앱과 같은 '이동평균' 방식이에요.
//  - 매수: 수량 += 산 수량, 평균 매수가 = (기존 수량×기존 평균 + 산 수량×단가) ÷ 새 수량, 원화 매입금액 += 이번에 낸 원화
//  - 매도: 수량 -= 판 수량, 평균 매수가는 그대로, 원화 매입금액은 판 비율만큼 줄어요
//          실현손익(원화) = 받은 원화 − 판 만큼의 원화 매입금액
// 거래마다 '거래 전 보유 상태'를 남겨 두어 가장 최근 거래를 취소할 수 있어요.

/**
 * @param {object} s 종목 (qty, avgPrice, avgCur, costKrw)
 * @param {{type:'buy'|'sell', qty:number, price:number, cur:'USD'|'KRW', krw:number, date:string}} t
 * @returns {{stock: object, trade: object}} 바뀐 종목과 기록할 거래
 */
export function applyTrade(s, t) {
  const q0 = Number(s.qty) || 0;
  const avg0 = Number(s.avgPrice) || 0;
  const avgCur = s.avgCur || t.cur;
  const qty = Number(t.qty) || 0;
  const price = Number(t.price) || 0;
  const krw = Math.round(Number(t.krw) || (t.cur === 'KRW' ? qty * price : 0));
  // 원화 매입금액: 이미 넣어 둔 값, 없으면 원화 종목은 수량×평균으로 알 수 있어요
  const cost0 = Number(s.costKrw) || (avgCur === 'KRW' ? q0 * avg0 : q0 === 0 ? 0 : null);
  // 평균 매수가와 같은 통화로 단가 맞추기
  const p = t.cur === avgCur ? price : avgCur === 'KRW' ? krw / qty : price;
  const before = { qty: s.qty ?? 0, avgPrice: s.avgPrice ?? '', avgCur: s.avgCur ?? '', costKrw: s.costKrw ?? '' };
  const trade = { id: t.id || Math.random().toString(36).slice(2, 10), type: t.type, date: t.date, qty, price, cur: t.cur, krw, memo: t.memo || '', before };

  if (!(qty > 0)) throw new Error('수량을 넣어 주세요');
  if (t.type === 'buy') {
    const q1 = q0 + qty;
    const next = { ...s, qty: round(q1), avgPrice: round((q0 * avg0 + qty * p) / q1), avgCur };
    if (cost0 != null) next.costKrw = Math.round(cost0 + krw);
    if (t.cur !== 'KRW' && krw) trade.fx = krw / (qty * price);
    return { stock: next, trade };
  }
  if (qty > q0 + 1e-9) throw new Error(`보유 수량(${q0}주)보다 많이 팔 수 없어요`);
  const ratio = q0 ? qty / q0 : 0;
  const costPart = cost0 != null ? cost0 * ratio : null;
  const next = { ...s, qty: round(q0 - qty) };
  if (cost0 != null) next.costKrw = Math.round(cost0 - costPart);
  if (costPart != null && krw) trade.realizedKrw = Math.round(krw - costPart);
  if (t.cur === avgCur) trade.realized = round((price - avg0) * qty); // 그 나라 돈 기준 손익
  if (t.cur !== 'KRW' && krw) trade.fx = krw / (qty * price);
  return { stock: next, trade };
}

/** 가장 최근 거래 취소: 거래 전 보유 상태로 되돌려요 */
export function undoLastTrade(s) {
  const trades = s.trades || [];
  if (!trades.length) return s;
  const last = trades.at(-1);
  const restored = { ...s, ...last.before, trades: trades.slice(0, -1) };
  for (const k of ['avgPrice', 'costKrw', 'avgCur']) if (restored[k] === '') delete restored[k];
  return restored;
}

/** 실현손익 합계 (원화) */
export function realizedKrw(stocks) {
  return (stocks || []).reduce((a, s) => a + (s.trades || []).reduce((b, t) => b + (t.realizedKrw || 0), 0), 0);
}

const round = (n) => Math.round(n * 1e6) / 1e6;
