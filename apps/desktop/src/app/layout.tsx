import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'minutes — 회의록 검색',
  description: '노션 회의록을 색인하고 출처와 함께 답하는 채팅',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
