'use client';

import { useCallback, useEffect, useState } from 'react';
import { projectClient, type ProjectDetail } from '@/projectClient';
import { NotionConnect } from './NotionConnect';

interface Props {
  projectId: string;
  projectName: string;
  /** 내 사용자 ID — 멤버 목록에서 자기 자신을 구분한다. */
  myUserId: string;
  onClose: () => void;
  /** 프로젝트가 삭제되어 더 이상 볼 수 없다. */
  onDeleted: () => void;
  onConnected: () => void;
}

/**
 * 프로젝트 설정 — 노션 연결, 초대 코드, 멤버 목록.
 * owner에게만 열리는 조작이 있고, 서버가 같은 규칙을 다시 검사한다(화면 숨김에만 의존하지 않는다).
 */
export function ProjectSettings({
  projectId,
  projectName,
  myUserId,
  onClose,
  onDeleted,
  onConnected,
}: Props) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await projectClient.get(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(code);
  };

  const isOwner = detail?.role === 'owner';

  return (
    <section className="settings">
      <header>
        <h2>{projectName}</h2>
        <button onClick={onClose}>닫기</button>
      </header>

      <div className="settings-block">
        <h3>노션 연결</h3>
        <p className="muted">
          연결한 사람이 색인한 범위가 곧 이 프로젝트의 공유 범위입니다 — 멤버 전원이 그 회의록을
          검색합니다.
        </p>
        <NotionConnect projectId={projectId} canConnect={!!isOwner} onConnected={onConnected} />
      </div>

      {isOwner && (
        <div className="settings-block">
          <h3>초대 코드</h3>
          <p className="muted">코드를 사내 메신저로 전달하세요. 받은 사람은 코드 입력만으로 참여합니다.</p>
          <button onClick={() => run(() => projectClient.createInvite(projectId))}>
            초대 코드 만들기
          </button>
          <ul className="invite-list">
            {detail?.invites?.map((invite) => (
              <li key={invite.code}>
                <code>{invite.code}</code>
                <button onClick={() => copy(invite.code)}>
                  {copied === invite.code ? '복사됨' : '복사'}
                </button>
                <button onClick={() => run(() => projectClient.revokeInvite(projectId, invite.code))}>
                  폐기
                </button>
              </li>
            ))}
            {detail?.invites?.length === 0 && <li className="muted">아직 만든 코드가 없습니다.</li>}
          </ul>
        </div>
      )}

      <div className="settings-block">
        <h3>멤버</h3>
        <ul className="member-list">
          {detail?.members.map((member) => (
            <li key={member.userId}>
              <span>
                {member.name ?? member.email ?? member.userId}
                <span className="muted"> · {member.role === 'owner' ? '소유자' : '멤버'}</span>
              </span>
              {isOwner && member.userId !== myUserId && (
                <button onClick={() => run(() => projectClient.removeMember(projectId, member.userId))}>
                  내보내기
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {isOwner && (
        <div className="settings-block">
          <h3>프로젝트 삭제</h3>
          <p className="muted">색인된 회의록도 함께 삭제되며 되돌릴 수 없습니다.</p>
          <button
            className="danger"
            onClick={() => run(async () => {
              await projectClient.remove(projectId);
              onDeleted();
            })}
          >
            프로젝트 삭제
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
