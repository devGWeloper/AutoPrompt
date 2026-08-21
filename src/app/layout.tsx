import './globals.css';
import type { Metadata } from 'next';
import { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'TestX · AI Agent Test',
  description: 'AI agent prompt management & flow-level RAGAS evaluation',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // System font stack (no next/font/google — the internal network is closed; the
  // stack in tailwind.config.ts falls back from Inter to the platform faces).
  // The shell (sidebar + content) is AppShell's; nothing wraps it here — a
  // status footer under it only repeated what the sidebar foot already shows.
  return (
    <html lang="ko">
      <body className="font-sans">
        <div className="h-dvh">{children}</div>
      </body>
    </html>
  );
}
