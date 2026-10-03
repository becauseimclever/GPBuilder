import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'gpbuilder-process-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));
buildSync({ entryPoints: ['src/process-runner.ts'], outdir: directory, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
const { executeProcess } = createRequire(import.meta.url)(join(directory, 'process-runner.cjs'));

test('returns bounded process output and includes stage diagnostics on nonzero exit', async () => {
  await assert.rejects(executeProcess(process.execPath, ['-e', 'process.stderr.write("compile broke"); process.exit(7)'], {
    timeoutMs: 10_000, stage: 'Compile test',
  }), /Compile test failed with exit 7.*compile broke/s);
});

test('terminates a process after its stage timeout', async () => {
  await assert.rejects(executeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 50, stage: 'Timeout test',
  }), /Timeout test timed out/);
});

test('preserves quoted arguments passed through cmd.exe on Windows', { skip: process.platform !== 'win32' }, async () => {
  const result = await executeProcess('cmd.exe', ['/d', '/c', 'echo "build directory"'], {
    timeoutMs: 10_000, stage: 'Windows shell quoting test',
  });
  assert.match(result.stdout, /build directory/);
});