import { checkPrerequisites } from './prerequisites.js';
import type { PrerequisiteOptions } from './prerequisites.js';
import { listBoards, listReleases, selectBuild } from './build-selection.js';
import type { BuildSelection } from './build-selection.js';
import { buildFirmware, validateFirmwareBuildRequest } from './firmware-build.js';
import type { PublishedArtifact } from './artifact-publisher.js';
import type { ProcessExecutor } from './process-runner.js';

export const operations = ['check-prerequisites', 'list-releases', 'list-boards', 'select-build', 'build'] as const;
export type Operation = typeof operations[number];

export function inferOperation(explicit: Operation | undefined, options: { release?: string; board?: string }): Operation | undefined {
  if (explicit !== undefined) return explicit;
  return options.release?.trim() && options.board?.trim() ? 'build' : undefined;
}

export interface RunOptions extends PrerequisiteOptions {
  operation: Operation;
  firmware?: string;
  release?: string;
  board?: string;
  configs?: string;
  process?: ProcessExecutor;
}

export interface RunResult {
  releases?: string[];
  boards?: string[];
  selection?: BuildSelection;
  artifact?: PublishedArtifact;
}

function required(options: RunOptions, name: 'firmware' | 'release' | 'board'): string {
  const value = options[name];
  if (!value?.trim()) throw new Error(`The ${name} input is required for ${options.operation}.`);
  return value;
}

export function run(options: RunOptions): RunResult | Promise<RunResult> {
  if (options.operation === 'build' && options.release?.trim() && options.board?.trim()) {
    validateFirmwareBuildRequest({
      release: options.release,
      board: options.board,
      ...(options.configs !== undefined && { configs: options.configs }),
      platform: options.host?.platform ?? process.platform,
    });
  }
  if (options.operation === 'check-prerequisites' || options.operation === 'build') {
    const results = checkPrerequisites(options);
    const failed = results.filter((result) => result.status !== 'available');
    if (failed.length > 0) {
      throw new Error(`Prerequisite check failed: ${failed.map((result) => result.name).join(', ')}. See the report for installation guidance.`);
    }
    if (options.operation === 'check-prerequisites') return {};
  }
  const firmware = options.firmware?.trim();
  if (options.operation === 'build') {
    return buildFirmware({
      ...(firmware && { firmware }),
      release: required(options, 'release'),
      board: required(options, 'board'),
      ...(options.configs !== undefined && { configs: options.configs }),
      log: options.log,
      ...(options.host?.picoRoot && { picoRoot: options.host.picoRoot }),
      ...(options.host?.vswhere && { vswhere: options.host.vswhere }),
      ...(options.host?.platform && { platform: options.host.platform }),
      ...(options.process && { execute: options.process }),
    }).then((result) => ({ selection: result.selection, artifact: result.artifact }));
  }
  if (!firmware) throw new Error(`The firmware input is required for ${options.operation}.`);
  if (options.operation === 'list-releases') {
    const releases = listReleases(firmware);
    for (const release of releases) options.log(release);
    return { releases };
  }
  const release = required(options, 'release');
  if (options.configs !== undefined && !options.configs.trim()) throw new Error('The configs input must be a non-empty directory path.');
  if (options.operation === 'list-boards') {
    const boards = listBoards(firmware, release, options.configs);
    for (const board of boards) options.log(board);
    return { boards };
  }
  const selection = selectBuild(firmware, release, required(options, 'board'), options.configs);
  options.log(`Release: ${selection.release}\nFirmware commit: ${selection.commit}\nBoard: ${selection.board}\nConfig source: ${selection.configSource}\nConfig path: ${selection.configPath}`);
  options.log('Selection validated; no firmware was built.');
  return { selection };
}