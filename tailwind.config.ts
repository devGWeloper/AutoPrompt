import type { Config } from 'tailwindcss';

// Token-based design system. Color values are set in globals.css as RGB channels
// so Tailwind's `/<alpha>` modifier works (e.g. bg-accent/10). Palette, type
// scale, 4/8px geometry and layered drop-shadows follow the Webflow design
// language documented in DESIGN-webflow.md.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Plain hex, not CSS custom properties: `rgb(var(--x) / <alpha-value>)` is
      // Color 4 syntax that older browsers drop wholesale, which left the app
      // with no fills at all there (see globals.css).
      colors: {
        bg: "#f9f9f9",
        surface: { DEFAULT: "#ffffff", 2: "#f5f5f5", 3: "#ececec" },
        line: { DEFAULT: "#d8d8d8", strong: "#bebebe" },
        // near-black: every primary CTA, heading and wordmark
        primary: { DEFAULT: "#080808", fg: "#ffffff" },
        ink: { DEFAULT: "#080808", strong: "#222222" },
        body: "#363636",
        muted: { DEFAULT: "#5a5a5a", soft: "#ababab" },
        accent: { DEFAULT: "#146ef5", fg: "#ffffff", deep: "#006acc", soft: "#ebf2fe" },
        // five-stop chromatic category palette — surface fills only
        chroma: {
          purple: "#7a3dff",
          pink: "#ed52cb",
          blue: "#3b89ff",
          orange: "#ff6b00",
          green: "#00d722",
        },
        // `vivid` is the brand's full-saturation stop (fills, dots); the base is
        // the darkened stop of the same hue that stays legible as text.
        ok: { DEFAULT: "#007a18", vivid: "#00d722" },
        warn: { DEFAULT: "#925e00", vivid: "#ffae13" },
        bad: { DEFAULT: "#ee1d36", vivid: "#ee1d36" },
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
      borderColor: { DEFAULT: "#d8d8d8" },
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
  // Tailwind wraps every colour utility in `rgb(R G B / var(--tw-*-opacity))`,
  // which is Color 4 syntax even when the palette is hex — an older browser drops
  // the whole declaration and the fill never lands. Turning the opacity plugins
  // off emits plain `background-color: #080808`; the `/alpha` modifier keeps
  // working (bg-bad/5 still compiles), it just is not what solid fills go through.
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
