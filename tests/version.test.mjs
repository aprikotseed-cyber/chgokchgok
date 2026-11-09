import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 휴대폰·태블릿이 예전 파일을 붙잡고 있지 않도록 파일 주소 뒤에 ?v=버전을 붙여요.
// 같은 파일이 다른 버전으로 두 번 불러와지지 않게, 모든 곳의 버전이 같아야 해요.
test('index.html과 js 파일의 ?v= 버전이 모두 같다', () => {
  const files = ['index.html', 'js/app.js', 'js/charts.js'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  const versions = new Set(files.flatMap((s) => [...s.matchAll(/\.(?:js|css)\?v=([\w-]+)/g)].map((m) => m[1])));
  assert.equal(versions.size, 1, [...versions].join(', '));
  for (const s of files.slice(1)) assert.ok(!/from '\.\/[a-z]+\.js'/.test(s), '버전 없는 import가 있어요');
});
