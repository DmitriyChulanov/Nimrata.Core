import type { VitePWAOptions } from 'vite-plugin-pwa';

/**
 * Настройки service worker: клиентская оболочка (собранные ассеты и index.html) кэшируется,
 * чтобы приложение открывалось без сети. Серверные маршруты не перехватываются: /api (в том числе
 * хаб /api/sync и его WebSocket) идёт прямо в сеть, и сбой сети остаётся сбоем сети — клиент по нему
 * отличает «нет сети» от ответа сервера (синтетический ответ вроде 503 выглядел бы как отказ сервера)
 */
export const pwaOptions: Partial<VitePWAOptions> = {
    strategies: 'generateSW',
    // Новая версия активируется сама и подхватывается при следующей загрузке страницы, без диалогов
    registerType: 'autoUpdate',
    // registerSW.js подключается в index.html только в сборке; в dev-режиме service worker не нужен
    injectRegister: 'script',
    devOptions: { enabled: false },
    // Приложение не устанавливается как PWA: нужен только кэш оболочки
    manifest: false,
    workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png,woff,woff2}'],
        navigateFallback: 'index.html',
        // Навигации на серверные маршруты (API, проверка здоровья, OpenAPI) оболочкой не подменяются
        navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/health$/, /^\/openapi(\/|$)/],
        // Кэш во время работы не ведётся: всё, что не входит в оболочку, идёт в сеть без участия service worker
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
    },
};
