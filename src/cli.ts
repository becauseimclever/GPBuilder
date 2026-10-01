import { parseArgs } from 'node:util';
import { operations, run } from './orchestrator.js';

try {
  const { values } = parseArgs({
    options: {
      'check-prerequisites': { type: 'boolean' },
      'list-releases': { type: 'boolean' },
      'list-boards': { type: 'boolean' },
      'select-build': { type: 'boolean' },
      build: { type: 'boolean' },
      firmware: { type: 'string' },
      release: { type: 'string' },
      board: { type: 'string' },
      configs: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });
  const selected = operations.filter((operation) => values[operation]);
  if (selected.length > 1) {
    throw new Error('Choose one operation. Builds always check prerequisites.');
  }
  const operation = selected[0];
  if (!values.help && operation === undefined && [values.firmware, values.release, values.board, values.configs].some((value) => value !== undefined)) {
    throw new Error('Choose an operation, such as --select-build or --list-boards.');
  }
  if (values.help || operation === undefined) {
    console.log(`GPBuilder

Usage: node dist/cli.cjs <operation> [options]

--check-prerequisites  Report host tools without installing anything.
--list-releases        List local release tags; requires --firmware.
--list-boards          List boards; requires --firmware and --release.
--select-build         Validate --firmware, --release, and --board without building.
--build                Check prerequisites and selection; compilation is not implemented.
--help                Show this help.

--firmware <path>      Local GP2040-CE Git checkout.
--release <tag>        Exact local release tag (for example v0.7.10).
--board <name>         Exact, case-sensitive board directory name.
--configs <path>       External directory containing board folders; replaces built-in configs.`);
  } else {
    run({
      mode: 'local', log: console.log,
      operation,
      ...(values.firmware !== undefined && { firmware: values.firmware }),
      ...(values.release !== undefined && { release: values.release }),
      ...(values.board !== undefined && { board: values.board }),
      ...(values.configs !== undefined && { configs: values.configs }),
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}