import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'gpbuilder-uf2-'));
after(() => rmSync(directory, { recursive: true, force: true }));
buildSync({ entryPoints: ['src/uf2.ts'], outdir: directory, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
const { validateUf2 } = createRequire(import.meta.url)(join(directory, 'uf2.cjs'));

function block(number, address, options = {}) {
  const bytes = Buffer.alloc(512);
  bytes.writeUInt32LE(options.magic0 ?? 0x0a324655, 0);
  bytes.writeUInt32LE(options.magic1 ?? 0x9e5d5157, 4);
  bytes.writeUInt32LE(options.flags ?? 0x2000, 8);
  bytes.writeUInt32LE(address, 12);
  bytes.writeUInt32LE(options.payloadSize ?? 256, 16);
  bytes.writeUInt32LE(options.number ?? number, 20);
  bytes.writeUInt32LE(options.count ?? 2, 24);
  bytes.writeUInt32LE(options.family ?? 0xe48bff56, 28);
  bytes.writeUInt32LE(0x0ab16f30, 508);
  return bytes;
}

test('validates RP2040 UF2 blocks and returns their contiguous flash range', () => {
  const result = validateUf2(Buffer.concat([
    block(1, 0x10000100),
    block(0, 0x10000000),
  ]));
  assert.deepEqual(result, {
    blockCount: 2,
    addressStart: 0x10000000,
    addressEnd: 0x10000200,
    familyId: 0xe48bff56,
  });
});

test('rejects malformed block structure, unsupported flags, and non-Pico addresses', () => {
  assert.throws(() => validateUf2(Buffer.alloc(511)), /512-byte blocks/);
  assert.throws(() => validateUf2(Buffer.concat([block(0, 0x10000000, { magic0: 1 }), block(1, 0x10000100)])), /magic/);
  assert.throws(() => validateUf2(Buffer.concat([block(0, 0x10000000, { family: 0x12345678 }), block(1, 0x10000100)])), /RP2040 family/);
  assert.throws(() => validateUf2(Buffer.concat([block(0, 0x10000000, { flags: 0x2001 }), block(1, 0x10000100)])), /flags/);
  assert.throws(() => validateUf2(Buffer.concat([block(0, 0x10000000, { count: 3 }), block(1, 0x10000100)])), /block count/);
  assert.throws(() => validateUf2(Buffer.concat([block(0, 0x10000000), block(0, 0x10000100)])), /block numbers/);
  assert.throws(() => validateUf2(Buffer.concat([block(0, 0x10000000, { payloadSize: 477 }), block(1, 0x10000100)])), /payload size/);
  assert.throws(() => validateUf2(Buffer.concat([block(0, 0x10000002), block(1, 0x10000100)])), /aligned/);
  assert.throws(() => validateUf2(Buffer.concat([block(0, 0x10000000), block(1, 0x10000080)])), /overlap/);
  assert.throws(() => validateUf2(Buffer.concat([block(0, 0x10200000), block(1, 0x10000100)])), /flash range/);
});