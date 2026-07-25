/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--accent)',
          dark: 'var(--accent-secondary)',
        },
        bg:       'var(--bg)',
        surface:  'var(--surface)',
        surface2: 'var(--surface-opaque)',
        border:   'var(--border)',
        accent:   'var(--accent-tertiary)',
        success:  'var(--success)',
        error:    'var(--error)',
        muted:    'var(--text-muted)',
        text:     'var(--text)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
