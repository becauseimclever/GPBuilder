import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const { materializeFirmware, applyConfigsOverlay } = createRequire(import.meta.url)(join(directory, 'firmware-source.cjs'));

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
  }), /v0\.7\.12 or main/);
  await assert.rejects(materializeFirmware({
    source: 'unused', release: 'v0.7.12', destination: directory,
    execute: async () => { throw new Error('unexpected process'); },
  }), /already exists/);
});

test('materializes the local main working tree including dirty files without touching the caller', async (context) => {
  const source = taggedFirmware(context);
  const commit = git(source, 'rev-parse', 'HEAD');
  writeFileSync(join(source, 'CMakeLists.txt'), 'project(dirty)\n');
  writeFileSync(join(source, 'untracked.txt'), 'caller data\n');
  mkdirSync(join(source, 'www', 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(source, 'www', 'node_modules', 'pkg', 'index.js'), 'x');
  mkdirSync(join(source, 'build'));
  writeFileSync(join(source, 'build', 'stale.uf2'), 'stale');
  const before = git(source, 'status', '--porcelain');
  const destination = join(directory, 'owned main copy');
  context.after(() => rmSync(destination, { recursive: true, force: true }));

  const result = await materializeFirmware({ source, release: 'main', destination });

  assert.equal(result.commit, commit);
  assert.equal(result.tag, 'main');
  assert.equal(result.dirty, true);
  assert.equal(readFileSync(join(destination, 'CMakeLists.txt'), 'utf8'), 'project(dirty)\n');
  assert.equal(readFileSync(join(destination, 'untracked.txt'), 'utf8'), 'caller data\n');
  assert.ok(existsSync(join(destination, '.git')));
  assert.ok(!existsSync(join(destination, 'www', 'node_modules')));
  assert.ok(!existsSync(join(destination, 'build')));
  assert.equal(git(destination, 'rev-parse', 'HEAD'), commit);
  assert.equal(git(source, 'status', '--porcelain'), before);
});

test('reports a clean local main copy as not dirty', async (context) => {
  const source = taggedFirmware(context);
  const destination = join(directory, 'clean main copy');
  context.after(() => rmSync(destination, { recursive: true, force: true }));
  const result = await materializeFirmware({ source, release: 'main', destination });
  assert.equal(result.dirty, false);
});

test('resolves upstream main once and checks out that exact commit', async () => {
  const commit = 'a'.repeat(40);
  const calls = [];
  const execute = async (command, args) => {
    calls.push(args.join(' '));
    if (args.includes('rev-parse') && args.includes('--verify')) return { stdout: `${commit}\n`, stderr: '' };
    if (args.includes('rev-parse')) return { stdout: `${commit}\n`, stderr: '' };
    if (args.includes('ls-tree')) return { stdout: `100644 blob ${'b'.repeat(40)}\tCMakeLists.txt\0`, stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const destination = join(directory, 'upstream main');
  const result = await materializeFirmware({ release: 'main', destination, execute });
  assert.equal(result.commit, commit);
  assert.equal(result.dirty, false);
  const fetches = calls.filter((call) => call.includes(' fetch '));
  assert.equal(fetches.length, 1);
  assert.match(fetches[0], /--filter=blob:none/);
  assert.match(fetches[0], /\+refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.doesNotMatch(fetches[0], /--depth/);
  assert.equal(calls.filter((call) => call.includes('--verify refs/remotes/origin/main^{commit}')).length, 1);
  assert.ok(calls.some((call) => call.endsWith(`checkout --quiet --detach ${commit}`)));
});

test('overlays an external board config directory onto the owned source', (context) => {
  const root = mkdtempSync(join(directory, 'overlay '));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const firmware = join(root, 'firmware');
  mkdirSync(join(firmware, 'configs', 'Pico'), { recursive: true });
  writeFileSync(join(firmware, 'configs', 'Pico', 'BoardConfig.h'), 'builtin');
  writeFileSync(join(firmware, 'configs', 'Pico', 'old.txt'), 'remove me');
  const configs = join(root, 'my configs');
  mkdirSync(join(configs, 'Pico', 'assets'), { recursive: true });
  writeFileSync(join(configs, 'Pico', 'BoardConfig.h'), 'custom');
  writeFileSync(join(configs, 'Pico', 'assets', 'a.txt'), 'asset');

  applyConfigsOverlay(firmware, configs, 'Pico');

  assert.equal(readFileSync(join(firmware, 'configs', 'Pico', 'BoardConfig.h'), 'utf8'), 'custom');
  assert.equal(readFileSync(join(firmware, 'configs', 'Pico', 'assets', 'a.txt'), 'utf8'), 'asset');
  assert.ok(!existsSync(join(firmware, 'configs', 'Pico', 'old.txt')));
  assert.equal(readFileSync(join(configs, 'Pico', 'BoardConfig.h'), 'utf8'), 'custom');
});

test('rejects a configs overlay without BoardConfig.h', (context) => {
  const root = mkdtempSync(join(directory, 'overlay missing '));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'configs', 'Pico'), { recursive: true });
  assert.throws(() => applyConfigsOverlay(join(root, 'fw'), join(root, 'configs'), 'Pico'), /BoardConfig\.h/);
});