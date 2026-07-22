import type { Citation } from '@minutes/core';
import { SourceCard } from './SourceCard';

/** 답변 본문의 [출처 N] 표기를 클릭 가능한 링크로 렌더링한다. */
function renderWithCitations(text: string, citations: Citation[]) {
  return text.split(/(\[출처\s*\d+\])/).map((part, i) => {
    const match = /\[출처\s*(\d+)\]/.exec(part);
    if (!match) return <span key={i}>{part}</span>;

    const citation = citations.find((c) => c.number === Number(match[1]));
    if (!citation) return <span key={i}>{part}</span>;

    return (
      <a
        key={i}
        href={citation.documentUrl}
        target="_blank"
        rel="noreferrer"
        className="citation-link"
        title={citation.documentTitle}
      >
        {part}
      </a>
    );
  });
}

interface Props {
  role: 'user' | 'assistant';
  text: string;
  citations: Citation[];
  /** 전송 시 자동 스크롤의 대상이 되도록 DOM id를 부여한다 */
  id?: string;
}

export function ChatMessage({ role, text, citations, id }: Props) {
  return (
    <div id={id} className={`message ${role}`}>
      {role === 'assistant' ? renderWithCitations(text, citations) : text}
      {role === 'assistant' && citations.length > 0 && (
        <div className="sources">
          {citations.map((c) => (
            <SourceCard key={c.number} citation={c} />
          ))}
        </div>
      )}
    </div>
  );
}
