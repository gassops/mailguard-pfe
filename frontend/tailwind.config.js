/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a5f',
        },
        brown: {
          100: '#fdf8f0',
          200: '#f5e6d0',
          400: '#c4956a',
          600: '#8B5E3C',
          800: '#5c3d1e',
        },
        verdict: {
          valid:      '#16a34a',
          suspicious: '#d97706',
          invalid:    '#dc2626',
        }
      }
    },
  },
  plugins: [],
}
