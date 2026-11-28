// GitHub Actions가 매일 실행: 아파트 실거래가와 주식 현재가를 가져와 Firestore에 저장합니다.
// 필요한 GitHub Secrets: FIREBASE_SERVICE_ACCOUNT (서비스 계정 JSON 전체), DATA_GO_KR_KEY (공공데이터포털 인증키)
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { currentTotals } from '../js/projection.js';
import { makeEntry } from '../js/history.js';
import { parseTrades, apiError, matchTrades, nameCandidates, estimate, recentMonths, yahooSymbols } from './market-lib.mjs';

const MONTHS = 24;
const TRADE_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

const rawKey = process.env.DATA_GO_KR_KEY || '';
const serviceKey = rawKey.includes('%') ? rawKey : encodeURIComponent(rawKey);

const tradeCache = new Map();
// 잠깐 생기는 서버 문제 (다시 해 보면 되는 것)
const TRANSIENT = /HTTP|TIMEOUT|시간\s*초과|연결 실패|서비스.*지연|SERVICE_TIMEOUT|APPLICATION_ERROR|DB_ERROR/i;
async function tradesFor(lawdCd, ym) {
  const k = `${lawdCd}-${ym}`;
  if (tradeCache.has(k)) return tradeCache.get(k);
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const url = `${TRADE_URL}?serviceKey=${serviceKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`;
    // 공공데이터포털(국토부) 서버가 잠깐 'HTTP 에러'·시간 초과를 내는 일이 있어요 → 조금 쉬었다가 3번까지 다시
    let xml = '';
    let err = null;
    for (let tryNo = 1; tryNo <= 3; tryNo++) {
      try { xml = await (await fetch(url)).text(); err = apiError(xml); } catch (e) { err = `연결 실패 (${e.message})`; }
      if (!err || !TRANSIENT.test(err) || tryNo === 3) break;
      await new Promise((r) => setTimeout(r, 4000 * tryNo));
    }
    if (err) throw new Error(TRANSIENT.test(err) ? `국토부 실거래가 서버가 잠시 응답하지 않았어요 (${err}). 지난번 받은 값을 그대로 보여 드려요` : `실거래가 API: ${err}`);
    const items = parseTrades(xml);
    all.push(...items);
    const total = Number(xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1] || 0);
    if (all.length >= total || items.length === 0) break;
  }
  tradeCache.set(k, all);
  return all;
}

async function updateHome(home) {
  if (!rawKey) return { error: 'DATA_GO_KR_KEY 시크릿이 없어요' };
  if (!home.lawdCd || !home.aptName) return { error: '지역코드와 단지명을 입력해 주세요' };
  const all = [];
  for (const ym of recentMonths(MONTHS)) all.push(...(await tradesFor(home.lawdCd, ym)));
  const matched = matchTrades(all, home);
  const est = estimate(matched);
  if (!est) return { error: '조건에 맞는 거래를 찾지 못했어요. 단지명/면적을 확인해 주세요', candidates: nameCandidates(all, home) };
  return est;
}

async function quote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (asset-tracker)' } });
  if (!res.ok) return null;
  const meta = (await res.json())?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  return { price: meta.regularMarketPrice, currency: meta.currency || 'KRW', symbol, name: meta.shortName || meta.longName || '' };
}

async function updateStocks(stocks) {
  const out = {};
  const currencies = new Set(['USD']); // 해외주식 원화 환산·환율 효과 계산에 항상 필요
  for (const s of stocks) {
    const t = String(s.ticker || '').trim().toUpperCase();
    if (!t || out[t]) continue;
    for (const sym of yahooSymbols(t)) {
      const q = await quote(sym).catch(() => null);
      if (q) { out[t] = q; if (q.currency !== 'KRW') currencies.add(q.currency); break; }
    }
    if (!out[t]) out[t] = { error: '시세를 찾지 못했어요' };
  }
  const fx = {};
  for (const c of currencies) {
    const q = await quote(`${c}KRW=X`).catch(() => null);
    if (q) fx[c] = q.price;
  }
  return { stocks: out, fx };
}

// MODE=quotes: 장중 1시간마다 주가·환율만 (실거래가 API는 하루 호출 제한이 있어 아침에만)
const QUOTES_ONLY = process.env.MODE === 'quotes';

const docs = (await db.collectionGroup('data').get()).docs.filter((d) => d.id === 'main');
console.log(`사용자 ${docs.length}명`);
for (const d of docs) {
  const data = d.data();
  const marketRef = d.ref.parent.doc('market');
  const prev = (await marketRef.get()).data() || {};
  const homes = {};
  for (const h of QUOTES_ONLY ? [] : data.homes || []) {
    try {
      const r = await updateHome(h);
      // 실패하면 이전 추정치를 유지하고 오류 메시지만 남깁니다.
      homes[h.id] = r.error ? { ...(prev.homes?.[h.id] || {}), error: r.error, candidates: r.candidates || null } : { ...r, error: null, candidates: null };
    } catch (e) {
      homes[h.id] = { ...(prev.homes?.[h.id] || {}), error: String(e.message || e) };
    }
    homes[h.id].checkedAt = new Date().toISOString();
    console.log(`집 ${h.name}: ${homes[h.id].error || homes[h.id].estimate}`);
  }
  const { stocks, fx } = await updateStocks(data.stocks || []);
  for (const [t, q] of Object.entries(stocks)) if (q.error && prev.stocks?.[t]?.price) stocks[t] = { ...prev.stocks[t], error: q.error };
  console.log(`주식 ${Object.keys(stocks).length}종목, 환율 ${JSON.stringify(fx)}`);
  const quotes = { stocks, fx: { ...(prev.fx || {}), ...fx }, quotesAt: FieldValue.serverTimestamp() };
  if (QUOTES_ONLY) await marketRef.set(quotes, { merge: true }); // 집 시세는 그대로 두고 주가·환율만 바꿔요
  else await marketRef.set({ homes, ...quotes, updatedAt: FieldValue.serverTimestamp() });

  // 오늘의 자산 기록 (앱을 안 연 날도 추이 그래프가 이어지게). 한국 날짜 기준
  const k = new Date(Date.now() + 9 * 3600_000);
  const today = new Date(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const fxAll = { ...(prev.fx || {}), ...fx };
  if (!fxAll.USD && data.settings?.usdKrw) fxAll.USD = Number(data.settings.usdKrw);
  const totals = currentTotals(data, { homes: QUOTES_ONLY ? prev.homes || {} : homes, stocks, fx: fxAll }, today);
  await d.ref.parent.doc('history').set({ days: { [day]: makeEntry(totals) } }, { merge: true });
  console.log(`자산 기록 ${day}: ${Math.round(totals.net).toLocaleString()}원`);
}
