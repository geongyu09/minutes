import { describe, expect, it } from 'vitest';
import { createProjectClient } from './projectClient';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function capturing(response: Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  };
  return { calls, fetchFn };
}

describe('createProjectClient', () => {
  it('프로젝트를 만든다', async () => {
    const { calls, fetchFn } = capturing(jsonResponse({ project: { id: 'p-1', name: '팀 회의록' } }, 201));
    const client = createProjectClient('http://server:8787', fetchFn, () => 'app-token');

    const project = await client.create('팀 회의록');

    expect(calls[0].url).toBe('http://server:8787/projects');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: '팀 회의록' });
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer app-token');
    expect(project.id).toBe('p-1');
  });

  it('프로젝트 상세(멤버·초대 코드)를 가져온다', async () => {
    const { calls, fetchFn } = capturing(
      jsonResponse({ role: 'owner', members: [{ userId: 'u-1', role: 'owner' }], invites: [] })
    );
    const client = createProjectClient('http://server:8787', fetchFn, () => 'app-token');

    const detail = await client.get('p-1');

    expect(calls[0].url).toBe('http://server:8787/projects/p-1');
    expect(detail.role).toBe('owner');
  });

  it('초대 코드를 만든다', async () => {
    const { calls, fetchFn } = capturing(
      jsonResponse({ invite: { code: 'inv-1', expiresAt: '2026-08-01T00:00:00.000Z' } }, 201)
    );
    const client = createProjectClient('http://server:8787', fetchFn, () => 'app-token');

    const invite = await client.createInvite('p-1');

    expect(calls[0].url).toBe('http://server:8787/projects/p-1/invites');
    expect(calls[0].init?.method).toBe('POST');
    expect(invite.code).toBe('inv-1');
  });

  it('초대 코드를 폐기한다', async () => {
    const { calls, fetchFn } = capturing(jsonResponse({ revoked: true }));
    const client = createProjectClient('http://server:8787', fetchFn, () => 'app-token');

    await client.revokeInvite('p-1', 'inv/1');

    // 코드에 URL에서 의미를 갖는 문자가 있어도 경로가 깨지지 않아야 한다
    expect(calls[0].url).toBe('http://server:8787/projects/p-1/invites/inv%2F1');
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('초대 코드로 참여하면 프로젝트 ID를 돌려준다', async () => {
    const { calls, fetchFn } = capturing(jsonResponse({ projectId: 'p-1' }));
    const client = createProjectClient('http://server:8787', fetchFn, () => 'app-token');

    expect(await client.acceptInvite('inv-1')).toBe('p-1');
    expect(calls[0].url).toBe('http://server:8787/invites/accept');
  });

  it('유효하지 않은 초대 코드는 서버 메시지를 그대로 전한다', async () => {
    const { fetchFn } = capturing(jsonResponse({ error: '유효하지 않은 초대 코드입니다' }, 404));
    const client = createProjectClient('http://server:8787', fetchFn, () => 'app-token');

    await expect(client.acceptInvite('틀림')).rejects.toThrow('유효하지 않은 초대 코드입니다');
  });

  it('멤버를 내보낸다', async () => {
    const { calls, fetchFn } = capturing(jsonResponse({ removed: true }));
    const client = createProjectClient('http://server:8787', fetchFn, () => 'app-token');

    await client.removeMember('p-1', 'u-2');

    expect(calls[0].url).toBe('http://server:8787/projects/p-1/members/u-2');
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('프로젝트를 삭제한다', async () => {
    const { calls, fetchFn } = capturing(jsonResponse({ deleted: true }));
    const client = createProjectClient('http://server:8787', fetchFn, () => 'app-token');

    await client.remove('p-1');

    expect(calls[0].url).toBe('http://server:8787/projects/p-1');
    expect(calls[0].init?.method).toBe('DELETE');
  });
});
