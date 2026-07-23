/**
 * 로그인("노션으로 로그인") 클라이언트.
 * 서버가 발급한 앱 토큰이 이후 모든 요청의 Bearer 인증이 된다 — 앱 토큰은 사용자에 귀속된다.
 */
import { config } from '@/config';
import { serverFetch } from '@/serverFetch';
import { getAppToken } from '@/session';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface LoginSession {
  pollToken: string;
  authUrl: string;
}

export interface LoginStatus {
  authorized: boolean;
  /** 인가가 끝났을 때만 내려온다. 일회성이므로 즉시 저장해야 한다. */
  appToken?: string;
}

export interface Account {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  role: 'owner' | 'member';
  connected: boolean;
  workspaceName?: string;
}

export interface Me {
  user: Account;
  projects: ProjectSummary[];
}

export interface AuthClient {
  startLogin(): Promise<LoginSession>;
  pollLogin(pollToken: string): Promise<LoginStatus>;
  /** 앱 토큰이 더 이상 유효하지 않으면 null — 앱은 로그인 화면으로 되돌아간다. */
  getMe(): Promise<Me | null>;
  logout(): Promise<void>;
}

export function createAuthClient(
  baseUrl: string,
  fetchFn: FetchLike = serverFetch,
  getToken: () => string | null = getAppToken
): AuthClient {
  const authHeader = (): Record<string, string> => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  return {
    async startLogin() {
      const res = await fetchFn(`${baseUrl}/auth/notion/session`, { method: 'POST' });
      if (!res.ok) throw new Error(`로그인 시작 실패 (${res.status})`);
      return (await res.json()) as LoginSession;
    },

    async pollLogin(pollToken) {
      const res = await fetchFn(`${baseUrl}/auth/notion/status`, {
        headers: { authorization: `Bearer ${pollToken}` },
      });
      if (!res.ok) throw new Error(`로그인 상태 조회 실패 (${res.status})`);
      return (await res.json()) as LoginStatus;
    },

    async getMe() {
      const res = await fetchFn(`${baseUrl}/me`, { headers: authHeader() });
      // 401은 오류가 아니라 "다시 로그인해야 한다"는 정상 흐름이다
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`계정 조회 실패 (${res.status})`);
      return (await res.json()) as Me;
    },

    async logout() {
      try {
        await fetchFn(`${baseUrl}/auth/logout`, { method: 'POST', headers: authHeader() });
      } catch (err) {
        // 서버에 못 닿아도 앱은 로컬 토큰을 버린다 — 로그아웃을 막을 이유가 없다
        console.error('[auth] 로그아웃 요청 실패', err);
      }
    },
  };
}

export const authClient = createAuthClient(config.server.baseUrl);
