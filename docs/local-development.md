# Running GPBuilder Locally

GPBuilder runs on Node.js 24. The same CLI bundle can run on Windows, macOS, and
Linux; no global npm installation of GPBuilder is required.

Without arguments the CLI prints help. To report installed and missing build tools:

```sh
node dist/cli.cjs --check-prerequisites
```

Local checks never install software. See [Checking Build Prerequisites](prerequisites.md)
for the checklist, reports, exit codes, and Action installation policy. Neither
installation method below builds GP2040-CE firmware yet.

To choose a board and release, see [Selecting a Release and Board](build-selection.md).
Selection requires Git and a local firmware checkout with tags. External config
directories are supported without changing the firmware checkout.

## Option 1: Build from Source

Install [Node.js 24](https://nodejs.org/en/download) with npm, and
[Git](https://git-scm.com/downloads). Confirm the tools are available:

```sh
node --version
npm --version
git --version
```

The Node.js version should start with `v24.`. In a terminal, run:

```sh
git clone https://github.com/becauseimclever/GPBuilder.git
cd GPBuilder
npm ci
npm run check
npm start
```

If you already have a checkout, start from its root directory and skip cloning.
`npm ci` installs the versions in the lockfile, including development tools.
Do not omit development dependencies when building from source.

`npm run check` runs linting, TypeScript checks, bundling, and smoke tests.
`npm start` rebuilds the bundles and launches the CLI. Use it again after editing
the source to run your changes. Pass `-- --check-prerequisites` to request a
read-only host-tool report: `npm start -- --check-prerequisites`.

To build once and run repeatedly without rebuilding:

```sh
npm run build
node dist/cli.cjs
```

The build command bundles JavaScript but does not perform TypeScript checking;
run `npm run check` before submitting changes. Commit regenerated bundles with
source changes because GitHub Action consumers execute them directly.

See [Overall Architecture](architecture.md#spec-driven-development) for the
workflow where feature guides double as specifications and user documentation.

## Option 2: Download a Release Without Building

Only Node.js 24 is required to launch the bundled CLI. GPBuilder's npm dependencies
and a local TypeScript compiler are not required for this option. A prerequisite
check will report missing firmware tools, including Git, separately.

1. Open the [GPBuilder releases page](https://github.com/becauseimclever/GPBuilder/releases).
2. Select a published version that includes the current scaffold and its bundles.
3. Under **Assets**, download **Source code (zip)** or **Source code (tar.gz)**.
4. Extract the archive and open a terminal in the extracted project directory,
   which contains `package.json` and the `dist` directory.
5. Run the bundled CLI directly:

```sh
node dist/cli.cjs
```

Although GitHub labels the download "Source code", the archive also contains
the committed, prebuilt `dist/cli.cjs` file. No compilation or `npm ci` is needed.
Do not use `npm start` for this installation method: it attempts to rebuild and
requires development dependencies.

Release archives are provided automatically by GitHub for a published release's
tag. This route does not require a separate release Action. There is currently
no workflow that uploads a standalone CLI asset, installer, or native executable;
`cli.cjs` is JavaScript and still requires Node.js.

This documentation does not create or publish a release. If no suitable release
is available yet, use the source-build option. A maintainer must publish a release
from a commit containing up-to-date bundles before the download route is available.

Keep the extracted release together, including its license and source. Use
`dist/cli.cjs` for local execution; `dist/action.cjs` is the GitHub Actions adapter.
To upgrade, extract a newer release into a separate directory and run its CLI.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `node` is not found | Install Node.js 24 and reopen the terminal so PATH changes take effect. |
| An unsupported Node.js version is reported | Switch to Node.js 24 and confirm with `node --version`. |
| PowerShell blocks `npm.ps1` | Use `npm.cmd` instead of `npm` for the source-build commands; no execution-policy change is needed. |
| `esbuild` is not found | For a source checkout, run `npm ci` with development dependencies. For a release download, use `node dist/cli.cjs` instead of `npm start`. |
| `dist/cli.cjs` cannot be found | Run from the project root. For source builds, run `npm run build`; for downloads, check that the selected release contains the bundle. |
| A prerequisite check exits with code 1 | Read its report, install or expose the missing tools, and rerun. Local checks never install automatically. |
| A firmware build rejects the target or host | The only implemented build profile is `v0.7.12`, board `Pico`, Release mode, on the qualified Windows x64 toolchain. Other profiles are not supported. |