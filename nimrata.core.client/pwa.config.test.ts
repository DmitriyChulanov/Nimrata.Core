import { describe, expect, it } from 'vitest';

import { pwaOptions } from './pwa.config.ts';

/** Попадает ли навигация по пути под navigateFallback (отдаётся оболочка из кэша) */
function isServedByShell(pathname: string): boolean {
    const denylist = pwaOptions.workbox?.navigateFallbackDenylist ?? [];
    return !denylist.some((pattern) => pattern.test(pathname));
}

describe('pwaOptions', () => {
    it('собирает service worker через generateSW с оболочкой index.html для навигации', () => {
        expect(pwaOptions.strategies ?? 'generateSW').toBe('generateSW');
        expect(pwaOptions.workbox?.navigateFallback).toBe('index.html');
        expect(pwaOptions.workbox?.globPatterns).toEqual(
            expect.arrayContaining([expect.stringContaining('html')]),
        );
    });

    it.each(['/', '/tracker/tasks/42', '/notes', '/apiary', '/reset-password?token=1'])(
        'отдаёт оболочку при навигации на клиентский маршрут %s',
        (pathname) => {
            expect(isServedByShell(pathname)).toBe(true);
        },
    );

    it.each(['/api', '/api/', '/api/sync', '/api/auth/me', '/health', '/openapi/v1.json'])(
        'не перехватывает серверный маршрут %s',
        (pathname) => {
            expect(isServedByShell(pathname)).toBe(false);
        },
    );

    it('не кэширует ответы во время работы: /api и хаб синхронизации идут прямо в сеть', () => {
        expect(pwaOptions.workbox?.runtimeCaching ?? []).toEqual([]);
    });

    it('обновляется без диалогов и не включается в dev-режиме', () => {
        expect(pwaOptions.registerType).toBe('autoUpdate');
        expect(pwaOptions.devOptions?.enabled ?? false).toBe(false);
    });
});
