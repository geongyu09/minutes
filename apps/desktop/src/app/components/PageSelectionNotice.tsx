/** 노션 인가 화면이 열려 있는 동안, 색인할 페이지를 전부 선택해야 함을 안내한다. */
export function PageSelectionNotice() {
  return (
    <span className="page-selection-notice" role="status">
      노션 승인 화면에서 <strong>검색에 사용할 페이지를 모두 선택</strong>해주세요.
      <br />
      선택한 페이지와 그 하위 페이지만 색인되어 답변에 사용됩니다.
    </span>
  );
}
