// PostToolUse-хук: форматирует файл, который только что изменил Claude.
// Ошибки форматирования не блокируют работу (всегда exit 0).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const client = path.join(root, 'nimrata.core.client');

let input = '';
for await (const chunk of process.stdin) input += chunk;

let file;
try {
    file = JSON.parse(input).tool_input?.file_path;
} catch {
    process.exit(0);
}
if (!file || !existsSync(file)) process.exit(0);

const rel = path.relative(root, file);
if (rel.startsWith('..') || /(^|[\/])(node_modules|bin|obj|dist)[\/]/.test(rel)) process.exit(0);

const run = (cmd, args, cwd) =>
    spawnSync(cmd, args, { cwd, stdio: 'ignore', shell: process.platform === 'win32' });

const ext = path.extname(file).toLowerCase();
const inClient = path.relative(client, file).startsWith('..') === false;

if (ext === '.cs') {
    run('dotnet', ['format', 'whitespace', 'Nimrata.Core.slnx', '--include', rel], root);
} else if (inClient && ['.ts', '.tsx', '.css', '.json'].includes(ext)) {
    const clientRel = path.relative(client, file);
    run('npx', ['prettier', '--write', clientRel], client);
    if (['.ts', '.tsx'].includes(ext)) run('npx', ['eslint', '--fix', clientRel], client);
}
process.exit(0);
