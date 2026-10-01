import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'gpbuilder-selection-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const gitConfig = join(directory, 'gitconfig');
writeFileSync(gitConfig, '');
buildSync({ entryPoints: ['src/build-selection.ts', 'src/orchestrator.ts', 'src/cli.ts', 'src/action.ts'], outdir: directory, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
const selection = createRequire(import.meta.url)(join(directory, 'build-selection.cjs'));
const { run } = createRequire(import.meta.url)(join(directory, 'orchestrator.cjs'));

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig },
  }).trim();
}

function firmwareFixture(context) {
  const root = mkdtempSync(join(directory, 'firmware with spaces '));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'GPBuilder Tests');
  git(root, 'config', 'user.email', 'tests@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(root, 'CMakeLists.txt'), 'project(fixture)\n');
  mkdirSync(join(root, 'configs', 'Pico'), { recursive: true });
  writeFileSync(join(root, 'configs', 'Pico', 'BoardConfig.h'), '#pragma once\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'fixture');
  git(root, 'tag', 'v0.7.9');
  git(root, 'tag', '-a', 'v0.7.10', '-m', 'release');
  git(root, 'tag', 'development');
  return root;
}

test('lists local release-shaped tags in descending numeric order without changing the checkout', (context) => {
  const root = firmwareFixture(context);
  const before = git(root, 'status', '--porcelain');
  assert.deepEqual(selection.listReleases(root), ['v0.7.10', 'v0.7.9']);
  assert.equal(git(root, 'status', '--porcelain'), before);
});

test('built-in boards come from the selected release, not dirty working-tree configs', (context) => {
  const root = firmwareFixture(context);
  mkdirSync(join(root, 'configs', 'NewBoard'));
  writeFileSync(join(root, 'configs', 'NewBoard', 'BoardConfig.h'), 'new board\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'new board');
  git(root, 'tag', 'v0.8.0');
  rmSync(join(root, 'configs', 'Pico'), { recursive: true });
  const before = git(root, 'status', '--porcelain');
  assert.deepEqual(selection.listBoards(root, 'v0.7.10'), ['Pico']);
  assert.deepEqual(selection.listBoards(root, 'v0.8.0'), ['NewBoard', 'Pico']);
  assert.equal(git(root, 'status', '--porcelain'), before);
});

test('external config directories replace built-in boards and ignore incomplete entries', (context) => {
  const root = firmwareFixture(context);
  const configs = join(root, 'external configs');
  mkdirSync(join(configs, 'CustomBoard'), { recursive: true });
  mkdirSync(join(configs, 'Incomplete'));
  writeFileSync(join(configs, 'CustomBoard', 'BoardConfig.h'), 'custom\n');
  writeFileSync(join(configs, 'README.md'), 'not a board\n');
  assert.deepEqual(selection.listBoards(root, 'v0.7.9', configs), ['CustomBoard']);
});

test('unknown tags, missing config roots, and tags without firmware structure fail clearly', (context) => {
  const root = firmwareFixture(context);
  assert.throws(() => selection.listBoards(root, 'v99.0.0'), /not available locally/);
  assert.throws(() => selection.listBoards(root, '--help'), /release tag/);
  assert.throws(() => selection.listBoards(root, 'v0.7.9', join(root, 'absent')), /config directory/);
  git(root, 'rm', 'CMakeLists.txt');
  git(root, 'commit', '--quiet', '-m', 'not firmware');
  git(root, 'tag', 'v9.0.0');
  assert.throws(() => selection.listBoards(root, 'v9.0.0'), /CMakeLists.txt/);
});

test('shared selection returns the exact commit and board without probing host build tools', (context) => {
  const root = firmwareFixture(context);
  const logs = [];
  const options = {
    operation: 'select-build', mode: 'local', firmware: root, release: 'v0.7.10', board: 'Pico',
    log: (line) => logs.push(line), execute: () => { throw new Error('Must not probe build tools'); },
  };
  const result = run(options);
  assert.deepEqual(result.selection, {
    firmware: root, release: 'v0.7.10', commit: git(root, 'rev-parse', 'HEAD'),
    board: 'Pico', configSource: 'firmware', configPath: 'configs/Pico',
  });
  assert.ok(logs.some((line) => line.includes('no firmware was built')));
  for (const board of ['Unknown', '../Pico', '/Pico', 'pico']) {
    assert.throws(() => run({ ...options, board }), /board/i);
  }
  for (const field of ['firmware', 'release', 'board']) {
    assert.throws(() => run({ ...options, [field]: '' }), new RegExp(field, 'i'));
  }
});

test('CLI and Action expose the same offline selection and external config directory', (context) => {
  const root = firmwareFixture(context);
  const configs = join(root, 'external configs');
  mkdirSync(join(configs, 'Custom'), { recursive: true });
  writeFileSync(join(configs, 'Custom', 'BoardConfig.h'), '#pragma once\n');
  const cli = (...args) => spawnSync(process.execPath, [join(directory, 'cli.cjs'), ...args], { encoding: 'utf8' });
  const releases = cli('--list-releases', '--firmware', root);
  assert.equal(releases.status, 0, releases.stderr);
  assert.equal(releases.stdout.trim(), 'v0.7.10\nv0.7.9');
  const boards = cli('--list-boards', '--firmware', root, '--release', 'v0.7.9');
  assert.equal(boards.status, 0, boards.stderr);
  assert.equal(boards.stdout.trim(), 'Pico');
  const selected = cli('--select-build', '--firmware', root, '--release', 'v0.7.9', '--board', 'Custom', '--configs', configs);
  assert.equal(selected.status, 0, selected.stderr);
  assert.match(selected.stdout, /Board: Custom/);
  assert.match(selected.stdout, /Config source: external/);
  assert.doesNotMatch(selected.stdout, /Prerequisite report/);
  const output = join(root, 'action-output');
  writeFileSync(output, '');
  const action = spawnSync(process.execPath, [join(directory, 'action.cjs')], {
    encoding: 'utf8', env: {
      ...process.env, GITHUB_OUTPUT: output, GITHUB_ACTIONS: 'false',
      INPUT_COMMAND: 'select-build', INPUT_FIRMWARE: root, INPUT_RELEASE: 'v0.7.9',
      INPUT_BOARD: 'Custom', INPUT_CONFIGS: configs,
    },
  });
  assert.equal(action.status, 0, action.stderr + action.stdout);
  assert.equal(action.stdout.replaceAll('\r\n', '\n'), selected.stdout);
  const outputs = readFileSync(output, 'utf8');
  assert.match(outputs, /firmware-commit<</);
  assert.ok(outputs.includes(git(root, 'rev-parse', 'HEAD')));
  assert.match(outputs, /config-path<</);
  assert.ok(outputs.includes(join(configs, 'Custom')));
  const conflicting = cli('--list-releases', '--build', '--firmware', root);
  assert.equal(conflicting.status, 1);
  assert.match(conflicting.stderr, /Choose one operation/);
  const missing = cli('--select-build', '--firmware', root, '--release', 'v0.7.9');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /board/i);
});

test('selection requires the repository root and preserves Git failure diagnostics', (context) => {
  const root = firmwareFixture(context);
  assert.throws(() => selection.listReleases(join(root, 'configs')), /repository root/);
  const invalid = join(root, 'missing checkout');
  assert.throws(() => selection.listReleases(invalid), /fatal:.*cannot change/i);
  const noOperation = spawnSync(process.execPath, [join(directory, 'cli.cjs'), '--board', 'Pico'], { encoding: 'utf8' });
  assert.equal(noOperation.status, 1);
  assert.match(noOperation.stderr, /Choose an operation/);
});

test('external configs do not follow board-directory symlinks or accept header directories', (context) => {
  const root = firmwareFixture(context);
  const configs = join(root, 'external');
  mkdirSync(join(configs, 'Invalid', 'BoardConfig.h'), { recursive: true });
  symlinkSync(join(root, 'configs', 'Pico'), join(configs, 'Linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(selection.listBoards(root, 'v0.7.9', configs), []);
  assert.throws(() => run({
    mode: 'local', operation: 'select-build', firmware: root, release: 'v0.7.9', board: 'Pico', configs,
    log: () => {},
  }), /Unknown board/);
});

test('builds with valid selections pass the mandatory gate then fail explicitly as unimplemented', (context) => {
  const root = firmwareFixture(context);
  for (const mode of ['local', 'action']) {
    const logs = [];
    assert.throws(() => run({
      mode, operation: 'build', firmware: root, release: 'v0.7.9', board: 'Pico',
      host: { platform: 'linux', ubuntu: true, githubActions: true },
      log: (line) => logs.push(line),
      execute: (command, args) => {
        assert.notEqual(command, 'sudo');
        const versions = { node: 'v24.0.0', npm: '11.0.0', cmake: 'cmake version 3.28.0', python3: 'Python 3.12.0', 'c++': 'g++ (GCC) 13.2.0' };
        const library = args[0]?.startsWith('-print-file-name=') ? `/toolchain/${args[0].split('=')[1]}` : undefined;
        return { status: 0, stdout: library ?? versions[command] ?? `${command} 1.0`, stderr: '' };
      },
    }), /no firmware was built/);
    assert.ok(logs.includes('12/12 prerequisites available.'));
    assert.ok(logs.some((line) => line.includes('Board: Pico')));
  }
});