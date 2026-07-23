'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import type { Citation } from '@minutes/core';
import { createChatTransport, type PipelineStage } from '@/generation/chatTransport';
import { clearProjectId } from '@/session';
import { ChatMessage } from './components/ChatMessage';
import { IndexStatus } from './components/IndexStatus';
import { Login } from './components/Login';
import { NotionConnect } from './components/NotionConnect';
import { PendingIndicator } from './components/PendingIndicator';
import { ProjectGate } from './components/ProjectGate';
import { ProjectSettings } from './components/ProjectSettings';
import { useSession } from './useSession';

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function citationsOf(message: UIMessage): Citation[] {
  const part = message.parts.find((p) => p.type === 'data-citations');
  return part && 'data' in part ? (part.data as Citation[]) : [];
}

function stageOf(message: UIMessage | undefined): PipelineStage | null {
  if (!message || message.role !== 'assistant') return null;
  const parts = message.parts.filter((p) => p.type === 'data-stage');
  const last = parts[parts.length - 1];
  return last && 'data' in last ? (last.data as PipelineStage) : null;
}

export default function ChatPage() {
  const { state, refresh, signIn, signOut, selectProject } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 생성 파이프라인은 서버가 아니라 웹뷰 안에서 실행된다 (Tauri 정적 export)
  const [transport] = useState(() => createChatTransport());
  const { messages, sendMessage, status, error } = useChat({
    transport,
    // 생성 파이프라인 실패를 조용히 삼키면 "답변이 없다"로만 보인다
    onError: (e) => console.error('[chat]', e),
  });
  const [input, setInput] = useState('');
  const busy = status === 'submitted' || status === 'streaming';
  // 답변 텍스트가 도착하기 전까지만 대기 표시를 보여준다 (도착 후엔 스트리밍 자체가 피드백)
  const last = messages[messages.length - 1];
  const waiting = busy && (last?.role !== 'assistant' || textOf(last) === '');

  // 새 질문이 전송되면 그 메시지가 화면 최상단(헤더 아래)에 오도록 스크롤한다
  const lastUserId = [...messages].reverse().find((m) => m.role === 'user')?.id;
  useEffect(() => {
    if (!lastUserId) return;
    document.getElementById(`msg-${lastUserId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [lastUserId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput('');
  };

  if (state.status === 'loading') return <div className="container" />;

  if (state.status === 'anonymous') {
    return (
      <div className="container">
        <Login onSignedIn={signIn} />
      </div>
    );
  }

  // 로그인은 됐지만 볼 프로젝트가 없다 — 만들거나 초대 코드로 참여한다
  if (!state.projectId) {
    return (
      <div className="container">
        <ProjectGate
          projects={state.me.projects}
          onEntered={async (projectId) => {
            await refresh();
            selectProject(projectId);
          }}
        />
      </div>
    );
  }

  const project = state.me.projects.find((p) => p.id === state.projectId);
  const isOwner = project?.role === 'owner';

  return (
    <div className="container">
      <header className="header">
        <h1>minutes</h1>

        {state.me.projects.length > 1 ? (
          <select value={state.projectId} onChange={(e) => selectProject(e.target.value)}>
            {state.me.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="project-name">{project?.name}</span>
        )}

        <NotionConnect projectId={state.projectId} canConnect={!!isOwner} onConnected={refresh} />
        <IndexStatus projectId={state.projectId} canReindex={!!isOwner} />
        <button onClick={() => setSettingsOpen((open) => !open)}>설정</button>
        <button onClick={signOut}>로그아웃</button>
      </header>

      {settingsOpen && project && (
        <ProjectSettings
          projectId={project.id}
          projectName={project.name}
          myUserId={state.me.user.id}
          onClose={() => setSettingsOpen(false)}
          onConnected={refresh}
          onDeleted={async () => {
            setSettingsOpen(false);
            clearProjectId();
            await refresh();
          }}
        />
      )}

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty">
            회의록에 대해 물어보세요.
            <br />
            예: &ldquo;로그인 방식은 뭘로 정했지?&rdquo;
          </div>
        )}
        {messages.map((m) => {
          // 텍스트가 아직 없는 어시스턴트 메시지는 대기 표시가 그 자리를 대신한다
          if (m.role === 'assistant' && textOf(m) === '' && waiting) return null;
          return (
            <ChatMessage
              key={m.id}
              id={`msg-${m.id}`}
              role={m.role === 'assistant' ? 'assistant' : 'user'}
              text={textOf(m)}
              citations={citationsOf(m)}
            />
          );
        })}
        {waiting && <PendingIndicator stage={stageOf(last)} />}
        {/* 아래 내용이 짧아도 마지막 질문을 최상단까지 끌어올릴 수 있게 하는 여백 */}
        {messages.length > 0 && <div className="messages-tail" aria-hidden="true" />}
      </main>

      {error && <div className="error">답변 생성 실패: {error.message}</div>}

      <form className="input-row" onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="질문을 입력하세요"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          전송
        </button>
      </form>
    </div>
  );
}
