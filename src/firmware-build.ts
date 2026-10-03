import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { publishArtifact } from './artifact-publisher.js';
import type { PublishedArtifact } from './artifact-publisher.js';
import { applyConfigsOverlay, materializeFirmware } from './firmware-source.js';
import { selectBuild } from './build-selection.js';
import type { BuildSelection } from './build-selection.js';
import type { ProcessExecutor, ProcessResult } from './process-runner.js';
import { executeProcess } from './process-runner.js';
import { findPicoPrebuiltTools } from './pico-prebuilt-tools.js';
import type { PicoPrebuiltTools } from './pico-prebuilt-tools.js';

const taggedRelease = 'v0.7.12';
const cmakeVersion = '4.3.4';
const ninjaVersion = '1.13.2';
const armToolchainVersion = '15_2_Rel1';
const armCompilerVersion = '15.2.1';

export interface ToolProfile {
  sdkTag: string;
  sdkCommit?: string;
  picotool: string;
  firmwareCommit?: string;
}

const toolProfiles: Record<string, ToolProfile> = {
  [taggedRelease]: {
    sdkTag: '2.1.1',
    sdkCommit: 'bddd20f928ce76142793bef434d4f75f4af6e433',
    picotool: '2.1.1',
    firmwareCommit: '0014e4ae2a312332e2582f6708dcc7d6bec5de8c',
  },
  main: { sdkTag: '2.3.1', picotool: '2.3.1' },
};

export function selectToolProfile(release: string): ToolProfile {
  const profile = Object.hasOwn(toolProfiles, release) ? toolProfiles[release] : undefined;
  if (!profile) throw new Error(`Firmware builds support only release v0.7.12 or main; received ${release}.`);
  return profile;
}

function versionParts(version: string): number[] {
  return version.split(/[._]|Rel/).filter((part) => part !== '').map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export interface CmakeMinimums {
  sdk?: string;
  toolchain?: string;
  picotool?: string;
}

export function parseCmakeMinimums(text: string): CmakeMinimums {
  const setting = (name: string): string | undefined =>
    new RegExp(`^\\s*set\\(\\s*${name}\\s+([^\\s)]+)\\s*\\)`, 'im').exec(text)?.[1];
  const guard = /PICO_SDK_VERSION_STRING\s+VERSION_LESS\s+"([^"]+)"/i.exec(text)?.[1];
  const sdkCandidates = [setting('sdkVersion'), guard].filter((value): value is string => value !== undefined);
  const minimums: CmakeMinimums = {};
  if (sdkCandidates.length > 0) {
    minimums.sdk = sdkCandidates.reduce((highest, value) => (compareVersions(value, highest) > 0 ? value : highest));
  }
  const toolchain = setting('toolchainVersion');
  if (toolchain !== undefined) minimums.toolchain = toolchain;
  const picotool = setting('picotoolVersion');
  if (picotool !== undefined) minimums.picotool = picotool;
  return minimums;
}

export function checkMinimums(minimums: CmakeMinimums, profile: ToolProfile): void {
  const requirements: [string, string | undefined, string][] = [
    ['Pico SDK', minimums.sdk, profile.sdkTag],
    ['Arm GNU toolchain', minimums.toolchain, armToolchainVersion],
    ['picotool', minimums.picotool, profile.picotool],
  ];
  for (const [name, required, pinned] of requirements) {
    if (required === undefined) {
      if (name !== 'Pico SDK') continue;
      throw new Error(`The ${name} minimum version is not declared in the firmware CMakeLists.txt; refusing to guess.`);
    }
    if (compareVersions(required, pinned) > 0) {
      throw new Error(`The firmware requires ${name} ${required}, but this build profile pinned ${pinned}.`);
    }
  }
}

export function firmwareOutputName(describe: string, board: string): string {
  // Mirrors GP2040-CE's CMake regex, which falls back to 0.0.0 for untagged builds.
  const version = /^v(\d+\.\d+\.\d+)/.exec(describe)?.[1] ?? '0.0.0';
  return `GP2040-CE_${version}_${board}`;
}

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
  vsDevCmd?: string;
  vswhere?: string;
  prebuilt?: PicoPrebuiltTools;
}

export interface FirmwareConfigureInput {
  sourceDirectory: string;
  buildDirectory: string;
  ninja: string;
  sdkDirectory: string;
  python: string;
  toolsDirectory: string;
  board: string;
  picoBoard: string;
  picoPlatform: string;
  prebuilt?: PicoPrebuiltTools | undefined;
}

export interface BoardPlatform {
  picoBoard: string;
  picoPlatform: string;
}

function cmakeSetValue(cmakeText: string, name: string): string | undefined {
  for (const rawLine of cmakeText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '');
    const match = new RegExp(`^\\s*set\\s*\\(\\s*${name}\\s+("([^"]*)"|[^\\s)]+)`, 'i').exec(line);
    if (match) return match[2] ?? match[1];
  }
  return undefined;
}

// Mirrors GP2040-CE: configs/<Board>/<Board>.cmake may override the default pico/rp2040 target.
export function resolveBoardPlatform(board: string, boardCmakeText: string | undefined): BoardPlatform {
  const picoBoard = (boardCmakeText && cmakeSetValue(boardCmakeText, 'PICO_BOARD')) || 'pico';
  const picoPlatform = (boardCmakeText && cmakeSetValue(boardCmakeText, 'PICO_PLATFORM')) || 'rp2040';
  if (picoPlatform !== 'rp2040') {
    throw new Error(`Board ${board} targets ${picoPlatform}; GPBuilder currently supports only RP2040 boards.`);
  }
  return { picoBoard, picoPlatform };
}

// Older nanopb generators break with setuptools 81+; newer ones pin setuptools themselves.
export function nanopbPipConstraint(requirementsText: string | undefined): string | undefined {
  if (requirementsText !== undefined && /^\s*setuptools\b/im.test(requirementsText)) {
    return undefined;
  }
  return 'setuptools<81\n';
}

export function firmwareConfigureArgs(input: FirmwareConfigureInput): string[] {
  const hostTools = input.prebuilt === undefined
    ? [`-DPICOTOOL_FETCH_FROM_GIT_PATH=${input.toolsDirectory}`]
    : [`-Dpioasm_DIR=${input.prebuilt.pioasmDir}`, `-Dpicotool_DIR=${input.prebuilt.picotoolDir}`];
  return [
    '-S', input.sourceDirectory, '-B', input.buildDirectory, '-G', 'Ninja', `-DCMAKE_MAKE_PROGRAM=${input.ninja}`,
    '-DCMAKE_BUILD_TYPE=Release', `-DGP2040_BOARDCONFIG=${input.board}`, `-DPICO_BOARD=${input.picoBoard}`, `-DPICO_PLATFORM=${input.picoPlatform}`,
    `-DPICO_SDK_PATH=${input.sdkDirectory}`, `-DPython3_EXECUTABLE=${input.python}`,
    '-DSKIP_SUBMODULES=TRUE', '-DSKIP_WEBBUILD=TRUE', ...hostTools,
  ];
}

export function validateFirmwareBuildRequest(
  options: Pick<FirmwareBuildOptions, 'release' | 'board' | 'configs' | 'platform' | 'firmware'>,
): void {
  selectToolProfile(options.release);
  if ((options.platform ?? process.platform) !== 'win32') {
    throw new Error('Firmware builds have only been integration-qualified on Windows x64.');
  }
  if (options.firmware !== undefined && !isDirectory(options.firmware)) {
    throw new Error(`Firmware source folder was not found: ${options.firmware}`);
  }
  if (options.configs !== undefined && !isDirectory(options.configs)) {
    throw new Error(`Configs folder was not found: ${options.configs}`);
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
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

async function discoverToolchain(options: FirmwareBuildOptions, execute: ProcessExecutor, sdkTag: string): Promise<Toolchain> {
  const picoRoot = resolve(options.picoRoot ?? join(homedir(), '.pico-sdk'));
  const prebuilt = findPicoPrebuiltTools(picoRoot, sdkTag);
  const cmake = requireFile(join(picoRoot, 'cmake', `v${cmakeVersion}`, 'bin', 'cmake.exe'), `CMake ${cmakeVersion}`);
  const ninja = requireFile(join(picoRoot, 'ninja', `v${ninjaVersion}`, 'ninja.exe'), `Ninja ${ninjaVersion}`);
  const armBin = join(picoRoot, 'toolchain', armToolchainVersion, 'bin');
  const gcc = requireFile(join(armBin, 'arm-none-eabi-gcc.exe'), `Arm GNU ${armToolchainVersion} GCC`);
  const gxx = requireFile(join(armBin, 'arm-none-eabi-g++.exe'), `Arm GNU ${armToolchainVersion} G++`);

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

  if (prebuilt !== undefined) return { root: picoRoot, cmake, ninja, python, armBin, prebuilt };

  const vswhere = resolve(options.vswhere ?? join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'));
  requireFile(vswhere, 'Visual Studio instance locator');
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
  if (toolchain.vsDevCmd === undefined) throw new Error('A Visual Studio developer environment script is required to build SDK host tools.');
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
    const toolProfile = selectToolProfile(options.release);
    let firmwareCommit = '';
    let dirty = false;
    await recordStage(`materialize firmware ${options.release} and submodules`, async () => {
      const source = await materializeFirmware({
        ...(options.firmware !== undefined && { source: options.firmware }),
        release: options.release, destination: sourceDirectory, execute,
      });
      if (toolProfile.firmwareCommit !== undefined && source.commit !== toolProfile.firmwareCommit) {
        throw new Error(`Release ${options.release} resolved to unexpected commit ${source.commit}; expected ${toolProfile.firmwareCommit}.`);
      }
      firmwareCommit = source.commit;
      dirty = source.dirty;
      if (options.release === 'main') {
        await runProcess(execute, 'git', ['-C', sourceDirectory, 'update-ref', 'refs/heads/main', source.commit], 'Record materialized main commit', 30_000);
      }
      if (options.configs !== undefined) applyConfigsOverlay(sourceDirectory, options.configs, options.board);
      checkMinimums(parseCmakeMinimums(readFileSync(join(sourceDirectory, 'CMakeLists.txt'), 'utf8')), toolProfile);
      return { stdout: `Firmware commit ${source.commit}${source.dirty ? ' (dirty)' : ''}`, stderr: '' };
    });
    const selection = selectBuild(sourceDirectory, options.release, options.board, options.configs);
    const boardCmake = join(sourceDirectory, 'configs', options.board, `${options.board}.cmake`);
    const { picoBoard, picoPlatform } = resolveBoardPlatform(options.board, existsSync(boardCmake) ? readFileSync(boardCmake, 'utf8') : undefined);
    options.log(`Release: ${selection.release}\nFirmware commit: ${selection.commit}\nBoard: ${selection.board}\nConfig source: ${selection.configSource}\nConfig path: ${selection.configPath}`);

    stage = 'validate qualified toolchain';
    options.log(`Build stage: ${stage}`);
    const toolchain = await discoverToolchain(options, execute, toolProfile.sdkTag);
    const profile = join(runDirectory, 'host-profile');
    mkdirSync(profile);
    let nativeEnvironment: NodeJS.ProcessEnv;
    if (toolchain.prebuilt !== undefined) {
      const { pioasmVersion, pioasmDir, picotoolVersion, picotoolDir } = toolchain.prebuilt;
      options.log(`Using prebuilt pioasm ${pioasmVersion} (${pioasmDir}) and picotool ${picotoolVersion} (${picotoolDir}); no host C++ compiler required.`);
      nativeEnvironment = { ...process.env };
    } else {
      let preparedEnvironment: NodeJS.ProcessEnv | undefined;
      await recordStage('prepare qualified Windows host tools', async () => {
        preparedEnvironment = await visualStudioEnvironment(execute, toolchain, profile);
        return { stdout: preparedEnvironment.VCToolsInstallDir ?? '', stderr: '' };
      });
      if (!preparedEnvironment) throw new Error('Visual Studio environment preparation returned no environment.');
      nativeEnvironment = preparedEnvironment;
    }
    const sdkDirectory = join(runDirectory, 'pico-sdk');
    mkdirSync(join(runDirectory, 'tools'));

    const { sdkTag } = toolProfile;
    let sdkCommit = '';
    await recordStage(`materialize Pico SDK ${sdkTag}`, async () => {
      await execute('git', ['clone', '--depth=1', '--branch', sdkTag, 'https://github.com/raspberrypi/pico-sdk.git', sdkDirectory], {
        timeoutMs: 600_000, stage: `Clone Pico SDK ${sdkTag}`,
      });
      const commit = await gitValue(execute, sdkDirectory, ['rev-parse', 'HEAD']);
      if (toolProfile.sdkCommit !== undefined && commit !== toolProfile.sdkCommit) {
        throw new Error(`Pico SDK ${sdkTag} resolved to unexpected commit ${commit}; expected ${toolProfile.sdkCommit}.`);
      }
      sdkCommit = commit;
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

    const nanopbRequirements = join(sourceDirectory, 'lib', 'nanopb', 'extra', 'requirements.txt');
    const pipConstraint = nanopbPipConstraint(existsSync(nanopbRequirements) ? readFileSync(nanopbRequirements, 'utf8') : undefined);
    const environment: NodeJS.ProcessEnv = {
      ...nativeEnvironment,
      HOME: profile,
      USERPROFILE: profile,
      PICO_SDK_PATH: sdkDirectory,
      PICO_TOOLCHAIN_PATH: join(toolchain.root, 'toolchain', armToolchainVersion),
      PICO_PIO_USB_PATH: join(sourceDirectory, 'lib', 'pico_pio_usb'),
      PICO_BOARD: picoBoard,
      PICO_PLATFORM: picoPlatform,
      GP2040_BOARDCONFIG: options.board,
      PICO_COMPILER: 'pico_arm_cortex_m0plus_gcc',
      SKIP_SUBMODULES: 'TRUE',
      SKIP_WEBBUILD: 'TRUE',
      PATH: `${toolchain.armBin};${dirname(toolchain.cmake)};${dirname(toolchain.ninja)};${nativeEnvironment.PATH ?? process.env.PATH ?? ''}`,
    };
    for (const key of ['CC', 'CXX', 'CMAKE_TOOLCHAIN_FILE', 'PICO_SDK_FETCH_FROM_GIT', 'PICO_SDK_FETCH_FROM_GIT_TAG', 'PICO_SDK_FETCH_FROM_GIT_PATH']) {
      delete environment[key];
    }
    if (pipConstraint !== undefined) {
      const constraint = join(runDirectory, 'pip-constraints.txt');
      writeFileSync(constraint, pipConstraint, { flag: 'wx' });
      environment.PIP_CONSTRAINT = constraint;
    } else {
      delete environment.PIP_CONSTRAINT;
    }
    const buildDirectory = join(runDirectory, 'build');
    await recordStage('configure firmware', () => runProcess(execute, toolchain.cmake, firmwareConfigureArgs({
      sourceDirectory, buildDirectory, ninja: toolchain.ninja, sdkDirectory, python: toolchain.python,
      toolsDirectory: join(runDirectory, 'tools'), prebuilt: toolchain.prebuilt,
      board: options.board, picoBoard, picoPlatform,
    }), `Configure GP2040-CE ${options.board} firmware`, 1_800_000, { env: environment }));
    await recordStage('compile firmware and generate UF2', () => runProcess(execute, toolchain.cmake, [
      '--build', buildDirectory, '--config', 'Release', '--target', 'GP2040-CE',
    ], 'Compile GP2040-CE and generate UF2', 3_600_000, { env: environment }));

    const cachePath = join(buildDirectory, 'CMakeCache.txt');
    stage = 'validate and publish UF2';
    options.log(`Build stage: ${stage}`);
    const cache = readFileSync(cachePath, 'utf8');
    const expectedCache = new Map([
      ['CMAKE_BUILD_TYPE', 'Release'], ['GP2040_BOARDCONFIG', options.board], ['PICO_BOARD', picoBoard],
      ['PICO_SDK_PATH', sdkDirectory.replaceAll('\\', '/')], ['Python3_EXECUTABLE', toolchain.python.replaceAll('\\', '/')],
    ]);
    for (const [key, value] of expectedCache) {
      const actual = readCacheValue(cache, key)?.replaceAll('\\', '/');
      if (actual !== value) throw new Error(`CMake cache ${key} was ${actual ?? 'missing'}, expected ${value}.`);
    }
    const version = await gitValue(execute, sourceDirectory, ['describe', '--tags', '--always', '--dirty', '--abbrev=7']);
    if (options.release === taggedRelease && version !== taggedRelease) {
      throw new Error(`Materialized source reports ${version}, expected ${taggedRelease}.`);
    }
    const outputName = firmwareOutputName(version, options.board);
    const artifactSource = join(buildDirectory, `${outputName}.uf2`);
    const elf = requireFile(join(buildDirectory, `${outputName}.elf`), `Expected ${options.board} ELF`);
    requireFile(artifactSource, `Expected ${options.board} UF2`);
    const elfBytes = readFileSync(elf);
    if (!elfBytes.includes(Buffer.from(outputName)) || !elfBytes.includes(Buffer.from(version))) {
      throw new Error(`The built ELF does not identify the expected ${version} ${options.board} firmware target.`);
    }
    const elfInfo = {
      filename: `${outputName}.elf`,
      byteSize: elfBytes.length,
      sha256: createHash('sha256').update(elfBytes).digest('hex'),
    };

    const sourceSubmodules = await gitValue(execute, sourceDirectory, ['submodule', 'status', '--recursive']);
    const sdkSubmodules = await gitValue(execute, sdkDirectory, ['submodule', 'status', '--recursive']);
    const arduinoJsonCommit = await gitValue(execute, join(buildDirectory, '_deps', 'arduinojson-src'), ['rev-parse', 'HEAD']);
    const prebuilt = toolchain.prebuilt;
    const hostToolDependencies = prebuilt !== undefined
      ? { prebuiltTools: { pioasm: { version: prebuilt.pioasmVersion, dir: prebuilt.pioasmDir }, picotool: { version: prebuilt.picotoolVersion, dir: prebuilt.picotoolDir } } }
      : { picotoolCommit: await gitValue(execute, join(runDirectory, 'tools', 'picotool-src'), ['rev-parse', 'HEAD']) };
    const freeze = await runProcess(execute, join(buildDirectory, 'venv', 'Scripts', 'python.exe'), ['-m', 'pip', 'freeze'], 'Record build-local Python dependencies', 30_000);
    const metadata = {
      firmware: { repository: options.firmware ? resolve(options.firmware) : 'https://github.com/OpenStickCommunity/GP2040-CE.git', requestedRelease: options.release, commit: firmwareCommit, dirty, submodules: sourceSubmodules },
      sdk: { tag: sdkTag, commit: sdkCommit, submodules: sdkSubmodules },
      dependencies: { arduinoJsonCommit, ...hostToolDependencies, pythonPackages: freeze.stdout.trim().split(/\r?\n/) },
      tools: { node: process.version, cmake: cmakeVersion, ninja: ninjaVersion, armGcc: armCompilerVersion, python: '3.13', buildType: 'Release' },
      configuration: { board: options.board, picoBoard, picoPlatform, firmwareVersion: version, upstreamFilename: `${outputName}.uf2`, configSource: selection.configSource, configPath: selection.configPath, elf: elfInfo },
      qualification: { platform: 'Windows x64', hardwareSmokeTest: false },
    };
    const artifact = publishArtifact({
      source: artifactSource, workingDirectory, runId, release: options.release, commit: firmwareCommit, board: options.board, buildType: 'release', metadata,
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