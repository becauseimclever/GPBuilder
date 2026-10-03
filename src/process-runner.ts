import { spawn } from 'node:child_process';

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  stage: string;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export type ProcessExecutor = (command: string, args: string[], options: ProcessOptions) => Promise<ProcessResult>;

const maxOutputBytes = 1024 * 1024;

function appendBounded(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8');
  return Buffer.byteLength(next) <= maxOutputBytes
    ? next
    : Buffer.from(next).subarray(-maxOutputBytes).toString('utf8');
}

function terminateTree(pid: number): void {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => {});
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      return;
    }
    const forceKill = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        return;
      }
    }, 2000);
    forceKill.unref();
  }
}

export const executeProcess: ProcessExecutor = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    windowsVerbatimArguments: process.platform === 'win32' && command.toLowerCase() === 'cmd.exe',
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let settled = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) terminateTree(child.pid);
  }, options.timeoutMs);
  const finishError = (error: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    reject(error);
  };

  child.stdout.on('data', (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
  child.on('error', (error) => finishError(new Error(`${options.stage}: could not start ${command}: ${error.message}`, { cause: error })));
  child.on('close', (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (timedOut) {
      reject(new Error(`${options.stage} timed out after ${Math.ceil(options.timeoutMs / 60_000)} minutes.\n${stderr || stdout}`));
    } else if (code !== 0) {
      reject(new Error(`${options.stage} failed with exit ${String(code)}${signal ? ` (${signal})` : ''}.\n${stderr || stdout}`));
    } else {
      resolve({ stdout, stderr });
    }
  });
});