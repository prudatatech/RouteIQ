import { readFileSync } from 'node:fs'

// Theme values come from design/tokens.json (copied to src/theme by design/generate-tokens.mjs).
const tokens = JSON.parse(readFileSync(new URL('./src/theme/tokens.json', import.meta.url), 'utf8'))
const c = tokens.color
const px = n => `${n}px`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c.bg,
        surface: c.surface,
        'surface-subtle': c.surfaceSubtle,
        border: c.border,
        'border-strong': c.borderStrong,
        text: c.text,
        muted: c.textMuted,
        disabled: c.textDisabled,
        brand: {
          DEFAULT: c.accent,
          hover: c.accentHover,
          fill: c.accentFill,
          'fill-hover': c.accentFillHover,
          soft: c.accentSoft,
        },
        'on-brand': c.onAccentFill,
        success: { DEFAULT: c.success, soft: c.successSoft },
        warning: { DEFAULT: c.warning, soft: c.warningSoft },
        danger: { DEFAULT: c.danger, hover: c.dangerHover, soft: c.dangerSoft },
        info: { DEFAULT: c.info, soft: c.infoSoft },
        neutral: { DEFAULT: c.neutral, soft: c.neutralSoft },
        overlay: c.overlay,
        // Legacy names kept while pages migrate to the names above.
        primary: { DEFAULT: c.accent, dark: c.accentHover },
        surface2: c.surfaceSubtle,
        accent: c.accentFill,
        error: c.danger,
      },
      fontFamily: {
        sans: [tokens.font.sans, 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: [tokens.font.sans, 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: [`"${tokens.font.mono}"`, 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        control: px(tokens.radius.control),
        card: px(tokens.radius.card),
      },
      height: { control: px(tokens.size.controlWeb) },
      minHeight: { control: px(tokens.size.controlWeb) },
      maxWidth: {
        content: px(tokens.size.contentMax),
        form: px(tokens.size.formMax),
      },
      boxShadow: {
        raised: '0 4px 12px rgba(24, 24, 27, 0.08)',
        dialog: '0 16px 48px rgba(24, 24, 27, 0.18)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': { '0%': { transform: 'translateX(100%)' }, '100%': { transform: 'translateX(0)' } },
        'slide-in-left': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out both',
        'fade-in-up': 'fade-in-up 200ms ease-out both',
        'scale-in': 'scale-in 150ms ease-out both',
        'slide-in-right': 'slide-in-right 200ms ease-out both',
        'slide-in-left': 'slide-in-left 200ms ease-out both',
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
}
