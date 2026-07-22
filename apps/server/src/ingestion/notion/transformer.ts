import type { BlockNode } from './fetcher';

function richText(block: any, type: string): string {
  const items = block[type]?.rich_text ?? [];
  return items.map((t: any) => t.plain_text).join('');
}

function tableToMarkdown(block: BlockNode): string {
  const rows = block.children.filter((c) => c.type === 'table_row');
  if (rows.length === 0) return '';

  const cells = rows.map((row: any) =>
    (row.table_row?.cells ?? []).map((cell: any[]) =>
      cell.map((t) => t.plain_text).join('').replace(/\|/g, '\\|')
    )
  );
  const width = cells[0]?.length ?? 0;
  const header = `| ${cells[0].join(' | ')} |`;
  const divider = `| ${Array(width).fill('---').join(' | ')} |`;
  const body = cells.slice(1).map((row) => `| ${row.join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

/** 노션 블록 하나를 마크다운으로 변환. 지원하지 않는 타입은 빈 문자열. */
function blockToMarkdown(block: BlockNode, indent: number, listIndex: number): string {
  const pad = '  '.repeat(indent);
  const childMd = (extra = 1) => blocksToMarkdown(block.children, indent + extra);

  switch (block.type) {
    case 'paragraph': {
      const text = richText(block, 'paragraph');
      return text ? pad + text + childMd() : childMd();
    }
    case 'heading_1':
      return `# ${richText(block, 'heading_1')}` + childMd(0);
    case 'heading_2':
      return `## ${richText(block, 'heading_2')}` + childMd(0);
    case 'heading_3':
      return `### ${richText(block, 'heading_3')}` + childMd(0);
    case 'bulleted_list_item':
      return `${pad}- ${richText(block, 'bulleted_list_item')}` + childMd();
    case 'numbered_list_item':
      return `${pad}${listIndex}. ${richText(block, 'numbered_list_item')}` + childMd();
    case 'to_do': {
      const checked = (block as any).to_do?.checked ? 'x' : ' ';
      return `${pad}- [${checked}] ${richText(block, 'to_do')}` + childMd();
    }
    case 'toggle':
      // 헤딩 + 본문으로 평탄화 (<details> 사용 안 함)
      return `${pad}**${richText(block, 'toggle')}**` + childMd();
    case 'code': {
      const lang = (block as any).code?.language ?? '';
      return `\`\`\`${lang}\n${richText(block, 'code')}\n\`\`\``;
    }
    case 'quote':
      return `> ${richText(block, 'quote')}` + childMd();
    case 'callout':
      return `> ${richText(block, 'callout')}` + childMd();
    case 'table':
      return tableToMarkdown(block);
    case 'divider':
      return '---';
    case 'image': {
      const caption = ((block as any).image?.caption ?? []).map((t: any) => t.plain_text).join('');
      return caption ? `(이미지: ${caption})` : '';
    }
    case 'file': {
      const caption = ((block as any).file?.caption ?? []).map((t: any) => t.plain_text).join('');
      return caption ? `(파일: ${caption})` : '';
    }
    case 'child_page':
    case 'child_database':
      return ''; // 별도 문서로 색인됨
    default:
      return '';
  }
}

function blocksToMarkdown(blocks: BlockNode[], indent = 0): string {
  const lines: string[] = [];
  let listIndex = 0;

  for (const block of blocks) {
    listIndex = block.type === 'numbered_list_item' ? listIndex + 1 : 0;
    const md = blockToMarkdown(block, indent, listIndex);
    if (md) lines.push(md);
  }
  return lines.length > 0 ? (indent > 0 ? '\n' : '') + lines.join(indent > 0 ? '\n' : '\n\n') : '';
}

/** 블록 트리 전체를 마크다운 문자열로 변환한다. */
export function toMarkdown(blocks: BlockNode[]): string {
  return blocksToMarkdown(blocks).trim();
}

function dateToText(date: { start?: string; end?: string } | null): string {
  if (!date?.start) return '';
  return date.end ? `${date.start} – ${date.end}` : date.start;
}

/** 속성 값 하나를 텍스트로. 지원하지 않는 타입·빈 값은 빈 문자열. */
function propertyToText(prop: any): string {
  switch (prop?.type) {
    case 'rich_text':
      return (prop.rich_text ?? []).map((t: any) => t.plain_text).join('');
    case 'select':
      return prop.select?.name ?? '';
    case 'status':
      return prop.status?.name ?? '';
    case 'multi_select':
      return (prop.multi_select ?? []).map((o: any) => o.name).join(', ');
    case 'people':
      return (prop.people ?? []).map((p: any) => p.name).filter(Boolean).join(', ');
    case 'date':
      return dateToText(prop.date);
    case 'number':
      return prop.number == null ? '' : String(prop.number);
    case 'checkbox':
      return prop.checkbox ? '예' : '아니요';
    case 'url':
      return prop.url ?? '';
    case 'email':
      return prop.email ?? '';
    case 'phone_number':
      return prop.phone_number ?? '';
    case 'formula':
      return propertyToText(prop.formula);
    case 'string':
      return prop.string ?? '';
    case 'boolean':
      return prop.boolean == null ? '' : prop.boolean ? '예' : '아니요';
    default:
      return '';
  }
}

/**
 * DB 행 페이지의 속성을 "- 이름: 값" 목록으로 변환한다.
 * title은 문서 제목으로 이미 쓰이므로 제외하고, 빈 값·미지원 타입은 생략한다.
 */
export function propertiesToMarkdown(properties: Record<string, any> | undefined): string {
  if (!properties) return '';

  const lines: string[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    if (prop?.type === 'title') continue;
    const text = propertyToText(prop);
    if (text) lines.push(`- ${name}: ${text}`);
  }
  return lines.join('\n');
}
