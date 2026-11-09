// 비서 개선 목록: 못 알아들었거나 엉뚱하게 답한 질문을 모아서, 한 번에 복사해 전달해요.
// 금액·숫자는 개인 정보라서 복사할 때 가려요 (질문 이해에는 필요 없어요).

/** 목록에 추가. 같은 질문이면 최신 것으로 바꿔요. 최대 50개 */
export function addFeedback(list, item) {
  const rest = (list || []).filter((x) => x.q !== item.q);
  return [...rest, { at: new Date().toISOString(), ...item }].slice(-50);
}

/** 금액·긴 숫자 가리기: 1,989,534원 → N원, $552.30 → $N, 12월 17일 같은 날짜는 그대로 */
export function maskNumbers(text) {
  return String(text || '')
    .replace(/[+−-]?\$\d[\d,.]*/g, '$N')
    .replace(/[+−-]?\d[\d,]*(\.\d+)?\s*(원|만원|억원?)/g, 'N$2')
    .replace(/\d{1,3}(,\d{3})+(\.\d+)?/g, 'N')
    .replace(/\d+(\.\d+)?%/g, 'N%');
}

const KIND = { unknown: '모른다고 답함', wrong: '엉뚱한 답' };

/** 저에게(개발자에게) 붙여넣을 글 */
export function feedbackText(list, dateStr) {
  const items = list || [];
  const lines = [`[차곡차곡 비서 개선 요청] ${dateStr} · ${items.length}건`, '아래 질문들을 비서가 제대로 알아듣도록 고쳐 주세요. (금액은 N으로 가렸어요)', ''];
  items.forEach((x, i) => {
    lines.push(`${i + 1}) 질문: ${x.q}`);
    lines.push(`   구분: ${KIND[x.kind] || (x.a ? '엉뚱한 답' : '모른다고 답함')}`);
    if (x.a) lines.push(`   비서 답: ${maskNumbers(x.a).replace(/\n+/g, ' / ')}`);
    if (x.want) lines.push(`   원래 원한 것: ${x.want}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}
