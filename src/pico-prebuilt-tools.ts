import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const MINIMUM_PREBUILT_PICOTOOL = '2.3.0';

export interface PicoPrebuiltTools {
  pioasmVersion: string;
  pioasmDir: string;
  picotoolVersion: string;
  picotoolDir: string;
}

const compareNumeric = (left: string, right: string): number =>
  left.replace(/^v/, '').localeCompare(right.replace(/^v/, ''), 'en', { numeric: true });

function versionDirectories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v?\d/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => compareNumeric(right, left));
  } catch {
    return [];
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds the Raspberry Pi Pico extension's prebuilt pioasm and picotool CMake packages.
 * The Pico SDK locates pioasm with an exact-version find_package, so when sdkTag is
 * given only that pioasm version qualifies; otherwise the newest one is used.
 */
export function findPicoPrebuiltTools(picoRoot: string, sdkTag?: string): PicoPrebuiltTools | undefined {
  const pioasmRoot = join(picoRoot, 'tools');
  const pioasmVersion = versionDirectories(pioasmRoot)
    .filter((version) => sdkTag === undefined || version.replace(/^v/, '') === sdkTag.replace(/^v/, ''))
    .find((version) => isFile(join(pioasmRoot, version, 'pioasm', 'pioasmConfig.cmake')));
  const picotoolRoot = join(picoRoot, 'picotool');
  const picotoolVersion = versionDirectories(picotoolRoot)
    .filter((version) => compareNumeric(version, MINIMUM_PREBUILT_PICOTOOL) >= 0)
    .find((version) => isFile(join(picotoolRoot, version, 'picotool', 'picotoolConfig.cmake')));
  if (!pioasmVersion || !picotoolVersion) return undefined;
  return {
    pioasmVersion,
    pioasmDir: join(pioasmRoot, pioasmVersion, 'pioasm'),
    picotoolVersion,
    picotoolDir: join(picotoolRoot, picotoolVersion, 'picotool'),
  };
}
