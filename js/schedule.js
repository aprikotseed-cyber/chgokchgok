// 은행·주택금융공사에서 받은 '상환스케줄' 파일 읽기.
// 엑셀(.xls)로 내려받아도 실제 내용은 HTML 표인 경우가 많아서 HTML 표와 CSV를 모두 읽습니다.
// 화면(브라우저)과 테스트(Node)에서 함께 쓰도록 DOM 없이 문자열만으로 처리해요.

const decode = (s) => s
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .trim();

function htmlRows(text) {
  return (text.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(decode));
}

function csvRows(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if ((c === ',' || c === '\t') && !q) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  });
}

const num = (s) => Number(String(s ?? '').replace(/[^\d.\-]/g, '')) || 0;
const isDate = (s) => /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(String(s).trim());
const toDate = (s) => {
  const [y, m, d] = String(s).trim().split(/[-./]/).map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * @returns {{rows: Array<{n, date, due, payment, principal, interest, balance}>, total: {payment, principal, interest}}}
 *   date = 실제 출금일(영업일), due = 약정 상환일, balance = 상환 후 남은 원금
 */
export function parseSchedule(text) {
  const rows = /<tr/i.test(text) ? htmlRows(text) : csvRows(text);

  // 머리글: '원리금'·'원금'·'이자'가 있는 줄. 데이터 줄은 맨 앞 '회차' 칸 때문에 머리글보다 길 수 있어요.
  const head = rows.find((r) => r.some((c) => c.includes('원리금')) && r.includes('원금') && r.some((c) => c.includes('이자')));
  const data = rows.filter((r) => /^\d+$/.test(r[0]) && r.filter(isDate).length >= 1);
  if (!data.length) throw new Error('상환 회차가 있는 표를 찾지 못했어요');

  let idx;
  if (head) {
    const off = data[0].length - head.length;
    const at = (pred) => { const i = head.findIndex(pred); return i < 0 ? -1 : i + off; };
    idx = {
      due: at((c) => c === '일자' || c.includes('예정일')),
      date: at((c) => c.includes('영업일') || c.includes('출금일')),
      payment: at((c) => c.includes('원리금')),
      principal: at((c) => c === '원금' || c.includes('상환원금')),
      interest: at((c) => c === '이자' || c.includes('이자금액')),
      balance: at((c) => c.includes('잔액')),
    };
  }
  // 머리글을 못 찾으면 주택금융공사 양식 순서: 회차, 예정일, 영업일, 원리금, 원금, 이자, 잔액
  if (!idx || Object.values(idx).some((i) => i < 0)) idx = { due: 1, date: 2, payment: 3, principal: 4, interest: 5, balance: 6 };
  if (!isDate(data[0][idx.date])) idx.date = idx.due;

  const out = data.map((r) => ({
    n: Number(r[0]),
    due: toDate(r[idx.due]),
    date: toDate(r[idx.date]),
    payment: num(r[idx.payment]),
    principal: num(r[idx.principal]),
    interest: num(r[idx.interest]),
    balance: num(r[idx.balance]),
  })).sort((a, b) => a.n - b.n);

  const total = out.reduce((a, r) => ({ payment: a.payment + r.payment, principal: a.principal + r.principal, interest: a.interest + r.interest }), { payment: 0, principal: 0, interest: 0 });
  return { rows: out, total };
}

// ───── 스케줄로 계산하기 (날짜는 'YYYY-MM-DD' 문자열 비교) ─────

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 그날까지 낸 회차를 반영한 남은 원금 */
export function scheduleBalanceAt(rows, dateStr) {
  let bal = rows.length ? rows[0].balance + rows[0].principal : 0;
  for (const r of rows) {
    if (r.date > dateStr) break;
    bal = r.balance;
  }
  return bal;
}

/** 그날 이후(그날 포함) 처음 낼 회차 */
export function nextScheduled(rows, dateStr) {
  return rows.find((r) => r.date >= dateStr) || null;
}

export function paidRows(rows, dateStr) {
  return rows.filter((r) => r.date <= dateStr);
}
