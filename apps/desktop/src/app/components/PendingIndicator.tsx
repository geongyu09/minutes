import type { PipelineStage } from '@/generation/chatTransport';

interface Props {
  stage: PipelineStage | null;
}

function labelOf(stage: PipelineStage | null): string {
  switch (stage?.stage) {
    case 'rewriting':
      return '질문을 정리하고 있어요';
    case 'searching':
      return '회의록을 검색하고 있어요';
    case 'generating':
      return stage.resultCount > 0
        ? `회의록 ${stage.resultCount}건을 참고해 답변을 작성하고 있어요`
        : '답변을 작성하고 있어요';
    default:
      return '준비하고 있어요';
  }
}

/** 답변 텍스트가 오기 전까지 파이프라인 진행 단계를 어시스턴트 말풍선 자리에 보여준다. */
export function PendingIndicator({ stage }: Props) {
  return (
    <div className="message assistant pending" role="status" aria-live="polite">
      {/* key로 단계가 바뀔 때마다 페이드인을 다시 재생한다 */}
      <span className="pending-label" key={stage?.stage ?? 'idle'}>
        {labelOf(stage)}
      </span>
      <span className="pending-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
