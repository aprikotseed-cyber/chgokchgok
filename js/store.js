// 데이터 저장소: Firebase(기본) 또는 체험 모드(?demo, 이 기기에만 저장)
// Firebase 웹 설정값은 공개되어도 괜찮은 값입니다. 실제 보안은 로그인 + Firestore 규칙이 담당해요.
const firebaseConfig = {
  apiKey: 'AIzaSyCE1mr4FhWg9-3slbSNy_VjqfKLh9kzaSI',
  authDomain: 'chgokchgok.firebaseapp.com',
  projectId: 'chgokchgok',
  storageBucket: 'chgokchgok.firebasestorage.app',
  messagingSenderId: '185892318993',
  appId: '1:185892318993:web:52984f7d174bbf362ee6b0',
};

const V = '10.12.2';
const demo = new URLSearchParams(location.search).has('demo');

export function isDemo() {
  return demo;
}

/**
 * @param {{onAuth:(user|null)=>void, onData:(d)=>void, onMarket:(m)=>void, onSync:(s)=>void}} h
 */
export async function connect(h) {
  if (demo) return demoStore(h);

  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const A = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  const F = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });

  let unsub = [];
  let mainRef = null;
  A.onAuthStateChanged(auth, (user) => {
    unsub.forEach((u) => u());
    unsub = [];
    h.onAuth(user);
    if (!user) return;
    mainRef = F.doc(db, 'users', user.uid, 'data', 'main');
    const marketRef = F.doc(db, 'users', user.uid, 'data', 'market');
    unsub.push(
      F.onSnapshot(mainRef, { includeMetadataChanges: true }, (s) => {
        h.onSync(s.metadata.hasPendingWrites ? 'saving' : s.metadata.fromCache ? 'offline' : 'saved');
        if (!s.metadata.hasPendingWrites) h.onData(s.exists() ? s.data() : null);
      }),
      F.onSnapshot(marketRef, (s) => h.onMarket(s.exists() ? s.data() : {})),
    );
  });

  return {
    login: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    logout: () => A.signOut(auth),
    save: (data) => F.setDoc(mainRef, data),
  };
}

function demoStore(h) {
  const KEY = 'chgok-demo';
  let data = JSON.parse(localStorage.getItem(KEY) || 'null') || sampleData();
  const market = sampleMarket();
  setTimeout(() => {
    h.onAuth({ email: '체험 모드' });
    h.onData(data);
    h.onMarket(market);
    h.onSync('demo');
  });
  return {
    login: async () => {},
    logout: async () => { localStorage.removeItem(KEY); location.href = location.pathname; },
    save: async (d) => { data = d; localStorage.setItem(KEY, JSON.stringify(d)); },
  };
}

function sampleData() {
  return {
    savings: [
      { id: 's1', name: '주거래 적금', kind: '적금', balance: 18_000_000, monthly: 1_000_000, rate: 3.5 },
      { id: 's2', name: '파킹통장', kind: '파킹통장', balance: 7_000_000, monthly: 200_000, rate: 2.5 },
      { id: 's3', name: '교직원 연금저축', kind: '연금', balance: 12_000_000, monthly: 300_000, rate: 4 },
    ],
    stocks: [
      { id: 't1', name: '삼성전자', ticker: '005930', qty: 120, avgPrice: 68_000 },
      { id: 't2', name: 'S&P500 ETF', ticker: 'VOO', qty: 15, avgPrice: 650_000 },
    ],
    stockPlan: { monthly: 500_000, rate: 6 },
    homes: [{ id: 'h1', name: '우리 집', lawdCd: '41135', aptName: '예시마을', area: 84, share: 100, useAuto: true, manualPrice: 950_000_000, growth: 2 }],
    debts: [
      { id: 'd1', name: '주택담보대출', kind: '주택담보대출', original: 400_000_000, balance: 352_000_000, rate: 3.9, method: 'annuity', maturity: '2054-03', graceEnd: '' },
      { id: 'd2', name: '신용대출', kind: '신용대출', original: 30_000_000, balance: 18_000_000, rate: 5.2, method: 'equal', maturity: '2029-06', graceEnd: '' },
    ],
    settings: { horizon: 20 },
    snapshots: { '2026-10': { assets: 1_140_000_000, debts: 373_000_000, net: 767_000_000 } },
  };
}

function sampleMarket() {
  const monthly = [];
  let p = 1_020_000_000;
  for (let i = 23; i >= 0; i--) {
    const d = new Date(2026, 10 - i, 1);
    p *= 1 + (Math.sin(i) * 0.012 + 0.003);
    if (i % 3 !== 1) monthly.push({ ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, median: Math.round(p / 1e6) * 1e6, count: 1 + (i % 3) });
  }
  return {
    updatedAt: new Date().toISOString(),
    fx: { USD: 1395 },
    stocks: { '005930': { price: 71_200, currency: 'KRW', name: 'Samsung Electronics' }, VOO: { price: 552.3, currency: 'USD', name: 'Vanguard S&P 500 ETF' } },
    homes: {
      h1: {
        estimate: 1_085_000_000, basis: '최근 6개월 실거래 3건 평균', monthly,
        trades: [
          { date: '2026-10-18', price: 1_090_000_000, floor: 11, area: 84.97 },
          { date: '2026-09-02', price: 1_075_000_000, floor: 4, area: 84.97 },
          { date: '2026-07-21', price: 1_090_000_000, floor: 15, area: 84.97 },
        ],
        checkedAt: new Date().toISOString(),
      },
    },
  };
}
