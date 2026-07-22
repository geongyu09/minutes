import type { Citation } from '@/core/types';

export function SourceCard({ citation }: { citation: Citation }) {
  return (
    <a className="source-card" href={citation.documentUrl} target="_blank" rel="noreferrer">
      <div>
        [출처 {citation.number}] {citation.documentTitle}
      </div>
      {citation.headingPath.length > 0 && (
        <div className="path">{citation.headingPath.join(' > ')}</div>
      )}
    </a>
  );
}
