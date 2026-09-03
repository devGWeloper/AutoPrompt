import type { Config } from 'tailwindcss';

// Token-based design system. The visual language is inview's (C:\work\inview,
// src/app/globals.css): a neutral enterprise palette on a light grey canvas,
// one blue accent, hairline chrome, 6px controls / 8px panels, and soft status
// tints instead of alpha overlays. Token *names* are unchanged so call sites
// keep working; only the values behind them moved.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Plain hex, not CSS custom properties: `rgb(var(--x) / <alpha-value>)` is
      // Color 4 syntax that older browsers drop wholesale, which left the app
      // with no fills at all there (see globals.css).
      colors: {
        bg: "#f4f5f7",
        surface: { DEFAULT: "#ffffff", 2: "#fafbfc", 3: "#f0f2f5" },
        line: { DEFAULT: "#e1e4e8", strong: "#d0d4da" },
        // The blue accent is the primary action colour — inview puts every CTA,
        // active tab and focus ring on it; near-black is text only.
        primary: { DEFAULT: "#2563eb", fg: "#ffffff", hover: "#1d4ed8" },
        ink: { DEFAULT: "#1f2328", strong: "#111827" },
        body: "#4b5563",
        muted: { DEFAULT: "#6b7280", soft: "#8a94a6" },
        accent: { DEFAULT: "#2563eb", fg: "#ffffff", deep: "#1d4ed8", soft: "#e8efff", soft2: "#dde7ff", line: "#c3d4fc" },
        // Status tones come as a set: `DEFAULT` is the legible text/border
        // stop, `soft` the surface fill, `vivid` the dot. Solid tints, not
        // alpha — the soft fills survive browsers without Color 4. `soft2` is the
        // one step deeper the same tint takes on hover.
        ok:   { DEFAULT: "#067647", vivid: "#16a34a", soft: "#e6f4ec", soft2: "#d6ecdf", line: "#bfe3ce" },
        warn: { DEFAULT: "#b54708", vivid: "#f59e0b", soft: "#fdf2e5", soft2: "#fae7d1", line: "#f1d6ba" },
        bad:  { DEFAULT: "#b42318", vivid: "#ef4444", soft: "#fdecec", soft2: "#fbdcd9", line: "#f4c1bc" },
        // inview's fourth status stop — a run that completed but scored a fail,
        // which is not the same thing as an error.
        fail: { DEFAULT: "#c2410c", vivid: "#f97316", soft: "#ffedd5", soft2: "#ffe1bd", line: "#fed7aa" },
        // Category hues. Surface/marker fills only — never a button background.
        chroma: {
          purple: "#7c3aed",
          pink: "#be185d",
          blue: "#2563eb",
          orange: "#b45309",
          green: "#067647",
        },
      },
      fontFamily: {
        // The platform UI face, with the Hangul fallbacks first in line — a
        // closed network means no webfont fetch, so the stack has to land on
        // something installed.
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
      // Type scale. Keys are prefixed so Tailwind's own text-xs/sm/base stay
      // untouched for the dense table surfaces.
      fontSize: {
        // KPI figure — set in mono, the one place a number gets to be large.
        'display-xxl': ['34px', { lineHeight: '35.7px', letterSpacing: '-0.8px', fontWeight: '700' }],
        'display-xl': ['28px', { lineHeight: '34px', letterSpacing: '-0.4px', fontWeight: '700' }],
        // Page title (inview `.dash-title-main`).
        'display-lg': ['24px', { lineHeight: '31.2px', letterSpacing: '-0.2px', fontWeight: '700' }],
        'display-md': ['20px', { lineHeight: '28px', letterSpacing: '-0.1px', fontWeight: '700' }],
        // Card head (`.dash-card-hero .dash-card-title`).
        'display-sm': ['17px', { lineHeight: '24px', fontWeight: '700' }],
        // Panel head (`.panel-header .title`) — the default screen/dialog title.
        'display-xs': ['16px', { lineHeight: '22px', letterSpacing: '0.1px', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28.8px' }],
        'body-md': ['16px', { lineHeight: '25.6px' }],
        'body-sm': ['14px', { lineHeight: '22.4px' }],
        // The uppercase, positively-tracked label over every table and field.
        caption: ['12.5px', { lineHeight: '16px', fontWeight: '600' }],
        'caption-mono': ['12.5px', { lineHeight: '18px' }],
      },
      borderColor: { DEFAULT: "#e1e4e8" },
      // 6px for buttons / badges / inputs, 8px for panels and cards, 9px for the
      // segmented track. Pills (99px) are for status chips and circular icons.
      borderRadius: {
        none: '0px',
        xs: '3px',
        sm: '6px',
        DEFAULT: '6px',
        md: '8px',
        lg: '9px',
        xl: '11px',
        '2xl': '12px',
        '3xl': '14px',
      },
      boxShadow: {
        // Level 1 — the hairline card lift. Barely there by design.
        card: '0 1px 0 rgba(17,24,39,0.02)',
        // The top chrome: a hairline plus a wide, very soft drop underneath.
        topbar: '0 1px 0 rgba(17,24,39,0.02), 0 10px 22px -18px rgba(17,24,39,0.25)',
        // Level 2 — hover / raised panels.
        lift: '0 1px 3px rgba(17,24,39,0.05), 0 8px 22px -16px rgba(17,24,39,0.35)',
        // Level 3 — the hero card among peers.
        elevated: '0 1px 3px rgba(17,24,39,0.06), 0 14px 30px -20px rgba(17,24,39,0.40)',
        // Level 4 — modal / dialog surfaces.
        modal: '0 8px 20px -8px rgba(17,24,39,0.20), 0 24px 60px -14px rgba(17,24,39,0.35)',
        // Focus ring — blue, 3px, 15%.
        ring: '0 0 0 3px rgba(37,99,235,0.15)',
        // Active segment in a segmented control.
        seg: '0 1px 2px rgba(17,24,39,0.10), 0 0 0 1px rgba(37,99,235,0.08)',
      },
    },
  },
  // Tailwind wraps every colour utility in `rgb(R G B / var(--tw-*-opacity))`,
  // which is Color 4 syntax even when the palette is hex — an older browser drops
  // the whole declaration and the fill never lands. Turning the opacity plugins
  // off emits plain `background-color: #2563eb`; the `/alpha` modifier keeps
  // working, it just is not what solid fills go through — and the status tones
  // now carry explicit `soft` / `line` stops so tints need no alpha at all.
  corePlugins: {
    backgroundOpacity: false,
    textOpacity: false,
    borderOpacity: false,
    divideOpacity: false,
    placeholderOpacity: false,
    ringOpacity: false,
  },
  plugins: [],
};

export default config;
