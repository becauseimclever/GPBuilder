import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'gpbuilder-publish-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));
buildSync({ entryPoints: ['src/uf2.ts', 'src/artifact-publisher.ts'], outdir: directory, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
const { publishArtifact } = createRequire(import.meta.url)(join(directory, 'artifact-publisher.cjs'));

function uf2Block(number, address) {
  const bytes = Buffer.alloc(512);
  bytes.writeUInt32LE(0x0a324655, 0);
  bytes.writeUInt32LE(0x9e5d5157, 4);
  bytes.writeUInt32LE(0x2000, 8);
  bytes.writeUInt32LE(address, 12);
  bytes.writeUInt32LE(256, 16);
  bytes.writeUInt32LE(number, 20);
  bytes.writeUInt32LE(2, 24);
  bytes.writeUInt32LE(0xe48bff56, 28);
  bytes.writeUInt32LE(0x0ab16f30, 508);
  return bytes;
}

test('publishes a validated UF2 atomically with a verified digest and metadata', () => {
  const workingDirectory = join(directory, 'working tree');
  const source = join(directory, 'built.uf2');
  const bytes = Buffer.concat([uf2Block(0, 0x10000000), uf2Block(1, 0x10000100)]);
  writeFileSync(source, bytes);

  const result = publishArtifact({
    source, workingDirectory, runId: 'unit-run', release: 'v0.7.12', board: 'Pico', buildType: 'release',
    metadata: { firmwareCommit: 'fixture-commit' },
  });

  assert.equal(result.path, join(workingDirectory, 'artifacts', 'Pico', 'v0.7.12', 'release', 'unit-run', 'GP2040-CE_0.7.12_Pico.uf2'));
  assert.equal(statSync(result.path).size, bytes.length);
  assert.equal(result.byteSize, bytes.length);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(JSON.parse(readFileSync(result.metadataPath, 'utf8')).firmwareCommit, 'fixture-commit');
  assert.equal(JSON.parse(readFileSync(result.metadataPath, 'utf8')).artifact.sha256, result.sha256);
});

test('refuses malformed firmware and never overwrites an existing run', () => {
  const workingDirectory = join(directory, 'working tree');
  const invalid = join(directory, 'invalid.uf2');
  writeFileSync(invalid, Buffer.alloc(512));
  const options = {
    source: invalid, workingDirectory, runId: 'unit-run', release: 'v0.7.12', board: 'Pico', buildType: 'release', metadata: {},
  };
  assert.throws(() => publishArtifact(options), /magic/);
  const valid = join(directory, 'valid.uf2');
  writeFileSync(valid, Buffer.concat([uf2Block(0, 0x10000000), uf2Block(1, 0x10000100)]));
  assert.throws(() => publishArtifact({ ...options, source: valid }), /already exists/);
});
test('publishes main builds under the full commit with a commit-qualified filename', () => {
  const workingDirectory = join(directory, 'main tree');
  const source = join(directory, 'main.uf2');
  writeFileSync(source, Buffer.concat([uf2Block(0, 0x10000000), uf2Block(1, 0x10000100)]));
  const commit = 'a'.repeat(40);
  const result = publishArtifact({
    source, workingDirectory, runId: 'main-run', release: 'main', commit, board: 'Pico', buildType: 'release', metadata: {},
  });
  assert.equal(result.path, join(workingDirectory, 'artifacts', 'Pico', 'main', commit, 'release', 'main-run', `GP2040-CE_main_${commit}_Pico.uf2`));
  const metadata = JSON.parse(readFileSync(result.metadataPath, 'utf8'));
  assert.deepEqual(metadata.requested, { release: 'main', commit, board: 'Pico', buildType: 'release' });
  assert.equal(metadata.artifact.filename, `GP2040-CE_main_${commit}_Pico.uf2`);
});

test('requires a full lowercase commit for main publication', () => {
  const workingDirectory = join(directory, 'main tree');
  const source = join(directory, 'main-invalid.uf2');
  writeFileSync(source, Buffer.concat([uf2Block(0, 0x10000000), uf2Block(1, 0x10000100)]));
  const options = { source, workingDirectory, runId: 'main-bad', release: 'main', board: 'Pico', buildType: 'release', metadata: {} };
  assert.throws(() => publishArtifact(options), /commit/);
  assert.throws(() => publishArtifact({ ...options, commit: 'abc123' }), /commit/);
  assert.throws(() => publishArtifact({ ...options, commit: '../'.repeat(13) + 'a' }), /commit/);
});
