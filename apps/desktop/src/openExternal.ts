/**
 * 외부 브라우저로 URL 열기.
 * Tauri에서는 plugin-shell의 open(기본 브라우저), 일반 브라우저에서는 새 탭.
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}
