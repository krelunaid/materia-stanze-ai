import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: 'native',
  envDir: '..',
  publicDir: '../public',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: '../dist-native',
  },
});
