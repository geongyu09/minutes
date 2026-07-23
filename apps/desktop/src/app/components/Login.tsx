'use client';

import { useRef, useState } from 'react';
import { authClient } from '@/authClient';
import { config } from '@/config';
import { openExternal } from '@/openExternal';

type State =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'error'; message: string };

const POLL_TIMEOUT_MS = 3 * 60_000; // 사용자가 노션 인가 화면에서 머무는 시간 여유

/**
 * "노션으로 로그인" — 브라우저로 노션 인가를 열고, 폴링으로 앱 토큰을 수령한다.
 * 로그인 인가에서 고른 페이지는 색인에 사용되지 않는다 (색인 범위는 프로젝트 연결에서 따로 고른다).
 */
export function Login({ onSignedIn }: { onSignedIn: (appToken: string) => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const running = useRef(false);

  const signIn = async () => {
    if (running.current) return;
    running.current = true;
    setState({ kind: 'waiting' });

    try {
      const { pollToken, authUrl } = await authClient.startLogin();
      await openExternal(authUrl);

      const startedAt = Date.now();
      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, config.indexing.pollIntervalMs));
        const status = await authClient.pollLogin(pollToken);
        if (status.authorized && status.appToken) {
          onSignedIn(status.appToken);
          return;
        }
      }
      setState({ kind: 'error', message: '로그인이 완료되지 않았습니다. 다시 시도해주세요.' });
    } catch (err) {
      // 원인을 감추면 디버깅이 불가능하다 — 콘솔과 화면 양쪽에 남긴다
      console.error('[login]', err);
      const cause = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message: `로그인에 실패했습니다: ${cause}` });
    } finally {
      running.current = false;
    }
  };

  return (
    <div className="gate">
      <h2>minutes</h2>
      <p className="gate-lead">노션 계정으로 로그인하면 팀의 회의록에 질문할 수 있습니다.</p>

      <button className="primary" onClick={signIn} disabled={state.kind === 'waiting'}>
        {state.kind === 'waiting' ? '노션에서 승인 대기 중…' : '노션으로 로그인'}
      </button>

      {state.kind === 'waiting' && (
        <p className="gate-hint">
          노션 승인 화면에서는 <strong>아무 페이지나 선택해도 됩니다</strong> — 로그인 확인에만
          쓰이고 색인에는 사용되지 않습니다.
        </p>
      )}
      {state.kind === 'error' && <p className="error">{state.message}</p>}
    </div>
  );
}
