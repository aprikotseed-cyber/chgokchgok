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
  let historyRef = null;
  A.onAuthStateChanged(auth, (user) => {
    unsub.forEach((u) => u());
    unsub = [];
    h.onAuth(user);
    if (!user) return;
    mainRef = F.doc(db, 'users', user.uid, 'data', 'main');
    const marketRef = F.doc(db, 'users', user.uid, 'data', 'market');
    historyRef = F.doc(db, 'users', user.uid, 'data', 'history');
    unsub.push(
      F.onSnapshot(mainRef, { includeMetadataChanges: true }, (s) => {
        h.onSync(s.metadata.hasPendingWrites ? 'saving' : s.metadata.fromCache ? 'offline' : 'saved');
        if (!s.metadata.hasPendingWrites) h.onData(s.exists() ? s.data() : null);
      }),
      F.onSnapshot(marketRef, (s) => h.onMarket(s.exists() ? s.data() : {})),
      F.onSnapshot(historyRef, (s) => h.onHistory?.(s.exists() ? s.data().days || {} : {})),
      // 구글 캘린더·태스크에서 받아 둔 일정·할일 (다음에 열 때 로그인 없이 바로 보이게)
      F.onSnapshot(F.doc(db, 'users', user.uid, 'data', 'agenda'), (s) => h.onAgenda?.(s.exists() ? s.data() : null)),
      // 메모: 하나씩 따로 저장 (단축어로 GitHub이 넣어도 앱 저장과 겹치지 않게)
      F.onSnapshot(F.collection(db, 'users', user.uid, 'memos'), (s) => h.onMemos?.(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      // 토큰 같은 비밀값: 백업 파일·개선 목록에 섞이지 않게 따로 저장
      F.onSnapshot(F.doc(db, 'users', user.uid, 'data', 'secrets'), (s) => h.onSecrets?.(s.exists() ? s.data() : {})),
    );
  });

  return {
    login: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    logout: () => A.signOut(auth),
    save: (data) => F.setDoc(mainRef, data),
    /**
     * 바뀐 항목만 저장해요 (자산·부채·설정처럼 맨 위 칸 단위). 한 기기에서 설정을 바꿔도
     * 다른 기기에서 고친 자산을 예전 값으로 덮어쓰지 않아요. changes의 값이 undefined면 그 칸을 지워요.
     */
    update: async (changes, full) => {
      const payload = {};
      for (const [k, v] of Object.entries(changes)) payload[k] = v === undefined ? F.deleteField() : v;
      if (!Object.keys(payload).length) return;
      try { await F.updateDoc(mainRef, payload); }
      catch (e) { if (e.code === 'not-found') await F.setDoc(mainRef, full); else throw e; }
    },
    /** 이번 달 자산 기록 한 칸만 (다른 기기에서 고친 내용을 덮어쓰지 않게, 전체 저장 대신 이 칸만) */
    saveSnapshot: (ym, snap) => F.setDoc(mainRef, { snapshots: { [ym]: snap } }, { merge: true }),
    /**
     * 당겨서 새로고침·앱으로 돌아올 때: 서버에서 직접 다시 받아요.
     * (휴대폰 앱이 뒤에 있다 오면 실시간 연결이 잠들어 있을 수 있어서, 저장해 둔 값 대신 서버 값을 받아요)
     * 인터넷이 안 되면 오류를 던져요.
     */
    reload: async () => {
      await F.enableNetwork(db).catch(() => {});
      const [m, mk, hs] = await Promise.all([F.getDocFromServer(mainRef), F.getDocFromServer(F.doc(db, 'users', auth.currentUser.uid, 'data', 'market')), F.getDocFromServer(historyRef)]);
      h.onData(m.exists() ? m.data() : null);
      h.onMarket(mk.exists() ? mk.data() : {});
      h.onHistory?.(hs.exists() ? hs.data().days || {} : {});
      h.onSync('saved');
    },
    /** 하루 자산 기록 한 줄 (같은 날이면 덮어써요) */
    saveHistory: (day, entry) => F.setDoc(historyRef, { days: { [day]: entry } }, { merge: true }),
    /** 단축어용 키: 이 계정의 로그인 유지 토큰 (단축어가 본인 받은편지함에만 쓸 수 있어요) */
    shortcutKey: () => auth.currentUser?.refreshToken || '',
    apiKey: firebaseConfig.apiKey,
    saveMemo: ({ id, ...memo }) => F.setDoc(F.doc(db, 'users', auth.currentUser.uid, 'memos', id), memo),
    deleteMemo: (id) => F.deleteDoc(F.doc(db, 'users', auth.currentUser.uid, 'memos', id)),
    saveAgenda: (agenda) => F.setDoc(F.doc(db, 'users', auth.currentUser.uid, 'data', 'agenda'), agenda),
    saveSecret: (key, value) => F.setDoc(F.doc(db, 'users', auth.currentUser.uid, 'data', 'secrets'), { [key]: value || F.deleteField() }, { merge: true }),
    pushSupported: async () => {
      const M = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-messaging.js`);
      return M.isSupported();
    },
    /** 이 기기를 푸시 알림 받을 기기로 등록. vapidKey는 Firebase 콘솔의 웹 푸시 인증서 키(공개값) */
    enablePush: async (vapidKey) => {
      const M = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-messaging.js`);
      if (!(await M.isSupported())) throw new Error('이 브라우저는 푸시 알림을 지원하지 않아요');
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('알림 권한이 허용되지 않았어요');
      const reg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
      const token = await M.getToken(M.getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
      const ref = F.doc(db, 'users', auth.currentUser.uid, 'data', 'push');
      const devices = ((await F.getDoc(ref)).data()?.devices || []).filter((x) => x.token !== token);
      devices.push({ token, device: deviceName(), addedAt: new Date().toISOString() });
      await F.setDoc(ref, { devices }, { merge: true });
      localStorage.setItem('chgok-push-token', token);
      return token;
    },
    pushDevices: async () => (await F.getDoc(F.doc(db, 'users', auth.currentUser.uid, 'data', 'push'))).data()?.devices || [],
    removePushDevice: async (token) => {
      const ref = F.doc(db, 'users', auth.currentUser.uid, 'data', 'push');
      const devices = ((await F.getDoc(ref)).data()?.devices || []).filter((x) => x.token !== token);
      await F.setDoc(ref, { devices }, { merge: true });
      if (localStorage.getItem('chgok-push-token') === token) localStorage.removeItem('chgok-push-token');
    },
  };
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad|Macintosh.*Mobile|Macintosh.*Safari/.test(ua) && navigator.maxTouchPoints > 1) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android 휴대폰' : 'Android 태블릿';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Macintosh/.test(ua)) return 'Mac';
  return '기기';
}

function demoStore(h) {
  const KEY = 'chgok-demo';
  let data = JSON.parse(localStorage.getItem(KEY) || 'null') || sampleData();
  const market = sampleMarket();
  const HKEY = 'chgok-demo-history';
  const history = JSON.parse(localStorage.getItem(HKEY) || 'null') || sampleHistory();
  const MKEY = 'chgok-demo-memos';
  let memos = JSON.parse(localStorage.getItem(MKEY) || 'null') || sampleMemos();
  const putMemos = () => { localStorage.setItem(MKEY, JSON.stringify(memos)); h.onMemos?.(memos); };
  setTimeout(() => {
    h.onMemos?.(memos);
    h.onAuth({ email: '체험 모드' });
    h.onData(data);
    h.onMarket(market);
    h.onHistory?.(history);
    h.onAgenda?.(null); // 예시 일정·할일은 앱이 가짜 구글에서 받아와요
    h.onSync('demo');
  });
  return {
    login: async () => {},
    logout: async () => { localStorage.removeItem(KEY); location.href = location.pathname; },
    save: async (d) => { data = d; localStorage.setItem(KEY, JSON.stringify(d)); },
    update: async (_c, full) => { data = full; localStorage.setItem(KEY, JSON.stringify(full)); },
    saveSnapshot: async (ym, snap) => { data = { ...data, snapshots: { ...(data.snapshots || {}), [ym]: snap } }; localStorage.setItem(KEY, JSON.stringify(data)); },
    reload: async () => {},
    saveHistory: async (day, entry) => { history[day] = entry; localStorage.setItem(HKEY, JSON.stringify(history)); },
    pushSupported: async () => false,
    enablePush: async () => { throw new Error('체험 모드에서는 알림을 켤 수 없어요'); },
    pushDevices: async () => [],
    saveSecret: async () => { throw new Error('체험 모드에서는 저장하지 않아요'); },
    saveAgenda: async () => {},
    shortcutKey: () => '',
    apiKey: '체험모드',
    saveMemo: async (m) => { memos = [m, ...memos.filter((x) => x.id !== m.id)]; putMemos(); },
    deleteMemo: async (id) => { memos = memos.filter((x) => x.id !== id); putMemos(); },
    removePushDevice: async () => {},
  };
}

function sampleMemos() {
  const t = Date.now();
  const h = 3600_000;
  return [
    { id: 'm1', text: '학부모 상담 때 물어볼 것\n- 방과후 신청 여부\n- 알레르기 확인', pinned: true, createdAt: t - 50 * h, updatedAt: t - 50 * h },
    { id: 'm2', text: '와이파이 비밀번호 바뀜: 공유기 뒷면 확인', pinned: false, createdAt: t - 2 * h, updatedAt: t - 2 * h },
    { id: 'm3', text: '다음 학기 연수 후보: 디지털 리터러시, 회복적 생활교육', pinned: false, createdAt: t - 26 * h, updatedAt: t - 26 * h },
    { id: 'm4', text: '읽을 책: 『도둑맞은 집중력』', pinned: false, createdAt: t - 9 * 24 * h, updatedAt: t - 9 * 24 * h },
  ];
}

function sampleData() {
  return {
    savings: [
      { id: 's1', name: '주거래 적금', kind: '적금', balance: 18_000_000, monthly: 1_000_000, rate: 3.5 },
      { id: 's2', name: '파킹통장', kind: '파킹통장', balance: 7_000_000, monthly: 200_000, rate: 2.5 },
      { id: 's3', name: '교직원 연금저축', kind: '연금', balance: 12_000_000, monthly: 300_000, rate: 4 },
    ],
    stocks: [
      { id: 't1', name: '삼성전자', ticker: '005930', market: 'kr', qty: 40, avgPrice: 68_000, avgCur: 'KRW' },
      { id: 't2', name: 'Vanguard S&P 500', ticker: 'VOO', market: 'us', qty: 15, avgPrice: 471.2, avgCur: 'USD', costKrw: 9_520_000 },
      { id: 't3', name: 'Invesco QQQ', ticker: 'QQQ', market: 'us', qty: 8, avgPrice: 452.8, avgCur: 'USD', costKrw: 4_890_000 },
      { id: 't4', name: 'Apple', ticker: 'AAPL', market: 'us', qty: 12, avgPrice: 198.5, avgCur: 'USD', costKrw: 3_310_000 },
      { id: 't5', name: 'TIGER 미국S&P500', ticker: '360750', market: 'pension', qty: 210, avgPrice: 17_850, avgCur: 'KRW' },
    ],
    homes: [{ id: 'h1', name: '우리 집', lawdCd: '41135', aptName: '예시마을', area: 84, share: 100, useAuto: true, manualPrice: 950_000_000, purchasePrice: 830_000_000, purchaseDate: '2021-05' }],
    debts: [
      { id: 'd1', name: '아낌e보금자리론', kind: '주택담보대출', rate: 3.9, method: 'graduated', schedule: sampleSchedule(), original: 400_000_000, balance: 0, maturity: '' },
      { id: 'd2', name: '신용대출', kind: '신용대출', original: 30_000_000, balance: 18_000_000, rate: 5.2, payDay: 14, method: 'equal', maturity: '2029-06', graceEnd: '' },
    ],
    settings: { horizon: 20 },
    fixed: [
      { id: 'f1', name: '아파트 관리비', category: '주거', amount: 238_000, day: 25, account: '주거래 통장' },
      { id: 'f2', name: '휴대폰', category: '통신', amount: 52_000, day: 21, account: '신용카드' },
      { id: 'f3', name: '인터넷·TV', category: '통신', amount: 33_000, day: 10, account: '신용카드' },
      { id: 'f4', name: '실손보험', category: '보험', amount: 41_200, day: 15, account: '주거래 통장' },
      { id: 'f5', name: '교직원공제회 장기저축', category: '기타', amount: 300_000, day: 10, account: '급여 통장' },
      { id: 'f6', name: '음악 구독', category: '구독', amount: 11_990, day: 3, account: '신용카드' },
      { id: 'f7', name: '대중교통', category: '교통', amount: 62_000, day: 1, account: '체크카드' },
    ],
    records: sampleRecords(),
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
    stocks: {
      '005930': { price: 71_200, currency: 'KRW' }, '360750': { price: 21_340, currency: 'KRW' },
      VOO: { price: 552.3, currency: 'USD' }, QQQ: { price: 498.1, currency: 'USD' }, AAPL: { price: 226.4, currency: 'USD' },
    },
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

function sampleRecords() {
  // 예시 기록은 잔액에 반영하지 않은 상태(applied: false)로 둡니다.
  const out = [];
  let n = 0;
  for (let i = 22; i >= 0; i--) {
    const d = new Date(2026, 10 - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (i > 0 || new Date().getDate() >= 5) out.push({ id: `rs${n++}`, type: 'saving', targetId: 's1', date: `${ym}-05`, amount: 1_000_000, kind: '정기 납입', memo: '', applied: false });
    out.push({ id: `rs${n++}`, type: 'saving', targetId: 's3', date: `${ym}-10`, amount: 300_000, kind: '정기 납입', memo: '', applied: false });
    if (i < 22) out.push({ id: `rr${n++}`, type: 'repayment', targetId: 'd1', date: `${ym}-${i === 0 ? '09' : '25'}`, amount: 520_000 + (22 - i) * 1700, interest: 1_160_000 - (22 - i) * 1700, kind: '정기 상환', memo: '', applied: false });
    if (i === 7) out.push({ id: `rx${n++}`, type: 'saving', targetId: 's2', date: `${ym}-28`, amount: 2_000_000, kind: '추가 납입', memo: '성과급 일부', applied: false });
    if (i === 3) out.push({ id: `rx${n++}`, type: 'repayment', targetId: 'd2', date: `${ym}-15`, amount: 5_000_000, interest: 0, kind: '중도 상환', memo: '신용대출 일부 상환', applied: false });
  }
  return out;
}

/** 체험용 상환스케줄: 체증식(매달 같은 금액씩 증가), 매달 17일 출금 */
function sampleSchedule() {
  const rows = [];
  let bal = 400_000_000;
  const i = 0.039 / 12;
  let pay = 1_302_000;
  for (let n = 1; n <= 360 && bal > 0; n++) {
    const d = new Date(2024, 2 + n, 17);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-17`;
    const interest = Math.round(bal * i);
    const principal = n === 360 ? bal : Math.min(bal, pay - interest);
    bal -= principal;
    rows.push({ n, due: date, date, payment: principal + interest, principal, interest, balance: bal });
    pay += 1_830;
  }
  return rows;
}

/** 체험용 자산 기록: 2년 동안 매일, 조금씩 오르내리며 늘어나는 모양 */
function sampleHistory() {
  const days = {};
  const today = new Date();
  const start = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());
  let net = 452_000_000;
  for (let d = new Date(start), i = 0; d < today; d.setDate(d.getDate() + 1), i++) {
    net += 385_000 + Math.sin(i / 9) * 600_000 + Math.sin(i / 40) * 250_000;
    const debts = 430_000_000 - i * 25_000;
    const homes = 1_000_000_000 + i * 110_000;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const stocks = Math.round(18_000_000 + i * 14_000 + Math.sin(i / 5) * 450_000);
    days[k] = { net: Math.round(net), savings: Math.round(net - homes + debts), stocks, homes, debts };
  }
  return days;
}
