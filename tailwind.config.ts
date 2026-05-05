import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1B4F8A',
        success: '#27AE60',
        danger: '#C0392B',
        warning: '#F0AD00',
        surface: '#F7F9FC',
        ink: '#142236',
      },
      fontFamily: {
        sans: ['Segoe UI', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 18px 40px rgba(20, 34, 54, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
