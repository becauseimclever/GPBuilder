# Building a Flashable Pico UF2

**Status: implemented and integration-built on Windows x64.** The supported build
is GP2040-CE **0.7.12** for the original Raspberry Pi **Pico** (RP2040), using
upstream tag `v0.7.12` and its built-in `Pico` configuration. This is not a Pico W,
Pico 2, or generic RP2040-board recipe. Other host profiles, targets, boards,
build types, and external configs are not supported or qualified.

Local selection accepts `main` for development/nightly builds. Building main,
including upstream resolution and revision-specific setup, remains planned. The
released Pico example is the initial qualification case; a successful release
build does not establish that a later main commit builds or runs correctly.

## User Contract

From the GPBuilder repository root on the qualified Windows x64 host, supply only
the firmware release and board:

```sh
node dist/cli.cjs --release v0.7.12 --board Pico
node dist/cli.cjs -r v0.7.12 -b Pico
```

These are equivalent supported commands. No `--build`, source path, SDK path, config
path, or matrix is required. With a complete release/board pair and no explicit
operation or matrix, the CLI defaults to `build`. An explicit `--select-build`
remains validation-only; an explicit `--build` remains supported. No arguments
still shows help. An incomplete pair fails with guidance, not a guessed board or
release. Help/version and matrix precedence remain as defined in the
[CLI contract](build-selection.md#planned-cli-contract).

The release flag is the firmware version, not GPBuilder's `--version` flag.
Use the exact tag `v0.7.12`; accepting a bare `0.7.12` alias is not part of this
contract. Local `main` selection is supported for discovery only; building main
is not supported.

Defaults are the upstream GP2040-CE repository, `configs/Pico` from that exact
commit, and build type `release` (CMake `Release`). A local firmware path may be
supplied to select its exact tag; GPBuilder materializes a clean copy and does not
modify that checkout. The caller needs network access for source and dependency
retrieval. GPBuilder does not install host software. Its qualified Windows tool
profile is checked before dependency setup; other host profiles are unsupported.

A successful run prints an absolute path to a newly built, validated
`GP2040-CE_0.7.12_Pico.uf2`, its byte size, and SHA-256 digest, then exits 0.
No flash drive or connected Pico is required to build. The produced image has not
been physically tested on a Pico. GPBuilder never flashes hardware, erases
configuration, or copies files to a device.

## Main and Revision-Specific Requirements

```sh
node dist/cli.cjs --release main --board Pico
node dist/cli.cjs -r main -b Pico
```

`--release` is the firmware target selector: this build currently accepts only
the exact release tag `v0.7.12`. No implicit latest target, arbitrary branch, raw commit expression,
`latest`, or `nightly` alias is introduced. "Nightly" describes building main; it
does not add a scheduled workflow or download a prebuilt nightly artifact.

### Resolve Once, Build One Commit

For the default upstream source, resolve `refs/heads/main` to its current commit
at the start of each invocation, then materialize that exact commit in owned
storage. For a supplied local checkout, use its local `refs/heads/main`; do not
fetch or substitute `origin/main`, the current branch, or HEAD if that ref is
missing. A local main build means the local branch tip, not necessarily the newest
upstream commit. Do not mutate the caller's branch or include uncommitted files.

Pin the resolved firmware commit throughout discovery, requirement inspection,
dependency setup, compilation, and artifact validation. A later branch update
must not change an in-progress build. All entries in one matrix invocation share
the same resolved firmware commit. A subsequent upstream main invocation resolves
again, rather than trusting a previous invocation's cached branch tip.

Use built-in configs from that same commit, not a separately fetched main config
tree. Record both the requested target (`main` or tag) and the resolved firmware
commit in the result. Keep enough Git/tag metadata for upstream version generation;
the embedded version reported by main is not necessarily the literal `main`.

### Derive the Build Requirements

Before selecting or preparing build tools, inspect requirements from the resolved
firmware commit, including its root CMake declarations, SDK/toolchain/picotool
version references, dependency manifests and lockfiles, submodule gitlinks, and
relevant build workflows. Inspect the selected SDK's own host-tool requirements as
well. Do not reuse a global profile chosen before the firmware target was known.

Distinguish hard constraints (minimum/exact versions in build logic or manifests),
preferred version references (such as Pico-extension version hints), and tested
workflow versions. Workflow use is compatibility evidence, not proof that all
other versions fail. Derive an explicit requirements record with each value's
source file/revision and whether it is required, preferred, or requires qualification.
Conflicting declarations or unsupported/dynamic declarations must cause a useful
failure or require a documented compatibility rule, not a guessed version. Do not
execute arbitrary firmware scripts merely to discover metadata.

Select the SDK revision referenced by that firmware commit, then verify that it
satisfies the firmware's hard constraints. Match compiler/C++ libraries and SDK
host tools to the resolved profile. Validate CMake, Python, Node/npm build needs,
and the generator against the same profile before running their build stages.
GPBuilder's own Node.js 24 runtime contract remains independent; source requirements
do not authorize silently changing the orchestrator runtime.

For `v0.7.12`, the inspected root CMake references SDK 2.1.1, Arm GNU 14_2_Rel1,
and picotool 2.1.1. The newer inspected firmware snapshot
[`21947c9f2251960f1cbbd6bfc2bea38bc31f9454`](https://github.com/OpenStickCommunity/GP2040-CE/blob/21947c9f2251960f1cbbd6bfc2bea38bc31f9454/CMakeLists.txt)
references SDK 2.3.1, Arm GNU 15_2_Rel1, and picotool 2.3.1. This illustrates why
main and release builds cannot share one hard-coded SDK version. These observations
are not a permanent main profile or proof that either combination is qualified.

"Latest SDK for main" means the SDK referenced by the resolved main commit, not
the newest SDK release independently available today. Never upgrade an older
firmware release to main's SDK merely because it is installed, or let main fall
back to a release's older SDK. A locally available tool is reusable only after its
version and configuration satisfy the selected requirements and compatibility
policy. Action repairs and dependency preparation must use this same record;
if the documented installer cannot supply a compatible tool, fail with guidance.

### Validation and Setup Order

1. Validate input syntax and perform a minimal bootstrap check for the orchestrator
   runtime, Git, and source-resolution access. Local mode never installs host tools.
2. Resolve the requested firmware target and inspect the exact source revision in
   owned storage. This limited source retrieval may precede the full tool gate;
   no firmware scripts or dependency installation run during inspection.
3. Derive the target requirements, report required/preferred versus detected tool
   versions, and run the full revision-specific prerequisite gate. The Action may
   apply its allowed repair policy and must recheck the selected requirements.
4. Only after that gate passes, prepare the selected SDK and project dependencies,
   verify their resolved versions/commits, and run configure/build. Stop before
   compilation if setup produces an incompatible SDK or dependency.

The full gate is mandatory for release and main builds; bootstrap success is not
build readiness. A standalone `--check-prerequisites` remains a generic host
report, not certification for an unspecified firmware revision. Selection/listing
remain non-compiling and do not run build-tool probes. Requirement inspection must
not be used as a back door to execute config/build scripts during selection.

### Main Artifact Identity

Keep released Pico output naming as documented below. For main, verify the freshly
generated UF2 using the effective upstream target name and embedded version from
that commit, rather than expecting `GP2040-CE_0.7.12_Pico.uf2`. Correlate the UF2
with the just-built ELF/configuration and resolved source metadata; do not rename
a stale or unrelated file to make it pass validation.

Publish a main artifact under
`artifacts/Pico/main/<full-firmware-commit>/<build-type>/<run-id>/`, using the filename
`GP2040-CE_main_<full-firmware-commit>_Pico.uf2`. Record the original upstream
filename and embedded version, requested target, full commit, requirement sources,
resolved SDK/dependencies/tools, and artifact digest in `build.json`. Main is a
development build, not an official release or an implicitly hardware-qualified
image. It must pass the same process, UF2, publication, and provenance checks.

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
from source and failed with incompatible MSVC C/C++ standard flags. Other Python
versions and operating systems still require separate build qualification.

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

Initialize recursive submodules at the selected commit's recorded gitlinks. A
submodule's configured tracking branch must not override its pinned commit. Record
the source and submodule commits, and verify the materialized tree before running
its build scripts. An unavailable object or failed submodule operation is fatal.

### 3. Prepare SDK and Dependencies

Acquire a separate Pico SDK 2.1.1 checkout from
`https://github.com/raspberrypi/pico-sdk.git`, resolve and record its commit, and
initialize its required submodules for this released Pico example. Other targets,
including main, use the SDK from their resolved requirement profile, not this
example's hard-coded version. Reuse an existing SDK only after verifying its
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
with the other venv packages. Remove this compatibility constraint only when the
selected nanopb generator no longer requires `pkg_resources` or declares a
compatible setuptools range itself.

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

### 5. Configure and Compile Pico

Use a new build directory and Ninja for the first qualified recipe. The effective
configuration must include:

| Setting | Sample value |
| --- | --- |
| `GP2040_BOARDCONFIG` | `Pico` |
| `PICO_BOARD` | `pico` (the SDK board, not `Pico`) |
| `PICO_PLATFORM` | `rp2040` |
| `PICO_SDK_PATH` | Verified SDK checkout's absolute path |
| `CMAKE_BUILD_TYPE` | `Release` |
| `SKIP_SUBMODULES` | `TRUE`, only after explicit submodule preparation passes |
| `SKIP_WEBBUILD` | `TRUE`, only after web asset generation passes |

Pass these through explicit arguments and a child-specific environment. The
tagged CMake reads environment overrides for several settings; clear conflicting
inherited overrides or set them to the resolved values. Also isolate compiler,
SDK, generator, Pico-PIO-USB, and Pico-extension discovery from unrelated machine
settings. Detected tools must be the tools actually used by CMake, including host
compiler setup for SDK utilities; finding an MSVC executable alone is not a
complete Visual Studio compile/link environment.

The conceptual CMake calls are below. Angle-bracket paths are placeholders for
owned/verified paths, not literal shell commands to run today:

```text
cmake -S <source> -B <build> -G Ninja -DCMAKE_BUILD_TYPE=Release -DGP2040_BOARDCONFIG=Pico -DPICO_BOARD=pico -DPICO_PLATFORM=rp2040 -DPICO_SDK_PATH=<sdk> -DSKIP_SUBMODULES=TRUE -DSKIP_WEBBUILD=TRUE
cmake --build <build> --config Release --target GP2040-CE
```

Use process argument arrays, not interpolated shell strings. On Windows, handle
npm's command shim through the established safe process boundary. Paths with
spaces must work on Windows, macOS, and Linux.

Let the tagged `compile_proto.cmake` generate its build-local Python environment
and protobuf outputs. Require their success, compilation/link success, and the
SDK's extra-output generation. Do not bypass these stages or substitute a
preexisting UF2. Verify the CMake cache reflects the requested board, SDK and
build type, and the generated firmware version is `0.7.12`, not `0.0.0` or a
different tag. Do not patch upstream source merely to disguise a wrong revision.

### 6. Validate and Publish the UF2

The tagged CMake sets the target output name to
`GP2040-CE_<version>_<board>` and calls `pico_add_extra_outputs`. For this recipe,
require the fresh build output `GP2040-CE_0.7.12_Pico.uf2`. Do not pick the first
match from a broad artifact glob or accept a stale file after a failed process.

Validate with an established UF2 parser or a narrowly tested validator grounded in
the [UF2 specification](https://github.com/microsoft/uf2#file-format):

- Require a nonempty regular file composed of complete 512-byte blocks.
- Validate all three magic values in every block, supported flags, payload sizes,
  alignment, block numbering, and a consistent complete block count.
- Require flashable RP2040-family blocks with the expected family identifier;
  reject another MCU family, file-container data, or non-flash-only content.
- Check target addresses and payload ranges against the original Pico's flash
  capacity and the selected SDK/linker layout. Reject overlaps, out-of-range
  writes, truncation, and an image without the expected bootable flash region.
- Correlate the artifact with the just-built ELF/build metadata: a valid RP2040
  UF2 header alone does not prove the Pico board config or firmware version.

Publish only after all stages and validation succeed, under the invocation's
working directory:

```text
artifacts/Pico/v0.7.12/release/<run-id>/
  GP2040-CE_0.7.12_Pico.uf2
  build.json
```

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
the `RPI-RP2` volume, and confirm reboot, expected USB behavior, version `0.7.12`,
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
   real source-build integration on Windows, macOS, and Linux before claiming
   those hosts supported. Record actual SDK/compiler/Node/Python versions and
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

The [matrix schema](matrix.md) defines parsing and normalization; matrix execution
still needs its pending policy decisions documented. Other
boards/releases, external-config integration, caching, automatic host tool
installation, and flashing automation are not established by this worked example.
Do not silently ignore an external-config request while claiming it was built;
that build path needs its own integration coverage before support is advertised.