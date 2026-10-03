import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'gpbuilder-tests-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const bundle = join(directory, 'prerequisites.cjs');
buildSync({ entryPoints: ['src/prerequisites.ts', 'src/orchestrator.ts'], outdir: directory, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
const { checkPrerequisites } = createRequire(import.meta.url)(bundle);
const { run } = createRequire(import.meta.url)(join(directory, 'orchestrator.cjs'));
const host = { platform: 'linux', ubuntu: true, githubActions: true };

function available(command, args) {
  const versions = { node: 'v24.17.0', npm: '11.0.0', cmake: 'cmake version 3.28.0', python3: 'Python 3.12.0', python: 'Python 3.12.0', 'c++': 'g++ (GCC) 13.2.0' };
  const library = args[0]?.startsWith('-print-file-name=') ? `/toolchain/${args[0].split('=')[1]}` : undefined;
  return { status: 0, stdout: library ?? versions[command] ?? `${command} 1.0`, stderr: '' };
}

test('all tools are reported and a ready Action does not install anything', () => {
  const calls = [];
  const logs = [];
  const results = checkPrerequisites({ mode: 'action', host, log: (line) => logs.push(line), execute: (command, args) => {
    calls.push(command);
    return available(command, args);
  } });
  assert.equal(results.length, 12);
  assert.ok(results.every((result) => result.status === 'available'));
  assert.ok(logs.includes('12/12 prerequisites available.'));
  assert.ok(!calls.includes('sudo'));
});

test('local mode reports missing and unusable tools without installing, even in CI', () => {
  const calls = [];
  const results = checkPrerequisites({ mode: 'local', host, log: () => {}, execute: (command, args) => {
    calls.push(command);
    if (command === 'git') return { status: null, stdout: '', stderr: '', missing: true };
    if (command === 'cmake') return { status: 0, stdout: 'cmake version 3.9.0', stderr: '' };
    return available(command, args);
  } });
  assert.equal(results.find((result) => result.name === 'Git').status, 'missing');
  assert.equal(results.find((result) => result.name.startsWith('CMake')).status, 'unusable');
  assert.ok(!calls.includes('sudo'));
});

test('Ubuntu Action installs only missing packages and rechecks', () => {
  const installs = [];
  let installed = false;
  const results = checkPrerequisites({ mode: 'action', host, log: () => {}, execute: (command, args) => {
    if (command === 'sudo') {
      installs.push(args);
      if (args.includes('install')) installed = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (['ninja', 'make'].includes(command) && !installed) return { status: null, stdout: '', stderr: '', missing: true };
    return available(command, args);
  } });
  assert.deepEqual(installs, [
    ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'update'],
    ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--no-install-recommends', 'ninja-build'],
  ]);
  assert.ok(results.every((result) => result.status === 'available'));
});

test('installation failure still prints a final report and throws', () => {
  const logs = [];
  assert.throws(() => checkPrerequisites({ mode: 'action', host, log: (line) => logs.push(line), execute: (command, args) => {
    if (command === 'sudo') return { status: 1, stdout: '', stderr: 'permission denied' };
    if (command === 'git') return { status: null, stdout: '', stderr: '', missing: true };
    return available(command, args);
  } }), /installation failed: permission denied/);
  assert.ok(logs.includes('Prerequisite report after installation'));
});

test('unsupported Action platforms fail after reporting without installing', () => {
  const logs = [];
  assert.throws(() => checkPrerequisites({ mode: 'action', host: { ...host, platform: 'darwin' }, log: (line) => logs.push(line), execute: () => ({ status: null, stdout: '', stderr: '', missing: true }) }), /Ubuntu runner/);
  assert.ok(logs.includes('0/12 prerequisites available.'));
});

test('Windows Python fallback is reused for venv checks', () => {
  const commands = [];
  const results = checkPrerequisites({ mode: 'local', host: { ...host, platform: 'win32' }, log: () => {}, execute: (command, args) => {
    commands.push([command, args[0]]);
    if (command === 'python3') return { status: 1, stdout: '', stderr: 'not found' };
    return available(command, args);
  } });
  assert.ok(results.every((result) => result.status === 'available'));
  assert.ok(commands.some(([command, argument]) => command === 'python' && argument === '-c'));
});

test('builds cannot bypass prerequisite checks in either mode', () => {
  for (const mode of ['local', 'action']) {
    const logs = [];
    assert.throws(() => run({ mode, operation: 'build', host, log: (line) => logs.push(line), execute: (command, args) => {
      if (command === 'git') return { status: null, stdout: '', stderr: '', missing: true };
      return available(command, args);
    } }), /Prerequisite check failed: Git/);
    assert.ok(logs.includes('Prerequisite report'));
  }
});

test('a build with available tools still requires an explicit release and board', () => {
  const logs = [];
  assert.throws(() => run({ mode: 'local', operation: 'build', host, log: (line) => logs.push(line), execute: available }), /release input is required/);
  assert.ok(logs.includes('12/12 prerequisites available.'));
});

test('timeouts, failed probes, and unresolved compiler libraries are unusable', () => {
  const results = checkPrerequisites({ mode: 'local', host, log: () => {}, execute: (command, args, timeout) => {
    assert.equal(timeout, 10_000);
    if (command === 'git') return { status: null, stdout: '', stderr: '', error: 'timed out' };
    if (command === 'python3' && args[0] === '-c') return { status: 1, stdout: '', stderr: 'No module named ensurepip' };
    if (args[0] === '-print-file-name=libstdc++.a') return { status: 0, stdout: 'libstdc++.a', stderr: '' };
    return available(command, args);
  } });
  assert.equal(results.filter((result) => result.status === 'unusable').length, 3);
});

test('Make satisfies the generator check when Ninja is unavailable', () => {
  const results = checkPrerequisites({ mode: 'local', host, log: () => {}, execute: (command, args) => {
    if (command === 'ninja') return { status: null, stdout: '', stderr: '', missing: true };
    return available(command, args);
  } });
  assert.equal(results.find((result) => result.name === 'Ninja or Make').status, 'available');
});

test('an Action outside GitHub Actions cannot install tools', () => {
  const calls = [];
  assert.throws(() => run({ mode: 'action', operation: 'check-prerequisites', host: { ...host, githubActions: false }, log: () => {}, execute: (command) => {
    calls.push(command);
    return { status: null, stdout: '', stderr: '', missing: true };
  } }), /Ubuntu runner/);
  assert.ok(!calls.includes('sudo'));
});

test('missing Node/npm require bootstrap setup rather than distro replacement', () => {
  const calls = [];
  assert.throws(() => run({ mode: 'action', operation: 'check-prerequisites', host, log: () => {}, execute: (command, args) => {
    calls.push(command);
    if (command === 'node') return { status: 0, stdout: 'v22.0.0', stderr: '' };
    if (command === 'npm') return { status: null, stdout: '', stderr: '', missing: true };
    return available(command, args);
  } }), /Prerequisite check failed: Node.js 24 on PATH, npm/);
  assert.ok(!calls.includes('sudo'));
});

test('repair deduplicates packages and a successful installer cannot hide a failed recheck', () => {
  const installs = [];
  const logs = [];
  assert.throws(() => run({ mode: 'action', operation: 'check-prerequisites', host, log: (line) => logs.push(line), execute: (command, args, timeout) => {
    if (command === 'sudo') {
      assert.equal(timeout, 600_000);
      if (args.includes('install')) installs.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command.startsWith('arm-none-eabi-')) return { status: null, stdout: '', stderr: '', missing: true };
    return available(command, args);
  } }), /Prerequisite check failed: Arm GCC, Arm G\+\+, Arm C library, Arm C\+\+ library/);
  assert.equal(installs.length, 1);
  assert.equal(installs[0].filter((argument) => argument === 'gcc-arm-none-eabi').length, 1);
  assert.ok(logs.includes('Prerequisite report after installation'));
});

function picoFixture(context, paths) {
  const root = mkdtempSync(join(directory, 'pico home '));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const relative of paths) {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');
  }
  return root;
}

const missing = { status: null, stdout: '', stderr: '', missing: true };

test('discovers Windows Pico tools, sorts versions numerically, and reuses Arm binaries', (context) => {
  const picoRoot = picoFixture(context, [
    'cmake/v3.9.0/bin/cmake.exe', 'cmake/v3.10.0/bin/cmake.exe',
    'ninja/v1.13.2/ninja.exe',
    'toolchain/9_3_Rel1/bin/arm-none-eabi-gcc.exe',
    'toolchain/15_2_Rel1/bin/arm-none-eabi-gcc.exe',
    'toolchain/15_2_Rel1/bin/arm-none-eabi-g++.exe',
  ]);
  const calls = [];
  const results = checkPrerequisites({ mode: 'action', host: { ...host, platform: 'win32', picoRoot }, log: () => {}, execute: (command, args) => {
    calls.push([command, args]);
    if (['cmake', 'ninja', 'make', 'arm-none-eabi-gcc', 'arm-none-eabi-g++'].includes(command)) return missing;
    return available(basename(command).replace(/\.exe$/, ''), args);
  } });
  assert.ok(results.every((result) => result.status === 'available'));
  assert.match(results.find((result) => result.name.startsWith('CMake')).detail, /\[Pico extension\].*v3\.10\.0/);
  assert.match(results.find((result) => result.name === 'Arm C++ library').detail, /15_2_Rel1/);
  assert.ok(!calls.some(([command]) => command.includes('9_3_Rel1') || command === 'sudo'));
  assert.ok(calls.some(([command, args]) => command === join(picoRoot, 'toolchain/15_2_Rel1/bin/arm-none-eabi-gcc.exe') && args[0] === '-print-file-name=libc.a'));
});

test('working PATH tools take precedence over managed installations', (context) => {
  const picoRoot = picoFixture(context, ['cmake/v4.3.4/bin/cmake.exe', 'ninja/v1.13.2/ninja.exe']);
  const results = checkPrerequisites({ mode: 'local', host: { ...host, platform: 'win32', picoRoot }, log: () => {}, execute: (command, args) => {
    assert.ok(!isAbsolute(command));
    return available(command, args);
  } });
  assert.ok(results.every((result) => result.status === 'available'));
});

test('unusable PATH and newer managed tools fall back to a working older version', (context) => {
  const picoRoot = picoFixture(context, ['cmake/v4.0.0/bin/cmake', 'cmake/v3.28.0/bin/cmake']);
  const results = checkPrerequisites({ mode: 'local', host: { ...host, picoRoot }, log: () => {}, execute: (command, args) => {
    if (command === 'cmake') return { status: 0, stdout: 'cmake version 3.9.0', stderr: '' };
    if (command.includes('v4.0.0')) return { status: null, stdout: '', stderr: '', error: 'bad executable' };
    return available(basename(command), args);
  } });
  assert.match(results.find((result) => result.name.startsWith('CMake')).detail, /v3\.28\.0/);
});

test('missing or incomplete managed roots do not hide failed checks', (context) => {
  const root = picoFixture(context, ['cmake/v3.28.0/README.txt']);
  for (const picoRoot of [root, join(root, 'absent')]) {
    const results = checkPrerequisites({ mode: 'local', host: { ...host, picoRoot }, log: () => {}, execute: () => missing });
    assert.ok(results.every((result) => result.status === 'missing'));
  }
});

test('managed Arm library probes cannot silently switch to a different version', (context) => {
  const picoRoot = picoFixture(context, [
    'toolchain/15_2_Rel1/bin/arm-none-eabi-gcc', 'toolchain/15_2_Rel1/bin/arm-none-eabi-g++',
    'toolchain/14_2_Rel1/bin/arm-none-eabi-gcc', 'toolchain/14_2_Rel1/bin/arm-none-eabi-g++',
  ]);
  const results = checkPrerequisites({ mode: 'local', host: { ...host, picoRoot }, log: () => {}, execute: (command, args) => {
    assert.ok(!command.includes('14_2_Rel1'));
    if (command.startsWith('arm-none-eabi-')) return missing;
    if (args[0] === '-print-file-name=libstdc++.a') return { status: 0, stdout: 'libstdc++.a', stderr: '' };
    return available(basename(command), args);
  } });
  assert.equal(results.find((result) => result.name === 'Arm C++ library').status, 'unusable');
});

test('discovers macOS application-bundle CMake and bin-layout Ninja', (context) => {
  const picoRoot = picoFixture(context, ['cmake/v3.31.0/CMake.app/Contents/bin/cmake', 'ninja/v1.12.0/bin/ninja']);
  const results = checkPrerequisites({ mode: 'local', host: { ...host, platform: 'darwin', picoRoot }, log: () => {}, execute: (command, args) => {
    if (['cmake', 'ninja', 'make'].includes(command)) return missing;
    return available(basename(command), args);
  } });
  assert.ok(results.every((result) => result.status === 'available'));
});

test('host compiler detection supports GCC and Clang names on all platforms', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const compiler of ['g++', 'clang++']) {
      const results = checkPrerequisites({ mode: 'local', host: { ...host, platform }, log: () => {}, execute: (command, args) => {
        if (command === 'c++') return missing;
        if (command === 'g++' && compiler !== 'g++') return missing;
        if (command === compiler) return { status: 0, stdout: `${compiler} version 18.0.0`, stderr: '' };
        return available(command, args);
      } });
      const result = results.find((item) => item.name === 'Host C++ compiler');
      assert.equal(result.status, 'available');
      assert.ok(result.detail.includes(`[PATH] ${compiler}:`));
    }
  }
});

test('CXX selects an executable with spaces without invoking a shell', () => {
  const compiler = join(directory, 'custom compiler', 'clang++.exe');
  const results = checkPrerequisites({ mode: 'local', host: { ...host, cxx: compiler }, log: () => {}, execute: (command, args) => {
    if (command === compiler) {
      assert.deepEqual(args, ['--version']);
      return { status: 0, stdout: 'clang version 18.0.0', stderr: '' };
    }
    assert.notEqual(command, 'c++');
    return available(command, args);
  } });
  assert.match(results.find((result) => result.name === 'Host C++ compiler').detail, /\[CXX\]/);
});

test('invalid explicit CXX does not silently fall back, and Arm GCC is not a host compiler', () => {
  for (const cxx of ['not-a-compiler', 'arm-none-eabi-g++']) {
    const results = checkPrerequisites({ mode: 'local', host: { ...host, cxx }, log: () => {}, execute: (command, args) => {
      assert.notEqual(command, 'c++');
      if (command === 'not-a-compiler') return missing;
      return available(command, args);
    } });
    assert.notEqual(results.find((result) => result.name === 'Host C++ compiler').status, 'available');
  }
});

test('macOS discovers and probes the active Xcode compiler via xcrun', () => {
  const compiler = join(directory, 'Xcode.app', 'Contents', 'Developer', 'usr', 'bin', 'clang++');
  const results = checkPrerequisites({ mode: 'local', host: { ...host, platform: 'darwin' }, log: () => {}, execute: (command, args) => {
    if (['c++', 'g++', 'clang++'].includes(command)) return missing;
    if (command === 'xcrun') {
      assert.deepEqual(args, ['--find', 'clang++']);
      return { status: 0, stdout: compiler, stderr: '' };
    }
    if (command === compiler) return { status: 0, stdout: 'Apple clang version 17.0.0', stderr: '' };
    return available(command, args);
  } });
  assert.match(results.find((result) => result.name === 'Host C++ compiler').detail, /\[Xcode\]/);
});

test('Windows discovers registered MSVC installations without PATH setup', (context) => {
  const installation = picoFixture(context, [
    'VC/Tools/MSVC/14.9.0/bin/Hostx64/x64/cl.exe',
    'VC/Tools/MSVC/14.40.0/bin/Hostx64/x64/cl.exe',
  ]);
  const results = checkPrerequisites({ mode: 'local', host: { ...host, platform: 'win32', arch: 'x64' }, log: () => {}, execute: (command, args) => {
    if (['c++', 'g++', 'clang++', 'cl', 'clang-cl'].includes(command)) return missing;
    if (command === 'vswhere') return { status: 0, stdout: JSON.stringify([{ installationPath: installation }]), stderr: '' };
    if (command.endsWith('cl.exe')) {
      assert.ok(command.includes('14.40.0'));
      assert.deepEqual(args, ['/?']);
      return { status: 0, stdout: 'C/C++ COMPILER OPTIONS', stderr: 'Microsoft (R) C/C++ Optimizing Compiler Version 19.40 for x64' };
    }
    return available(command, args);
  } });
  const result = results.find((item) => item.name === 'Host C++ compiler');
  assert.equal(result.status, 'available');
  assert.match(result.detail, /\[Visual Studio\]/);
  assert.match(result.detail, /Compiler Version 19\.40/);
});

test('unrecognized output, broken compiler probes, and malformed vswhere output do not pass', () => {
  const results = checkPrerequisites({ mode: 'local', host: { ...host, platform: 'win32' }, log: () => {}, execute: (command, args) => {
    if (command === 'c++') return { status: 0, stdout: 'not a compiler', stderr: '' };
    if (['g++', 'clang++', 'cl', 'clang-cl'].includes(command)) return { status: 1, stdout: '', stderr: 'compiler failed' };
    if (command === 'vswhere') return { status: 0, stdout: 'invalid JSON', stderr: '' };
    return available(command, args);
  } });
  assert.equal(results.find((result) => result.name === 'Host C++ compiler').status, 'unusable');
});