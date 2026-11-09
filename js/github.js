// 앱 안 [지금 업데이트] 버튼: GitHub Actions 작업을 대신 실행해요 (Run workflow를 누르는 것과 같아요).
// 토큰은 사용자 Firestore(users/{uid}/data/secrets)에만 저장하고, 공개 코드에는 넣지 않아요.

const FALLBACK = { owner: 'aprikotseed-cyber', repo: 'chgokchgok' };

/** 사이트 주소(owner.github.io/repo/)에서 저장소 알아내기 */
export function repoFromLocation(loc) {
  const m = String(loc?.hostname || '').match(/^([^.]+)\.github\.io$/i);
  const repo = String(loc?.pathname || '').split('/').filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo } : FALLBACK;
}

export const WORKFLOWS = {
  quotes: { file: 'quotes.yml', label: '주가·환율' },
  full: { file: 'update-market.yml', label: '주가·환율·주택 실거래가' },
};

/** 작업 실행 요청. 성공하면 true, 실패하면 알기 쉬운 오류 */
export async function dispatchWorkflow({ owner, repo }, token, file, fetchImpl = fetch) {
  if (!token) throw new Error('먼저 설정에서 GitHub 토큰을 넣어 주세요');
  let res;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${file}/dispatches`, {
      method: 'POST',
      // 브라우저에서 바로 부르므로 GitHub이 허용하는 기본 헤더만 써요
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
  } catch {
    throw new Error('GitHub에 연결하지 못했어요. 인터넷 연결을 확인해 주세요');
  }
  if (res.status === 204) return true;
  if (res.status === 401) throw new Error('토큰이 맞지 않거나 만료됐어요. 설정에서 새 토큰을 넣어 주세요');
  if (res.status === 403 || res.status === 404) throw new Error('토큰에 이 저장소의 Actions 실행 권한이 없어요 (Actions: Read and write)');
  if (res.status === 422) throw new Error('업데이트 작업을 찾지 못했어요. 최신 버전이 반영됐는지 확인해 주세요');
  throw new Error(`GitHub 오류 (${res.status})`);
}
