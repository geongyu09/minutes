import { config } from '@/config';
import { serverFetch } from '@/serverFetch';
import { getAppToken } from '@/notionAuth';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** 서버 색인 결과 — apps/server의 IndexingResult와 필드를 맞춘다. */
export interface ReindexResult {
  mode: 'full' | 'incremental';
  total: number;
  indexed: number;
  failed: number;
  deleted: number;
  /** 쿼터 초과·인증 만료 등으로 중단됨 — 서버가 커서를 전진시키지 않았다 */
  aborted?: { reason: 'rate_limit' | 'unauthorized'; message: string };
}

/** 서버 색인 잡 상태 — apps/server의 IndexJobState와 필드를 맞춘다. */
export type IndexJob =
  | { status: 'idle' }
  | { status: 'running'; mode: 'full' | 'incremental'; indexed: number; total: number }
  | { status: 'done'; result: ReindexResult; finishedAt: string }
  | { status: 'failed'; error: string; finishedAt: string };

export interface IndexClient {
  /** 색인을 시작한다. 이미 실행 중이면(409) 그 잡 상태를 그대로 반환한다. */
  startReindex(mode: 'full' | 'incremental'): Promise<IndexJob>;
  getIndexJob(): Promise<IndexJob>;
}

/** 중앙 서버 /index HTTP 클라이언트 — 앱 토큰(Bearer)으로 사용자를 증명한다. */
export function createIndexClient(
  baseUrl: string,
  fetchFn: FetchLike = serverFetch,
  getToken: () => string | null = getAppToken
): IndexClient {
  const headers = (): Record<string, string> => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const parseJob = async (res: Response, okStatuses: number[]): Promise<IndexJob> => {
    if (!okStatuses.includes(res.status)) {
      throw new Error(`색인 서버 오류 (${res.status}): ${await res.text()}`);
    }
    const { job } = (await res.json()) as { job: IndexJob };
    return job;
  };

  return {
    async startReindex(mode) {
      const res = await fetchFn(`${baseUrl}/index?mode=${mode}`, {
        method: 'POST',
        headers: headers(),
      });
      // 409(이미 실행 중)도 정상 흐름 — 진행 중인 잡을 이어서 보여주면 된다
      return parseJob(res, [202, 409]);
    },

    async getIndexJob() {
      const res = await fetchFn(`${baseUrl}/index/status`, { headers: headers() });
      return parseJob(res, [200]);
    },
  };
}

export const indexClient = createIndexClient(config.server.baseUrl);
