'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import type { Citation } from '@/core/types';
import { ChatMessage } from './components/ChatMessage';
import { IndexStatus } from './components/IndexStatus';

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

export default function ChatPage() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState('');
  const busy = status === 'submitted' || status === 'streaming';

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
        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            role={m.role === 'assistant' ? 'assistant' : 'user'}
            text={textOf(m)}
            citations={citationsOf(m)}
          />
        ))}
      </main>

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
