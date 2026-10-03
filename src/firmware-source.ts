import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeProcess } from './process-runner.js';
import type { ProcessExecutor } from './process-runner.js';

const upstreamRepository = 'https://github.com/OpenStickCommunity/GP2040-CE.git';
const supportedRelease = 'v0.7.12';

export interface MaterializedFirmware {
  directory: string;
  commit: string;
  tag: string;
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

export async function materializeFirmware(options: MaterializeOptions): Promise<MaterializedFirmware> {
  const { release } = options;
  if (release !== supportedRelease) throw new Error('This build currently supports the exact tag v0.7.12 only.');
  const execute = options.execute ?? executeProcess;
  const directory = resolve(options.destination);
  if (existsSync(directory)) throw new Error(`Firmware destination already exists: ${directory}`);

  if (options.source !== undefined) {
    await execute('git', ['clone', '--no-hardlinks', '--no-checkout', '--', resolve(options.source), directory], {
      timeoutMs: 600_000, stage: 'Clone local firmware source',
    });
  } else {
    await execute('git', ['init', '--quiet', directory], { timeoutMs: 10_000, stage: 'Initialize firmware source' });
    await git(execute, directory, ['remote', 'add', 'origin', upstreamRepository], 10_000);
    await git(execute, directory, ['fetch', '--depth=1', 'origin', `refs/tags/${release}:refs/tags/${release}`]);
  }

  const commit = await git(execute, directory, ['rev-parse', '--verify', `refs/tags/${release}^{commit}`], 10_000);
  await git(execute, directory, ['checkout', '--quiet', '--detach', commit], 10_000);
  if (await git(execute, directory, ['rev-parse', 'HEAD'], 10_000) !== commit) {
    throw new Error(`Materialized firmware does not match release ${release}.`);
  }
  const rootCmake = await git(execute, directory, ['ls-tree', '-z', 'HEAD', '--', 'CMakeLists.txt'], 10_000);
  if (!/^100(?:644|755) blob [a-f0-9]+\tCMakeLists\.txt\0$/.test(rootCmake)) {
    throw new Error(`Release ${release} does not contain a regular root CMakeLists.txt.`);
  }
  await git(execute, directory, ['submodule', 'update', '--init', '--recursive']);
  if (await git(execute, directory, ['status', '--porcelain', '--untracked-files=all'], 10_000)) {
    throw new Error(`Materialized firmware checkout for ${release} is not clean.`);
  }
  return { directory, commit, tag: release };
}