import { checkPrerequisites } from './prerequisites.js';
import type { PrerequisiteOptions } from './prerequisites.js';
import { listBoards, listReleases, selectBuild } from './build-selection.js';
import type { BuildSelection } from './build-selection.js';

export const operations = ['check-prerequisites', 'list-releases', 'list-boards', 'select-build', 'build'] as const;
export type Operation = typeof operations[number];

export interface RunOptions extends PrerequisiteOptions {
  operation: Operation;
  firmware?: string;
  release?: string;
  board?: string;
  configs?: string;
}

export interface RunResult {
  releases?: string[];
  boards?: string[];
  selection?: BuildSelection;
}

function required(options: RunOptions, name: 'firmware' | 'release' | 'board'): string {
  const value = options[name];
  if (!value?.trim()) throw new Error(`The ${name} input is required for ${options.operation}.`);
  return value;
}

export function run(options: RunOptions): RunResult {
  if (options.operation === 'check-prerequisites' || options.operation === 'build') {
    const results = checkPrerequisites(options);
    const failed = results.filter((result) => result.status !== 'available');
    if (failed.length > 0) {
      throw new Error(`Prerequisite check failed: ${failed.map((result) => result.name).join(', ')}. See the report for installation guidance.`);
    }
    if (options.operation === 'check-prerequisites') return {};
  }
  const firmware = required(options, 'firmware');
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
  if (options.operation === 'build') {
    throw new Error('Firmware build orchestration is not implemented yet. Prerequisites passed; no firmware was built.');
  }
  options.log('Selection validated; no firmware was built.');
  return { selection };
}