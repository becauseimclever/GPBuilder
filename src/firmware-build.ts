import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { publishArtifact } from './artifact-publisher.js';
import type { PublishedArtifact } from './artifact-publisher.js';
import { materializeFirmware } from './firmware-source.js';
import { selectBuild } from './build-selection.js';
import type { BuildSelection } from './build-selection.js';
import type { ProcessExecutor, ProcessResult } from './process-runner.js';
import { executeProcess } from './process-runner.js';

const firmwareRelease = 'v0.7.12';
const firmwareCommit = '0014e4ae2a312332e2582f6708dcc7d6bec5de8c';
const sdkCommit = 'bddd20f928ce76142793bef434d4f75f4af6e433';
const cmakeVersion = '4.3.4';
const ninjaVersion = '1.13.2';
const armToolchainVersion = '15_2_Rel1';
const armCompilerVersion = '15.2.1';
const sdkTag = '2.1.1';

export interface FirmwareBuildOptions {
  firmware?: string;
  release: string;
  board: string;
  configs?: string;
  workingDirectory?: string;
  picoRoot?: string;
  vswhere?: string;
  platform?: string;
  execute?: ProcessExecutor;
  log: (message: string) => void;
}

export interface FirmwareBuildResult {
  sourceCommit: string;
  selection: BuildSelection;
  artifact: PublishedArtifact;
}

interface Toolchain {
  root: string;
  cmake: string;
  ninja: string;
  python: string;
  armBin: string;
  vsDevCmd: string;
  vswhere: string;
}

export function validateFirmwareBuildRequest(
  options: Pick<FirmwareBuildOptions, 'release' | 'board' | 'configs' | 'platform'>,
): void {
  if (options.release !== firmwareRelease || options.board !== 'Pico' || options.configs !== undefined) {
    throw new Error('Firmware builds currently support only release v0.7.12, board Pico, built-in configs, and Release build type.');
  }
  if ((options.platform ?? process.platform) !== 'win32') {
    throw new Error('The v0.7.12 Pico build has only been integration-qualified on Windows x64.');
  }
}

function requireFile(path: string, description: string): string {
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`${description} was not found: ${path}`);
  return path;
}

async function runProcess(
  execute: ProcessExecutor,
  command: string,
  args: string[],
  stage: string,
  timeoutMs: number,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcessResult> {
  return execute(command, args, { ...options, timeoutMs, stage });
}

async function discoverToolchain(options: FirmwareBuildOptions, execute: ProcessExecutor): Promise<Toolchain> {
  const picoRoot = resolve(options.picoRoot ?? join(homedir(), '.pico-sdk'));
  const cmake = requireFile(join(picoRoot, 'cmake', `v${cmakeVersion}`, 'bin', 'cmake.exe'), `CMake ${cmakeVersion}`);
  const ninja = requireFile(join(picoRoot, 'ninja', `v${ninjaVersion}`, 'ninja.exe'), `Ninja ${ninjaVersion}`);
  const armBin = join(picoRoot, 'toolchain', armToolchainVersion, 'bin');
  const gcc = requireFile(join(armBin, 'arm-none-eabi-gcc.exe'), `Arm GNU ${armToolchainVersion} GCC`);
  const gxx = requireFile(join(armBin, 'arm-none-eabi-g++.exe'), `Arm GNU ${armToolchainVersion} G++`);
  const vswhere = resolve(options.vswhere ?? join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'));
  requireFile(vswhere, 'Visual Studio instance locator');

  const gccVersion = await runProcess(execute, gcc, ['--version'], 'Check Arm GCC version', 10_000);
  const gxxVersion = await runProcess(execute, gxx, ['--version'], 'Check Arm G++ version', 10_000);
  if (!gccVersion.stdout.includes(armCompilerVersion) || !gxxVersion.stdout.includes(armCompilerVersion)) {
    throw new Error(`The qualified Arm toolchain must be ${armCompilerVersion}; detected ${gccVersion.stdout.split(/\r?\n/)[0]} / ${gxxVersion.stdout.split(/\r?\n/)[0]}.`);
  }
  const libraries: Array<[string, string]> = [[gcc, 'libc.a'], [gxx, 'libstdc++.a']];
  for (const [compiler, library] of libraries) {
    const result = await runProcess(execute, compiler, [`-print-file-name=${library}`], `Check Arm ${library}`, 10_000);
    const path = result.stdout.trim();
    if (path === library || !existsSync(path)) throw new Error(`Arm library ${library} was not found in the selected toolchain.`);
  }

  const cmakeResult = await runProcess(execute, cmake, ['--version'], 'Check CMake version', 10_000);
  const ninjaResult = await runProcess(execute, ninja, ['--version'], 'Check Ninja version', 10_000);
  if (!cmakeResult.stdout.includes(cmakeVersion)) throw new Error(`CMake ${cmakeVersion} is required; detected ${cmakeResult.stdout.trim()}.`);
  if (!ninjaResult.stdout.trim().startsWith(ninjaVersion)) throw new Error(`Ninja ${ninjaVersion} is required; detected ${ninjaResult.stdout.trim()}.`);

  const pythonResult = await runProcess(execute, 'py.exe', ['-3.13', '-c', 'import sys; print(sys.executable)'], 'Locate Python 3.13', 10_000);
  const python = resolve(pythonResult.stdout.trim());
  requireFile(python, 'Python 3.13');
  const pythonVersion = await runProcess(execute, python, ['--version'], 'Check Python version', 10_000);
  if (!/^Python 3\.13\./.test(pythonVersion.stdout.trim())) throw new Error(`Python 3.13 is required for this qualified Windows build; detected ${pythonVersion.stdout.trim()}.`);

  const vsResult = await runProcess(execute, vswhere, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], 'Locate Visual Studio C++ tools', 10_000);
  const installation = vsResult.stdout.trim();
  if (!installation) throw new Error('A Visual Studio C++ Build Tools installation is required for SDK host tools.');
  const vsDevCmd = requireFile(join(installation, 'Common7', 'Tools', 'VsDevCmd.bat'), 'Visual Studio developer environment script');
  return { root: picoRoot, cmake, ninja, python, armBin, vsDevCmd, vswhere };
}

async function visualStudioEnvironment(execute: ProcessExecutor, toolchain: Toolchain, profile: string): Promise<NodeJS.ProcessEnv> {
  const command = `call "${toolchain.vsDevCmd}" -no_logo -host_arch=x64 -arch=x64 >nul && set`;
  const output = await runProcess(execute, 'cmd.exe', ['/d', '/c', command], 'Prepare Visual Studio host compiler', 60_000, {
    env: { ...process.env, USERPROFILE: profile, HOME: profile },
  });
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const line of output.stdout.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      const name = line.slice(0, separator);
      const existing = Object.keys(environment).find((key) => key.toUpperCase() === name.toUpperCase());
      if (existing !== undefined) delete environment[existing];
      environment[name.toUpperCase() === 'PATH' ? 'PATH' : name] = line.slice(separator + 1);
    }
  }
  if (!environment.VCToolsInstallDir || !environment.WindowsSdkDir) {
    throw new Error('Visual Studio host compiler environment did not expose C++ tools and the Windows SDK.');
  }
  return environment;
}

async function gitValue(execute: ProcessExecutor, directory: string, args: string[]): Promise<string> {
  const result = await runProcess(execute, 'git', ['-C', directory, ...args], 'Read build provenance', 10_000, { cwd: directory });
  return result.stdout.trim();
}

function readCacheValue(cache: string, key: string): string | undefined {
  const line = cache.split(/\r?\n/).find((entry) => entry.startsWith(`${key}:`));
  const separator = line?.indexOf('=') ?? -1;
  return separator < 0 ? undefined : line!.slice(separator + 1);
}

async function runFirmwareBuild(options: FirmwareBuildOptions): Promise<FirmwareBuildResult> {
  validateFirmwareBuildRequest(options);
  const execute = options.execute ?? executeProcess;
  const workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  const runId = randomUUID();
  const runDirectory = mkdtempSync(join(tmpdir(), 'gpbuilder-build-'));
  const diagnostics: string[] = [];
  let stage = 'build initialization';

  const recordStage = async (name: string, work: () => Promise<ProcessResult>): Promise<ProcessResult> => {
    stage = name;
    options.log(`Build stage: ${name}`);
    try {
      const result = await work();
      diagnostics.push(`\n## ${name}\n${result.stdout}\n${result.stderr}`);
      return result;
    } catch (error) {
      diagnostics.push(`\n## ${name}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      throw error;
    }
  };

  try {
    const sourceDirectory = join(runDirectory, 'firmware');
    await recordStage('materialize firmware tag and submodules', async () => {
      const source = await materializeFirmware({
        ...(options.firmware !== undefined && { source: options.firmware }),
        release: options.release, destination: sourceDirectory, execute,
      });
      if (source.commit !== firmwareCommit) throw new Error(`Release ${firmwareRelease} resolved to unexpected commit ${source.commit}; expected ${firmwareCommit}.`);
      return { stdout: `Firmware commit ${source.commit}`, stderr: '' };
    });
    const selection = selectBuild(sourceDirectory, options.release, options.board);
    options.log(`Release: ${selection.release}\nFirmware commit: ${selection.commit}\nBoard: ${selection.board}\nConfig source: ${selection.configSource}\nConfig path: ${selection.configPath}`);

    stage = 'validate qualified toolchain';
    options.log(`Build stage: ${stage}`);
    const toolchain = await discoverToolchain(options, execute);
    const profile = join(runDirectory, 'host-profile');
    mkdirSync(profile);
    let preparedEnvironment: NodeJS.ProcessEnv | undefined;
    await recordStage('prepare qualified Windows host tools', async () => {
      preparedEnvironment = await visualStudioEnvironment(execute, toolchain, profile);
      return { stdout: preparedEnvironment.VCToolsInstallDir ?? '', stderr: '' };
    });
    if (!preparedEnvironment) throw new Error('Visual Studio environment preparation returned no environment.');
    const nativeEnvironment = preparedEnvironment;
    const sdkDirectory = join(runDirectory, 'pico-sdk');
    mkdirSync(join(runDirectory, 'tools'));

    await recordStage('materialize Pico SDK 2.1.1', async () => {
      await execute('git', ['clone', '--depth=1', '--branch', sdkTag, 'https://github.com/raspberrypi/pico-sdk.git', sdkDirectory], {
        timeoutMs: 600_000, stage: 'Clone Pico SDK 2.1.1',
      });
      const commit = await gitValue(execute, sdkDirectory, ['rev-parse', 'HEAD']);
      if (commit !== sdkCommit) throw new Error(`Pico SDK ${sdkTag} resolved to unexpected commit ${commit}; expected ${sdkCommit}.`);
      const submodules = await runProcess(execute, 'git', ['-C', sdkDirectory, 'submodule', 'update', '--init', '--recursive'], 'Initialize Pico SDK submodules', 600_000);
      return { stdout: `Pico SDK ${sdkTag} commit ${commit}\n${submodules.stdout}`, stderr: submodules.stderr };
    });

    const webDirectory = join(sourceDirectory, 'www');
    const fsdata = join(sourceDirectory, 'lib', 'httpd', 'fsdata.c');
    if (existsSync(fsdata)) rmSync(fsdata);
    const npm = process.platform === 'win32' ? 'cmd.exe' : 'npm';
    const npmArgs = (args: string[]) => process.platform === 'win32' ? ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`] : args;
    await recordStage('install web dependencies', () => runProcess(execute, npm, npmArgs(['ci']), 'Install firmware web dependencies', 1_200_000, { cwd: webDirectory }));
    await recordStage('generate embedded web assets', async () => {
      const result = await runProcess(execute, npm, npmArgs(['run', 'build']), 'Generate firmware web assets', 1_200_000, { cwd: webDirectory });
      if (!existsSync(fsdata) || !lstatSync(fsdata).isFile() || lstatSync(fsdata).size === 0) {
        throw new Error('The web build did not generate a nonempty lib/httpd/fsdata.c.');
      }
      return result;
    });

    const constraint = join(runDirectory, 'pip-constraints.txt');
    writeFileSync(constraint, 'setuptools<81\n', { flag: 'wx' });
    const environment: NodeJS.ProcessEnv = {
      ...nativeEnvironment,
      HOME: profile,
      USERPROFILE: profile,
      PICO_SDK_PATH: sdkDirectory,
      PICO_TOOLCHAIN_PATH: join(toolchain.root, 'toolchain', armToolchainVersion),
      PICO_PIO_USB_PATH: join(sourceDirectory, 'lib', 'pico_pio_usb'),
      PICO_BOARD: 'pico',
      PICO_PLATFORM: 'rp2040',
      GP2040_BOARDCONFIG: 'Pico',
      PICO_COMPILER: 'pico_arm_cortex_m0plus_gcc',
      SKIP_SUBMODULES: 'TRUE',
      SKIP_WEBBUILD: 'TRUE',
      PIP_CONSTRAINT: constraint,
      PATH: `${toolchain.armBin};${dirname(toolchain.cmake)};${dirname(toolchain.ninja)};${nativeEnvironment.PATH ?? process.env.PATH ?? ''}`,
    };
    for (const key of ['CC', 'CXX', 'CMAKE_TOOLCHAIN_FILE', 'PICO_SDK_FETCH_FROM_GIT', 'PICO_SDK_FETCH_FROM_GIT_TAG', 'PICO_SDK_FETCH_FROM_GIT_PATH']) {
      delete environment[key];
    }
    const buildDirectory = join(runDirectory, 'build');
    await recordStage('configure firmware', () => runProcess(execute, toolchain.cmake, [
      '-S', sourceDirectory, '-B', buildDirectory, '-G', 'Ninja', `-DCMAKE_MAKE_PROGRAM=${toolchain.ninja}`,
      '-DCMAKE_BUILD_TYPE=Release', '-DGP2040_BOARDCONFIG=Pico', '-DPICO_BOARD=pico', '-DPICO_PLATFORM=rp2040',
      `-DPICO_SDK_PATH=${sdkDirectory}`, `-DPython3_EXECUTABLE=${toolchain.python}`,
      '-DSKIP_SUBMODULES=TRUE', '-DSKIP_WEBBUILD=TRUE', `-DPICOTOOL_FETCH_FROM_GIT_PATH=${join(runDirectory, 'tools')}`,
    ], 'Configure GP2040-CE Pico firmware', 1_800_000, { env: environment }));
    await recordStage('compile firmware and generate UF2', () => runProcess(execute, toolchain.cmake, [
      '--build', buildDirectory, '--config', 'Release', '--target', 'GP2040-CE',
    ], 'Compile GP2040-CE and generate UF2', 3_600_000, { env: environment }));

    const cachePath = join(buildDirectory, 'CMakeCache.txt');
    stage = 'validate and publish UF2';
    options.log(`Build stage: ${stage}`);
    const cache = readFileSync(cachePath, 'utf8');
    const expectedCache = new Map([
      ['CMAKE_BUILD_TYPE', 'Release'], ['GP2040_BOARDCONFIG', 'Pico'], ['PICO_BOARD', 'pico'],
      ['PICO_SDK_PATH', sdkDirectory.replaceAll('\\', '/')], ['Python3_EXECUTABLE', toolchain.python.replaceAll('\\', '/')],
    ]);
    for (const [key, value] of expectedCache) {
      const actual = readCacheValue(cache, key)?.replaceAll('\\', '/');
      if (actual !== value) throw new Error(`CMake cache ${key} was ${actual ?? 'missing'}, expected ${value}.`);
    }
    const version = await gitValue(execute, sourceDirectory, ['describe', '--tags', '--always', '--dirty', '--abbrev=7']);
    if (version !== firmwareRelease) throw new Error(`Materialized source reports ${version}, expected ${firmwareRelease}.`);
    const artifactSource = join(buildDirectory, 'GP2040-CE_0.7.12_Pico.uf2');
    const elf = requireFile(join(buildDirectory, 'GP2040-CE_0.7.12_Pico.elf'), 'Expected Pico ELF');
    requireFile(artifactSource, 'Expected Pico UF2');
    const elfBytes = readFileSync(elf);
    if (!elfBytes.includes(Buffer.from('GP2040-CE_0.7.12_Pico')) || !elfBytes.includes(Buffer.from('v0.7.12'))) {
      throw new Error('The built ELF does not identify the expected v0.7.12 Pico firmware target.');
    }
    const elfInfo = {
      filename: 'GP2040-CE_0.7.12_Pico.elf',
      byteSize: elfBytes.length,
      sha256: createHash('sha256').update(elfBytes).digest('hex'),
    };

    const sourceSubmodules = await gitValue(execute, sourceDirectory, ['submodule', 'status', '--recursive']);
    const sdkSubmodules = await gitValue(execute, sdkDirectory, ['submodule', 'status', '--recursive']);
    const arduinoJsonCommit = await gitValue(execute, join(buildDirectory, '_deps', 'arduinojson-src'), ['rev-parse', 'HEAD']);
    const picotoolCommit = await gitValue(execute, join(runDirectory, 'tools', 'picotool-src'), ['rev-parse', 'HEAD']);
    const freeze = await runProcess(execute, join(buildDirectory, 'venv', 'Scripts', 'python.exe'), ['-m', 'pip', 'freeze'], 'Record build-local Python dependencies', 30_000);
    const metadata = {
      firmware: { repository: options.firmware ? resolve(options.firmware) : 'https://github.com/OpenStickCommunity/GP2040-CE.git', requestedRelease: firmwareRelease, commit: firmwareCommit, submodules: sourceSubmodules },
      sdk: { tag: sdkTag, commit: sdkCommit, submodules: sdkSubmodules },
      dependencies: { arduinoJsonCommit, picotoolCommit, pythonPackages: freeze.stdout.trim().split(/\r?\n/) },
      tools: { node: process.version, cmake: cmakeVersion, ninja: ninjaVersion, armGcc: armCompilerVersion, python: '3.13', buildType: 'Release' },
      configuration: { board: 'Pico', picoBoard: 'pico', firmwareVersion: version, configSource: 'firmware', elf: elfInfo },
      qualification: { platform: 'Windows x64', hardwareSmokeTest: false },
    };
    const artifact = publishArtifact({
      source: artifactSource, workingDirectory, runId, release: firmwareRelease, board: 'Pico', buildType: 'release', metadata,
    });
    options.log(`UF2: ${artifact.path}\nSize: ${artifact.byteSize} bytes\nSHA-256: ${artifact.sha256}\nMetadata: ${artifact.metadataPath}`);
    return { sourceCommit: firmwareCommit, selection, artifact };
  } catch (error) {
    const logDirectory = resolve(workingDirectory, 'artifacts', 'logs', runId);
    try {
      mkdirSync(logDirectory, { recursive: true });
      writeFileSync(join(logDirectory, 'build.log'), `Stage: ${stage}\n${diagnostics.join('\n')}\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`, { flag: 'wx' });
    } catch {
      // Retain the original stage error if diagnostic publication is unavailable.
    }
    const logPath = join(logDirectory, 'build.log');
    throw new Error(`Firmware build failed during ${stage}: ${error instanceof Error ? error.message : String(error)}. Diagnostics: ${logPath}`, { cause: error });
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

export function buildFirmware(options: FirmwareBuildOptions): Promise<FirmwareBuildResult> {
  validateFirmwareBuildRequest(options);
  return runFirmwareBuild(options);
}