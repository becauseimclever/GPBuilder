import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateUf2 } from './uf2.js';

export interface PublishOptions {
  source: string;
  workingDirectory: string;
  runId: string;
  release: string;
  board: string;
  buildType: string;
  metadata: Record<string, unknown>;
}

export interface PublishedArtifact {
  path: string;
  metadataPath: string;
  sha256: string;
  byteSize: number;
}

export function publishArtifact(options: PublishOptions): PublishedArtifact {
  if (!/^[A-Za-z0-9-]+$/.test(options.runId)) throw new Error('Artifact run ID contains unsupported characters.');
  if (options.release !== 'v0.7.12' || options.board !== 'Pico' || options.buildType !== 'release') {
    throw new Error('Artifact publication currently supports v0.7.12, Pico, and release builds only.');
  }
  const source = resolve(options.source);
  const sourceStats = lstatSync(source);
  if (!sourceStats.isFile()) throw new Error('The UF2 source must be a regular file.');
  const input = readFileSync(source);
  const validation = validateUf2(input);
  const parent = resolve(options.workingDirectory, 'artifacts', 'Pico', 'v0.7.12', 'release');
  mkdirSync(parent, { recursive: true });
  const destination = join(parent, options.runId);
  if (existsSync(destination)) throw new Error(`Artifact run ${options.runId} already exists.`);
  const staging = mkdtempSync(join(parent, `.tmp-${options.runId}-`));
  const filename = 'GP2040-CE_0.7.12_Pico.uf2';
  const stagedUf2 = join(staging, filename);
  const stagedMetadata = join(staging, 'build.json');
  const digest = createHash('sha256').update(input).digest('hex');

  try {
    copyFileSync(source, stagedUf2);
    const published = readFileSync(stagedUf2);
    const publishedDigest = createHash('sha256').update(published).digest('hex');
    if (published.length !== input.length || publishedDigest !== digest) {
      throw new Error('Published UF2 size or SHA-256 does not match the validated build output.');
    }
    writeFileSync(stagedMetadata, `${JSON.stringify({
      ...options.metadata,
      requested: { release: options.release, board: options.board, buildType: options.buildType },
      artifact: {
        filename, byteSize: published.length, sha256: publishedDigest,
        validation: { ...validation, flashStartHex: `0x${validation.addressStart.toString(16)}`, flashEndHex: `0x${validation.addressEnd.toString(16)}` },
      },
    }, null, 2)}\n`, { flag: 'wx' });
    renameSync(staging, destination);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  const path = join(destination, filename);
  const metadataPath = join(destination, 'build.json');
  const finalStats = lstatSync(path);
  if (!finalStats.isFile()) throw new Error('Published UF2 is not a regular file.');
  const finalBytes = readFileSync(path);
  const finalDigest = createHash('sha256').update(finalBytes).digest('hex');
  if (finalStats.size !== input.length || finalDigest !== digest) throw new Error('Published UF2 verification failed.');
  return { path: resolve(path), metadataPath: resolve(metadataPath), sha256: finalDigest, byteSize: finalStats.size };
}