import { checkPrerequisites } from './prerequisites.js';
import type { PrerequisiteOptions } from './prerequisites.js';

export interface RunOptions extends PrerequisiteOptions {
  operation: 'check-prerequisites' | 'build';
}

export function run(options: RunOptions): void {
  const results = checkPrerequisites(options);
  const failed = results.filter((result) => result.status !== 'available');
  if (failed.length > 0) {
    throw new Error(`Prerequisite check failed: ${failed.map((result) => result.name).join(', ')}. See the report for installation guidance.`);
  }
  if (options.operation === 'build') {
    throw new Error('Firmware build orchestration is not implemented yet. Prerequisites passed; no firmware was built.');
  }
}