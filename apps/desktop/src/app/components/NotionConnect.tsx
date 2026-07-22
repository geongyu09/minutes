'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAppToken, notionAuthClient, setAppToken } from '@/notionAuth';
import { openExternal } from '@/openExternal';

type ConnectState =
  | { kind: 'loading' }
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected'; workspaceName?: string }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 3 * 60_000; // 사용자가 노션 인가 화면에서 머무는 시간 여유

/** 노션 워크스페이스 연결 버튼 + 연결 상태 표시. */
export function NotionConnect() {
  const [state, setState] = useState<ConnectState>({ kind: 'loading' });
  const polling = useRef(false);

  const refresh = useCallback(async () => {
    const token = getAppToken();
    if (!token) {
      setState({ kind: 'disconnected' });
      return;
    }
    try {
      const status = await notionAuthClient.getStatus(token);
      setState(
        status.connected
          ? { kind: 'connected', workspaceName: status.workspaceName }
          : { kind: 'disconnected' }
      );
    } catch {
      // 서버에 못 닿으면 연결 안 된 것으로 표시 — 채팅 자체는 서버 복구 후 동작한다
      setState({ kind: 'disconnected' });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = async () => {
    if (polling.current) return;
    setState({ kind: 'connecting' });
    try {
      const session = await notionAuthClient.startSession();
      setAppToken(session.appToken);
      await openExternal(session.authUrl);

      polling.current = true;
      const startedAt = Date.now();
      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const status = await notionAuthClient.getStatus(session.appToken);
        if (status.connected) {
          setState({ kind: 'connected', workspaceName: status.workspaceName });
          return;
        }
      }
      setState({ kind: 'error', message: '연결이 완료되지 않았습니다. 다시 시도해주세요.' });
    } catch {
      setState({ kind: 'error', message: '노션 연결에 실패했습니다. 서버 상태를 확인해주세요.' });
    } finally {
      polling.current = false;
    }
  };

  if (state.kind === 'loading') return null;

  if (state.kind === 'connected') {
    return (
      <span className="notion-connect connected">
        노션 연결됨{state.workspaceName ? ` · ${state.workspaceName}` : ''}
      </span>
    );
  }

  return (
    <span className="notion-connect">
      {state.kind === 'error' && <span className="error">{state.message}</span>}
      <button onClick={connect} disabled={state.kind === 'connecting'}>
        {state.kind === 'connecting' ? '노션에서 승인 대기 중…' : '노션 연결'}
      </button>
    </span>
  );
}
