/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./web/**/*.{js,ts,jsx,tsx}",
    "./web/index.html",
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
          panel: 'var(--fandex-bg-card)',
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
        sans: ['var(--fandex-font-body)'],
        display: ['var(--fandex-font-display)'],
        code: ['var(--fandex-font-code)'],
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
        'fast': '150ms',
        'base': '250ms',
      },
      transitionTimingFunction: {
        'fandex': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      boxShadow: {
        'sm': 'var(--fandex-shadow-sm)',
        'md': 'var(--fandex-shadow-md)',
        'lg': 'var(--fandex-shadow-lg)',
      },
      borderRadius: {
        // FANDEX 以直角为主，仅保留小圆角用于特殊场景
        'none': '0',
        'sm': '2px',
        'DEFAULT': '3px',
        'md': '4px',
        'lg': '6px',
        'xl': '8px',
        '2xl': '12px',
      },
      maxWidth: {
        'content': '720px',
      },
      keyframes: {
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'shake': 'shake 0.4s ease-in-out',
        'slide-up': 'slide-up 0.3s ease-out',
      },
      height: {
        'nav': 'var(--fandex-nav-height)',
      },
      width: {
        'sidebar': 'var(--fandex-sidebar-width)',
      },
    },
  },
  plugins: [],
}
