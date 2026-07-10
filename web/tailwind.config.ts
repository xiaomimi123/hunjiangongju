import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#141414',
        ink2: '#5b6169',
        ink3: '#9aa1a9',
        paper: '#f2f3f5',
        surface: '#ffffff',
        surface2: '#f7f8fa',
        line: '#e7e9ec',
        flame1: '#ff5a1f',
        flame2: '#ff2d78',
        flame: '#ff2f57',
        ok: '#0fb77e',
        warn: '#f59e0b',
        bad: '#f5334f',
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,20,20,.05), 0 14px 34px -18px rgba(20,20,20,.18)',
        lift: '0 10px 26px -10px rgba(255,60,90,.5)',
      },
    },
  },
  plugins: [],
} satisfies Config
