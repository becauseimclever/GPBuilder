# Build Matrix Definitions

**Status: documented schema, not implemented.** A matrix describes one firmware
build for each listed board. The same definition is supported by the planned
local CLI and GitHub Action. Scheduling and result aggregation remain pending;
this guide does not claim that matrix execution is available.

## File Formats

Accept UTF-8 `.yaml`, `.yml`, and `.json` files using the same field names, types,
defaults, and validation rules. Select the parser by the file extension
(case-insensitive); reject unsupported extensions or content that does not parse
as the indicated format. Do not guess a second format after a parsing failure.

JSON must be standard JSON, without comments or trailing commas. YAML must contain
one document using YAML 1.2 scalar rules. YAML comments are allowed, but custom
tags, anchors, aliases, and merge keys are not: the definition must represent the
same plain data as JSON. Reject duplicate mapping/object keys in either format,
including keys that would otherwise be silently overwritten by a parser.

## Schema

The root is an object with exactly two required properties: `defaults` and
`boards`. Field names are case-sensitive. Unknown fields are errors at every
level, including misspelled properties and CLI flag names used as keys.

### Defaults

`defaults` is an object shared by all boards:

| Field | Type | Required | Meaning when present / omitted |
| --- | --- | --- | --- |
| `release` | String | Yes | Exact firmware tag such as `v0.7.12`, or the literal `main`; no implicit latest target |
| `firmware` | String | No | Local firmware Git checkout root; omitted means the default upstream GP2040-CE repository |
| `configs` | String | No | Local directory containing board folders; omitted means `configs/` at the selected firmware revision |
| `build-type` | String | No | `debug` or `release`; omitted means `release` |

`release` is the firmware version, consistent with `--release`; it is not a
GPBuilder version or build type. The sample requires the exact tag `v0.7.12`,
not the shorthand `0.7.12`. Use `main` explicitly for development/nightly builds;
other branch names, commit expressions, `latest`, and `nightly` are not accepted.
Firmware/config locations have the same meanings as
their CLI options: local directory paths, not repository URLs. A checked-out
dedicated configs repository is supported by pointing to its board-containing
directory.

Optional fields use omission to request built-in defaults. `null`, empty strings,
and whitespace-only strings are invalid, not alternate spellings of "default".
Do not expand environment variables, `~`, GitHub expressions, or embedded commands
inside values. Absolute paths are accepted on the host running the build; relative
paths are preferable for definitions shared between environments.

### Boards

`boards` is a nonempty array of objects, with one object per board:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | String | Yes | Exact, case-sensitive board directory name, such as `Pico` |
| `configs` | String | No | External config root for this board only; replaces `defaults.configs` |

String-only entries such as `boards: [Pico]` are not part of this schema. Board
names follow the existing selection rules: start with an ASCII letter or digit,
then use only ASCII letters, digits, dots, underscores, or hyphens. Names cannot
be paths or traversal expressions. Reject repeated exact board names to avoid
ambiguous per-board overrides and results. Board order is preserved in the
normalized request list; this does not yet prescribe execution order.

This schema does not allow per-board firmware, release, or build-type overrides.
Those settings come from `defaults`. There are no axes, cartesian products,
include/exclude expressions, nested matrices, or arbitrary shell commands.
Different firmware releases or build types require separate definitions for now.

## Config Inheritance and Paths

For each board, determine the effective settings in this order:

1. Take the firmware release and source from `defaults`, using the upstream
   firmware repository only when `defaults.firmware` is absent.
2. Take `boards[index].configs` if supplied; otherwise take `defaults.configs`.
3. If neither config value is supplied, use `configs/<name>` in the selected
   firmware commit. Do not take configs from upstream HEAD or the caller's dirty
  working tree. For main, use the same resolved commit for source and configs.
4. Use `defaults.build-type`, or `release` when omitted.

Resolve `defaults.release` once per matrix invocation and use the same firmware
commit for every board, including when main advances during execution. Default
upstream main is refreshed for a new invocation; an explicit local firmware path
uses its local `refs/heads/main` without fetching. Derive shared SDK/tool requirements
from that resolved commit, applying any documented board-specific requirements
from the same source. Never reuse an older release's SDK profile for main or the
reverse. See [revision-specific requirements](firmware-build.md#main-and-revision-specific-requirements).

External config values always identify a root containing board folders, not the
individual board folder. For board `Pico` with an external root `../board-configs`,
the selected directory is `../board-configs/Pico` and must have a regular
`BoardConfig.h`. Retain the current rules excluding symlinked board directories
and headers. A per-board override replaces the shared config source completely;
it does not merge files and must not fall back if that board is missing.

Resolve the CLI `--matrix` argument or Action `matrix` input relative to the
invocation's working directory. Resolve **all paths inside the definition** relative
to the parent of that absolute matrix path, not the shell's current directory or
the process's temporary build directory. Moving the invocation to another working
directory must not change those internal resolutions when the same matrix path
is supplied. Absolute internal paths remain absolute.

Use the same resolved paths on both adapters. A missing or invalid explicit path
is an error, never a reason to substitute upstream firmware or another config root.
Config roots may be outside the matrix's directory; board names still cannot
escape the selected config root.

## Equivalent Examples

These definitions request the same two builds. `CustomBoard` is illustrative and
requires a real matching config folder; it is not a claim of support for a new
hardware target. Paths in both examples are relative to their containing file.

### YAML

```yaml
defaults:
  release: v0.7.12
  firmware: ../GP2040-CE
  configs: ../board-configs
  build-type: release
boards:
  - name: Pico
  - name: CustomBoard
    configs: ../custom-configs
```

### JSON

```json
{
  "defaults": {
    "release": "v0.7.12",
    "firmware": "../GP2040-CE",
    "configs": "../board-configs",
    "build-type": "release"
  },
  "boards": [
    { "name": "Pico" },
    { "name": "CustomBoard", "configs": "../custom-configs" }
  ]
}
```

Pico uses `../board-configs/Pico`. CustomBoard uses
`../custom-configs/CustomBoard`. Both use the same local firmware release and
Release build configuration. CLI scalar flags cannot change these values.

The minimal upstream Pico example omits both locations and the build type:

```yaml
defaults:
  release: v0.7.12
boards:
  - name: Pico
```

It normalizes to the same build settings as the
[two-flag Pico example](firmware-build.md#user-contract), using upstream firmware,
its matching built-in configs, and Release configuration.

For a development build, change the target to `main`. Equivalent minimal examples:

```yaml
defaults:
  release: main
boards:
  - name: Pico
```

```json
{
  "defaults": { "release": "main" },
  "boards": [{ "name": "Pico" }]
}
```

The requested target and resolved commit must both appear in results. Main does
not imply automatic scheduling or a different debug/release build type.

## Invocation and Precedence

Planned CLI syntax, once matrix execution is implemented:

```sh
node dist/cli.cjs --matrix ./matrix.yaml
node dist/cli.cjs -m ./matrix.json
```

These filenames are examples, not files created by this documentation change.
The Action uses its `matrix` input with the same file-path semantics. The consumer
must make the definition and any referenced local directories available first.

Matrix mode means build the listed boards; it does not need or consume a separate
operation field. All effective build settings come from the definition and its
documented built-in defaults. Other recognized CLI operation/build flags and
Action scalar inputs are ignored and reported by name, never merged as defaults
or overrides. `command` is not a matrix-schema field. Help/version keep their
precedence and do not load the matrix. See
[CLI precedence](build-selection.md#planned-cli-contract) for syntax-error handling.

## Validation and Acceptance

Parse and validate the entire definition before beginning build side effects.
Reject a missing/unreadable/empty file, invalid syntax, invalid root/defaults/board
types, missing required fields, unknown or duplicate keys, empty boards, duplicate
board names, unsafe names, invalid firmware targets, or unsupported build types.
Do not coerce strings to arrays, numbers to versions, or nulls to defaults.

Errors must identify the file and field path (for example `boards[1].configs`),
plus line/column when supplied by the parser. Do not echo secrets or complete file
contents. Semantic source/config validation must retain useful diagnostics and
must not turn an invalid definition into a scalar build request.

Acceptance criteria for schema implementation:

1. Equivalent YAML/JSON definitions produce identical normalized build requests,
   including board order, absolute paths, release, config source, and build type.
2. Shared defaults apply to every board; a board config override changes only
   that board's config root. Missing explicit paths/boards do not trigger fallback.
3. Omitting optional paths selects upstream/matching configs as documented;
   omitted build type selects Release. Null/empty/wrong-type values fail.
4. Relative internal paths resolve from the matrix file regardless of the calling
   working directory, using host path APIs and fixtures with spaces.
5. Tests reject malformed/duplicate keys in both formats, unknown fields, YAML
   aliases/tags/multiple documents, bad board entries, and unsupported extensions.
6. Scalar CLI/Action values do not affect the normalized matrix. Help/version do
   not read it. No parser or normalization unit test performs network access,
   runs build scripts, or installs tools.
7. YAML/JSON both accept `defaults.release: main` as a string target and reject
  unsupported branches/aliases. Resolve one firmware commit for all boards and
  use its SDK/tool requirements throughout the run; a moving main branch cannot
  mix firmware revisions or dependency profiles in one invocation.

## Execution Decisions Still Pending

Before implementing matrix execution, document finite input/expansion limits,
scheduling/concurrency, in-process Action builds versus GitHub job generation,
per-entry prerequisite policy, fail-fast versus aggregation, cancellation,
per-entry artifacts/outputs, and overall exit status. Every actual build must
retain the mandatory prerequisite gate and UF2 validation; this schema does not
bypass either. The first schema has no version field; incompatible future schema
changes require an explicit compatibility/versioning decision.

Use established YAML/JSON parsers with duplicate-key detection and safe data-only
parsing. Reuse the project's test runner, temporary fixtures, and process-boundary
injection. Matrix execution and external-config compilation remain unverified;
schema examples alone are not evidence of successful firmware builds.