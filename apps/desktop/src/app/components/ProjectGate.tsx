'use client';

import { useState } from 'react';
import type { ProjectSummary } from '@/authClient';
import { projectClient } from '@/projectClient';

interface Props {
  projects: ProjectSummary[];
  /** 프로젝트를 만들었거나 참여했다 — 세션을 다시 읽고 그 프로젝트로 들어간다. */
  onEntered: (projectId: string) => void;
}

/**
 * 로그인은 됐지만 볼 프로젝트가 정해지지 않은 상태의 화면.
 * 프로젝트를 새로 만들거나(내가 노션을 연결한다), 받은 초대 코드로 참여한다(연결 불필요).
 */
export function ProjectGate({ projects, onEntered }: Props) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onEntered(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      {projects.length > 0 ? (
        <>
          <h2>프로젝트 선택</h2>
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.id}>
                <button onClick={() => onEntered(project.id)}>
                  {project.name}
                  <span className="muted">
                    {project.role === 'owner' ? '소유자' : '멤버'}
                    {project.connected ? '' : ' · 노션 미연결'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h2>프로젝트를 시작하세요</h2>
          <p className="gate-lead">
            노션을 연결해 회의록을 색인하거나, 팀원에게 받은 초대 코드로 참여할 수 있습니다.
          </p>
        </>
      )}

      <form
        className="gate-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) run(async () => (await projectClient.create(name.trim())).id);
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="새 프로젝트 이름"
          disabled={busy}
        />
        <button type="submit" className="primary" disabled={busy || !name.trim()}>
          만들기
        </button>
      </form>

      <form
        className="gate-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) run(() => projectClient.acceptInvite(code.trim()));
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="초대 코드"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !code.trim()}>
          참여
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
