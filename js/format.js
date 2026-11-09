// 금액 표시 도우미 (내부 단위는 원)

/** 3억 2,500만원 형태 */
export function won(n) {
  if (n == null || isNaN(n)) return '-';
  const sign = n < 0 ? '-' : '';
  let a = Math.abs(Math.round(n));
  if (a >= 1e8) {
    let eok = Math.floor(a / 1e8);
    let man = Math.round((a % 1e8) / 1e4);
    if (man === 10000) { eok += 1; man = 0; }
    return `${sign}${eok.toLocaleString()}억${man ? ` ${man.toLocaleString()}만` : ''}원`;
  }
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString()}만원`;
  return `${sign}${a.toLocaleString()}원`;
}

/** 그래프 축용 짧은 표기: 3.2억, 4,500만 */
export function wonShort(n) {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e8) return `${sign}${+(a / 1e8).toFixed(a >= 1e10 ? 0 : 1)}억`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString()}만`;
  return `${sign}${a}`;
}

export function pct(n, digits = 1) {
  return `${(Number(n) || 0).toFixed(digits).replace(/\.0+$/, '')}%`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function ymLabel(ym) {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return `${y}년 ${Number(m)}월`;
}

export function dateTime(d) {
  if (!d) return '-';
  const t = d.toDate ? d.toDate() : new Date(d);
  return t.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
