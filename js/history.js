// 자산 기록과 추이. 하루에 한 줄씩 { 날짜: {net, savings, stocks, homes, debts} } 로 쌓고,
// 일별(최근 30일) / 월별(최근 12개월, 그달 마지막 기록) / 연도별(그해 마지막 기록)로 묶어 보여줘요.

/** 오늘 기록 한 줄 (currentTotals 결과로) */
export function makeEntry(t) {
  const r = Math.round;
  return { net: r(t.net), savings: r(t.savings + t.stocks), stocks: r(t.stocks), homes: r(t.homes), debts: r(t.debts) };
}

export function sameEntry(a, b) {
  return !!a && !!b && ['net', 'savings', 'homes', 'debts'].every((k) => a[k] === b[k]);
}

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * @param days {'YYYY-MM-DD': entry}
 * @param snapshots 예전 월별 기록 {'YYYY-MM': {net, assets, debts}} (그달 일별 기록이 없을 때만 써요)
 * @param mode 'day' | 'month' | 'year'
 * @param estimates 기록으로 거꾸로 계산한 지난 달 {'YYYY-MM': entry(est)} (일별 기록·예전 기록이 없는 달만 써요)
 * @returns {points: [{key, label, net, savings, stocks, homes, debts}], change, rate}
 */
export function trend(days = {}, snapshots = {}, mode = 'day', today = new Date(), estimates = {}) {
  const all = { ...days };
  if (mode !== 'day') {
    for (const [ym, s] of Object.entries(snapshots || {})) {
      if (Object.keys(all).some((k) => k.startsWith(ym))) continue;
      all[`${ym}-28`] = { net: s.net, debts: s.debts, homes: null, savings: null };
    }
    for (const [ym, e] of Object.entries(estimates || {})) {
      if (Object.keys(all).some((k) => k.startsWith(ym))) continue;
      all[`${ym}-28`] = { ...e, est: true };
    }
  }
  const keys = Object.keys(all).sort();
  let points = [];
  if (mode === 'day') {
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    points = keys.filter((k) => k >= key(from) && k <= key(today)).map((k) => ({ key: k, label: `${Number(k.slice(5, 7))}/${Number(k.slice(8))}`, ...all[k] }));
  } else {
    const size = mode === 'month' ? 7 : 4;
    const last = {};
    for (const k of keys) last[k.slice(0, size)] = k; // 그 기간의 마지막 기록
    let groups = Object.keys(last).sort();
    if (mode === 'month') {
      const from = new Date(today.getFullYear(), today.getMonth() - 11, 1);
      groups = groups.filter((g) => g >= `${from.getFullYear()}-${pad(from.getMonth() + 1)}`); // 달력 기준 최근 12개월
    }
    points = groups.map((g) => ({ key: g, label: mode === 'month' ? `${g.slice(2, 4)}.${g.slice(5)}` : `${g}년`, ...all[last[g]] }));
  }
  // 바로 앞 점과 비교한 변화 (주식은 환율 효과 포함, 저축은 주식을 뺀 예금·적금 등)
  points.forEach((p, i) => { if (i) p.diff = diffOf(points[i - 1], p); });
  const first = points[0];
  const end = points.at(-1);
  const change = points.length > 1 ? end.net - first.net : 0;
  return { points, change, rate: points.length > 1 && first.net ? (change / Math.abs(first.net)) * 100 : 0 };
}

/** 두 기록 사이 변화: 총자산과 무엇 때문에 움직였는지 */
export function diffOf(a, b) {
  const has = a.savings != null && b.savings != null;
  const d = { net: b.net - a.net, prevLabel: a.label, prevKey: a.key };
  if (has) {
    d.stocks = (b.stocks || 0) - (a.stocks || 0);
    d.cash = (b.savings - (b.stocks || 0)) - (a.savings - (a.stocks || 0));
    d.homes = (b.homes || 0) - (a.homes || 0);
    d.debts = (b.debts || 0) - (a.debts || 0);
  }
  return d;
}

/** 오늘 값과 가장 최근의 지난 기록 비교 (홈 맨 위 '어제 대비') */
export function sinceLast(days, todayKey, current) {
  const prev = Object.keys(days || {}).filter((k) => k < todayKey).sort().pop();
  if (!prev) return null;
  return { ...diffOf({ ...days[prev], label: prev, key: prev }, current), prevKey: prev };
}
