// ============================================================
// 로그인 상태 감시 + 로그인/로그아웃 처리
// ============================================================

const isAppPage = location.pathname.endsWith('app.html');
const isLoginPage = !isAppPage;

auth.onAuthStateChanged((user) => {
  if (user) {
    if (isLoginPage) location.replace('app.html');
  } else {
    if (isAppPage) location.replace('index.html');
  }
});

if (isLoginPage) {
  const loginBtn = document.getElementById('loginBtn');
  const emailEl = document.getElementById('email');
  const pwEl = document.getElementById('password');
  const errEl = document.getElementById('authError');

  function tryLogin() {
    errEl.textContent = '';
    const email = emailEl.value.trim();
    const pw = pwEl.value;
    if (!email || !pw) {
      errEl.textContent = '이메일과 비밀번호를 입력해주세요.';
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = '확인 중...';
    auth.signInWithEmailAndPassword(email, pw)
      .catch((error) => {
        errEl.textContent = '로그인 정보가 올바르지 않습니다.';
        loginBtn.disabled = false;
        loginBtn.textContent = '로그인';
      });
  }

  loginBtn.addEventListener('click', tryLogin);
  pwEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
}

function logout() {
  auth.signOut();
}
