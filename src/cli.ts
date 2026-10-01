import { parseArgs } from 'node:util';
import { run } from './orchestrator.js';

try {
  const { values } = parseArgs({
    options: {
      'check-prerequisites': { type: 'boolean' },
      build: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });
  if (values['check-prerequisites'] && values.build) {
    throw new Error('Choose --check-prerequisites or --build, not both. Builds always check prerequisites.');
  }
  if (values.help || (!values['check-prerequisites'] && !values.build)) {
    console.log('GPBuilder\n\nUsage: node dist/cli.cjs [--check-prerequisites | --build | --help]\n\n--check-prerequisites  Report host tools without installing anything.\n--build                Check prerequisites, then request a firmware build (not implemented).');
  } else {
    run({
      mode: 'local', log: console.log,
      operation: values.build ? 'build' : 'check-prerequisites',
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}