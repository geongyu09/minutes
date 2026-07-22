import { config } from '@/core/config';
import { countTokens } from '@/core/tokens';
import type { Chunk, RawDocument } from '@/core/types';

interface Section {
  headingPath: string[];
  content: string;
}

/** 마크다운을 헤딩(#, ##, ###) 기준 섹션으로 분할하며 headingPath 스택을 유지한다. */
function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const path: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) sections.push({ headingPath: [...path], content });
    buffer = [];
  };

  for (const line of markdown.split('\n')) {
    const match = /^(#{1,3})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      path.splice(level - 1);
      path.push(match[2].trim());
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** maxTokens 초과 섹션을 문단 단위로 재분할한다. overlapRatio만큼 뒤 문단을 다음 조각에 겹친다. */
function splitLongSection(section: Section): Section[] {
  const { targetTokens, maxTokens, overlapRatio } = config.chunking;
  if (countTokens(section.content) <= maxTokens) return [section];

  const paragraphs = section.content.split(/\n\s*\n/).filter((p) => p.trim());
  const pieces: Section[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    pieces.push({ headingPath: section.headingPath, content: current.join('\n\n') });

    // 뒤에서부터 overlap 토큰만큼 문단을 남겨 다음 조각과 겹친다
    const overlapBudget = Math.floor(targetTokens * overlapRatio);
    const kept: string[] = [];
    let keptTokens = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      const tokens = countTokens(current[i]);
      if (keptTokens + tokens > overlapBudget) break;
      kept.unshift(current[i]);
      keptTokens += tokens;
    }
    current = kept;
    currentTokens = keptTokens;
  };

  for (const paragraph of paragraphs) {
    const tokens = countTokens(paragraph);
    if (currentTokens + tokens > targetTokens && current.length > 0) flush();
    current.push(paragraph);
    currentTokens += tokens;
  }
  if (current.length > 0 && currentTokens > 0) {
    pieces.push({ headingPath: section.headingPath, content: current.join('\n\n') });
  }
  return pieces;
}

/** 문서 제목·헤딩 경로를 본문 앞에 붙인 청크 본문을 만든다 — 검색 품질에 직결. */
function buildContent(doc: RawDocument, section: Section): string {
  return [
    `문서: ${doc.title}`,
    section.headingPath.length > 0 ? `위치: ${section.headingPath.join(' > ')}` : '',
    '',
    section.content,
  ]
    .filter(Boolean)
    .join('\n');
}

export function chunkDocument(doc: RawDocument): Chunk[] {
  const { minTokens } = config.chunking;

  const sections = splitSections(doc.markdown).flatMap(splitLongSection);

  // minTokens 미만 섹션은 앞 섹션에 병합
  const merged: Section[] = [];
  for (const section of sections) {
    const prev = merged[merged.length - 1];
    if (countTokens(section.content) < minTokens && prev) {
      prev.content += `\n\n${section.content}`;
    } else {
      merged.push(section);
    }
  }

  return merged.map((section, chunkIndex) => {
    const content = buildContent(doc, section);
    return {
      id: `${doc.id}:${chunkIndex}`,
      documentId: doc.id,
      chunkIndex,
      content,
      metadata: {
        documentTitle: doc.title,
        documentUrl: doc.url,
        headingPath: section.headingPath,
        lastEditedTime: doc.lastEditedTime,
        tokenCount: countTokens(content),
      },
    };
  });
}
