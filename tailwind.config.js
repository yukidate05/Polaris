/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Polaris brand colors
        teal: {
          50:  '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
        },
        aurora: {
          teal:   '#4ECDC4',
          green:  '#45B7AA',
          purple: '#8B7EC8',
          violet: '#9B8FD4',
          light:  '#B8E4E2',
        },
        surface: {
          DEFAULT:  '#F8FAFB',
          card:     'rgba(255,255,255,0.75)',
          glass:    'rgba(255,255,255,0.55)',
          overlay:  'rgba(255,255,255,0.90)',
        },
        brand: {
          DEFAULT: '#14B8A6',
          dark:    '#0D9488',
          light:   '#4ECDC4',
        },
      },
      fontFamily: {
        sans: ['System'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
        '4xl': '32px',
      },
      spacing: {
        18: '72px',
        22: '88px',
      },
    },
  },
  plugins: [],
};
