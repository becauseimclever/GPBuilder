import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

const releasePattern = /^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const boardPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface BuildSelection {
  firmware: string;
  release: string;
  commit: string;
  board: string;
  configSource: 'firmware' | 'external';
  configPath: string;
}

function git(firmware: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', resolve(firmware), ...args], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read firmware repository at ${resolve(firmware)}. Ensure Git is installed and the checkout/tag is available locally. ${detail}`, { cause: error });
  }
}

export function listReleases(firmware: string): string[] {
  if (git(firmware, ['rev-parse', '--is-inside-work-tree', '--show-prefix']).trim() !== 'true') {
    throw new Error('The firmware directory must be the repository root of a local Git checkout.');
  }
  return git(firmware, ['for-each-ref', '--format=%(refname:strip=2)', 'refs/tags'])
    .split(/\r?\n/).filter((tag) => releasePattern.test(tag))
    .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }));
}

function releaseCommit(firmware: string, release: string): string {
  if (!releasePattern.test(release)) throw new Error('Select an exact release tag such as v0.7.10.');
  if (!listReleases(firmware).includes(release)) {
    throw new Error(`Release ${release} is not available locally. Fetch the desired tag into the firmware checkout first.`);
  }
  const commit = git(firmware, ['rev-parse', '--verify', `refs/tags/${release}^{commit}`]).trim();
  const root = git(firmware, ['ls-tree', '-z', commit, '--', 'CMakeLists.txt']);
  if (!/^100(?:644|755) blob [a-f0-9]+\tCMakeLists\.txt\0$/.test(root)) {
    throw new Error(`Release ${release} does not contain a regular root CMakeLists.txt.`);
  }
  return commit;
}

function externalDirectory(configs: string): string {
  try {
    const directory = realpathSync(resolve(configs));
    if (!lstatSync(directory).isDirectory()) throw new Error('Not a directory');
    return directory;
  } catch (error) {
    throw new Error(`Cannot read external config directory: ${resolve(configs)}`, { cause: error });
  }
}

function discoverBoards(firmware: string, commit: string, configs?: string): string[] {
  let boards: string[];
  if (configs !== undefined) {
    const directory = externalDirectory(configs);
    try {
      boards = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && boardPattern.test(entry.name))
        .filter((entry) => {
          try {
            return lstatSync(join(directory, entry.name, 'BoardConfig.h')).isFile();
          } catch {
            return false;
          }
        }).map((entry) => entry.name);
    } catch (error) {
      throw new Error(`Cannot read external config directory: ${directory}`, { cause: error });
    }
  } else {
    boards = git(firmware, ['ls-tree', '-r', '-z', commit, '--', 'configs'])
      .split('\0').flatMap((record) => {
        const match = /^100(?:644|755) blob [a-f0-9]+\tconfigs\/([^/]+)\/BoardConfig\.h$/.exec(record);
        const board = match?.[1];
        return board && boardPattern.test(board) ? [board] : [];
      });
  }
  return boards.sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
}

export function listBoards(firmware: string, release: string, configs?: string): string[] {
  return discoverBoards(firmware, releaseCommit(firmware, release), configs);
}

export function selectBuild(firmware: string, release: string, board: string, configs?: string): BuildSelection {
  if (!boardPattern.test(board)) throw new Error('Select a board name, not a path.');
  const commit = releaseCommit(firmware, release);
  const boards = discoverBoards(firmware, commit, configs);
  if (!boards.includes(board)) {
    throw new Error(`Unknown board ${board} in ${configs === undefined ? `release ${release}` : 'external configs'}. Use list-boards to see available names.`);
  }
  return {
    firmware: resolve(firmware), release, commit, board,
    configSource: configs === undefined ? 'firmware' : 'external',
    configPath: configs === undefined ? `configs/${board}` : join(externalDirectory(configs), board),
  };
}