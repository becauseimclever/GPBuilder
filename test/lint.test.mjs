import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint();

for (const filePath of ['action.yml', '.github/workflows/lint-fixture.yml', 'config/example.yaml']) {
  test(`ESLint validates YAML in ${filePath}`, async () => {
    const [valid] = await eslint.lintText('name: example\nenabled: true\n', { filePath });
    assert.equal(valid.errorCount, 0);
    assert.equal(valid.warningCount, 0, 'YAML must be linted, not reported as ignored');

    const [invalid] = await eslint.lintText('name: first\nname: duplicate\n', { filePath });
    assert.ok(invalid.errorCount > 0, 'Duplicate YAML keys must fail linting');

    const [malformed] = await eslint.lintText('name: [unterminated\n', { filePath });
    assert.ok(malformed.errorCount > 0, 'Malformed YAML must fail linting');
  });
}