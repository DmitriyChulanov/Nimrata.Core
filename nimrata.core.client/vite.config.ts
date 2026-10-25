import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { env } from 'process';

const baseFolder =
    env.APPDATA !== undefined && env.APPDATA !== ''
        ? `${env.APPDATA}/ASP.NET/https`
        : `${env.HOME}/.aspnet/https`;

const certificateName = "nimrata.core.client";
const certFilePath = path.join(baseFolder, `${certificateName}.pem`);
const keyFilePath = path.join(baseFolder, `${certificateName}.key`);

// Сертификат dotnet dev-certs нужен только dev-серверу: сборка (в т.ч. в Docker) обходится без него.
function loadHttps() {
    if (!fs.existsSync(baseFolder)) {
        fs.mkdirSync(baseFolder, { recursive: true });
    }

    if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
        if (0 !== child_process.spawnSync('dotnet', [
            'dev-certs',
            'https',
            '--export-path',
            certFilePath,
            '--format',
            'Pem',
            '--no-password',
        ], { stdio: 'inherit', }).status) {
            throw new Error("Could not create certificate.");
        }
    }

    return {
        key: fs.readFileSync(keyFilePath),
        cert: fs.readFileSync(certFilePath),
    };
}

const target = env.ASPNETCORE_HTTPS_PORT ? `https://localhost:${env.ASPNETCORE_HTTPS_PORT}` :
    env.ASPNETCORE_URLS ? env.ASPNETCORE_URLS.split(';')[0] : 'https://localhost:7146';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [plugin()],
    resolve: {
        alias: {
            '@platform': fileURLToPath(new URL('./src/platform', import.meta.url)),
            '@tracker': fileURLToPath(new URL('./src/modules/tracker', import.meta.url)),
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    server: {
        proxy: {
            // Единый префикс API платформы: все серверные маршруты живут под /api.
            '^/api': {
                target,
                secure: false
            }
        },
        port: parseInt(env.DEV_SERVER_PORT || '61625'),
        https: command === 'serve' ? loadHttps() : undefined,
    }
}))
