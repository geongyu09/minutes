'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAppToken, notionAuthClient, setAppToken } from '@/notionAuth';
import { openExternal } from '@/openExternal';
import { PageSelectionNotice } from './PageSelectionNotice';

type ConnectState =
  | { kind: 'loading' }
  | { kind: 'disconnected' }
  // 연결 변경 중에도 기존 워크스페이스는 살아 있으므로 이름을 계속 보여준다
  | { kind: 'connecting'; workspaceName?: string }
  | { kind: 'connected'; workspaceName?: string }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 3 * 60_000; // 사용자가 노션 인가 화면에서 머무는 시간 여유

/** 노션 워크스페이스 연결 버튼 + 연결 상태 표시. */
export function NotionConnect() {
  const [state, setState] = useState<ConnectState>({ kind: 'loading' });
  const polling = useRef(false);
  // 취소 요청 — 폴링 루프가 다음 회차에서 이 값을 보고 스스로 멈춘다
  const cancelled = useRef(false);

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

  /**
   * 인가 화면을 열고 완료될 때까지 폴링한다.
   * 연결 변경은 같은 워크스페이스를 다시 고를 수 있어 이름 변화로 완료를 알 수 없으므로,
   * 서버가 내려주는 `reconnecting`(인가 진행 중 여부)이 꺼지는 것을 완료 신호로 쓴다.
   */
  const runAuthFlow = async (
    start: () => Promise<{ appToken: string; authUrl: string }>,
    previousWorkspaceName?: string
  ) => {
    if (polling.current) return;
    cancelled.current = false;
    setState({ kind: 'connecting', workspaceName: previousWorkspaceName });
    try {
      const { appToken, authUrl } = await start();
      await openExternal(authUrl);

      polling.current = true;
      const startedAt = Date.now();
      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        // 취소 화면 상태는 cancel()이 이미 되돌렸으므로 여기서는 조용히 빠져나간다
        if (cancelled.current) return;
        const status = await notionAuthClient.getStatus(appToken);
        if (status.connected && !status.reconnecting) {
          setState({ kind: 'connected', workspaceName: status.workspaceName });
          return;
        }
      }
      setState({ kind: 'error', message: '연결이 완료되지 않았습니다. 다시 시도해주세요.' });
    } catch (err) {
      // 원인을 감추면 디버깅이 불가능하다 — 콘솔과 화면 양쪽에 남긴다
      console.error('[notion-connect]', err);
      const cause = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message: `노션 연결에 실패했습니다: ${cause}` });
    } finally {
      polling.current = false;
    }
  };

  const connect = () =>
    runAuthFlow(async () => {
      const session = await notionAuthClient.startSession();
      setAppToken(session.appToken);
      return session;
    });

  /** 연결 변경 — 앱 토큰은 그대로 두고 인가만 다시 받는다. 중도 포기하면 기존 연결이 유지된다. */
  const reconnect = (workspaceName?: string) =>
    runAuthFlow(async () => {
      const appToken = getAppToken();
      if (!appToken) throw new Error('앱 토큰이 없습니다');
      return { appToken, authUrl: await notionAuthClient.startReconnect(appToken) };
    }, workspaceName);

  /**
   * 승인 대기 취소 — 서버의 진행 중인 인가를 버리고 취소 직전 상태로 되돌린다.
   * 연결 변경 중이었다면 기존 워크스페이스가 그대로 남는다.
   */
  const cancel = async (previousWorkspaceName?: string) => {
    cancelled.current = true;
    setState(
      previousWorkspaceName
        ? { kind: 'connected', workspaceName: previousWorkspaceName }
        : { kind: 'disconnected' }
    );
    const appToken = getAppToken();
    if (!appToken) return;
    try {
      await notionAuthClient.cancel(appToken);
    } catch (err) {
      // 서버에 못 닿아도 화면은 이미 되돌렸다 — 남은 state는 서버가 수명으로 정리한다
      console.error('[notion-connect] 취소 실패', err);
    }
  };

  if (state.kind === 'loading') return null;

  if (state.kind === 'connected') {
    return (
      <span className="notion-connect connected">
        노션 연결됨{state.workspaceName ? ` · ${state.workspaceName}` : ''}
        <button onClick={() => reconnect(state.workspaceName)}>연결 변경</button>
      </span>
    );
  }

  // 연결 변경 중이면 기존 워크스페이스가 아직 살아 있다는 것을 보여준다
  if (state.kind === 'connecting' && state.workspaceName) {
    return (
      <span className="notion-connect connected">
        노션 연결됨 · {state.workspaceName}
        <button disabled>노션에서 승인 대기 중…</button>
        <button onClick={() => cancel(state.workspaceName)}>취소</button>
        <PageSelectionNotice />
      </span>
    );
  }

  return (
    <span className="notion-connect">
      {state.kind === 'error' && <span className="error">{state.message}</span>}
      <button onClick={connect} disabled={state.kind === 'connecting'}>
        {state.kind === 'connecting' ? '노션에서 승인 대기 중…' : '노션 연결'}
      </button>
      {state.kind === 'connecting' && <button onClick={() => cancel()}>취소</button>}
      {state.kind === 'connecting' && <PageSelectionNotice />}
    </span>
  );
}
