import * as core from '@actions/core';
import { run } from './orchestrator.js';

try {
  const operation = core.getInput('command') || 'check-prerequisites';
  if (operation !== 'check-prerequisites' && operation !== 'build') {
    throw new Error('The command input must be check-prerequisites or build.');
  }
  run({ mode: 'action', operation, log: core.info });
} catch (error) {
  core.setFailed(error instanceof Error ? error : String(error));
}