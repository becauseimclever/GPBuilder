# Overall Architecture

Status: baseline for prerequisite checking; future firmware build behavior is proposed.

## Purpose and Scope

GPBuilder is a Node.js build orchestrator for GP2040-CE. It is intended to expose
the same build capabilities through a local CLI and a reusable GitHub Action.
It coordinates firmware tooling rather than replacing the firmware project's
build system or owning firmware source code.

The current implementation checks host prerequisites and reports them. The CLI
is read-only; the Action can repair missing tools on Ubuntu runners. Both build
entry points require the shared prerequisite gate, then fail explicitly because
firmware compilation is not implemented. Firmware checkout, SDK preparation,
compilation, and artifact collection remain future work.

## Architectural Principles

- Keep observable behavior and acceptance criteria in the user-facing feature guide.
- Keep build decisions in a shared core so local and Action execution agree.
- Keep CLI arguments, GitHub inputs, logging, and exit handling in adapters.
- Make source revisions, configuration, and toolchain versions explicit enough
  to diagnose and reproduce a build.
- Prefer small modules and typed contracts; do not introduce a plugin framework,
  service, or dependency-injection container without a demonstrated need.

## Current System

```mermaid
flowchart TD
    Local[Local developer] --> CLI[CLI adapter]
    Workflow[Consumer workflow] --> Action[GitHub Action adapter]
    CLI --> Core[Shared orchestration entry point]
    Action --> Core
    Core --> Prerequisites[Shared host-tool checks and console report]
    Prerequisites --> LocalReport[Local: report only]
    Prerequisites --> Repair[Action: Ubuntu package repair and recheck]
```

| Component | Location | Current responsibility |
| --- | --- | --- |
| Shared core | [src/orchestrator.ts](../src/orchestrator.ts) | Requires prerequisites for checks and builds; rejects unfinished build execution |
| Prerequisites | [src/prerequisites.ts](../src/prerequisites.ts) | Detects tools, reports status, and applies the Ubuntu Action repair policy |
| CLI adapter | [src/cli.ts](../src/cli.ts) | Supplies console logging and maps failures to a nonzero exit code |
| Action adapter | [src/action.ts](../src/action.ts) | Supplies Actions logging and reports failures with `core.setFailed` |
| Action metadata | [action.yml](../action.yml) | Declares Node.js 24 and the `command` input; no outputs yet |
| Build and checks | [package.json](../package.json) | Defines npm scripts and dependencies |
| Smoke tests | [test/smoke.test.mjs](../test/smoke.test.mjs) | Executes standalone copies of both bundles from temporary directories |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | Tests on Linux, Windows, and macOS; verifies bundles; invokes the real Action on Linux |

The core accepts an explicit operation and local/Action mode plus a logging
function; it does not import the Actions toolkit. Command execution and host
information are injectable for deterministic tests. The CLI cannot enable
installation merely by inheriting GitHub environment variables.

## Runtime and Distribution

- Node.js 24 is the supported application runtime. TypeScript uses strict checks.
- npm and the committed lockfile manage dependencies. `npm ci` installs the
  locked dependency tree.
- esbuild produces standalone CommonJS bundles for the CLI and Action.
- `npm start` rebuilds and launches the CLI. Action consumers execute the
  committed bundle without installing this project's dependencies.
- The JavaScript Action is distributed through Git refs and GitHub releases;
  Marketplace listing is optional. The npm package is currently private.
- CI is configured to test the scaffold on three operating systems. This does not establish
  cross-platform support for GP2040-CE toolchains or firmware builds.

Generated [dist/action.cjs](../dist/action.cjs) and
[dist/cli.cjs](../dist/cli.cjs) are release inputs and must remain tracked.
Changes to source or dependencies must include regenerated bundles. CI rejects
differences between committed bundles and fresh build output.

## Proposed Build Architecture

The following boundaries guide future feature specs; they are not implemented
APIs or a requirement to create a module for each box immediately.

```mermaid
flowchart TD
    Adapters[CLI and Action adapters] --> Request[Normalized build request]
    Request --> Orchestrator[Shared orchestrator]
    Orchestrator --> Validation[Validate configuration and paths]
    Validation --> Source[Resolve firmware source and revision]
    Source --> Toolchain[Check or prepare required tools]
    Toolchain --> Build[Invoke the firmware build system]
    Build --> Artifacts[Collect artifacts and build metadata]
    Artifacts --> Result[Structured result returned to adapter]
```

### Responsibilities and Contracts

The adapters should translate their inputs into the same typed request and map
the shared result into CLI output or Action outputs. Core behavior should not
depend on GitHub environment variables or change merely because it runs in CI.

The shared orchestrator should validate the request, sequence build steps, and
return a result. Firmware source handling, tool discovery, process execution,
and artifact collection should be isolated where they introduce external effects
or need independent tests. Prefer Node.js standard APIs and existing dependencies
before adding new libraries.

Feature guides define request fields, defaults, path resolution, supported targets,
result fields, and failure behavior as their specification. The current flags and
Action input are documented in [Checking Build Prerequisites](prerequisites.md).
Firmware source and target contracts remain undecided.

### Execution and Safety

Future process execution should pass executable arguments separately instead of
interpolating user-controlled shell commands. It must propagate build failures,
make relevant diagnostics available, and specify timeout and cancellation behavior.
Build success must reflect successful compilation and validated expected artifacts,
not merely successful process launch.

Operations must not delete or overwrite caller-owned source or output without
explicit authorization. Cleanup should be restricted to directories owned by the
current build. Specs for fetching or executing external tools must address source
trust, version selection, and integrity verification. Building firmware executes
code from that source and therefore requires an appropriate trust boundary.

Avoid logging secrets. Action permissions should remain minimal, with publishing
and other write operations owned by consumer workflows unless a later spec
explicitly adds them to GPBuilder.

### Files and Reproducibility

Dependencies, caches, test coverage, logs, local environment files, and temporary
build output do not belong in version control. The root `build/`, `artifacts/`,
and `tmp/` directories are ignored for local use, but are not yet prescribed
runtime output paths. Preserve the lockfile, documentation, and Action bundles.

A future build result should identify the resolved firmware revision, selected
target and options, toolchain versions, and produced artifacts. Artifact naming,
hashing, cache keys, and reproducibility guarantees need their own acceptance
criteria; the scaffold makes no byte-for-byte reproducibility guarantee.

## Spec-Driven Development

Feature documents double as user documentation and specifications. Keep one
guide per feature directly in `docs/`, with a descriptive name such as
[prerequisites.md](prerequisites.md); do not create a parallel `docs/specs/` tree.

Start with the user's workflow: runnable commands, inputs/defaults, expected
output, errors/exit codes, supported platforms, side effects, and troubleshooting.
Include scope and limitations so proposed behavior cannot be mistaken for an
available capability. End with acceptance criteria and verification instructions
that developers can use to test the documented contract.

Draft or update the guide as behavior is designed, then implement and test against
it in the same change. Resolve blocking decisions with the maintainer, but do not
require a separate spec approval document or duplicate content. Keep guides current
when behavior changes and link them from the README.

Run `npm run check` and any feature-specific integration checks. Review tests
against the documented acceptance criteria, include regenerated bundles, and
state verification gaps honestly. Update this architecture document when shared
boundaries change. CI enforces technical checks, not documentation approval.

## Decisions Left to Feature Specs

- Whether builds consume a local checkout, fetch a repository revision, or both.
- Supported GP2040-CE targets, configuration options, and firmware revisions.
- Source-specific toolchain version selection beyond the current host-tool profile.
- Native versus containerized builds and supported host platforms.
- Artifact layout, caching, concurrency, cancellation, and cleanup policy.
- CLI options, Action inputs/outputs, and any machine-readable result format.

These decisions should be grounded in the firmware project's build requirements
when the first build feature is specified, rather than assumed by this scaffold.