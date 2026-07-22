import { describe, expect, it } from 'vitest';
import { propertiesToMarkdown } from './transformer';

describe('propertiesToMarkdown', () => {
  it('지원 타입 속성을 "- 이름: 값" 목록으로 변환한다', () => {
    const md = propertiesToMarkdown({
      상태: { type: 'status', status: { name: '진행 중' } },
      분류: { type: 'select', select: { name: '기획' } },
      태그: { type: 'multi_select', multi_select: [{ name: '백엔드' }, { name: '긴급' }] },
      메모: { type: 'rich_text', rich_text: [{ plain_text: '다음 주 ' }, { plain_text: '재논의' }] },
      담당자: { type: 'people', people: [{ name: '박건규' }, { name: '김하나' }] },
      공수: { type: 'number', number: 3 },
      완료: { type: 'checkbox', checkbox: true },
      링크: { type: 'url', url: 'https://example.com' },
      메일: { type: 'email', email: 'a@b.c' },
      전화: { type: 'phone_number', phone_number: '010-0000-0000' },
    });

    expect(md.split('\n')).toEqual([
      '- 상태: 진행 중',
      '- 분류: 기획',
      '- 태그: 백엔드, 긴급',
      '- 메모: 다음 주 재논의',
      '- 담당자: 박건규, 김하나',
      '- 공수: 3',
      '- 완료: 예',
      '- 링크: https://example.com',
      '- 메일: a@b.c',
      '- 전화: 010-0000-0000',
    ]);
  });

  it('date는 start만 또는 start–end로 표기한다', () => {
    const md = propertiesToMarkdown({
      회의일: { type: 'date', date: { start: '2026-07-20' } },
      기간: { type: 'date', date: { start: '2026-07-20', end: '2026-07-24' } },
    });
    expect(md).toBe('- 회의일: 2026-07-20\n- 기간: 2026-07-20 – 2026-07-24');
  });

  it('formula는 결과 타입별 값을 표기한다', () => {
    const md = propertiesToMarkdown({
      점수: { type: 'formula', formula: { type: 'number', number: 42 } },
      라벨: { type: 'formula', formula: { type: 'string', string: 'A급' } },
      여부: { type: 'formula', formula: { type: 'boolean', boolean: false } },
      마감: { type: 'formula', formula: { type: 'date', date: { start: '2026-08-01' } } },
    });
    expect(md.split('\n')).toEqual([
      '- 점수: 42',
      '- 라벨: A급',
      '- 여부: 아니요',
      '- 마감: 2026-08-01',
    ]);
  });

  it('title은 문서 제목으로 이미 쓰이므로 제외한다', () => {
    const md = propertiesToMarkdown({
      이름: { type: 'title', title: [{ plain_text: '주간 회의' }] },
      상태: { type: 'select', select: { name: '완료' } },
    });
    expect(md).toBe('- 상태: 완료');
  });

  it('빈 값과 미지원 타입(relation/rollup/files)은 생략한다', () => {
    const md = propertiesToMarkdown({
      빈메모: { type: 'rich_text', rich_text: [] },
      빈선택: { type: 'select', select: null },
      빈태그: { type: 'multi_select', multi_select: [] },
      빈날짜: { type: 'date', date: null },
      빈숫자: { type: 'number', number: null },
      연결: { type: 'relation', relation: [{ id: 'x' }] },
      집계: { type: 'rollup', rollup: { type: 'number', number: 1 } },
      첨부: { type: 'files', files: [{ name: 'a.pdf' }] },
    });
    expect(md).toBe('');
  });

  it('숫자 0과 checkbox false는 유효한 값으로 표기한다', () => {
    const md = propertiesToMarkdown({
      공수: { type: 'number', number: 0 },
      완료: { type: 'checkbox', checkbox: false },
    });
    expect(md).toBe('- 공수: 0\n- 완료: 아니요');
  });

  it('속성이 없으면 빈 문자열을 반환한다', () => {
    expect(propertiesToMarkdown({})).toBe('');
    expect(propertiesToMarkdown(undefined)).toBe('');
  });
});
