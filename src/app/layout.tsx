import './globals.css';
import type { Metadata } from 'next';
import { ReactNode } from 'react';
import pkg from '../../package.json';

export const metadata: Metadata = {
  title: 'AutoPrompt · Prompt Management & RAGAS',
  description: 'AI agent prompt management & flow-level RAGAS evaluation',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // System font stack (no next/font/google — the internal network is closed).
  // Shell mirrors inview: topbar (per page) / content / slim statusbar footer.
  return (
    <html lang="ko">
      <body className="font-sans">
        <div className="flex h-dvh flex-col">
          <div className="min-h-0 flex-1">{children}</div>
          <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-surface-2 px-[18px] text-xs tracking-[0.2px] text-muted">
            <span>AutoPrompt · Prompt Management</span>
            <span className="flex items-center gap-2">
              <span>RAGAS Eval</span>
              <span className="font-mono text-muted/80">v{pkg.version}</span>
            </span>
          </footer>
        </div>
      </body>
    </html>
  );
}
