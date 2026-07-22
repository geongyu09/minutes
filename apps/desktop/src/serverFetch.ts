/**
 * 중앙 서버 호출용 fetch.
 * Tauri 웹뷰에서는 plugin-http(네이티브 fetch)를 써서 CORS를 우회하고,
 * 일반 브라우저(next dev 단독 실행)에서는 표준 fetch로 동작한다.
 */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const serverFetch: FetchLike = async (url, init) => {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, init);
  }
  return fetch(url, init);
};
