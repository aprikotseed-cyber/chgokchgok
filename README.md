# 나의 재무 비서 — 설정 가이드 (1단계)

## 1. Firebase 프로젝트 준비
1. https://console.firebase.google.com 접속 → "프로젝트 추가" (끄적끄적/육삼레벨업과 분리된 새 프로젝트 추천)
2. 프로젝트 설정 > 일반 > 내 앱 > 웹 앱 추가 → 설정값(firebaseConfig)을 복사
3. `js/firebase-config.js` 파일 안의 `여기에_...` 부분을 복사한 값으로 교체

## 2. 로그인 설정 (본인만 접근 가능하게)
1. Firebase 콘솔 > Authentication > Sign-in method > "이메일/비밀번호" 사용 설정
2. Authentication > Users > "사용자 추가" → 본인 이메일과 비밀번호를 **직접 1개만** 추가
   - 회원가입 화면은 만들지 않았어요. 아무나 못 들어오게 하기 위함이에요.

## 3. Firestore 데이터베이스 생성
1. Firebase 콘솔 > Firestore Database > 데이터베이스 만들기 (프로덕션 모드)
2. "규칙" 탭에서 아래 내용으로 교체 — **본인 계정 외에는 절대 데이터를 읽거나 쓸 수 없게** 막는 규칙입니다.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 4. 배포
끄적끄적/육삼레벨업과 동일하게 GitHub Pages로 배포하면 됩니다.
1. 새 GitHub 저장소 생성 (이 파일들을 그대로 업로드)
2. Settings > Pages > Branch를 main으로 설정
3. 발급된 주소로 접속 → 로그인 화면이 뜨면 정상 설치 완료

> 참고: 저장소가 public이어도, 위 2번(로그인 계정 1개만 존재) + 3번(Firestore 규칙) 두 가지가 실제 보안을 담당해요.
> 즉 URL을 남이 알아도 로그인 정보가 없으면 아무것도 볼 수 없고, 데이터도 못 건드립니다.

## 지금까지 만들어진 것 (1단계)
- 로그인 (본인 전용)
- 대시보드: 순자산, 이번 달 지출/저축, 카테고리 파이차트, 순자산 추이 그래프, "비서의 한마디"
- 내역 수동 입력 (수입/지출)
- 투자자산 + 통장 + 카드 스냅샷 관리 (수익률 자동계산)
- 예산(카테고리별) · 저축목표 · 순자산목표 설정
- 카테고리 직접 관리 (추가/삭제)

## 다음 단계 (2단계 예정) — 현대카드 PDF 자동분류
카드 PDF를 업로드하면 클로드가 가맹점명을 보고 카테고리를 자동으로 분류해주는 기능이에요.
다만 이 기능은 **Firebase Cloud Functions(서버 코드)** 가 하나 더 필요해요 — 클로드 API 키를 브라우저에 그대로 넣으면 누구나 개발자도구로 훔쳐볼 수 있어서, 반드시 서버 뒤편에 숨겨야 하기 때문이에요.
Cloud Functions 설정(Blaze 요금제 전환 필요 - 사용량 기반이라 개인 사용 시 거의 무료)까지 준비되시면 다음 단계로 이어서 만들어드릴게요.
