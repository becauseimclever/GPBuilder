import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { executeProcess } from './process-runner.js';
import type { ProcessExecutor } from './process-runner.js';

const upstreamRepository = 'https://github.com/OpenStickCommunity/GP2040-CE.git';
const taggedRelease = 'v0.7.12';
const mainTarget = 'main';
const excludedCopySegments = new Set(['node_modules', 'build']);

export interface MaterializedFirmware {
  directory: string;
  commit: string;
  tag: string;
  dirty: boolean;
}

export interface MaterializeOptions {
  source?: string;
  release: string;
  destination: string;
  execute?: ProcessExecutor;
}

async function git(execute: ProcessExecutor, directory: string, args: string[], timeoutMs = 600_000): Promise<string> {
  const result = await execute('git', ['-C', directory, ...args], { cwd: directory, timeoutMs, stage: `Git ${args[0]}` });
  return result.stdout.trim();
}

async function checkoutVerified(execute: ProcessExecutor, directory: string, commit: string, release: string): Promise<void> {
  await git(execute, directory, ['checkout', '--quiet', '--detach', commit], 10_000);
  if (await git(execute, directory, ['rev-parse', 'HEAD'], 10_000) !== commit) {
    throw new Error(`Materialized firmware does not match ${release}.`);
  }
}

async function requireRootCmake(execute: ProcessExecutor, directory: string, release: string): Promise<void> {
  const rootCmake = await git(execute, directory, ['ls-tree', '-z', 'HEAD', '--', 'CMakeLists.txt'], 10_000);
  if (!/^100(?:644|755) blob [a-f0-9]+\tCMakeLists\.txt\0$/.test(rootCmake)) {
    throw new Error(`Firmware ${release} does not contain a regular root CMakeLists.txt.`);
  }
}

function copyWorkingTree(source: string, directory: string): void {
  cpSync(source, directory, {
    recursive: true,
    filter: (path) => !relative(source, path).split(sep).some((segment) => excludedCopySegments.has(segment)),
  });
}

async function materializeLocalMain(execute: ProcessExecutor, source: string, directory: string): Promise<MaterializedFirmware> {
  copyWorkingTree(source, directory);
  const commit = await git(execute, directory, ['rev-parse', '--verify', 'HEAD^{commit}'], 10_000);
  await git(execute, directory, ['submodule', 'update', '--init', '--recursive']);
  const dirty = (await git(execute, directory, ['status', '--porcelain'], 60_000)) !== '';
  return { directory, commit, tag: mainTarget, dirty };
}

async function materializeUpstreamMain(execute: ProcessExecutor, directory: string): Promise<MaterializedFirmware> {
  await execute('git', ['init', '--quiet', directory], { timeoutMs: 10_000, stage: 'Initialize firmware source' });
  await git(execute, directory, ['remote', 'add', 'origin', upstreamRepository], 10_000);
  await git(execute, directory, ['fetch', '--filter=blob:none', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  const commit = await git(execute, directory, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'], 10_000);
  await checkoutVerified(execute, directory, commit, mainTarget);
  await requireRootCmake(execute, directory, mainTarget);
  await git(execute, directory, ['submodule', 'update', '--init', '--recursive']);
  return { directory, commit, tag: mainTarget, dirty: false };
}

async function materializeTag(execute: ProcessExecutor, source: string | undefined, directory: string, release: string): Promise<MaterializedFirmware> {
  if (source !== undefined) {
    await execute('git', ['clone', '--no-hardlinks', '--no-checkout', '--', source, directory], {
      timeoutMs: 600_000, stage: 'Clone local firmware source',
    });
  } else {
    await execute('git', ['init', '--quiet', directory], { timeoutMs: 10_000, stage: 'Initialize firmware source' });
    await git(execute, directory, ['remote', 'add', 'origin', upstreamRepository], 10_000);
    await git(execute, directory, ['fetch', '--depth=1', 'origin', `refs/tags/${release}:refs/tags/${release}`]);
  }
  const commit = await git(execute, directory, ['rev-parse', '--verify', `refs/tags/${release}^{commit}`], 10_000);
  await checkoutVerified(execute, directory, commit, release);
  await requireRootCmake(execute, directory, release);
  await git(execute, directory, ['submodule', 'update', '--init', '--recursive']);
  if (await git(execute, directory, ['status', '--porcelain', '--untracked-files=all'], 10_000)) {
    throw new Error(`Materialized firmware checkout for ${release} is not clean.`);
  }
  return { directory, commit, tag: release, dirty: false };
}

export async function materializeFirmware(options: MaterializeOptions): Promise<MaterializedFirmware> {
  const { release } = options;
  if (release !== taggedRelease && release !== mainTarget) {
    throw new Error('This build currently supports the exact tag v0.7.12 or main only.');
  }
  const execute = options.execute ?? executeProcess;
  const directory = resolve(options.destination);
  if (existsSync(directory)) throw new Error(`Firmware destination already exists: ${directory}`);
  const source = options.source === undefined ? undefined : resolve(options.source);

  if (release === mainTarget) {
    return source === undefined ? materializeUpstreamMain(execute, directory) : materializeLocalMain(execute, source, directory);
  }
  return materializeTag(execute, source, directory, release);
}

/** Replaces configs/<board> in an owned firmware copy with <configsDirectory>/<board>. */
export function applyConfigsOverlay(firmwareDirectory: string, configsDirectory: string, board: string): string {
  const overlaySource = resolve(configsDirectory, board);
  if (!existsSync(join(overlaySource, 'BoardConfig.h'))) {
    throw new Error(`Configs folder must contain ${board}/BoardConfig.h: ${overlaySource}`);
  }
  const target = resolve(firmwareDirectory, 'configs', board);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(overlaySource, target, { recursive: true });
  return target;
}