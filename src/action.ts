import * as core from '@actions/core';
import { operations, run } from './orchestrator.js';

async function main(): Promise<void> {
  try {
    const command = core.getInput('command') || 'check-prerequisites';
    const operation = operations.find((candidate) => candidate === command);
    if (!operation) {
      throw new Error(`The command input must be one of: ${operations.join(', ')}.`);
    }
    const configs = core.getInput('configs');
    const firmware = core.getInput('firmware');
    const result = await run({
      mode: 'action', operation, log: core.info,
      ...(firmware && { firmware }), release: core.getInput('release'), board: core.getInput('board'),
      ...(configs && { configs }),
    });
    if (result.releases) core.setOutput('releases', result.releases);
    if (result.boards) core.setOutput('boards', result.boards);
    if (result.selection) {
      core.setOutput('release', result.selection.release);
      core.setOutput('firmware-commit', result.selection.commit);
      core.setOutput('board', result.selection.board);
      core.setOutput('config-source', result.selection.configSource);
      core.setOutput('config-path', result.selection.configPath);
    }
    if (result.artifact) {
      core.setOutput('uf2-path', result.artifact.path);
      core.setOutput('uf2-sha256', result.artifact.sha256);
      core.setOutput('build-metadata-path', result.artifact.metadataPath);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error : String(error));
  }
}

void main();