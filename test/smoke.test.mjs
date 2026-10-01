import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

for (const entry of ['cli', 'action']) {
  test(`${entry} bundle runs outside the repository`, (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'gpbuilder-'));
    context.after(() => rmSync(directory, { recursive: true, force: true }));

    const bundle = fileURLToPath(new URL(`../dist/${entry}.cjs`, import.meta.url));
    const standaloneBundle = join(directory, `${entry}.cjs`);
    copyFileSync(bundle, standaloneBundle);
    const result = spawnSync(process.execPath, [standaloneBundle], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, PATH: '', GITHUB_ACTIONS: 'false', INPUT_COMMAND: 'check-prerequisites' },
    });

    assert.ifError(result.error);
    if (entry === 'cli') {
      assert.equal(result.status, 0);
      assert.match(result.stdout, /Usage: node dist\/cli.cjs/);
      for (const flag of ['--check-prerequisites', '--build']) {
        const checked = spawnSync(process.execPath, [standaloneBundle, flag], {
          cwd: directory, encoding: 'utf8', env: { ...process.env, PATH: '', GITHUB_ACTIONS: 'true' },
        });
        assert.equal(checked.status, 1);
        assert.match(checked.stdout, /Prerequisite report/);
        assert.match(checked.stderr, /Prerequisite check failed/);
        assert.doesNotMatch(checked.stdout, /Installing Ubuntu packages/);
      }
      const invalid = spawnSync(process.execPath, [standaloneBundle, '--unknown'], { encoding: 'utf8' });
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /Unknown option/);
    } else {
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Prerequisite report/);
      assert.match(result.stdout, /Automatic installation requires/);
      assert.doesNotMatch(result.stdout, /Installing Ubuntu packages/);
    }
  });
}