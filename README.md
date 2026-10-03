# GPBuilder

Build orchestrator for GP2040-CE, designed to run locally and as a reusable
GitHub Action.

GPBuilder selects local GP2040-CE release tags or the local `main` branch and
boards, supports external board config directories, and reports installed and
missing host build tools. It can install missing packages on Ubuntu GitHub Actions
runners. A complete UF2 build is implemented for GP2040-CE `v0.7.12`, the original
Pico, Release mode, and the qualified Windows x64 tool profile. Other targets and
host profiles are not yet supported.

## Architecture and Development

See [Overall Architecture](docs/architecture.md) for the current system, proposed
build boundaries, and documentation-driven development workflow. Feature guides
double as specifications: usage, behavior, limitations, and acceptance criteria
live in one document. Start with [Selecting a Release and Board](docs/build-selection.md)
or [Checking Build Prerequisites](docs/prerequisites.md).

The [planned CLI reference](docs/build-selection.md#planned-cli-contract) documents
short/long flags, upstream source defaults, debug/release builds, and the pending
matrix design. These additions are documented but not implemented.

The [matrix schema](docs/matrix.md) supports YAML and JSON with shared defaults,
a board list, and per-board config-location overrides. Matrix execution policy
is still pending; no matrix support is implemented yet.

[Building a Flashable Pico UF2](docs/firmware-build.md) documents the implemented
workflow: `--release v0.7.12 --board Pico` produces a validated UF2 using default
upstream source/configs on the qualified Windows x64 profile. Hardware behavior is
not qualified; the build does not flash a device.

Local `main` selection is implemented for listing and validating boards. Building
a pinned main commit for development/nightly use remains planned; its SDK and tool
checks/setup will follow that commit's referenced versions, while older releases
retain their own requirements.

## Local Development

Install Node.js 24, npm, and Git, then run:

```sh
git clone https://github.com/becauseimclever/GPBuilder.git
cd GPBuilder
npm ci
npm start
```

For an existing checkout, skip cloning and run the npm commands from its root.
`npm start` builds and runs the local CLI. The project uses strict TypeScript,
ESLint with type-aware rules, esbuild, and the Node.js test runner.

Run `npm start -- --check-prerequisites` for a read-only tool report. With no
arguments the CLI shows help. A complete `--release v0.7.12 --board Pico` pair
starts the qualified build; unsupported target/profile combinations fail.

With a local firmware Git checkout, choose a release and board without building:

```sh
npm start -- --list-releases --firmware ../GP2040-CE
npm start -- --list-boards --firmware ../GP2040-CE --release v0.7.12
npm start -- --select-build --firmware ../GP2040-CE --release v0.7.12 --board Pico
```

Use an exact local tag from the first command or select `main` explicitly. Main
means the local `refs/heads/main` branch; it does not use the current checkout or
fetch from upstream. Add `--configs <directory>` to
list/select boards from a separate local config directory or checked-out repo.
See the [selection guide](docs/build-selection.md) for the layout and Action inputs/outputs.

To run without building, download a published release's **Source code** archive,
extract it, and run `node dist/cli.cjs` from the extracted project root. The archive
includes the committed CLI bundle; only Node.js 24 is needed. This requires a
release containing the bundle and does not create or publish one automatically.

See [Running GPBuilder Locally](docs/local-development.md) for full source-build
and release-download instructions, prerequisites, and troubleshooting.

| Command | Purpose |
| --- | --- |
| `npm run build` | Bundle the CLI and GitHub Action into `dist/` |
| `npm run lint` | Lint source, tests, JavaScript configuration, and all project `.yml`/`.yaml` files; reject warnings |
| `npm run lint:fix` | Apply automatic lint fixes |
| `npm run typecheck` | Check TypeScript without emitting files |
| `npm test` | Build and smoke-test both bundled entry points |
| `npm run check` | Run linting, type checking, build, and tests |

YAML linting includes GitHub workflows and Action metadata. With the VS Code
ESLint extension installed, workspace settings enable the same YAML rules in the
editor. `npm run check` is the required zero-error, zero-warning validation gate;
`npm run build` alone only bundles the application.

The shared orchestration entry point is `src/orchestrator.ts`. The local adapter
is `src/cli.ts`, and `src/action.ts` handles GitHub Actions logging and failures.

## GitHub Action Usage

After these files have been pushed, another repository can use this action by
referencing that commit's full SHA. Replace `COMMIT_SHA` below with the actual SHA:

```yaml
name: GPBuilder
on: workflow_dispatch

permissions:
  contents: read

jobs:
  prerequisites:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: becauseimclever/GPBuilder@COMMIT_SHA
        with:
          command: check-prerequisites
```

Consumers do not need to install or build GPBuilder. GitHub supplies its Node.js 24
Action runtime, while `actions/setup-node` provides Node.js 24 and npm on PATH for
the prerequisite checks. Self-hosted runners must support `node24` actions.
See the [prerequisite guide](docs/prerequisites.md) for automatic installation
requirements and the `command: build` gate.

## Bundles and Releases

The generated `dist/` files are intentionally committed: GitHub executes them
directly when another repository references the action. After source or dependency
changes, run `npm run check` and include the updated bundles and lockfile in your
commit. CI checks Linux, Windows, and macOS and rejects stale or missing bundles.

To release the action:

1. Ensure CI passes and the generated bundles are committed.
2. Create a version tag such as `v0.1.0` and a GitHub release targeting that commit.
3. Consumers can then reference `becauseimclever/GPBuilder@v0.1.0` (or pin its SHA).
4. Optionally publish the release to GitHub Marketplace using GitHub's release UI.
	 The repository must be public and meet Marketplace requirements; `action.yml`
	 contains the required metadata and branding.

No releases are created automatically. The npm package is marked private to avoid
accidental npm publication; GitHub Action distribution does not require npm
publication.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
