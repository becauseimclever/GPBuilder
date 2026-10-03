import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'gpbuilder-source-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const gitConfig = join(directory, 'gitconfig');
writeFileSync(gitConfig, '');
buildSync({ entryPoints: ['src/firmware-source.ts'], outdir: directory, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
const { materializeFirmware } = createRequire(import.meta.url)(join(directory, 'firmware-source.cjs'));

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig },
  }).trim();
}

function taggedFirmware(context) {
  const root = mkdtempSync(join(directory, 'firmware with spaces '));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'GPBuilder Tests');
  git(root, 'config', 'user.email', 'tests@example.invalid');
  writeFileSync(join(root, 'CMakeLists.txt'), 'project(fixture)\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'release');
  git(root, 'tag', 'v0.7.12');
  return root;
}

test('materializes exact local tag without including dirty caller files', async (context) => {
  const source = taggedFirmware(context);
  const commit = git(source, 'rev-parse', 'refs/tags/v0.7.12^{commit}');
  writeFileSync(join(source, 'CMakeLists.txt'), 'project(dirty)\n');
  writeFileSync(join(source, 'untracked.txt'), 'caller data\n');
  const before = git(source, 'status', '--porcelain');
  const destination = join(directory, 'owned source checkout');

  const result = await materializeFirmware({ source, release: 'v0.7.12', destination });

  assert.equal(result.directory, destination);
  assert.equal(result.commit, commit);
  assert.equal(result.tag, 'v0.7.12');
  assert.equal(readFileSync(join(destination, 'CMakeLists.txt'), 'utf8'), 'project(fixture)\n');
  assert.equal(git(source, 'status', '--porcelain'), before);
});

test('rejects unsupported tags and occupied destinations before running Git', async () => {
  const destination = join(directory, 'occupied');
  await assert.rejects(materializeFirmware({
    source: 'unused', release: 'v0.7.13', destination,
    execute: async () => { throw new Error('unexpected process'); },
  }), /v0\.7\.12 only/);
  await assert.rejects(materializeFirmware({
    source: 'unused', release: 'v0.7.12', destination: directory,
    execute: async () => { throw new Error('unexpected process'); },
  }), /already exists/);
});