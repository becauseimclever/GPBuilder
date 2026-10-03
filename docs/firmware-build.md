# Building a Flashable RP2040 or RP2350 UF2

**Status: implemented and integration-built on Windows x64 (locally) and Ubuntu
x64 (through the GitHub Action, building `Pico` and the external-config
`OpenCore0` on GP2040-CE `main`; see [Host Profiles](#host-profiles)).** The supported builds
are for **RP2040** and **RP2350 (Arm Secure, `rp2350-arm-s`)** board
configurations: GP2040-CE **0.7.12** from upstream tag
`v0.7.12`, and development builds of GP2040-CE `main`. The board may be any
configuration discovered in the firmware's built-in `configs` directory or in a
caller-supplied configs folder (for example the
[Board Config Registry](https://github.com/OpenStickCommunity/Board-Config-Registry)).
The board's platform is derived from its configuration (see
[Board Platform](#board-platform)); boards that select an RP2350 platform, such
as `Pico2`, are rejected. Integration-built boards are `Pico` (both targets) and
the registry's `OpenCore0` (`main`). Other host profiles (including macOS) and
build types are not supported or qualified.

The released Pico example is the initial qualification case; a successful release
build does not establish that a later main commit builds or runs correctly. Each
main build reports the exact commit it built.

## User Contract

From the GPBuilder repository root on a supported host, supply only
the firmware release and board:

```sh
node dist/cli.cjs --release v0.7.12 --board Pico
node dist/cli.cjs --build --release v0.7.12 --board Pico
```

These are equivalent supported commands; `--release main` works the same way.
Short `-r`/`-b` aliases from the target menu in
[build selection](./build-selection.md) are not yet implemented. No `--build`,
source path, SDK path, config path, or matrix is required. With a complete release/board pair and no explicit
operation or matrix, the CLI defaults to `build`. An explicit `--select-build`
remains validation-only; an explicit `--build` remains supported. No arguments
still shows help. An incomplete pair fails with guidance, not a guessed board or
release. Help/version and matrix precedence remain as defined in the
[CLI contract](build-selection.md#planned-cli-contract).

The release flag is the firmware version, not GPBuilder's `--version` flag.
Use the exact tag `v0.7.12` or the exact target `main`; accepting a bare `0.7.12`
alias is not part of this contract.

Defaults are the upstream GP2040-CE repository, `configs/<Board>` from that exact
commit, and build type `release` (CMake `Release`). Two optional folders change
the inputs:

```sh
node dist/cli.cjs --firmware <source-folder> --configs <configs-folder> --release main --board Pico
```

- `--firmware <source-folder>` supplies a local GP2040-CE Git checkout. GPBuilder
  materializes an owned copy and never builds in or modifies that folder. See
  [Materialize the Selected Source](#2-materialize-the-selected-source) for how
  `v0.7.12` and `main` treat local changes.
- `--configs <configs-folder>` supplies board configurations laid out like the
  firmware's `configs` directory. It must contain `<Board>/BoardConfig.h`. Its
  `<Board>` directory replaces `configs/<Board>` in the owned source copy only.
  The caller's configs folder is never modified. A board that exists only in the
  configs folder (not in the firmware) is supported; for example, with a local
  registry checkout:

```sh
node dist/cli.cjs --firmware C:\ws\GP2040-CE --configs C:\ws\Board-Config-Registry\configs --release main --board OpenCore0
```

The caller needs network access for source and dependency retrieval. GPBuilder
does not install host software. The tool profile for the host (see
[Host Profiles](#host-profiles)) is checked before dependency setup; other host
profiles are unsupported.

A successful run prints an absolute path to a newly built, validated UF2 (for
example `GP2040-CE_0.7.12_Pico.uf2`), its byte size, and SHA-256 digest, then exits 0.
No flash drive or connected Pico is required to build. The produced image has not
been physically tested on a Pico. GPBuilder never flashes hardware, erases
configuration, or copies files to a device.

## Main and Revision-Specific Requirements

```sh
node dist/cli.cjs --release main --board Pico
node dist/cli.cjs --firmware ./GP2040-CE --configs ./my-configs --release main --board Pico
```

`--release` is the firmware target selector: this build accepts exactly the
release tag `v0.7.12` or `main`. No implicit latest target, arbitrary branch, raw
commit expression, `latest`, or `nightly` alias is introduced. "Nightly" describes
building main; it does not add a scheduled workflow or download a prebuilt
nightly artifact. Main builds support RP2040 and `rp2350-arm-s` boards on
supported hosts (see [Board Platform](#board-platform)).

### Board Platform

The selected board's SDK board and platform come from the board configuration
after any `--configs` overlay, mirroring the firmware's root `CMakeLists.txt`:

- If `configs/<Board>/<Board>.cmake` exists, its `set(PICO_BOARD <value>)` and
  `set(PICO_PLATFORM <value>)` lines supply the SDK board and platform.
- A missing file or missing setting defaults to `PICO_BOARD=pico` and
  `PICO_PLATFORM=rp2040`, the firmware's own defaults. For example the registry's
  `OpenCore0` has no `.cmake` file and builds as `pico`/`rp2040`; `PicoW` sets
  `pico_w`/`rp2040`.
- Supported platforms and their compiler profiles:

  | `PICO_PLATFORM` | `PICO_COMPILER` | UF2 family |
  | --- | --- | --- |
  | `rp2040` | `pico_arm_cortex_m0plus_gcc` | `0xe48bff56` (RP2040) |
  | `rp2350-arm-s` | `pico_arm_cortex_m33_gcc` | `0xe48bff59` (RP2350 Arm Secure) |

- Any other platform fails before dependency setup with an error naming the
  board and platform. This includes the bare `rp2350` (which the SDK maps to a
  default core; boards must state `rp2350-arm-s` explicitly) and
  `rp2350-riscv`, which needs a RISC-V toolchain this build does not provide.
  The upstream `Pico2` config sets the bare `rp2350` and is therefore rejected
  until its `.cmake` names `rp2350-arm-s`.

### Resolve Once, Build One Commit

For the default upstream source, resolve `refs/heads/main` once at the start of
the invocation, then clone that exact commit into owned storage and verify the
checked-out commit. A later branch update must not change an in-progress build,
and a subsequent invocation resolves again rather than reusing a cached tip.

For an explicit local `--firmware` main build, GPBuilder builds the working tree
as it currently exists: it copies the directory, including uncommitted and
untracked files and the `.git` directory (so upstream version generation through
`git describe` works), into owned temporary storage. `node_modules` and `build`
directories are excluded. The caller's directory is never modified. The copy
records the `HEAD` commit and a `dirty` flag (true when `git status --porcelain`
reports changes); the generated firmware version then carries a `-dirty` suffix.
The local branch name is irrelevant: a local main build means "this working tree",
not necessarily the newest upstream commit.

Use built-in configs from the copied source unless `--configs` supplies an
overlay (see [Materialize the Selected Source](#2-materialize-the-selected-source)).
Record the requested target, the resolved firmware commit, the dirty flag, and
the config source in the result. The embedded version reported by main is not
the literal `main`.

### Tool Profiles and Compatibility Check

Each supported target has a pinned, qualified tool profile:

| Target | Pico SDK | picotool | Arm GNU toolchain |
|---|---|---|---|
| `v0.7.12` | 2.1.1 (commit `bddd20f928ce76142793bef434d4f75f4af6e433`) | 2.1.1 | `15_2_Rel1` |
| `main` | 2.3.1 (resolved commit recorded) | 2.3.1 | `15_2_Rel1` |

Both profiles use CMake 4.3.4, Ninja 1.13.2, Python 3.13, and
SDK host tools (`pioasm` and `picotool`). When the Pico extension's prebuilt
host tools for the profile are installed under the Pico root, GPBuilder uses
them and no host C++ compiler or Visual Studio is required:

- `tools/<sdk version>/pioasm/pioasmConfig.cmake` (pioasm must match the SDK
  version exactly because the SDK looks it up by exact version), and
- `picotool/<picotool version>/picotool/picotoolConfig.cmake`.

They are passed to CMake as `pioasm_DIR` and `picotool_DIR`, and the prebuilt
picotool version and path are recorded in provenance. If either is missing,
the SDK builds the host tools from source with the host's native C++ compiler
(see [Host Profiles](#host-profiles)). SDK 2.3.1 does not build
`v0.7.12` (its bundled Mbed TLS integration is incompatible), so release and main
builds cannot share one SDK. Python 3.14 is not used because `grpcio-tools` has no
compatible wheel.

Before preparing the SDK, GPBuilder reads the minimum versions declared by the
materialized source's root `CMakeLists.txt`: the Pico-extension hints
`set(sdkVersion …)`, `set(toolchainVersion …)`, and `set(picotoolVersion …)`, and
the SDK minimum guard `if (PICO_SDK_VERSION_STRING VERSION_LESS "…")`. The SDK
requirement is the higher of the hint and the guard. If a declaration
cannot be found, or the source requires a newer SDK, picotool, or toolchain than
the pinned profile, the build fails with the required and pinned versions instead
of guessing. Firmware scripts are never executed to discover these values.

### Host Profiles

GPBuilder never installs host tools. Each supported host expects the pinned
tools under the Pico root (default `~/.pico-sdk`):

| Host | Tool names | Python 3.13 | Native host compiler (fallback only) | PATH delimiter | Metadata label |
|---|---|---|---|---|---|
| Windows x64 (`win32`) | `cmake.exe`, `ninja.exe`, `arm-none-eabi-gcc.exe`, `arm-none-eabi-g++.exe` | `py.exe -3.13` | Visual Studio 2022 C++ tools via vswhere/VsDevCmd | `;` | `Windows x64` |
| Ubuntu x64 (`linux`) | `cmake`, `ninja`, `arm-none-eabi-gcc`, `arm-none-eabi-g++` (no suffix) | `python3.13` on `PATH` | `gcc`/`g++` from the inherited `PATH` | `:` | `Ubuntu x64` |

Tool paths are `cmake/v4.3.4/bin/cmake[.exe]`, `ninja/v1.13.2/ninja[.exe]`, and
`toolchain/15_2_Rel1/bin/arm-none-eabi-{gcc,g++}[.exe]`. On Ubuntu, npm is
invoked directly rather than through `cmd.exe`. Any other platform, including
macOS (`darwin`), is rejected before side effects.

On Ubuntu, the calling workflow is responsible for provisioning the tool layout
(for example by downloading the Arm GNU 15.2.Rel1 Linux toolchain, CMake 4.3.4,
and Ninja 1.13.2 into `~/.pico-sdk`, and using `actions/setup-python` for 3.13).
GPBuilder only discovers and validates them. The Ubuntu profile has been
exercised by real `ubuntu-latest` integration builds through the GitHub Action
(`Pico` from the firmware's built-in configs and `OpenCore0` from the Board
Config Registry, both on `main`); it has no hardware qualification.

### Validation and Setup Order

1. Validate input syntax: target, board, platform (`win32` or `linux`), and that `--firmware` and
   `--configs` (when supplied) are existing directories. Local mode never installs
   host tools.
2. Materialize the selected source in owned storage and apply any configs overlay.
3. Check the source's declared minimums against the selected profile, then run
   tool discovery for that profile.
4. Only after those checks pass, prepare the SDK, verify its version/commit, and
   run web-asset generation, configure, and build.

A standalone `--check-prerequisites` remains a generic host report, not
certification for a specific firmware revision. Selection/listing remain
non-compiling and do not run build-tool probes.

### Main Artifact Identity

For main, the expected UF2/ELF names follow upstream's derivation from
`git describe --tags --always --dirty --abbrev=7` for the materialized source:
the `X.Y.Z` captured from a leading `vX.Y.Z`, or `0.0.0` when the describe output
has no such tag. For example, `v0.7.12-123-gabc1234` produces
`GP2040-CE_0.7.12_Pico.uf2`. The ELF must still embed the full describe string.
Never rename a stale or unrelated file to pass validation.

Publish a main artifact under
`artifacts/<Board>/main/<full-firmware-commit>/<build-type>/<run-id>/`, using the filename
`GP2040-CE_main_<full-firmware-commit>_<Board>.uf2` (for example `Pico` or `OpenCore0`). `build.json` records the original
upstream filename and embedded version, requested target, full commit, dirty flag,
config source (`firmware` or `external`) and external config path, SDK version and
commit, and artifact digest. Main is a development build, not an official release
or an implicitly hardware-qualified image. It must pass the same process, UF2,
publication, and provenance checks.

## Release-Specific Evidence

Reviewed against the tagged source, not the firmware's current main branch:

| Upstream source | Observed requirement or behavior |
| --- | --- |
| [Root CMake configuration](https://github.com/OpenStickCommunity/GP2040-CE/blob/v0.7.12/CMakeLists.txt) | CMake minimum 3.10; SDK minimum 2.1.1; Pico-extension version hints SDK 2.1.1, Arm GNU 14_2_Rel1, picotool 2.1.1; default SDK board `pico` |
| [Pico config](https://github.com/OpenStickCommunity/GP2040-CE/blob/v0.7.12/configs/Pico/BoardConfig.h) | GP2040 board configuration label `Pico`; this header defines its pin mappings and defaults |
| [Firmware workflow](https://github.com/OpenStickCommunity/GP2040-CE/blob/v0.7.12/.github/workflows/cmake.yml) | Ubuntu 22.04 build, CMake 3.17.x setup, Release configuration, separately generated web assets, UF2 artifact collection |
| [Web workflow](https://github.com/OpenStickCommunity/GP2040-CE/blob/v0.7.12/.github/workflows/node.js.yml) | Node 20.x, `npm ci`, web build, then `lib/httpd/fsdata.c` collection |
| [Web package](https://github.com/OpenStickCommunity/GP2040-CE/blob/v0.7.12/www/package.json) | `npm run build` runs protobuf TypeScript generation, Vite, and `makefsdata` |
| [Protobuf generation](https://github.com/OpenStickCommunity/GP2040-CE/blob/v0.7.12/compile_proto.cmake) | Python 3 creates a build-directory venv, installs nanopb requirements, and generates C headers/sources |
| [Submodules](https://github.com/OpenStickCommunity/GP2040-CE/blob/v0.7.12/.gitmodules) | TinyUSB and Pico-PIO-USB are external repositories pinned by the firmware commit's gitlinks |

The [host prerequisite guide](prerequisites.md) was initially reviewed against a
newer firmware revision requiring SDK 2.3.1. That is not the SDK minimum for
`v0.7.12`. A generic 12/12 host report does not establish release compatibility.

The release's version hints are SDK 2.1.1 and Arm GNU 14_2_Rel1. GPBuilder has
completed an end-to-end Windows x64 build using SDK 2.1.1 commit
`bddd20f928ce76142793bef434d4f75f4af6e433`, Arm GNU 15.2.1 (`15_2_Rel1`), CMake
4.3.4, Ninja 1.13.2, Python 3.13.15, and build-local setuptools 80.10.2. The
published `GP2040-CE_0.7.12_Pico.uf2` is 2,402,304 bytes with SHA-256
`b8be8f1ff12a7bfbd215b1fbbc2ec9cc83bacfb1745e6b2502ce60c459bd4aaf`; its 4,692
RP2040-family blocks passed the implemented UF2 validation. Source commit was
`0014e4ae2a312332e2582f6708dcc7d6bec5de8c`. The physical Pico smoke test has not
been performed, so hardware behavior is not qualified. This build profile is
qualified only on the observed Windows host. A separate attempt with SDK 2.3.1
failed because its Mbed TLS API is incompatible with this release's PS4
authentication code; do not substitute it for SDK 2.1.1. Detect and report other
missing or unqualified versions rather than silently selecting them.

For this Windows recipe, use Python 3.13: it has a compatible binary wheel for
the pinned `grpcio-tools==1.71.0`. Python 3.14 attempted to build that package
from source and failed with incompatible MSVC C/C++ standard flags. The Ubuntu
x64 profile also uses Python 3.13 (`python3.13`) and the host GCC for SDK
utilities; it is qualified only by the GitHub Action integration build recorded
in the acceptance criteria. Other Python versions and operating systems still
require separate build qualification.

GPBuilder runs on Node.js 24. The tagged v0.7.12 web `npm ci` and build have been
verified on Node 24. Upstream testing on Node 20 alone would not prove that
compatibility. Do not silently switch GPBuilder to an unsupported runtime or
rewrite the firmware lockfile to make dependency installation pass.

## Required Orchestration

### 1. Normalize and Check the Request

Normalize the two flags into the shared core's build request. Reject malformed
flags and unsafe board/ref values before side effects. Follow the bootstrap,
source-inspection, and revision-specific gate order above. Local mode reports
missing tools and stops; the Action retains only its documented Ubuntu repair
policy. Do not let a generic host-tool report bypass the selected revision's gate.

Keep CLI and Action adapters thin. Source preparation, tool selection, process
execution, and artifact validation belong in cohesive shared-core modules.
Log stage names, selected inputs, resolved revisions, and failures without secrets.

### 2. Materialize the Selected Source

Resolve `refs/tags/v0.7.12` from
`https://github.com/OpenStickCommunity/GP2040-CE.git` to a commit and check out that
commit into a new GPBuilder-owned run directory. Preserve Git metadata and the
selected tag: upstream uses `git describe` for the embedded version and output
name. Never fall back to main, HEAD, a similarly named tag, or a downloaded
prebuilt release artifact.

For an explicit local firmware path, materialize a separate clean copy of the
selected local commit and its tag. Do not build in, switch, reset, clean, or edit
the caller's checkout. Uncommitted source changes are not part of a tagged build.
Do not fetch missing firmware tags into the caller's repository.

For `main`, the default upstream source clones the commit resolved from
`refs/heads/main` once per invocation. An explicit local `--firmware` main build
copies the caller's working tree (including uncommitted/untracked files and
`.git`, excluding `node_modules` and `build`) into owned storage as described in
[Resolve Once, Build One Commit](#resolve-once-build-one-commit).

When `--configs <dir>` is supplied, `<dir>/<Board>/BoardConfig.h` must exist; the
directory `<dir>/<Board>` is copied over `configs/<Board>` in the owned source copy
before any build script runs. A missing board directory or `BoardConfig.h` is a
fatal validation error. The caller's configs directory is never modified. The
result records `configSource: "external"` and the absolute configs path; without
`--configs` it records `configSource: "firmware"`.

Initialize recursive submodules at the selected commit's recorded gitlinks. A
submodule's configured tracking branch must not override its pinned commit. Record
the source and submodule commits, and verify the materialized tree before running
its build scripts. An unavailable object or failed submodule operation is fatal.

Git-materialized sources (tags and upstream main, including submodules) are
checked out byte-exact with `core.autocrlf=false`, regardless of the caller's
Git configuration (for example, Windows defaults that convert to CRLF). The
repository's `.gitattributes` rules still apply.

### 3. Prepare SDK and Dependencies

Acquire a separate Pico SDK checkout from
`https://github.com/raspberrypi/pico-sdk.git` at the selected profile's SDK tag
(2.1.1 for `v0.7.12`, 2.3.1 for `main`), resolve and record its commit, and
initialize its required submodules. For `v0.7.12` the commit must equal the pinned
commit; for `main` the resolved commit is recorded. The same profile's picotool
version is either the matching prebuilt picotool (see the profile table) or is
fetched and built by CMake. Reuse an existing SDK only after verifying its
revision and dependencies; do not modify a developer's managed SDK installation.
Select the compatible Arm compiler and matching C/C++ libraries explicitly.

Project-local dependency restoration is part of the build, distinct from host
tool installation. It may fetch SDK/library sources, restore the firmware's npm
packages inside the run directory, and install nanopb's requirements inside its
build-local Python venv. It must not use global npm/pip installs, change the user's
PATH permanently, or invoke sudo/UAC in local mode. These network and script
execution effects must be clear in user-facing help/build documentation.

Preserve the firmware npm lockfile and use `npm ci`, not an unconstrained install.
Respect the selected nanopb requirements and retain their resolved versions in
the report; do not claim fully locked Python dependencies if upstream does not
pin them. In the inspected v0.7.12 nanopb generator, `proto/__init__.py` imports
`pkg_resources`, but its requirements do not constrain setuptools. Setuptools 81+
deprecates/removes that compatibility API; pass a build-owned pip constraints file
containing `setuptools<81` through `PIP_CONSTRAINT` while the upstream requirements
are installed into the build-local venv. Do not change the upstream requirements
file or install this constraint globally. Record the resolved setuptools version
with the other venv packages. Apply this compatibility constraint only when the
selected source's `lib/nanopb/extra/requirements.txt` does not declare a
setuptools requirement itself (or the file is absent); when upstream declares
one, as GP2040-CE `main` does with `setuptools==81.0.0`, omit the constraints
file and `PIP_CONSTRAINT` so the upstream pin is honored instead of conflicting.

Root CMake also fetches ArduinoJson at `v6.21.2`; resolve/record the fetched
revision. SDK host-tool downloads are dependencies too, not an assumed side effect
that can be omitted from diagnostics or provenance.

### 4. Generate Embedded Web Assets

In the owned firmware copy's `www` directory, run `npm ci`, then `npm run build`.
Require both commands to exit successfully and require the generated
`lib/httpd/fsdata.c` to be present and nonempty from this run. Do not use
`--if-present`, tolerate missing scripts, or silently ship stale web assets.

This includes the release's web protobuf generation and asset embedding. Use
`SKIP_WEBBUILD=TRUE` for CMake only after this stage passes. Upstream can skip its
web commands when tools are not found, so CMake success alone is not enough to
prove the web configurator was built.

### 5. Configure and Compile the Board

Use a new build directory and Ninja for the first qualified recipe. The effective
configuration must include (sample values for `--board Pico`):

| Setting | Sample value |
| --- | --- |
| `GP2040_BOARDCONFIG` | The selected board, e.g. `Pico` |
| `PICO_BOARD` | Derived SDK board, e.g. `pico` (not `Pico`) |
| `PICO_PLATFORM` | Derived platform; `rp2040` or `rp2350-arm-s` |
| `PICO_COMPILER` | Per platform, see [Board Platform](#board-platform) |
| `PICO_SDK_PATH` | Verified SDK checkout's absolute path |
| `CMAKE_BUILD_TYPE` | `Release` |
| `SKIP_SUBMODULES` | `TRUE`, only after explicit submodule preparation passes |
| `SKIP_WEBBUILD` | `TRUE`, only after web asset generation passes |

Pass these through explicit arguments and a child-specific environment. The
tagged CMake reads environment overrides for several settings; clear conflicting
inherited overrides or set them to the resolved values. Also isolate compiler,
SDK, generator, Pico-PIO-USB, and Pico-extension discovery from unrelated machine
settings. Detected tools must be the tools actually used by CMake, including host
compiler setup for SDK utilities when they are built from source; finding an MSVC
executable alone is not a complete Visual Studio compile/link environment. When
prebuilt `pioasm` and `picotool` are used, Visual Studio is not probed. On
Ubuntu, Visual Studio is never probed: SDK utilities are built with the `gcc`/`g++`
found on the inherited `PATH`, and the child environment starts from the inherited
environment with the overrides above applied.

The conceptual CMake calls are below. Angle-bracket paths are placeholders for
owned/verified paths, not literal shell commands to run today:

```text
cmake -S <source> -B <build> -G Ninja -DCMAKE_BUILD_TYPE=Release -DGP2040_BOARDCONFIG=<Board> -DPICO_BOARD=<sdk-board> -DPICO_PLATFORM=<platform> -DPICO_COMPILER=<compiler> -DPICO_SDK_PATH=<sdk> -DSKIP_SUBMODULES=TRUE -DSKIP_WEBBUILD=TRUE
cmake --build <build> --config Release --target GP2040-CE
```

Use process argument arrays, not interpolated shell strings. On Windows, handle
npm's command shim through the established safe process boundary. Paths with
spaces must work on Windows, macOS, and Linux.

Let the tagged `compile_proto.cmake` generate its build-local Python environment
and protobuf outputs. Require their success, compilation/link success, and the
SDK's extra-output generation. Do not bypass these stages or substitute a
preexisting UF2. Verify the CMake cache reflects the requested board, SDK and
build type, and the generated firmware version matches the selected source's
`git describe` output (`0.7.12` for the release), not `0.0.0` or a different tag. Do not patch upstream source merely to disguise a wrong revision.

### 6. Validate and Publish the UF2

The tagged CMake sets the target output name to
`GP2040-CE_<version>_<board>` and calls `pico_add_extra_outputs`. For the release
recipe, require the fresh build output `GP2040-CE_0.7.12_Pico.uf2`; for main,
require the name derived from the describe output (see
[Main Artifact Identity](#main-artifact-identity)). Do not pick the first
match from a broad artifact glob or accept a stale file after a failed process.

Validate with an established UF2 parser or a narrowly tested validator grounded in
the [UF2 specification](https://github.com/microsoft/uf2#file-format):

- Require a nonempty regular file composed of complete 512-byte blocks.
- Validate all three magic values in every block, supported flags, payload sizes,
  alignment, block numbering, and a consistent complete block count.
- Require flashable blocks with the selected platform's family identifier
  (RP2040 `0xe48bff56`; `rp2350-arm-s` `0xe48bff59`); reject another MCU family,
  file-container data, or non-flash-only content.
- Check target addresses and payload ranges against the platform's XIP flash
  window: 2 MiB from `0x10000000` for RP2040 (the original Pico's capacity), and
  16 MiB from `0x10000000` for RP2350. Reject overlaps, out-of-range writes,
  truncation, and an image without the bootable region at `0x10000000`.
- For `rp2350-arm-s`, accept one optional leading RP2350-E10 *absolute block*
  exactly as picotool emits it: family `0xe48bff57`, flags `0x2000` (optionally
  with `0x8000` and the `0x9957e304` ignore-block extension tag), block 0 of 2,
  256-byte payload of `0xef`. It is excluded from the image's block count,
  numbering, and address checks, and the reported block count covers only the
  firmware image. Any other absolute-family block is rejected.
- Correlate the artifact with the just-built ELF/build metadata: a valid UF2
  header alone does not prove the board config or firmware version.

Publish only after all stages and validation succeed, under the invocation's
working directory:

```text
artifacts/<Board>/v0.7.12/release/<run-id>/
  GP2040-CE_0.7.12_<Board>.uf2
  build.json

artifacts/<Board>/main/<full-commit>/<build-type>/<run-id>/
  GP2040-CE_main_<full-commit>_<Board>.uf2
  build.json
```

`<Board>` is the selected board config folder name and must contain only ASCII
letters, digits, `_`, or `-`; other names are rejected before publication.

Use a collision-resistant run ID and atomic publication of the validated result;
never overwrite a previous successful run. The metadata includes original and
normalized inputs, firmware/SDK/dependency commits, actual tool versions, build
type, config origin, artifact byte size and SHA-256, and validation results.
Recompute/verify the published file's size and digest before reporting success.
Return the absolute artifact path through the shared result; print it in the CLI.
For the future Action build result, expose `uf2-path`, `uf2-sha256`, and
`build-metadata-path` only on success. Artifact upload remains a consumer workflow
step, not an implicit publish operation.

## Execution Boundaries

Use a uniquely created directory under the OS temporary directory for each run.
No shared mutable source/build cache is required for this first slice. Isolate
concurrent runs and debug/release outputs. Retain failure diagnostics in a separate
run-specific log directory under `artifacts/logs/`; failed runs must not expose a
success-shaped UF2 result. Clean only owned temporary paths, including on failure;
never recursively delete caller-provided source/config/output directories.

Use bounded execution with process-tree cancellation. Initial per-stage limits
are 10 minutes per source/SDK/submodule retrieval, 20 minutes for npm restoration
and web generation each, 30 minutes for configure (including dependency retrieval),
and 60 minutes for compile/protobuf/UF2 generation. Timeout or cancellation is a
failure, not permission to publish a partial artifact. Preserve bounded useful
stdout/stderr and identify the failed stage. No unbounded automatic retries.

Use HTTPS for retrieval, preserve package-lock integrity checks, and verify fetched
Git object identities against resolved refs/gitlinks. Record mutable tag resolutions
as commits. Hashes and commit records establish identity, not independent source
trust or byte-for-byte reproducibility. Never disable certificate verification or
log credentials. Do not patch away third-party errors or suppress warnings to
make a build appear validated; report compatibility issues and resolve them.

## What Ready to Flash Means

The output is the firmware UF2 for the original Pico, not an ELF, source archive,
flash-nuke image, or prebuilt binary downloaded from a release. A successful host
run means the build and artifact checks passed. It does not prove the user's
wiring, attached peripherals, existing stored configuration, or hardware behavior.

Before marking this recipe qualified, manually test the produced file on a real
original Pico: back up needed configuration, enter BOOTSEL mode, copy the UF2 to
the `RPI-RP2` volume, and confirm reboot, expected USB behavior, the expected
version (`0.7.12` for the release, the describe output for main),
and access to the web configurator. Follow the firmware project's update guidance;
do not automate reset/erase steps or promise preservation of existing settings.
Record the exact artifact digest and test outcome. Hardware testing is an explicit
integration check and cannot be replaced by mocked tests or UF2-header inspection.

## Implementation and Acceptance

Implement in small test-driven slices after resolving the release compatibility
checks above:

1. Add the documented aliases and implicit-build request normalization. Test that
   the two sample flags build, incomplete inputs fail, and help, selection-only,
   and matrix precedence do not accidentally start a build.
2. Add isolated source/SDK preparation and release-specific tool selection with
   injected process/network boundaries. Cover missing tags, failed downloads,
   mismatched versions, dirty caller checkouts, and path-with-spaces handling.
3. Add dependency/web/protobuf/configure/build stages. Simulate every stage failing;
   assert that failures/timeouts stop dependent work and never publish success.
   Verify explicit environment/argument propagation and the prerequisite gate.
4. Add artifact validation/publication. Cover stale/missing/empty/truncated UF2s,
   wrong family, invalid blocks/addresses, wrong board/version metadata, hash
   mismatches, publication failures, and concurrent/debug-release isolation.
5. Run `npm run check`, regenerate tracked bundles, and run a separately identified
   real source-build integration on each host profile before claiming it
   supported (Windows x64 locally; Ubuntu x64 through the Action; macOS remains
   unsupported). Record actual SDK/compiler/Node/Python versions and
   whether the web/configuration generation worked. Never install host packages
   or use the network in unit tests.
6. Starting without firmware/config paths, the two-flag sample must produce the
   validated named artifact and metadata, exit 0, and leave caller-owned files
   unchanged. Repeat with a failed stage and prove it exits nonzero without
   reporting or publishing a new successful artifact.
7. Complete and record the physical Pico smoke test before calling the recipe
   hardware-qualified. No actual firmware build or hardware test was performed
   while writing this guide.
8. Test main resolution with a moving remote/local branch: resolve once per
   invocation, keep one commit across all stages/matrix boards, and resolve again
   for a new upstream invocation. Missing main must not fall back to another ref.
9. Test at least the observed older/newer SDK profiles with injected metadata and
   tools: each target selects its own referenced versions, rejects incompatible
   tools, and does not reuse stale requirement records. Cover missing/conflicting
   declarations and an installer that succeeds but supplies the wrong version.
10. Verify main artifact names/metadata identify the full commit and embedded
    upstream version, with the same UF2 validation as releases. Execute a separate
    real main integration before claiming a main revision/tool profile supported.
11. Test `--configs`: the board overlay replaces the source copy's board config,
    a missing `<Board>/BoardConfig.h` fails before any build stage, the caller's
    directories are unchanged, and metadata records the external config path.
12. Test board platform derivation: no `<Board>.cmake` yields `pico`/`rp2040`,
    `set(PICO_BOARD ...)`/`set(PICO_PLATFORM ...)` values are used,
    `rp2350-arm-s` is accepted with `pico_arm_cortex_m33_gcc`, bare `rp2350` and
    `rp2350-riscv` fail naming the board, RP2350 UF2s (with and without the
    absolute block) validate while cross-family images are rejected, and
    configure arguments, environment,
    artifact name, and metadata use the selected board. Execute a real build of a
    board supplied only by an external configs folder (`OpenCore0` from the
    registry on `main`).
13. Test the Ubuntu host profile with injected platform `linux`: tool paths have
    no `.exe`, Python is discovered with `python3.13`, Visual Studio is never
    probed, `PATH` entries are joined with `:`, npm is invoked directly, and
    metadata records `Ubuntu x64`. `darwin` must still be rejected before side
    effects. Execute a real `ubuntu-latest` Action build of `Pico` and
    `OpenCore0` on `main` before claiming the Ubuntu profile supported
    (verified: both boards built and were published as release assets).

The [matrix schema](matrix.md) defines parsing and normalization; matrix execution
still needs its pending policy decisions documented. RP2040 and `rp2350-arm-s`
boards are supported from built-in or external configs (both targets); only
`Pico`, `OpenCore0`, and the registry's `PimoroniPicoLipo2XLW` (RP2350) have been
integration-built, and no image has been hardware-tested. RISC-V RP2350 builds,
the upstream `Pico2` config (bare `rp2350`), other releases, caching, automatic
host tool installation, and flashing automation are not established by this
worked example.
