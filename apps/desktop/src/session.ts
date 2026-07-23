/**
 * 앱의 세션 상태 — 앱 토큰(누구인가)과 현재 프로젝트(무엇을 보는가).
 * 서버 요청은 모두 `Authorization: Bearer <앱 토큰>` + `projectId`로 스코프된다.
 */
const APP_TOKEN_KEY = 'minutes.appToken';
const PROJECT_ID_KEY = 'minutes.projectId';

function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
}

export function getAppToken(): string | null {
  return read(APP_TOKEN_KEY);
}

export function setAppToken(token: string): void {
  window.localStorage.setItem(APP_TOKEN_KEY, token);
}

/** 로그아웃 — 토큰과 함께 보고 있던 프로젝트도 잊는다. */
export function clearSession(): void {
  window.localStorage.removeItem(APP_TOKEN_KEY);
  window.localStorage.removeItem(PROJECT_ID_KEY);
}

export function getProjectId(): string | null {
  return read(PROJECT_ID_KEY);
}

export function setProjectId(projectId: string): void {
  window.localStorage.setItem(PROJECT_ID_KEY, projectId);
}

export function clearProjectId(): void {
  window.localStorage.removeItem(PROJECT_ID_KEY);
}

/** 저장된 앱 토큰이 있으면 Bearer 헤더를 만든다. */
export function authHeaders(): Record<string, string> {
  const token = getAppToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
