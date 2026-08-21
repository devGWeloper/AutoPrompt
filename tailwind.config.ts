import type { Config } from 'tailwindcss';

// Token-based design system. Color values are set in globals.css as RGB channels
// so Tailwind's `/<alpha>` modifier works (e.g. bg-accent/10). Palette, type
// scale, 4/8px geometry and layered drop-shadows follow the Webflow design
// language documented in DESIGN-webflow.md.
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
        // near-black: every primary CTA, heading and wordmark
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          fg: 'rgb(var(--primary-fg) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          strong: 'rgb(var(--ink-strong) / <alpha-value>)',
        },
        body: 'rgb(var(--body) / <alpha-value>)',
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          soft: 'rgb(var(--mute-soft) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          deep: 'rgb(var(--accent-deep) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
        },
        // five-stop chromatic category palette — surface fills only
        chroma: {
          purple: 'rgb(var(--chroma-purple) / <alpha-value>)',
          pink: 'rgb(var(--chroma-pink) / <alpha-value>)',
          blue: 'rgb(var(--chroma-blue) / <alpha-value>)',
          orange: 'rgb(var(--chroma-orange) / <alpha-value>)',
          green: 'rgb(var(--chroma-green) / <alpha-value>)',
        },
        ok: {
          DEFAULT: 'rgb(var(--ok) / <alpha-value>)',
          vivid: 'rgb(var(--ok-vivid) / <alpha-value>)',
        },
        warn: {
          DEFAULT: 'rgb(var(--warn) / <alpha-value>)',
          vivid: 'rgb(var(--warn-vivid) / <alpha-value>)',
        },
        bad: {
          DEFAULT: 'rgb(var(--bad) / <alpha-value>)',
          vivid: 'rgb(var(--bad-vivid) / <alpha-value>)',
        },
      },
      fontFamily: {
        // WF Visual Sans is proprietary; Inter is the documented substitute and
        // the system faces carry it where Inter is not installed (closed network,
        // so no webfont fetch). Korean falls back to the platform Hangul face.
        sans: [
          'Inter',
          'Inter var',
          'Segoe UI Variable Text',
          'Segoe UI',
          '-apple-system',
          'BlinkMacSystemFont',
          'Pretendard',
          'Noto Sans KR',
          'Apple SD Gothic Neo',
          'Malgun Gothic',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: ['Inconsolata', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'D2Coding', 'monospace'],
      },
      // Brand type scale. Keys are prefixed so Tailwind's own text-xs/sm/base
      // stay untouched for the dense table surfaces.
      fontSize: {
        'display-xxl': ['80px', { lineHeight: '83.2px', letterSpacing: '-0.8px', fontWeight: '600' }],
        'display-xl': ['56px', { lineHeight: '58.24px', fontWeight: '600' }],
        'display-lg': ['44.8px', { lineHeight: '46.6px', fontWeight: '600' }],
        'display-md': ['32px', { lineHeight: '41.6px', fontWeight: '500' }],
        'display-sm': ['24px', { lineHeight: '31.2px', fontWeight: '500' }],
        'display-xs': ['20px', { lineHeight: '28px', fontWeight: '500' }],
        'body-lg': ['28.8px', { lineHeight: '46.08px', letterSpacing: '-0.288px' }],
        'body-md': ['16px', { lineHeight: '25.6px', letterSpacing: '-0.16px' }],
        'body-sm': ['14px', { lineHeight: '22.4px' }],
        caption: ['12.8px', { lineHeight: '15.36px', fontWeight: '550' }],
        'caption-mono': ['12px', { lineHeight: '18px' }],
      },
      borderColor: { DEFAULT: 'rgb(var(--line) / <alpha-value>)' },
      // Tight, engineered geometry: 4px for buttons / badges / inputs, 8px for
      // cards. Pill is reserved for circular icon containers and meters, so the
      // scale collapses onto those two stops.
      borderRadius: {
        none: '0px',
        xs: '2px',
        sm: '4px',
        DEFAULT: '4px',
        md: '8px',
        lg: '8px',
        xl: '8px',
        '2xl': '8px',
        '3xl': '12px',
      },
      boxShadow: {
        // Level 1 is the hairline border alone — cards carry no shadow by default.
        card: 'none',
        // Level 2 — the brand's layered multi-stop drop
        lift: '0 84px 24px rgba(0,0,0,0), 0 54px 22px rgba(0,0,0,0.01), 0 30px 18px rgba(0,0,0,0.04), 0 13px 13px rgba(0,0,0,0.08), 0 3px 7px rgba(0,0,0,0.09)',
        // Level 3 — the deeper version for pricing / featured emphasis
        elevated:
          '0 84px 24px rgba(0,0,0,0), 0 54px 22px rgba(0,0,0,0.02), 0 30px 18px rgba(0,0,0,0.05), 0 13px 13px rgba(0,0,0,0.09), 0 3px 7px rgba(0,0,0,0.12)',
        // Level 4 — modal / dialog surfaces
        modal: '0 24px 24px rgba(0,0,0,0.26), 0 6px 13px rgba(0,0,0,0.29)',
        ring: '0 0 0 3px rgba(8,8,8,0.10)',
        seg: '0 1px 2px rgba(8,8,8,0.10)',
      },
    },
  },
  plugins: [],
};

export default config;
