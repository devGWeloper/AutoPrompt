import type { Config } from 'tailwindcss';

// Token-based design system. Color values are set in globals.css as RGB channels
// so Tailwind's `/<alpha>` modifier works (e.g. bg-accent/10). Palette + rounded,
// soft-shadow language mirror the inview app's neutral enterprise tone.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          2: 'rgb(var(--surface-2) / <alpha-value>)',
          3: 'rgb(var(--surface-3) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
        },
        ok: 'rgb(var(--ok) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Noto Sans KR',
          'Apple SD Gothic Neo',
          'Malgun Gothic',
          'Roboto',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'D2Coding', 'monospace'],
      },
      borderColor: { DEFAULT: 'rgb(var(--line) / <alpha-value>)' },
      // Squarer, inview-like radii (panels ~8px, cards ~11-14px). `full` stays
      // pill for status badges.
      borderRadius: {
        sm: '0.375rem', // 6px
        DEFAULT: '0.5rem', // 8px
        md: '0.5rem', // 8px
        lg: '0.625rem', // 10px
        xl: '0.75rem', // 12px
        '2xl': '0.875rem', // 14px
        '3xl': '1.125rem', // 18px
      },
      boxShadow: {
        card: '0 1px 2px rgba(17,24,39,0.04), 0 1px 0 rgba(17,24,39,0.02)',
        elevated: '0 12px 32px -14px rgba(17,24,39,0.22), 0 2px 6px rgba(17,24,39,0.05)',
        ring: '0 0 0 3px rgba(37,99,235,0.15)',
        seg: '0 1px 2px rgba(17,24,39,0.10), 0 0 0 1px rgba(37,99,235,0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
