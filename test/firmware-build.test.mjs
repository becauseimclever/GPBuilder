import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'gpbuilder-firmware-build-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));
buildSync({ entryPoints: ['src/firmware-build.ts'], outdir: directory, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
const {
  selectToolProfile,
  parseCmakeMinimums,
  checkMinimums,
  compareVersions,
  firmwareOutputName,
  validateFirmwareBuildRequest,
  firmwareConfigureArgs,
  nanopbPipConstraint,
  resolveBoardPlatform,
} =  createRequire(import.meta.url)(join(directory, 'firmware-build.cjs'));

const mainCmake = `cmake_minimum_required(VERSION 3.10)
set(sdkVersion 2.3.1)
set(toolchainVersion 15_2_Rel1)
set(picotoolVersion 2.3.1)
if (PICO_SDK_VERSION_STRING VERSION_LESS "2.3.1")
  message(FATAL_ERROR "Require at least Raspberry Pi Pico SDK version 2.3.1")
endif()
`;

test('configure arguments use prebuilt pioasm and picotool packages when available', () => {
  const base = { sourceDirectory: 'src', buildDirectory: 'build', ninja: 'ninja.exe', sdkDirectory: 'sdk', python: 'python.exe', toolsDirectory: 'tools', board: 'OpenCore0', picoBoard: 'pico', picoPlatform: 'rp2040' };
  const fetched = firmwareConfigureArgs(base);
  assert.ok(fetched.includes('-DPICOTOOL_FETCH_FROM_GIT_PATH=tools'));
  assert.ok(!fetched.some((arg) => arg.startsWith('-Dpioasm_DIR=') || arg.startsWith('-Dpicotool_DIR=')));

  const prebuilt = firmwareConfigureArgs({ ...base, prebuilt: { pioasmVersion: 'v2.3.1', pioasmDir: 'pio', picotoolVersion: '2.3.1', picotoolDir: 'pt' } });
  assert.ok(prebuilt.includes('-Dpioasm_DIR=pio'));
  assert.ok(prebuilt.includes('-Dpicotool_DIR=pt'));
  assert.ok(!prebuilt.some((arg) => arg.startsWith('-DPICOTOOL_FETCH_FROM_GIT_PATH=')));
  assert.deepEqual(prebuilt.slice(0, 4), fetched.slice(0, 4));
});

test('configure arguments name the requested board and its derived SDK board and platform', () => {
  const args = firmwareConfigureArgs({ sourceDirectory: 'src', buildDirectory: 'build', ninja: 'ninja.exe', sdkDirectory: 'sdk', python: 'python.exe', toolsDirectory: 'tools', board: 'OpenCore0', picoBoard: 'pico', picoPlatform: 'rp2040' });
  assert.ok(args.includes('-DGP2040_BOARDCONFIG=OpenCore0'));
  assert.ok(args.includes('-DPICO_BOARD=pico'));
  assert.ok(args.includes('-DPICO_PLATFORM=rp2040'));
  assert.ok(!args.includes('-DGP2040_BOARDCONFIG=Pico'));
});

test('derives the board platform from the optional board cmake file', () => {
  assert.deepEqual(resolveBoardPlatform('OpenCore0', undefined), { picoBoard: 'pico', picoPlatform: 'rp2040' });
  assert.deepEqual(resolveBoardPlatform('PicoW', 'set(PICO_BOARD pico_w)\n'), { picoBoard: 'pico_w', picoPlatform: 'rp2040' });
  assert.deepEqual(
    resolveBoardPlatform('Custom', '# set(PICO_BOARD ignored)\nset(PICO_BOARD "my_board")\nset(PICO_PLATFORM rp2040)\n'),
    { picoBoard: 'my_board', picoPlatform: 'rp2040' },
  );
  assert.throws(
    () => resolveBoardPlatform('Pico2', 'set(PICO_BOARD pico2)\nset(PICO_PLATFORM rp2350)\n'),
    /Pico2.*rp2350.*only RP2040/i,
  );
});

test('constrains setuptools only when nanopb requirements leave it unpinned', () => {
  assert.equal(nanopbPipConstraint('protobuf>=3.19\ngrpcio-tools>=1.46.0\n'), 'setuptools<81\n');
  assert.equal(nanopbPipConstraint(undefined), 'setuptools<81\n');
  assert.equal(nanopbPipConstraint('protobuf==6.33.5\ngrpcio-tools==1.78.0\nsetuptools==81.0.0\n'), undefined);
  assert.equal(nanopbPipConstraint('  Setuptools >= 70\n'), undefined);
  assert.equal(nanopbPipConstraint('# setuptools is not needed\nprotobuf\n'), 'setuptools<81\n');
});

test('selects pinned tool profiles per release', () => {
  const tagged = selectToolProfile('v0.7.12');
  assert.equal(tagged.sdkTag, '2.1.1');
  assert.equal(tagged.sdkCommit, 'bddd20f928ce76142793bef434d4f75f4af6e433');
  assert.equal(tagged.picotool, '2.1.1');
  assert.equal(tagged.firmwareCommit, '0014e4ae2a312332e2582f6708dcc7d6bec5de8c');
  const main = selectToolProfile('main');
  assert.equal(main.sdkTag, '2.3.1');
  assert.equal(main.sdkCommit, undefined);
  assert.equal(main.picotool, '2.3.1');
  assert.equal(main.firmwareCommit, undefined);
  assert.throws(() => selectToolProfile('v0.7.11'), /v0\.7\.12 or main/);
});

test('compares dotted and Arm release versions numerically', () => {
  assert.equal(compareVersions('2.3.1', '2.10.0'), -1);
  assert.equal(compareVersions('2.3.1', '2.3.1'), 0);
  assert.equal(compareVersions('2.3', '2.3.0'), 0);
  assert.equal(compareVersions('15_2_Rel1', '14_2_Rel1'), 1);
  assert.equal(compareVersions('15_2_Rel1', '15_2_Rel2'), -1);
});

test('parses firmware minimums statically and uses the stricter SDK requirement', () => {
  assert.deepEqual(parseCmakeMinimums(mainCmake), { sdk: '2.3.1', toolchain: '15_2_Rel1', picotool: '2.3.1' });
  const guardStricter = mainCmake.replace('set(sdkVersion 2.3.1)', 'set(sdkVersion 2.2.0)');
  assert.equal(parseCmakeMinimums(guardStricter).sdk, '2.3.1');
  const hintStricter = mainCmake.replace('set(sdkVersion 2.3.1)', 'set(sdkVersion 2.4.0)');
  assert.equal(parseCmakeMinimums(hintStricter).sdk, '2.4.0');
  assert.deepEqual(parseCmakeMinimums('project(x)\n'), {});
});

test('accepts minimums the profile satisfies and rejects missing or newer ones', () => {
  const profile = selectToolProfile('main');
  assert.doesNotThrow(() => checkMinimums(parseCmakeMinimums(mainCmake), profile));
  assert.doesNotThrow(() => checkMinimums({ sdk: '2.1.1', toolchain: '14_2_Rel1', picotool: '2.1.1' }, profile));
  assert.throws(() => checkMinimums({ toolchain: '15_2_Rel1', picotool: '2.3.1' }, profile), /SDK.*not declare/i);
  assert.throws(
    () => checkMinimums({ sdk: '2.4.0', toolchain: '15_2_Rel1', picotool: '2.3.1' }, profile),
    /SDK 2\.4\.0.*pinned 2\.3\.1/,
  );
  assert.throws(
    () => checkMinimums({ sdk: '2.3.1', toolchain: '16_1_Rel1', picotool: '2.3.1' }, profile),
    /16_1_Rel1.*pinned 15_2_Rel1/,
  );
  assert.throws(
    () => checkMinimums({ sdk: '2.3.1', toolchain: '15_2_Rel1', picotool: '2.5.0' }, profile),
    /picotool 2\.5\.0.*pinned 2\.3\.1/,
  );
});

test('derives upstream output names from git describe', () => {
  assert.equal(firmwareOutputName('v0.7.12', 'Pico'), 'GP2040-CE_0.7.12_Pico');
  assert.equal(firmwareOutputName('v0.7.12-31-gabcdef1', 'Pico'), 'GP2040-CE_0.7.12_Pico');
  assert.equal(firmwareOutputName('abcdef1-dirty', 'Pico'), 'GP2040-CE_0.0.0_Pico');
});

test('validates release, board, host, and supplied folders before building', () => {
  const firmware = join(directory, 'firmware');
  const configs = join(directory, 'configs');
  mkdirSync(firmware, { recursive: true });
  mkdirSync(configs, { recursive: true });
  const base = { board: 'Pico', platform: 'win32' };
  assert.doesNotThrow(() => validateFirmwareBuildRequest({ ...base, release: 'v0.7.12' }));
  assert.doesNotThrow(() => validateFirmwareBuildRequest({ ...base, release: 'main', firmware, configs }));
  assert.doesNotThrow(() => validateFirmwareBuildRequest({ ...base, release: 'v0.7.12', configs }));
  assert.throws(() => validateFirmwareBuildRequest({ ...base, release: 'v0.7.11' }), /v0\.7\.12 or main/);
  assert.doesNotThrow(() => validateFirmwareBuildRequest({ ...base, release: 'main', board: 'OpenCore0', firmware, configs }));
  assert.throws(() => validateFirmwareBuildRequest({ ...base, release: 'main', firmware: join(directory, 'missing') }), /Firmware source folder.*not found/i);
  assert.throws(() => validateFirmwareBuildRequest({ ...base, release: 'main', configs: join(directory, 'missing') }), /Configs folder.*not found/i);
  assert.throws(() => validateFirmwareBuildRequest({ ...base, release: 'main', platform: 'linux' }), /only been integration-qualified on Windows x64/);
});
