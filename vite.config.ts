import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [{
    name: 'public-indexing-policy',
    transformIndexHtml(html) {
      return mode === 'public'
        ? html.replace('noindex, nofollow, noarchive', 'index, follow')
          .replace('Закрытый трекер подписок и регулярных платежей.', 'Личный трекер подписок и регулярных платежей.')
        : html;
    },
  }],
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) return 'firebase';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react';
          if (id.includes('/node_modules/lucide-react/')) return 'icons';
        },
      },
    },
  },
}));
