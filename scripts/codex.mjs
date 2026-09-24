// Sign in or inspect the exact CLI shipped as a locked dependency of this checkout.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyManagedCodex } from '../src/main/managed-codex.ts';

const args = process.argv.slice(2);
if (!['--version', 'login'].includes(args[0]) ||
    (args[0] === '--version' && args.length !== 1) ||
    (args[0] === 'login' && (args.length > 2 || (args[1] && !['status', '--device-auth'].includes(args[1]))))) {
  console.error('Use npm run codex:version, npm run codex:login, or npm run codex:login -- status (or --device-auth).');
  process.exitCode = 1;
} else {
  try {
    const binary = await verifyManagedCodex(fileURLToPath(new URL('../', import.meta.url)));
    const child = spawn(binary, args, { stdio: 'inherit', shell: false });
    const forward = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    try {
      const { code, signal } = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
      process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
    } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
