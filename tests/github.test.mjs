import test from 'node:test';
import assert from 'node:assert/strict';
import { repoFromLocation, dispatchWorkflow } from '../js/github.js';

test('사이트 주소에서 저장소 알아내기', () => {
  assert.deepEqual(repoFromLocation({ hostname: 'aprikotseed-cyber.github.io', pathname: '/chgokchgok/' }), { owner: 'aprikotseed-cyber', repo: 'chgokchgok' });
  assert.deepEqual(repoFromLocation({ hostname: 'localhost', pathname: '/' }), { owner: 'aprikotseed-cyber', repo: 'chgokchgok' });
});

test('작업 실행 요청: 주소·헤더·본문, 응답별 안내', async () => {
  let call;
  const ok = async (url, opt) => { call = { url, opt }; return { status: 204 }; };
  assert.equal(await dispatchWorkflow({ owner: 'o', repo: 'r' }, 'tok', 'quotes.yml', ok), true);
  assert.equal(call.url, 'https://api.github.com/repos/o/r/actions/workflows/quotes.yml/dispatches');
  assert.equal(call.opt.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(call.opt.body), { ref: 'main' });
  await assert.rejects(dispatchWorkflow({ owner: 'o', repo: 'r' }, '', 'quotes.yml', ok), /토큰을 넣어/);
  await assert.rejects(dispatchWorkflow({ owner: 'o', repo: 'r' }, 'x', 'q', async () => ({ status: 401 })), /만료/);
  await assert.rejects(dispatchWorkflow({ owner: 'o', repo: 'r' }, 'x', 'q', async () => ({ status: 403 })), /Read and write/);
  await assert.rejects(dispatchWorkflow({ owner: 'o', repo: 'r' }, 'x', 'q', async () => { throw new Error('net'); }), /인터넷/);
});
