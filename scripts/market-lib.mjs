// 실거래가·주가 수집에 쓰는 순수 함수 모음 (네트워크·Firebase 없이 테스트 가능)

/** 국토부 아파트 매매 실거래가 XML → 거래 배열. 신규(영문 태그)·구버전(한글 태그) 모두 지원 */
export function parseTrades(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const pick = (item, ...tags) => {
    for (const t of tags) {
      const m = item.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`));
      if (m) return m[1].trim();
    }
    return '';
  };
  return items.map((it) => {
    const y = pick(it, 'dealYear', '년');
    const mo = pick(it, 'dealMonth', '월').padStart(2, '0');
    const d = pick(it, 'dealDay', '일').padStart(2, '0');
    return {
      name: pick(it, 'aptNm', '아파트'),
      dong: pick(it, 'umdNm', '법정동'),
      area: Number(pick(it, 'excluUseAr', '전용면적')),
      price: Number(pick(it, 'dealAmount', '거래금액').replace(/[^\d]/g, '')) * 10000, // 만원 → 원
      floor: Number(pick(it, 'floor', '층')) || null,
      date: `${y}-${mo}-${d}`,
      cancelled: /^O$/i.test(pick(it, 'cdealType', '해제여부')),
    };
  });
}

/** 공공데이터포털 오류 응답 감지 (키 오류 등은 200 OK에 XML로 옵니다) */
export function apiError(xml) {
  const code = xml.match(/<resultCode>(.*?)<\/resultCode>/)?.[1];
  if (code && !/^0+$/.test(code)) return xml.match(/<resultMsg>(.*?)<\/resultMsg>/)?.[1] || `오류 코드 ${code}`;
  const auth = xml.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/)?.[1];
  return auth || null;
}

const norm = (s) => String(s || '').replace(/[\s()·.\-]/g, '').toLowerCase();

export function matchTrades(trades, home) {
  const want = norm(home.aptName);
  const area = Number(home.area);
  const tol = Number(home.areaTolerance ?? 2);
  return trades.filter(
    (t) => !t.cancelled && want && norm(t.name).includes(want) && (!area || Math.abs(t.area - area) <= tol),
  );
}

/** 단지명이 안 맞을 때 도움이 되도록, 같은 지역에서 이름이 비슷한 단지 후보 */
export function nameCandidates(trades, home) {
  const want = norm(home.aptName);
  const names = [...new Set(trades.map((t) => t.name))];
  const score = (n) => [...want].filter((c) => norm(n).includes(c)).length;
  return names.sort((a, b) => score(b) - score(a)).slice(0, 15);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 매칭된 거래 → 추정 시세. 최근 6개월 안 최신 3건 평균, 없으면 가장 최근 거래 */
export function estimate(matched, today = new Date()) {
  if (!matched.length) return null;
  const sorted = [...matched].sort((a, b) => b.date.localeCompare(a.date));
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - 6);
  const cut = cutoff.toISOString().slice(0, 10);
  const recent = sorted.filter((t) => t.date >= cut).slice(0, 3);
  const used = recent.length ? recent : sorted.slice(0, 1);
  const value = Math.round(used.reduce((a, t) => a + t.price, 0) / used.length);
  const basis = recent.length
    ? `최근 6개월 실거래 ${used.length}건 평균`
    : `최근 6개월 거래 없음 → 마지막 거래(${used[0].date})`;

  const byMonth = {};
  for (const t of sorted) (byMonth[t.date.slice(0, 7)] ||= []).push(t.price);
  const monthly = Object.entries(byMonth)
    .map(([ym, ps]) => ({ ym, median: median(ps), count: ps.length }))
    .sort((a, b) => a.ym.localeCompare(b.ym));

  return { estimate: value, basis, trades: sorted.slice(0, 30), monthly };
}

/** 최근 n개월 'YYYYMM' 목록 (이번 달 포함) */
export function recentMonths(n, today = new Date()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** 사용자가 입력한 종목코드 → 야후 파이낸스 심볼 후보 */
export function yahooSymbols(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (/^\d{6}$/.test(t)) return [`${t}.KS`, `${t}.KQ`];
  return [t];
}
