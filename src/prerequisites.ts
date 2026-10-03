import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { findPicoPrebuiltTools } from './pico-prebuilt-tools.js';

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  missing?: boolean;
}

export type Execute = (command: string, args: string[], timeout: number) => CommandResult;

export interface Host {
  platform: string;
  ubuntu: boolean;
  githubActions: boolean;
  picoRoot?: string;
  cxx?: string;
  vswhere?: string;
  arch?: string;
}

interface Requirement {
  name: string;
  command: string;
  args: string[];
  packages: string[];
  guidance: string;
  accepts?: (output: string) => boolean;
}

export interface PrerequisiteResult {
  name: string;
  status: 'available' | 'missing' | 'unusable';
  detail: string;
  guidance: string;
}

export interface PrerequisiteOptions {
  mode: 'local' | 'action';
  log: (message: string) => void;
  execute?: Execute;
  host?: Host;
}

const requirements: Requirement[] = [
  {
    name: 'Node.js 24 on PATH', command: 'node', args: ['--version'], packages: [],
    guidance: 'Install Node.js 24; in Actions use actions/setup-node with node-version: 24.',
    accepts: (output) => /^v24\./.test(output.trim()),
  },
  {
    name: 'npm', command: 'npm', args: ['--version'], packages: [],
    guidance: 'Install npm with Node.js 24; in Actions use actions/setup-node.',
    accepts: (output) => /^\d+\./.test(output.trim()),
  },
  {
    name: 'Git', command: 'git', args: ['--version'], packages: ['git'],
    guidance: 'Install Git and add it to PATH.',
  },
  {
    name: 'CMake >= 3.10', command: 'cmake', args: ['--version'], packages: ['cmake'],
    guidance: 'Install CMake 3.10 or newer and add it to PATH.',
    accepts: (output) => {
      const version = /cmake version (\d+)\.(\d+)/.exec(output);
      return version !== null && (Number(version[1]) > 3 ||
        (Number(version[1]) === 3 && Number(version[2]) >= 10));
    },
  },
  {
    name: 'Ninja or Make', command: 'ninja', args: ['--version'], packages: ['ninja-build'],
    guidance: 'Install Ninja or Make and add it to PATH.',
  },
  {
    name: 'Host C++ compiler', command: 'c++', args: ['--version'], packages: ['build-essential'],
    guidance: 'Expose GCC/Clang on PATH or set CXX to its executable; on Windows use Visual Studio C++ Build Tools, and on macOS install Xcode Command Line Tools.',
  },
  {
    name: 'Python 3', command: 'python3', args: ['--version'], packages: ['python3'],
    guidance: 'Install Python 3 and expose python3 (or python on Windows) on PATH.',
    accepts: (output) => /^Python 3\./.test(output.trim()),
  },
  {
    name: 'Python venv and ensurepip', command: 'python3',
    args: ['-c', 'import venv, ensurepip; print("venv and ensurepip available")'],
    packages: ['python3-venv'],
    guidance: 'Install Python venv/ensurepip support; Ubuntu package: python3-venv.',
  },
  {
    name: 'Arm GCC', command: 'arm-none-eabi-gcc', args: ['--version'], packages: ['gcc-arm-none-eabi'],
    guidance: 'Install the Arm GNU bare-metal toolchain and add its bin directory to PATH.',
  },
  {
    name: 'Arm G++', command: 'arm-none-eabi-g++', args: ['--version'], packages: ['gcc-arm-none-eabi'],
    guidance: 'Install the Arm GNU bare-metal C++ compiler and add it to PATH.',
  },
  {
    name: 'Arm C library', command: 'arm-none-eabi-gcc', args: ['-print-file-name=libc.a'],
    packages: ['gcc-arm-none-eabi', 'libnewlib-arm-none-eabi'],
    guidance: 'Install Arm newlib libraries; Ubuntu package: libnewlib-arm-none-eabi.',
    accepts: (output) => /[/\\]libc\.a$/.test(output.trim()),
  },
  {
    name: 'Arm C++ library', command: 'arm-none-eabi-g++', args: ['-print-file-name=libstdc++.a'],
    packages: ['gcc-arm-none-eabi', 'libstdc++-arm-none-eabi-newlib'],
    guidance: 'Install Arm C++ libraries; Ubuntu package: libstdc++-arm-none-eabi-newlib.',
    accepts: (output) => /[/\\]libstdc\+\+\.a$/.test(output.trim()),
  },
];

export const executeCommand: Execute = (command, args, timeout) => {
  const windowsNpm = process.platform === 'win32' && command === 'npm';
  const result = spawnSync(windowsNpm ? 'cmd.exe' : command,
    windowsNpm ? ['/d', '/s', '/c', 'npm.cmd --version'] : args, {
      encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
    });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error.message } : {}),
    missing: result.error !== undefined && 'code' in result.error && result.error.code === 'ENOENT',
  };
};

function currentHost(): Host {
  let ubuntu = false;
  if (process.platform === 'linux') {
    try {
      ubuntu = /^ID=(?:ubuntu|"ubuntu")$/m.test(readFileSync('/etc/os-release', 'utf8'));
    } catch {
      ubuntu = false;
    }
  }
  return {
    platform: process.platform, ubuntu, githubActions: process.env.GITHUB_ACTIONS === 'true',
    picoRoot: join(homedir(), '.pico-sdk'),
    arch: process.arch,
    ...(process.env.CXX ? { cxx: process.env.CXX } : {}),
    ...(process.platform === 'win32' && process.env['ProgramFiles(x86)'] ? {
      vswhere: join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    } : {}),
  };
}

function visualStudioCompilers(execute: Execute, host: Host): string[] {
  const result = execute(host.vswhere ?? 'vswhere', [
    '-all', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-format', 'json', '-utf8',
  ], 10_000);
  if (result.status !== 0 || result.error) return [];
  try {
    const installations: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(installations)) return [];
    const entries: unknown[] = installations;
    const compilers: string[] = [];
    const architecture = host.arch === 'arm64' ? 'arm64' : host.arch === 'ia32' ? 'x86' : 'x64';
    for (const installation of entries) {
      if (typeof installation !== 'object' || installation === null ||
          !('installationPath' in installation) || typeof installation.installationPath !== 'string') continue;
      const root = join(installation.installationPath, 'VC', 'Tools', 'MSVC');
      try {
        const versions = readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }));
        for (const version of versions) {
          const compiler = join(root, version, 'bin', `Host${architecture}`, architecture, 'cl.exe');
          try {
            if (statSync(compiler).isFile()) compilers.push(compiler);
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
    return compilers;
  } catch {
    return [];
  }
}

function detectHostCompiler(requirement: Requirement, execute: Execute, host: Host): PrerequisiteResult {
  let failure: PrerequisiteResult = {
    name: requirement.name, status: 'missing', detail: 'No supported host compiler was found.', guidance: requirement.guidance,
  };
  const probe = (command: string, source: string): PrerequisiteResult | undefined => {
    const msvc = /(?:^|[/\\])cl(?:\.exe)?$/i.test(command);
    const result = execute(command, msvc ? ['/?'] : ['--version'], 10_000);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const recognized = /(?:clang|g\+\+|gcc|Free Software Foundation|Microsoft.*C\/C\+\+)/i.test(output);
    const crossCompiler = /arm-none-eabi/i.test(command) || /arm-none-eabi/i.test(output);
    const accepted = result.status === 0 && !result.error && recognized && !crossCompiler;
    const lines = output.split(/\r?\n/);
    const banner = lines.find((line) => /(?:clang|gcc|g\+\+|Microsoft.*C\/C\+\+).*\b(?:version|\d+\.)/i.test(line));
    const detail = result.error ?? (banner || lines.find((line) => line.trim()) || `exit ${String(result.status)}`);
    const detected: PrerequisiteResult = {
      name: requirement.name,
      status: accepted ? 'available' : result.missing ? 'missing' : 'unusable',
      detail: `[${source}] ${command}: ${detail}${crossCompiler ? ' (Arm cross-compiler is not a host compiler)' : ''}`,
      guidance: requirement.guidance,
    };
    if (accepted) return detected;
    if (failure.status === 'missing') failure = detected;
    return undefined;
  };
  if (host.cxx?.trim()) {
    const result = probe(host.cxx.trim().replace(/^"(.*)"$/, '$1'), 'CXX');
    return result ?? failure;
  }
  const candidates = ['c++', 'g++', 'clang++'];
  if (host.platform === 'win32') candidates.push('cl', 'clang-cl');
  for (const command of candidates) {
    const result = probe(command, 'PATH');
    if (result) return result;
  }
  if (host.platform === 'darwin') {
    const located = execute('xcrun', ['--find', 'clang++'], 10_000);
    if (located.status === 0 && !located.error && isAbsolute(located.stdout.trim())) {
      const result = probe(located.stdout.trim(), 'Xcode');
      if (result) return result;
    }
  }
  if (host.platform === 'win32') {
    for (const command of visualStudioCompilers(execute, host)) {
      const result = probe(command, 'Visual Studio');
      if (result) return result;
    }
  }
  const prebuilt = host.picoRoot ? findPicoPrebuiltTools(host.picoRoot) : undefined;
  if (prebuilt) {
    return {
      name: requirement.name,
      status: 'available',
      detail: `[Pico extension] prebuilt pioasm ${prebuilt.pioasmVersion} and picotool ${prebuilt.picotoolVersion}; host compiler not required`,
      guidance: requirement.guidance,
    };
  }
  return failure;
}

function picoCandidates(command: string, host: Host): string[] {
  if (!host.picoRoot) return [];
  const layouts: Record<string, { directory: string; paths: string[][] }> = {
    cmake: { directory: 'cmake', paths: [['bin'], ['CMake.app', 'Contents', 'bin']] },
    ninja: { directory: 'ninja', paths: [[], ['bin']] },
    'arm-none-eabi-gcc': { directory: 'toolchain', paths: [['bin']] },
    'arm-none-eabi-g++': { directory: 'toolchain', paths: [['bin']] },
  };
  const layout = layouts[command];
  if (!layout) return [];
  const root = join(host.picoRoot, layout.directory);
  try {
    const versions = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v?\d/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.replace(/^v/, '').localeCompare(left.replace(/^v/, ''), 'en', { numeric: true }));
    const executable = `${command}${host.platform === 'win32' ? '.exe' : ''}`;
    return versions.flatMap((version) => layout.paths.map((parts) => join(root, version, ...parts, executable)))
      .filter((candidate) => {
        try {
          return statSync(candidate).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function detect(execute: Execute, host: Host): PrerequisiteResult[] {
  const selected = new Map<string, string>();
  let armDirectory: string | undefined;
  return requirements.map((requirement) => {
    if (requirement.name === 'Host C++ compiler') return detectHostCompiler(requirement, execute, host);
    const previous = selected.get(requirement.command);
    let candidates = [requirement.command];
    if (requirement.name === 'Python 3' && host.platform === 'win32') candidates.push('python');
    if (requirement.command === 'ninja') candidates.push('make');
    candidates.push(...picoCandidates(requirement.command, host));
    if (armDirectory && requirement.command.startsWith('arm-none-eabi-')) {
      candidates = [join(armDirectory, `${requirement.command}${host.platform === 'win32' ? '.exe' : ''}`)];
    }
    if (previous) candidates = [previous];
    let command = requirement.command;
    let result: CommandResult = { status: null, stdout: '', stderr: '', missing: true };
    let output = '';
    let available = false;
    for (const candidate of candidates) {
      const attempt = execute(candidate, requirement.args, 10_000);
      const text = `${attempt.stdout}\n${attempt.stderr}`.trim();
      const accepted = attempt.status === 0 && !attempt.error && text.length > 0 &&
        (requirement.accepts?.(text) ?? true);
      if (accepted || result.missing) {
        command = candidate;
        result = attempt;
        output = text;
      }
      if (accepted) {
        available = true;
        selected.set(requirement.command, candidate);
        if (requirement.command === 'arm-none-eabi-gcc' && isAbsolute(candidate)) {
          armDirectory = dirname(candidate);
        }
        break;
      }
    }
    const status = available ? 'available' : result.missing ? 'missing' : 'unusable';
    const detail = (result.error ?? output.split(/\r?\n/)[0] ?? '').trim();
    return {
      name: requirement.name, status,
      detail: `${isAbsolute(command) ? '[Pico extension] ' : ''}${command}: ${detail || `exit ${String(result.status)}`}`,
      guidance: requirement.guidance,
    };
  });
}

function report(results: PrerequisiteResult[], log: (message: string) => void, title: string): void {
  log(title);
  for (const result of results) {
    log(`[${result.status.toUpperCase()}] ${result.name}: ${result.detail}`);
    if (result.status !== 'available') log(`  Fix: ${result.guidance}`);
  }
  log(`${results.filter((result) => result.status === 'available').length}/${results.length} prerequisites available.`);
  log('Host-tool check only; firmware source, Pico SDK >= 2.3.1, and target compatibility are not validated.');
}

export function checkPrerequisites(options: PrerequisiteOptions): PrerequisiteResult[] {
  const execute = options.execute ?? executeCommand;
  const host = options.host ?? currentHost();
  let results = detect(execute, host);
  report(results, options.log, 'Prerequisite report');
  if (options.mode === 'local' || results.every((result) => result.status === 'available')) return results;

  if (!host.githubActions || host.platform !== 'linux' || !host.ubuntu) {
    throw new Error('Automatic installation requires a GitHub Actions Ubuntu runner. Install the reported tools manually on other hosts.');
  }
  const failed = requirements.filter((requirement, index) => results[index]?.status !== 'available');
  const packages = [...new Set(failed.flatMap((requirement) => requirement.packages))];
  if (packages.length > 0) {
    options.log(`Installing Ubuntu packages: ${packages.join(', ')}`);
    let installationError: string | undefined;
    for (const args of [
      ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'update'],
      ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--no-install-recommends', ...packages],
    ]) {
      const result = execute('sudo', args, 600_000);
      if (result.status !== 0 || result.error) {
        installationError = result.error ?? ((result.stderr || result.stdout).trim() || `exit ${String(result.status)}`);
        break;
      }
    }
    results = detect(execute, host);
    report(results, options.log, 'Prerequisite report after installation');
    if (installationError) throw new Error(`Prerequisite installation failed: ${installationError}`);
  }
  return results;
}