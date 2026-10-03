# Selecting a Release and Board

**Status:** The sections through "Acceptance and Verification" describe current
behavior, including local selection from an exact release tag or the literal
`main` branch. [Planned CLI Contract](#planned-cli-contract) documents future flags,
upstream source defaults, and builds; those changes are not implemented. The [matrix schema](matrix.md)
defines YAML/JSON inputs; matrix execution decisions remain pending.

The [Pico UF2 build guide](firmware-build.md) specifies the planned two-flag
`v0.7.12`/`Pico` workflow, required build stages, and artifact acceptance checks.

GPBuilder can list local firmware release tags, list boards, and validate a build
selection from a local release tag or `main` branch through the CLI or GitHub Action.
This slice is offline and read-only:
it does not fetch repositories, change your checkout, run config code, install
tools, or compile firmware. Selection needs Node.js 24 and Git on PATH, but not
the firmware compiler toolchain.

## Local Usage

Run these commands from the GPBuilder directory. `../GP2040-CE` must be the root
of an existing firmware Git checkout with local release tags:

```sh
node dist/cli.cjs --list-releases --firmware ../GP2040-CE
node dist/cli.cjs --list-boards --firmware ../GP2040-CE --release v0.7.12
node dist/cli.cjs --select-build --firmware ../GP2040-CE --release v0.7.12 --board Pico
node dist/cli.cjs --select-build --firmware ../GP2040-CE --release main --board Pico
```

Choose an exact tag from the first command, then an exact board name from the
second. The version above is an example, not a default. From source, you can
replace `node dist/cli.cjs` with `npm start --` to rebuild before running.
There are no interactive prompts or implicit latest-release selections.

Successful selection prints the requested target, resolved commit, board, config
source, and config path, followed by `Selection validated; no firmware was built.`
It exits with code 0. Invalid inputs or failed Git/filesystem operations exit with
code 1. Listing commands print one value per line; an empty list succeeds with no
output. CLI operations are mutually exclusive, and options alone do not perform
a selection. With no arguments, the CLI still shows help.

## Release Contract

- `firmware` is required and resolves relative to the process working directory.
  Supply the checkout root, not its `configs` folder, a bare repository, a ZIP
  extraction without Git metadata, or a repository URL. Paths with spaces work
  when quoted at the command line.
- `list-releases` lists local tags shaped like `v0.7.12` or `0.7.12`, optionally
  followed by a hyphen and a prerelease suffix of letters, digits, dots, or hyphens.
  It sorts names in descending numeric-aware order, not semantic-version order.
  It does not verify that a tag has a published GitHub release.
- Selection accepts an exact tag, including its `v` prefix if present, or the
  literal `main`. Main resolves only `refs/heads/main` in the supplied checkout;
  it never falls back to HEAD, the checked-out branch, or a remote-tracking ref.
  Annotated and lightweight tags are supported and resolved to a commit. Other
  branches, commit hashes, `latest`, and revision expressions are invalid.
- The selected commit must contain a regular root `CMakeLists.txt`. This is a
  structural check, not certification that an arbitrary repository is GP2040-CE.
- Missing tags or a missing local main branch fail with guidance. If necessary,
  fetch/create the desired ref yourself before running GPBuilder. No command here
  performs a network fetch or checkout. `--list-releases` lists tags only; main
  is an explicit selection target, not a release tag.
- Built-in boards are read from the selected commit's Git tree. Your current
  branch, uncommitted edits, and untracked config folders do not change that list.
  Existing working-tree files are neither replaced nor used as that release's files.

## Board Config Sources

By default, boards come from `configs/<board>/BoardConfig.h` at the selected
release. Names are case-sensitive, start with an ASCII letter or digit, and may
contain letters, digits, dots, underscores, and hyphens. A board must be an immediate
child directory with a regular `BoardConfig.h`; supporting files may also exist.
Symlinked board directories/headers and incomplete directories are not listed.
Directory paths and traversal expressions are not board names. Lists use ascending
numeric-aware name order.

To use local external configs, supply a directory containing board subdirectories:

```text
board-configs/
  CustomBoard/
    BoardConfig.h
    ...supporting files...
```

```sh
node dist/cli.cjs --list-boards --firmware ../GP2040-CE --release v0.7.12 --configs ../board-configs
node dist/cli.cjs --select-build --firmware ../GP2040-CE --release v0.7.12 --board CustomBoard --configs ../board-configs
```

The external directory **replaces**, rather than merges with, the built-in config
source. Unknown external boards never fall back to firmware configs. A missing or
unreadable config root fails. An existing root with no valid boards lists nothing;
selecting any board from it fails. Pass the containing directory, not
`CustomBoard` itself. Relative paths resolve from the process working directory.

A dedicated configs repository works the same way: check it out yourself and pass
its board-containing directory. GPBuilder does not require Git metadata for
external configs, fetch a URL, or choose its revision. External configs use current
disk contents, including local edits, and are not pinned or hashed by this slice.
Compatibility with the selected firmware release remains the caller's responsibility.

The reported `config-path` has two meanings:

| Source | Meaning |
| --- | --- |
| `firmware` | `configs/<board>`, relative to the selected commit's Git tree; not a promise about current working-tree contents |
| `external` | Absolute, resolved local directory of the selected board |

## GitHub Action

Check out the firmware separately. The action does not clone it. Replace
`COMMIT_SHA` with a GPBuilder commit containing this feature:

```yaml
name: Select Firmware
on: workflow_dispatch
permissions:
  contents: read
jobs:
  select:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          repository: OpenStickCommunity/GP2040-CE
          path: firmware
          fetch-depth: 0
      - uses: becauseimclever/GPBuilder@COMMIT_SHA
        id: selection
        with:
          command: select-build
          firmware: firmware
          release: v0.7.12
          board: Pico
```

`fetch-depth: 0` makes tags and their objects available; it is consumer-controlled
network access, not GPBuilder fetching. Only the Actions Node.js 24 runtime and Git
are needed for selection. A build/prerequisite operation additionally needs the
bootstrap and host tools described in [Checking Build Prerequisites](prerequisites.md).

To use a dedicated config repo, add another checkout step with a distinct `path`
and set `configs` to its board-containing directory. For example, if boards are in
`custom-configs/configs/`, use `configs: custom-configs/configs` and a board from
that directory. No repository URL is accepted in the `configs` input.

| Input | Default / requirement |
| --- | --- |
| `command` | `check-prerequisites`; also accepts `list-releases`, `list-boards`, `select-build`, and `build` |
| `firmware` | Required for all operations except `check-prerequisites` |
| `release` | Required for `list-boards`, `select-build`, and `build` |
| `board` | Required for `select-build` and `build` |
| `configs` | Optional external config root; omitted/empty Action input uses built-in configs |

`list-releases` sets `releases` and `list-boards` sets `boards`, each a JSON array.
`select-build` sets `release`, `firmware-commit`, `board`, `config-source`, and
`config-path`. For example, the resolved commit is available as
`${{ steps.selection.outputs.firmware-commit }}`. Failed operations do not publish
selection outputs. The core returns the same values to both adapters.

## Build Gate and Limitations

```sh
node dist/cli.cjs --build --firmware ../GP2040-CE --release v0.7.12 --board Pico
```

`--build` and `command: build` run the mandatory prerequisite gate first, then
require and validate the same selection. Thus a failed tool check can occur before
a missing selection-input error. Local builds never install tools; Action builds
retain the Ubuntu repair policy. After the gate and selection pass, build still
fails explicitly because compilation is not implemented. No firmware is produced.

Selection confirms directory/header presence, not header correctness, CMake
compatibility, SDK availability, or compilability. Config CMake files are not
executed. Source materialization, external-config integration into the firmware
build system, release-dependent toolchains, and artifact production remain future
work. Use trusted firmware/config sources when execution is added.

## Acceptance and Verification

1. Local tags can be listed without fetching, changing HEAD, or altering a dirty tree.
2. Built-in boards reflect the selected release commit, not the current checkout.
3. External roots replace built-in configs; incomplete and symlinked boards are ignored.
4. Invalid/missing tags, boards, checkout roots, and external roots fail clearly;
   selections cannot escape their config root via board paths.
5. CLI and Action share validation and report matching commit/board/config values.
6. Listing/selection never probes or installs build tools; actual build requests
   retain the prerequisite gate and cannot claim compilation success.

Run `node --test test/build-selection.test.mjs test/prerequisites.test.mjs` for
focused checks, then `npm run check`. Selection tests include local Git integration
using temporary repositories and external filesystem fixtures; they need Git,
but never access the network or install packages. Adapter tests bundle the source
into temporary directories. Prerequisite installation boundaries remain mocked.
CI runs the suite on Windows, macOS, and Linux; a local run verifies only its host.

## Planned CLI Contract

This section specifies the next CLI interface, not commands available in today's
bundle. It supersedes the current requirement for an explicit firmware path only
when implemented. No runtime code changes are part of this documentation work.

### Complete Flag Reference

Flags are case-sensitive. Every planned flag has a single-letter and full-word
form. Uppercase letters distinguish build operations from board-related options.
"Existing long flag" means its long spelling exists today; new short forms and
changed defaults in this section are still planned.

| Short | Long | Value | Planned behavior / default | Current availability |
| --- | --- | --- | --- | --- |
| `-h` | `--help` | None | Print all supported flags, defaults, and examples; exit without reading sources or a matrix | Both forms exist; expanded menu planned |
| `-v` | `--version` | None | Print GPBuilder's own package version and exit successfully; not the firmware version | Planned |
| `-p` | `--check-prerequisites` | None | Report host build tools without installing locally | Existing long flag |
| `-l` | `--list-releases` | None | List release tags from the selected firmware source | Existing long flag; currently local-only |
| `-L` | `--list-boards` | None | List boards for a specified firmware release and config source | Existing long flag |
| `-s` | `--select-build` | None | Resolve and validate a selection without compiling | Existing long flag |
| `-B` | `--build` | None | Request a firmware build; default operation for a complete release/board pair without another operation or matrix | Existing long flag; compilation not implemented |
| `-r` | `--release` | Exact tag or `main` | Firmware target; tags retain their `v` prefix, and main resolves to one commit per invocation; no implicit latest | Existing long flag; local main selection implemented |
| `-b` | `--board` | Name | Exact, case-sensitive board folder name; no default board | Existing long flag |
| `-c` | `--configs` | Directory | Optional directory containing board folders; defaults to `configs/` in the selected firmware revision | Existing long flag |
| `-f` | `--firmware` | Directory | Optional local firmware Git checkout root; if omitted, use the upstream repository below | Existing long flag; currently required for selection |
| `-m` | `--matrix` | File path | Select matrix-only input mode using YAML or JSON; ignore other operation/build flags except help/version; no default file | Schema documented; execution pending |
| `-t` | `--build-type` | `debug` or `release` | Build configuration; defaults to `release` | Planned |

The firmware version is always `-r/--release`; `-v/--version` never selects
firmware. A GPBuilder version such as `0.1.0`, a firmware tag such as `v0.7.12`,
and the build type `release` are three independent values.

The literal `main` is a supported local selection target and a planned build target
for development/nightly builds. It is not a build type or an alias for the newest release tag.
`--list-releases` remains a tag listing; `main` is selected explicitly rather than
represented as a release tag. No `latest` or `nightly` input alias is introduced.

Without a matrix, use at most one explicit operation (`-p`, `-l`, `-L`, `-s`, or
`-B`). If no operation is supplied, a complete `--release`/`--board` pair selects
`build`; optional source/config/build-type options still apply. Missing release
or board values fail rather than guessing a default. An explicit `--select-build`
never compiles, even when both values are present.
With a matrix, its definition supplies the operation and build settings; other
operation/build flags do not participate in the request. These input modes are
mutually exclusive, not merged. No arguments continue to show help. The two-flag
build default must be stated clearly in help and is not yet implemented.

After parsing flag syntax, precedence is help, GPBuilder-version reporting, matrix
mode, then single-selection mode. Help/version ignore other recognized options
and exit without reading the matrix, accessing sources, probing tools, or building.
If both informational flags are present, show help. For example, `--matrix missing-file
--help` shows help successfully without checking whether the file exists.

Value-bearing options support separate arguments such as `-r v0.7.12` and
`--release v0.7.12`, as well as long-option assignment `--release=v0.7.12`.
Quote filesystem paths containing spaces. Combined short flags and attached short
values, such as `-Brv0.7.12`, are outside this contract; spell each flag separately.
Unknown flags, positional arguments, missing flag arguments, and repeated options
(including a short/long alias pair or multiple matrix paths) fail syntactic
validation with useful errors. Precedence does not make malformed CLI syntax valid.
After precedence chooses a mode, validate only its effective inputs. In
single-selection mode, empty paths, invalid values, conflicting operations, and
irrelevant options fail. In matrix mode, other recognized operation/build options
are ignored rather than checked for semantic validity or used as defaults. CLI
exit codes remain 0 for success and 1 for failure.

### Help Menu

`-h`, `--help`, and invocation without arguments must print a readable help menu
to standard output and exit with code 0. It must list every available flag with
its short and long forms, value placeholder or allowed values, purpose, required
inputs, and defaults. Include examples for informational commands, discovery,
single-board selection/builds, explicit local paths, and matrix usage.

Help must explain the distinction between GPBuilder's version, the firmware
release, and the debug/release build type. It must also explain matrix precedence
and the help/version exception. It must work offline without a firmware checkout,
matrix file, or installed build tools. Errors should suggest `--help` when useful,
without substituting a successful help exit for a failed command.

The following is the target menu once these flags are implemented, not the current
bundle's output. Shipped help must describe supported behavior truthfully rather
than advertise unimplemented capabilities as available. Exact spacing is not an
acceptance requirement.

```text
GPBuilder

Usage:
  node dist/cli.cjs --release <tag|main> --board <name> [options]
  node dist/cli.cjs <operation> [options]
  node dist/cli.cjs --matrix <file>
  node dist/cli.cjs --help
  node dist/cli.cjs --version

Information:
  -h, --help                    Show this menu and examples.
  -v, --version                 Show GPBuilder's version, not firmware's version.

Operations (optional; release + board defaults to build):
  -p, --check-prerequisites     Report host build tools; never install locally.
  -l, --list-releases           List tags from the selected firmware source.
  -L, --list-boards             List boards; requires --release.
  -s, --select-build            Validate selection; requires --release and --board.
  -B, --build                   Build firmware; requires --release and --board.

Single-selection options:
  -r, --release <tag|main>      Exact firmware tag or main; no default.
  -b, --board <name>            Case-sensitive board name; no default.
  -f, --firmware <directory>    Local Git checkout; default: upstream GP2040-CE.
  -c, --configs <directory>     Board folders; default: selected firmware's configs/.
  -t, --build-type <type>       debug or release; default: release.

Matrix mode:
  -m, --matrix <file>           YAML/JSON definition supplies all build settings.
                               Other operation/build flags are ignored and reported.
                               --help and --version take precedence without loading it.

Examples:
  node dist/cli.cjs --release v0.7.12 --board Pico
  node dist/cli.cjs -r v0.7.12 -b Pico
  node dist/cli.cjs -r main -b Pico
  node dist/cli.cjs -h
  node dist/cli.cjs -v
  node dist/cli.cjs -l
  node dist/cli.cjs -L -r v0.7.12
  node dist/cli.cjs -s -r v0.7.12 -b Pico
  node dist/cli.cjs -B -r v0.7.12 -b Pico -t debug
  node dist/cli.cjs -B -r v0.7.12 -b CustomBoard -f "../firmware checkout" -c "../board configs"
  node dist/cli.cjs -m ./matrix.yaml
  node dist/cli.cjs --matrix ./matrix.json

The example release and board are explicit choices, not defaults.
Builds require prepared host tools and may download source/project dependencies.
Tool and SDK requirements come from the selected firmware commit.
Local builds never install host tools. Builds output a UF2; they do not flash it.
Matrix files use .yaml, .yml, or .json; see docs/matrix.md for the schema.
```

The [matrix guide](matrix.md) defines the shared YAML/JSON schema and examples.
The filenames in help are illustrative, not bundled files. Keep help's flag list
and examples synchronized with parser behavior as features become available.

### Single-Selection Requirements

The following applies when no matrix file is supplied:

| Operation | Required inputs | Optional inputs |
| --- | --- | --- |
| `--help`, `--version` | None | Other recognized options are ignored after syntax validation |
| `--check-prerequisites` | None | None |
| `--list-releases` | None | `--firmware` |
| `--list-boards` | `--release` | `--firmware`, `--configs` |
| `--select-build`, `--build` | `--release`, `--board` | `--firmware`, `--configs`, `--build-type` |
| No explicit operation (implicit `build`) | `--release`, `--board` | `--firmware`, `--configs`, `--build-type` |

Release targets retain exact tag spelling. The only supported branch target is
the literal `main`; other branches and commit expressions remain invalid. A local
checkout resolves main from `refs/heads/main`, never its current HEAD or a remote
tracking ref. Without `--firmware`, upstream resolution is planned but not yet
implemented. Board names remain case-sensitive and cannot contain traversal.
Selection must report the requested target, resolved firmware commit, board,
config source, and effective build type.
Selecting or listing does not establish that a board can compile successfully.

### Firmware and Config Defaults

The default firmware repository is
[`OpenStickCommunity/GP2040-CE`](https://github.com/OpenStickCommunity/GP2040-CE),
using `https://github.com/OpenStickCommunity/GP2040-CE.git`. "Default repository"
means this firmware repository, not the GPBuilder orchestrator repository.

- Without `--firmware`, resolve the requested release in the default repository.
  Listing releases may access that remote; selection and builds may retrieve the
  requested revision. Resolve an explicit `main` from `refs/heads/main` once per
  invocation. Do not substitute the default branch, HEAD, or another target if
  resolution fails.
- With `--firmware`, use the supplied local Git checkout and its local tags or
  local `refs/heads/main`, according to the requested target. This behavior is
  implemented for listing/selection; source materialization for builds is planned.
  Preserve the current offline behavior: do not fetch into it, switch its branch,
  overwrite files, or silently fall back to upstream. ZIP source directories and
  arbitrary repository URLs are not accepted by this directory option.
- Without `--configs`, use `configs/` from the resolved firmware revision. Thus
  omitting both paths uses the upstream firmware and its matching configs. When a
  local firmware checkout is supplied, its selected tag also supplies the default
  configs; do not mix its firmware with configs from upstream HEAD.
- With `--configs`, use that local board-containing directory instead. It replaces
  built-in configs, with no merge or fallback. A separately checked-out config repo
  is supported through its local directory. External config contents remain
  caller-controlled and are not selected by the firmware release flag.
- Missing explicit paths, unavailable releases, and missing boards are errors,
  not requests to use a default. An omitted path and an invalid path differ.
- Direct CLI paths resolve relative to the invocation's working directory, on
  Windows, macOS, and Linux. Paths inside a matrix resolve relative to the matrix
  file's parent directory, as defined in the [matrix guide](matrix.md).

Remote retrieval must use argument-safe process/API calls, retain useful failure
diagnostics, and record the resolved commit rather than only a mutable tag name.
Any materialized source belongs in GPBuilder-owned storage, never over a
caller-owned checkout. Do not execute firmware/config scripts while merely
listing or selecting. Actual compilation executes source-controlled build code,
so users must trust both firmware and external configs.

The [Pico build guide](firmware-build.md) specifies first-slice source preparation,
owned storage, timeouts, cleanup, and integrity/trust checks, without a shared
mutable cache. Release compatibility must still be qualified. General caching and
other source profiles need their own documented policies. Network failures must
never produce build success.

For every build, derive SDK/tool requirements from that resolved firmware commit,
not a single global profile or the newest tools installed. The
[revision-specific validation contract](firmware-build.md#main-and-revision-specific-requirements)
defines bootstrap checks, source inspection, the full target-aware prerequisite
gate, and matching dependency setup. Main uses its own referenced SDK, not an
independently chosen latest SDK. The standalone host report is not target qualification.

### Build Type

`--build-type debug` selects CMake `Debug`; `--build-type release` selects CMake
`Release`. The default is `release`. Only these lowercase CLI values are accepted;
other configurations and arbitrary CMake argument injection are outside this scope.
Build type does not change the firmware tag or board.

The effective configuration must reach the actual CMake configure/build operation
and be included in selection/build reports. Debug and release outputs must be
isolated so one invocation cannot reuse incompatible build state or overwrite the
other's results. The [Pico build guide](firmware-build.md#6-validate-and-publish-the-uf2)
defines the first artifact layout and validation gates. Every actual build retains the prerequisite
gate; neither build type nor matrix use may bypass it.

### Planned Examples

These examples describe the target interface and will not all run with the current
bundle. `v0.7.12` and `Pico` are illustrative explicit choices, not defaults.

```sh
node dist/cli.cjs --release v0.7.12 --board Pico
node dist/cli.cjs -r v0.7.12 -b Pico
node dist/cli.cjs --release main --board Pico
node dist/cli.cjs --help
node dist/cli.cjs -h
node dist/cli.cjs --version
node dist/cli.cjs -v
node dist/cli.cjs --list-releases
node dist/cli.cjs -L -r v0.7.12
node dist/cli.cjs --select-build --release v0.7.12 --board Pico
node dist/cli.cjs -s -r v0.7.12 -b Pico -t debug
node dist/cli.cjs -B -r v0.7.12 -b Pico -t release
node dist/cli.cjs --build --release v0.7.12 --board CustomBoard --firmware "../firmware checkout" --configs "../board configs" --build-type debug
```

### Matrix Definition

`-m/--matrix <file>` selects matrix-only input mode. Its primary audience is GitHub
Action consumers, but local users must also be able to supply the same supported
definition. No separate `--build` or other operation flag is needed alongside it.
Omitting the flag uses the single-selection workflow; there is no implicit
matrix-file discovery.

The [matrix schema](matrix.md) supports `.yaml`, `.yml`, and `.json` with identical
semantics. A required `defaults` object holds `release` and optional `firmware`,
`configs`, and `build-type`. A nonempty `boards` array contains objects with a
required `name` and optional per-board `configs` override. Matrix mode requests
builds; there is no operation or command field in the definition.

The definition supplies all build settings as structured data, not shell
arguments. No scalar CLI/Action input is a default, override, or fallback for a
matrix value. The schema defines omission defaults and matrix-relative paths.

With a matrix, ignore recognized `--check-prerequisites`, `--list-releases`,
`--list-boards`, `--select-build`, `--build`, `--release`, `--board`, `--firmware`,
`--configs`, and `--build-type` options and their short forms. Their values must not
be resolved, accessed, or semantically validated. Emit a diagnostic naming the
ignored options, without echoing their values, so this precedence is visible.
Help/version take precedence and exit before loading the definition, as described
in [Help Menu](#help-menu). Unknown flags and malformed CLI syntax still fail.

An invalid, empty, missing, or unreadable matrix file must fail; it must not fall
back to scalar flags or single-selection behavior. Every actual build described
by the matrix still requires the shared prerequisite gate. Ignoring an operation
flag must never bypass that gate.

This is not GitHub's `strategy.matrix` schema and does not expand cartesian axes.
See [execution decisions still pending](matrix.md#execution-decisions-still-pending)
for limits, scheduling, Action job handling, failure/cancellation behavior, and
per-entry artifacts/results that must be documented before execution is implemented.

Parsing must treat matrix contents as data, not executable YAML tags, shell text,
or dynamically evaluated JavaScript. Unit tests must use isolated fixtures and
mock network/process installation boundaries. The schema alone does not settle
matrix execution or establish that external board configs can compile.

### GitHub Action Parity

The proposed Action input mapping keeps adapter logic thin and shared validation
in the core:

| CLI value | Action input | Planned meaning |
| --- | --- | --- |
| Operation flag | `command` | Existing operation names; default remains `check-prerequisites` when no matrix is supplied |
| `--release` | `release` | Exact firmware tag or `main`, not GPBuilder's version |
| `--board` | `board` | Board name |
| `--firmware` | `firmware` | Optional local checkout; omission selects upstream |
| `--configs` | `configs` | Optional external config root; omission uses selected firmware configs |
| `--build-type` | `build-type` | `debug` or `release`, default `release` |
| `--matrix` | `matrix` | Selects matrix-only builds from the shared YAML/JSON schema; execution pending |

Short aliases are CLI syntax only. Action callers use named inputs, not a raw
command-line string. A non-empty `matrix` input takes precedence over `command`
(including its default), `release`, `board`, `firmware`, `configs`, and `build-type`.
These ignored inputs are reported by name and do not influence or invalidate the
matrix request. The CLI help/version exception does not add new Action commands.

Empty optional Action path inputs count as omitted. Validate non-empty paths only
when they are effective inputs for the chosen mode; an invalid matrix path always
fails rather than enabling scalar fallback. Direct Action paths resolve from its
working directory, normally `GITHUB_WORKSPACE`; internal paths are relative to the
matrix file. Matrix-specific outputs and full workflow examples await execution
decisions, not a different Action schema.

### Planned Acceptance Criteria

1. Each documented short/long pair produces the same normalized request. Syntax
  errors fail clearly; semantic validation follows the documented mode precedence.
2. `-v/--version` reports GPBuilder only, without network/tool/source access;
  `-r/--release` selects firmware and never implicitly selects latest.
3. Without explicit firmware/config paths, the requested release and matching
  `configs/` resolve from upstream. Explicit local inputs do not trigger a remote
  fallback or mutate caller-owned checkouts.
4. Board/config validation and external replacement semantics remain intact.
5. `debug` and `release` map to the correct CMake configuration, with a documented
  release default, reported effective values, and isolated build output.
6. CLI and Action inputs resolve through the same core contracts; local builds
  never install tools and actual builds cannot bypass prerequisite checks.
7. Matrix parsing and normalization follow the [shared schema acceptance criteria](matrix.md#validation-and-acceptance).
  Execution remains blocked until its pending design questions have documented answers.
8. Matrix mode uses only its definition for operation/build settings. Supplying
  conflicting scalar flags does not change the resulting request; ignored options
  are reported by name. Invalid scalar values/paths are not semantically validated
  or accessed in matrix mode. An invalid matrix never triggers scalar fallback.
9. Help lists every supported short/long flag, values, defaults, and examples, and
  works without network, source files, or tools. Help/version combined with a
  syntactically valid matrix argument must not load the file or start work; test
  with a nonexistent matrix path. No arguments show help successfully.
10. Without an explicit operation or matrix, `--release v0.7.12 --board Pico`
  normalizes to a Release build using default upstream source/configs. An incomplete
  pair fails; explicit selection-only requests do not compile. Follow the
  [Pico build acceptance criteria](firmware-build.md#implementation-and-acceptance)
  before claiming this command produces a flashable UF2.
11. `main` resolves to one immutable firmware commit per invocation using the
  selected source's branch ref. Tags never fall back to main; main never falls back
  to HEAD or a release. Build checks/setup use the resolved revision's requirements,
  and main artifacts identify the requested target and full commit.

When implementing these changes, add focused failing tests before feature code,
then run the required `npm run check` gate and regenerate tracked bundles. Network
retrieval and real compilation require separately identified integration checks;
mocked tests do not establish remote availability or cross-platform build support.