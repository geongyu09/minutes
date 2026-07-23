'use client';

import { useCallback, useEffect, useState } from 'react';
import { authClient, type Me, type ProjectSummary } from '@/authClient';
import {
  clearProjectId,
  clearSession,
  getAppToken,
  getProjectId,
  setAppToken,
  setProjectId,
} from '@/session';

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  /** 로그인됨. `projectId`가 null이면 아직 볼 프로젝트를 못 정한 상태(생성·참여 필요). */
  | { status: 'ready'; me: Me; projectId: string | null };

/** 저장된 선택이 아직 유효하면 그대로, 아니면 프로젝트가 하나뿐일 때만 자동 진입한다. */
function resolveProjectId(projects: ProjectSummary[]): string | null {
  const stored = getProjectId();
  if (stored && projects.some((p) => p.id === stored)) return stored;
  if (projects.length === 1) {
    setProjectId(projects[0].id);
    return projects[0].id;
  }
  if (stored) clearProjectId();
  return null;
}

/**
 * 앱의 세션 상태 — 로그인 여부와 현재 프로젝트를 한곳에서 관리한다.
 * 화면들은 이 상태만 보고 갈린다: 익명이면 로그인, 프로젝트 미선택이면 생성·참여, 그 외 채팅.
 */
export function useSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    if (!getAppToken()) {
      setState({ status: 'anonymous' });
      return;
    }
    try {
      const me = await authClient.getMe();
      // 앱 토큰이 폐기·만료됐다 — 남은 토큰을 붙들고 있어봐야 모든 요청이 401이다
      if (!me) {
        clearSession();
        setState({ status: 'anonymous' });
        return;
      }
      setState({ status: 'ready', me, projectId: resolveProjectId(me.projects) });
    } catch (err) {
      // 서버에 못 닿는 것은 로그아웃 사유가 아니다 — 토큰은 두고 로딩만 끝낸다
      console.error('[session]', err);
      setState({ status: 'anonymous' });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (appToken: string) => {
      setAppToken(appToken);
      await refresh();
    },
    [refresh]
  );

  const signOut = useCallback(async () => {
    await authClient.logout();
    clearSession();
    setState({ status: 'anonymous' });
  }, []);

  const selectProject = useCallback((projectId: string) => {
    setProjectId(projectId);
    setState((prev) => (prev.status === 'ready' ? { ...prev, projectId } : prev));
  }, []);

  return { state, refresh, signIn, signOut, selectProject };
}
