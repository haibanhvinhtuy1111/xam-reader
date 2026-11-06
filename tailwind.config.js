/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: { cream: '#F8F9F5', ink: '#111827', brand: '#1E4631', warn: '#FDF6EC' },
    },
  },
  plugins: [],
};
