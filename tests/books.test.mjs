import test from 'node:test';
import assert from 'node:assert/strict';
import { shelfOrder, booksReadIn, cleanQuotes, parseGoogleBooks, googleBooksUrl } from '../js/books.js';

const books = [
  { id: 'a', title: 'A', status: 'want', createdAt: 1 },
  { id: 'b', title: 'B', status: 'done', end: '2026-03-01' },
  { id: 'c', title: 'C', status: 'reading' },
  { id: 'd', title: 'D', status: 'done', end: '2026-11-20' },
  { id: 'e', title: 'E', status: 'done', end: '2025-12-30' },
  { id: 'f', title: 'F', status: 'want', createdAt: 5 },
];

test('책장 순서와 상태 거르기', () => {
  assert.deepEqual(shelfOrder(books).map((b) => b.id), ['c', 'd', 'b', 'e', 'f', 'a']);
  assert.deepEqual(shelfOrder(books, 'done').map((b) => b.id), ['d', 'b', 'e']);
});

test('그해 다 읽은 책 수', () => {
  assert.equal(booksReadIn(books, 2026), 2);
  assert.equal(booksReadIn(books, 2025), 1);
});

test('인상 깊은 문장: 빈 줄은 빼요', () => {
  assert.deepEqual(cleanQuotes([{ text: ' 좋은 문장 ', page: '12' }, { text: '', page: '3' }, { text: '두 번째' }]), [{ text: '좋은 문장', page: '12' }, { text: '두 번째', page: '' }]);
});

test('구글 북스 결과 → 후보 (표지 주소는 https로)', () => {
  const r = parseGoogleBooks({ items: [{ volumeInfo: { title: '도둑맞은 집중력', authors: ['요한 하리'], publisher: '어크로스', imageLinks: { thumbnail: 'http://books.google.com/x?id=1&edge=curl' } } }, { volumeInfo: {} }] });
  assert.deepEqual(r, [{ title: '도둑맞은 집중력', author: '요한 하리', publisher: '어크로스', cover: 'https://books.google.com/x?id=1' }]);
  assert.match(googleBooksUrl('도둑맞은 집중력'), /q=%EB%8F%84/);
});
