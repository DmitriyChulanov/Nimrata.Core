import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';
import plugin from '@vitejs/plugin-react';

// Отдельный конфиг, чтобы тесты не зависели от dev-сертификата из vite.config.ts.
export default defineConfig({
    plugins: [plugin()],
    resolve: {
        alias: {
            '@platform': fileURLToPath(new URL('./src/platform', import.meta.url)),
            '@tasks': fileURLToPath(new URL('./src/extensions/tasks', import.meta.url)),
            '@notes': fileURLToPath(new URL('./src/extensions/notes', import.meta.url)),
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
    },
});
