'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import type { Citation } from '@minutes/core';
import { createChatTransport, type PipelineStage } from '@/generation/chatTransport';
import { ChatMessage } from './components/ChatMessage';
import { IndexStatus } from './components/IndexStatus';
import { NotionConnect } from './components/NotionConnect';
import { PendingIndicator } from './components/PendingIndicator';

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

  return (
    <div className="container">
      <header className="header">
        <h1>minutes</h1>
        <NotionConnect />
        <IndexStatus />
      </header>

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
