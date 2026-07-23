/**
 * 프로젝트·초대 클라이언트. 프로젝트는 공유의 단위이며,
 * owner만 노션 연결·색인·초대·멤버 관리를 할 수 있다 (서버가 멤버십으로 강제한다).
 */
import { config } from '@/config';
import { serverFetch } from '@/serverFetch';
import { getAppToken } from '@/session';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface Project {
  id: string;
  name: string;
}

export interface Invite {
  code: string;
  expiresAt: string;
}

export interface Member {
  userId: string;
  role: 'owner' | 'member';
  name?: string;
  email?: string;
}

export interface ProjectDetail {
  role: 'owner' | 'member';
  members: Member[];
  /** owner에게만 내려온다. */
  invites?: Invite[];
}

export interface ProjectClient {
  create(name: string): Promise<Project>;
  get(projectId: string): Promise<ProjectDetail>;
  remove(projectId: string): Promise<void>;
  createInvite(projectId: string): Promise<Invite>;
  revokeInvite(projectId: string, code: string): Promise<void>;
  /** 참여한 프로젝트 ID. 실패 이유는 서버가 하나로 뭉뚱그려 내려준다. */
  acceptInvite(code: string): Promise<string>;
  removeMember(projectId: string, userId: string): Promise<void>;
}

export function createProjectClient(
  baseUrl: string,
  fetchFn: FetchLike = serverFetch,
  getToken: () => string | null = getAppToken
): ProjectClient {
  const headers = (json = false): Record<string, string> => {
    const token = getToken();
    return {
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  };

  /** 서버가 내려준 오류 메시지를 그대로 사용자에게 보여준다 — 원인을 감추지 않는다. */
  const parse = async <T>(res: Response): Promise<T> => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body as { error?: string }).error ?? `요청 실패 (${res.status})`);
    }
    return body as T;
  };

  const send = async (url: string, init: RequestInit): Promise<void> => {
    await parse(await fetchFn(url, init));
  };

  return {
    async create(name) {
      const res = await fetchFn(`${baseUrl}/projects`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ name }),
      });
      return (await parse<{ project: Project }>(res)).project;
    },

    async get(projectId) {
      const res = await fetchFn(`${baseUrl}/projects/${encodeURIComponent(projectId)}`, {
        headers: headers(),
      });
      return parse<ProjectDetail>(res);
    },

    remove(projectId) {
      return send(`${baseUrl}/projects/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        headers: headers(),
      });
    },

    async createInvite(projectId) {
      const res = await fetchFn(`${baseUrl}/projects/${encodeURIComponent(projectId)}/invites`, {
        method: 'POST',
        headers: headers(),
      });
      return (await parse<{ invite: Invite }>(res)).invite;
    },

    revokeInvite(projectId, code) {
      return send(
        `${baseUrl}/projects/${encodeURIComponent(projectId)}/invites/${encodeURIComponent(code)}`,
        { method: 'DELETE', headers: headers() }
      );
    },

    async acceptInvite(code) {
      const res = await fetchFn(`${baseUrl}/invites/accept`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ code }),
      });
      return (await parse<{ projectId: string }>(res)).projectId;
    },

    removeMember(projectId, userId) {
      return send(
        `${baseUrl}/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE', headers: headers() }
      );
    },
  };
}

export const projectClient = createProjectClient(config.server.baseUrl);
