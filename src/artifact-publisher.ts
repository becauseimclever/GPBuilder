import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateUf2 } from './uf2.js';

export interface PublishOptions {
  source: string;
  workingDirectory: string;
  runId: string;
  release: string;
  /** Full firmware commit; required when release is `main`. */
  commit?: string;
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

interface ArtifactLayout {
  segments: string[];
  filename: string;
  requested: Record<string, string>;
}

function artifactLayout(options: PublishOptions): ArtifactLayout {
  if (!/^[A-Za-z0-9_-]+$/.test(options.board)) {
    throw new Error('Artifact board name contains unsupported characters.');
  }
  if (options.buildType !== 'release') {
    throw new Error('Artifact publication currently supports release builds only.');
  }
  const { board, buildType } = options;
  if (options.release === 'v0.7.12') {
    return {
      segments: [board, 'v0.7.12', buildType],
      filename: `GP2040-CE_0.7.12_${board}.uf2`,
      requested: { release: options.release, board, buildType },
    };
  }
  if (options.release === 'main') {
    const commit = options.commit;
    if (commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) {
      throw new Error('Publishing a main build requires the full 40-character lowercase firmware commit.');
    }
    return {
      segments: [board, 'main', commit, buildType],
      filename: `GP2040-CE_main_${commit}_${board}.uf2`,
      requested: { release: 'main', commit, board, buildType },
    };
  }
  throw new Error('Artifact publication currently supports v0.7.12 and main builds only.');
}

export function publishArtifact(options: PublishOptions): PublishedArtifact {
  if (!/^[A-Za-z0-9-]+$/.test(options.runId)) throw new Error('Artifact run ID contains unsupported characters.');
  const layout = artifactLayout(options);
  const source = resolve(options.source);
  const sourceStats = lstatSync(source);
  if (!sourceStats.isFile()) throw new Error('The UF2 source must be a regular file.');
  const input = readFileSync(source);
  const validation = validateUf2(input);
  const parent = resolve(options.workingDirectory, 'artifacts', ...layout.segments);
  mkdirSync(parent, { recursive: true });
  const destination = join(parent, options.runId);
  if (existsSync(destination)) throw new Error(`Artifact run ${options.runId} already exists.`);
  const staging = mkdtempSync(join(parent, `.tmp-${options.runId}-`));
  const { filename } = layout;
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
      requested: layout.requested,
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