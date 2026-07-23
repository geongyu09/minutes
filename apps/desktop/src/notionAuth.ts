/**
 * 프로젝트의 색인용 노션 연결(OAuth) 클라이언트 — owner만 호출할 수 있다.
 * 로그인용 노션 인가는 별도다(`authClient.ts`) — 목적과 페이지 선택 범위가 다르다.
 */
import { config } from '@/config';
import { serverFetch } from '@/serverFetch';
import { getAppToken } from '@/session';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ConnectionStatus {
  connected: boolean;
  /** 인가 URL을 열어둔 상태 — 연결(또는 연결 변경) 완료 폴링의 종료 조건이다. */
  reconnecting?: boolean;
  workspaceName?: string;
}

export interface NotionAuthClient {
  /** 연결 시작. 이미 연결된 프로젝트에서 부르면 연결 변경이 된다. */
  startConnect(projectId: string): Promise<string>;
  /** 연결 완료 폴링. */
  getStatus(projectId: string): Promise<ConnectionStatus>;
  /** 승인 대기 취소 — 진행 중인 인가만 버리고 기존 연결은 그대로 둔다. */
  cancel(projectId: string): Promise<void>;
}

export function createNotionAuthClient(
  baseUrl: string,
  fetchFn: FetchLike = serverFetch,
  getToken: () => string | null = getAppToken
): NotionAuthClient {
  const scoped = (path: string, projectId: string): string =>
    `${baseUrl}${path}?projectId=${encodeURIComponent(projectId)}`;

  const headers = (): Record<string, string> => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  return {
    async startConnect(projectId) {
      const res = await fetchFn(scoped('/oauth/notion/session', projectId), {
        method: 'POST',
        headers: headers(),
      });
      if (!res.ok) throw new Error(`노션 연결 시작 실패 (${res.status})`);
      const body = (await res.json()) as { authUrl: string };
      return body.authUrl;
    },

    async getStatus(projectId) {
      const res = await fetchFn(scoped('/oauth/notion/status', projectId), { headers: headers() });
      if (!res.ok) throw new Error(`연결 상태 조회 실패 (${res.status})`);
      return (await res.json()) as ConnectionStatus;
    },

    async cancel(projectId) {
      const res = await fetchFn(scoped('/oauth/notion/cancel', projectId), {
        method: 'POST',
        headers: headers(),
      });
      if (!res.ok) throw new Error(`연결 취소 실패 (${res.status})`);
    },
  };
}

export const notionAuthClient = createNotionAuthClient(config.server.baseUrl);
