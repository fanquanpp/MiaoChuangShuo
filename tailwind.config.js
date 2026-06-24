/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // FANDEX 品牌色系
        fandex: {
          primary: 'var(--fandex-primary)',
          'primary-hover': 'var(--fandex-primary-hover)',
          secondary: 'var(--fandex-secondary)',
          tertiary: 'var(--fandex-tertiary)',
        },
        // FANDEX 背景色系 - 使用 nf-bg 避免与 Tailwind 内置 bg-* 冲突
        'nf-bg': {
          DEFAULT: 'var(--fandex-bg)',
          card: 'var(--fandex-bg-card)',
          code: 'var(--fandex-bg-code)',
          hover: 'var(--fandex-bg-hover)',
          sidebar: 'var(--fandex-bg-sidebar)',
          nav: 'var(--fandex-bg-nav)',
        },
        // FANDEX 文字色系 - 使用 nf-text 避免与 Tailwind 内置 text-* 冲突
        'nf-text': {
          DEFAULT: 'var(--fandex-text)',
          secondary: 'var(--fandex-text-secondary)',
          tertiary: 'var(--fandex-text-tertiary)',
          inverse: 'var(--fandex-text-inverse)',
        },
        // FANDEX 边框色系 - 使用 nf-border 避免与 Tailwind 内置 border-* 冲突
        'nf-border': {
          DEFAULT: 'var(--fandex-border)',
          light: 'var(--fandex-border-light)',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        serif: ['"SimSun"', '"Source Han Serif CN"', 'serif'],
        code: ['"JetBrains Mono"', 'monospace'],
      },
      spacing: {
        'xs': '4px',
        'sm': '8px',
        'md': '16px',
        'lg': '24px',
        'xl': '32px',
        '2xl': '48px',
        '3xl': '64px',
      },
      transitionDuration: {
        'fast': '120ms',
        'base': '220ms',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.2)',
        'md': '0 4px 6px rgba(0, 0, 0, 0.3)',
        'lg': '0 10px 15px rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [],
}
