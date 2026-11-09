// 체험 모드용 가짜 구글: 진짜 구글과 같은 모양의 응답을 돌려줘요 (이 기기 메모리에만).
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function createDemoGoogle() {
  const t0 = new Date();
  const day = (n, h, m = 0) => new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + n, h, m);
  const at = (n, h, m, mins = 60) => ({ start: { dateTime: day(n, h, m).toISOString() }, end: { dateTime: new Date(day(n, h, m).getTime() + mins * 60000).toISOString() } });
  const allDay = (n, len = 1) => ({ start: { date: key(day(n, 0)) }, end: { date: key(day(n + len, 0)) } });
  const calendars = [
    { id: 'work', summary: 'Work', backgroundColor: '#2a78d6', primary: true },
    { id: 'life', summary: 'Life', backgroundColor: '#1baf7a' },
    { id: 'exercise', summary: 'Exercise', backgroundColor: '#eb6834' },
    { id: 'cherish', summary: 'Cherish', backgroundColor: '#e87ba4' },
    { id: 'birthday', summary: 'Birthday', backgroundColor: '#eda100' },
    { id: 'partner', summary: '내 캘린더', backgroundColor: '#8b8a83' },
  ].map((c) => ({ accessRole: 'owner', ...c }));
  // 구글처럼 '2026-11-13T19:00:00' + timeZone을 받으면 그대로 돌려줘요
  const fix = (x) => (x?.dateTime && !/Z|[+-]\d\d:\d\d$/.test(x.dateTime) ? { dateTime: `${x.dateTime}+09:00` } : x);
  const events = {
    work: [{ id: 'w1', summary: '학년 협의회', ...at(0, 15, 0, 60) }, { id: 'w2', summary: '학부모 상담', ...at(1, 16, 30, 40) }, { id: 'w3', summary: '디지털 교육 연수', ...allDay(3, 2) }],
    life: [{ id: 'l1', summary: '대학원 수업', ...at(2, 19, 0, 150) }, { id: 'l2', summary: '자동차 정기검사', ...at(6, 10, 0, 60) }],
    exercise: [{ id: 'x1', summary: '헬스', ...at(0, 19, 30, 60) }, { id: 'x2', summary: '러닝 5km', ...at(2, 6, 30, 40) }],
    cherish: [{ id: 'c1', summary: '저녁 데이트', ...at(4, 18, 30, 150) }],
    birthday: [{ id: 'b1', summary: '어머니 생신', ...allDay(9) }],
    partner: [{ id: 'p1', summary: '친구 결혼식', ...at(5, 12, 0, 120) }, { id: 'p2', summary: '야근', ...at(0, 20, 0, 120) }],
  };
  const lists = [{ id: 'default', title: '내 할 일 목록' }];
  let tasks = [
    { id: 't1', title: '교육청 공문 회신', due: `${key(day(-1, 0))}T00:00:00.000Z`, status: 'needsAction' },
    { id: 't2', title: '수학 단원평가 채점', due: `${key(day(0, 0))}T00:00:00.000Z`, status: 'needsAction' },
    { id: 't3', title: '우유 사기', due: `${key(day(0, 0))}T00:00:00.000Z`, status: 'needsAction' },
    { id: 't4', title: '현장체험학습 동의서 걷기', due: `${key(day(1, 0))}T00:00:00.000Z`, status: 'needsAction' },
    { id: 't5', title: '대학원 과제 제출', notes: 'PDF로', due: `${key(day(4, 0))}T00:00:00.000Z`, status: 'needsAction' },
    { id: 't6', title: '읽고 싶은 책 정리', status: 'needsAction' },
    { id: 't7', title: '연말정산 서류 준비', due: `${key(day(-3, 0))}T00:00:00.000Z`, status: 'completed', completed: day(-2, 9).toISOString() },
  ];
  let n = 100;
  const delay = () => new Promise((r) => setTimeout(r, 150));
  return {
    demo: true,
    connected: () => true,
    connect: async () => 'demo',
    disconnect() {},
    calendars: async () => (await delay(), calendars),
    events: async (calId) => (await delay(), events[calId] || []),
    taskLists: async () => lists,
    addEvent: async (calId, body) => { await delay(); const e = { id: `e${n++}`, ...body, start: fix(body.start), end: fix(body.end) }; (events[calId] ||= []).push(e); return e; },
    patchEvent: async (calId, id, body) => { await delay(); const e = events[calId].find((x) => x.id === id); Object.assign(e, body, body.start ? { start: fix(body.start), end: fix(body.end) } : {}); return e; },
    deleteEvent: async (calId, id) => { await delay(); events[calId] = events[calId].filter((x) => x.id !== id); return null; },
    tasks: async () => (await delay(), tasks),
    addTask: async (_l, body) => { await delay(); const t = { id: `t${n++}`, status: 'needsAction', ...body }; tasks = [t, ...tasks]; return t; },
    patchTask: async (_l, id, body) => { await delay(); tasks = tasks.map((t) => (t.id === id ? { ...t, ...body, completed: body.status === 'completed' ? new Date().toISOString() : body.status ? null : t.completed } : t)); return tasks.find((t) => t.id === id); },
    deleteTask: async (_l, id) => { await delay(); tasks = tasks.filter((t) => t.id !== id); return null; },
  };
}
