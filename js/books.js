// 독서 기입장: 화면·테스트가 함께 쓰는 순수 함수
// book: { id, title, author, publisher, cover, status: 'reading'|'done'|'want', start, end, rating(0~5), review, quotes: [{text, page}] }

export const BOOK_STATUS = [['reading', '읽는 중'], ['done', '다 읽음'], ['want', '읽고 싶은 책']];
const ORDER = { reading: 0, done: 1, want: 2 };

/** 책장 순서: 읽는 중 → 다 읽음(최근에 끝낸 것부터) → 읽고 싶은 책(최근에 넣은 것부터) */
export function shelfOrder(books, status = '') {
  return (books || []).filter((b) => !status || b.status === status).sort((a, b) =>
    (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3)
    || (a.status === 'done' ? String(b.end || '').localeCompare(String(a.end || '')) : 0)
    || (b.createdAt || 0) - (a.createdAt || 0));
}

/** 그해에 다 읽은 책 수 (올해 목표 '책 N권'에 써요) */
export function booksReadIn(books, year) {
  return (books || []).filter((b) => b.status === 'done' && String(b.end || '').startsWith(`${year}-`)).length;
}

/** 비어 있는 인상 깊은 문장 줄은 빼요 */
export function cleanQuotes(quotes) {
  return (quotes || []).map((q) => ({ text: String(q.text || '').trim(), page: String(q.page || '').trim() })).filter((q) => q.text);
}

/** 구글 북스 검색 결과 → 후보 [{title, author, publisher, cover}] */
export function parseGoogleBooks(json) {
  return (json?.items || []).map((it) => {
    const v = it.volumeInfo || {};
    const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '';
    return {
      title: [v.title, v.subtitle].filter(Boolean).join(': '),
      author: (v.authors || []).join(', '),
      publisher: v.publisher || '',
      cover: img.replace(/^http:/, 'https:').replace('&edge=curl', ''),
    };
  }).filter((b) => b.title);
}

export const googleBooksUrl = (q) => `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books`;
