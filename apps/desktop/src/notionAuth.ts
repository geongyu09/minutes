/**
 * 노션 연결(OAuth) 클라이언트 — 서버가 발급한 앱 토큰으로 자신(사용자)을 증명한다.
 * 앱 토큰은 localStorage에 보관하고, 모든 서버 요청의 Bearer 헤더로 쓴다.
 */
import { config } from '@/config';
import { serverFetch } from '@/serverFetch';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const APP_TOKEN_KEY = 'minutes.appToken';

export function getAppToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(APP_TOKEN_KEY);
}

export function setAppToken(token: string): void {
  window.localStorage.setItem(APP_TOKEN_KEY, token);
}

/** 저장된 앱 토큰이 있으면 Bearer 헤더를 만든다. */
export function authHeaders(): Record<string, string> {
  const token = getAppToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export interface ConnectSession {
  appToken: string;
  authUrl: string;
}

export interface ConnectionStatus {
  connected: boolean;
  /** 인가 URL을 열어둔 상태 — 연결(또는 연결 변경) 완료 폴링의 종료 조건이다. */
  reconnecting?: boolean;
  workspaceName?: string;
}

export interface NotionAuthClient {
  /** 연결 시작 — 서버가 앱 토큰과 노션 인가 URL을 발급한다. */
  startSession(): Promise<ConnectSession>;
  /** 연결 변경 — 앱 토큰은 그대로 두고 새 인가 URL만 받는다. */
  startReconnect(appToken: string): Promise<string>;
  /** 연결 완료 폴링. */
  getStatus(appToken: string): Promise<ConnectionStatus>;
  /** 승인 대기 취소 — 진행 중인 인가만 버리고 기존 연결은 그대로 둔다. */
  cancel(appToken: string): Promise<void>;
}

export function createNotionAuthClient(
  baseUrl: string,
  fetchFn: FetchLike = serverFetch
): NotionAuthClient {
  return {
    async startSession() {
      const res = await fetchFn(`${baseUrl}/oauth/notion/session`, { method: 'POST' });
      if (!res.ok) throw new Error(`노션 연결 시작 실패 (${res.status})`);
      return (await res.json()) as ConnectSession;
    },

    async startReconnect(appToken) {
      const res = await fetchFn(`${baseUrl}/oauth/notion/reconnect`, {
        method: 'POST',
        headers: { authorization: `Bearer ${appToken}` },
      });
      if (!res.ok) throw new Error(`노션 연결 변경 시작 실패 (${res.status})`);
      const body = (await res.json()) as { authUrl: string };
      return body.authUrl;
    },

    async getStatus(appToken) {
      const res = await fetchFn(`${baseUrl}/oauth/notion/status`, {
        headers: { authorization: `Bearer ${appToken}` },
      });
      if (!res.ok) throw new Error(`연결 상태 조회 실패 (${res.status})`);
      return (await res.json()) as ConnectionStatus;
    },

    async cancel(appToken) {
      const res = await fetchFn(`${baseUrl}/oauth/notion/cancel`, {
        method: 'POST',
        headers: { authorization: `Bearer ${appToken}` },
      });
      if (!res.ok) throw new Error(`연결 취소 실패 (${res.status})`);
    },
  };
}

export const notionAuthClient = createNotionAuthClient(config.server.baseUrl);
