# Checking Build Prerequisites

Status: implemented for host tools. This guide is also the behavioral specification
for prerequisite checks; there is no separate internal spec to keep in sync.

## Check Your Machine

From a GPBuilder source checkout:

```sh
npm start -- --check-prerequisites
```

From an extracted release or an already built checkout:

```sh
node dist/cli.cjs --check-prerequisites
```

The CLI checks commands visible on the current process's PATH, then supported
Pico extension-managed tool locations under your home directory's `.pico-sdk`.
It does not install or upgrade software, change PATH, prompt for elevation, clone
repositories, or create a Python environment. This remains true when the CLI is
invoked inside a CI workflow. Tools outside these locations may be reported as
missing; expose their executable directory and reopen your terminal before retrying.

The console report lists each requirement as:

- **AVAILABLE:** the probe succeeded and any stated version/library check passed.
- **MISSING:** an executable could not be started because it was not found.
- **UNUSABLE:** a command failed, timed out, returned empty output, or failed the
  stated version/library check. A launcher that cannot find its target may also
  produce this status.

Each unavailable requirement includes installation guidance. The report ends with
an available/total count. Exit code `0` means all host checks passed; `1` means at
least one failed. This is not a successful firmware build or a complete validation
of a firmware development environment.

## What Is Checked

| Requirement | Probe / acceptance | Ubuntu repair package |
| --- | --- | --- |
| Node.js on PATH | `node --version`, major version 24 | Bootstrap with `actions/setup-node` |
| npm | `npm --version`, numeric version | Included with the Node.js bootstrap |
| Git | `git --version` | `git` |
| CMake | `cmake --version`, at least 3.10 | `cmake` |
| Build generator | `ninja --version`, falling back to `make --version` | `ninja-build` |
| Host C++ compiler | `CXX`, GCC/Clang on PATH, Visual Studio on Windows, or Xcode tools on macOS | `build-essential` |
| Python | `python3 --version`, major version 3 | `python3` |
| Python virtual environments | Import `venv` and `ensurepip` using the detected Python | `python3-venv` |
| Arm C compiler | `arm-none-eabi-gcc --version` | `gcc-arm-none-eabi` |
| Arm C++ compiler | `arm-none-eabi-g++ --version` | `gcc-arm-none-eabi` |
| Arm C library | GCC's `-print-file-name=libc.a` resolves to a path | `gcc-arm-none-eabi`, `libnewlib-arm-none-eabi` |
| Arm C++ library | G++'s `-print-file-name=libstdc++.a` resolves to a path | `gcc-arm-none-eabi`, `libstdc++-arm-none-eabi-newlib` |

On Windows, Python detection falls back to `python` if `python3` cannot report
Python 3. The selected command is reused for the virtual-environment probe.
The npm probe uses the fixed `npm.cmd --version` command through Windows' command
interpreter; it does not accept user-supplied shell text.

Local detection supports Windows, macOS, and Linux. Custom host-compiler locations
can be supplied through `CXX`; GPBuilder does not recursively search the machine
or parse VS Code workspace settings. The Arm library probes inspect compiler
lookup output, not every target's multilib variant.

Most tools are checked for availability, not a certified version range. Node.js 24
is GPBuilder's policy, not an inferred firmware requirement. The CMake minimum
comes from the firmware configuration; its CI currently selects CMake 3.31.x.

## Host C++ Compiler Discovery

A host compiler builds programs for your computer. The Arm `arm-none-eabi-g++`
compiler builds firmware for the microcontroller and cannot satisfy this check.
VS Code can configure or discover a compiler without putting it on your terminal's
PATH; installing the editor or its C++ language extension alone does not supply one.

GPBuilder checks the following sources in order:

1. **Explicit `CXX`:** when set, probe exactly that executable. This overrides
   discovery; a missing, broken, or Arm cross-compiler selection fails rather
   than silently choosing a different compiler.
2. **PATH on all platforms:** try `c++`, `g++`, then `clang++`, accepting a
   successful GCC/Clang version probe. Windows also tries MSVC `cl /?` and
   `clang-cl --version`. The recognized compiler banner may be on stdout or stderr.
3. **Windows:** use Visual Studio Installer's `vswhere` to locate installations
   with the C++ tools component, including Build Tools editions. Probe registered
   MSVC toolsets newest-first within each installation, using the native
   host/target architecture (`x64`, `arm64`, or `x86`). This works without a
   Developer Command Prompt when the installed compiler can display its banner.
4. **macOS:** use `xcrun --find clang++` to locate and probe the active Xcode or
   Command Line Tools compiler when PATH candidates fail. The active developer
   directory is selected by the system and any inherited `DEVELOPER_DIR` setting.

The report labels the selected source as `[CXX]`, `[PATH]`, `[Visual Studio]`, or
`[Xcode]` and includes the executable and version banner. A runnable compiler must
produce a recognized banner; simply finding a directory or executable is not enough.

For a custom Windows installation, set the executable path in PowerShell:

```powershell
$env:CXX = 'C:\path\to\compiler\clang++.exe'
node dist/cli.cjs --check-prerequisites
```

For a custom Linux/macOS installation:

```sh
CXX=/path/to/compiler/clang++ node dist/cli.cjs --check-prerequisites
```

Replace the example with the actual path. `CXX` must name one executable, not a
shell command containing flags or wrappers. Paths containing spaces are supported.
GPBuilder does not execute shell setup scripts or modify your environment.

This check verifies compiler presence and its ability to report a version, not a
compile/link test. MSVC builds may still require a Visual Studio Developer shell
to provide `INCLUDE`, `LIB`, and Windows SDK settings. Likewise, GCC/Clang headers,
linkers, SDKs, and compatibility with a particular build generator are not validated.
If no compiler is discovered, install/configure Visual Studio C++ Build Tools on
Windows, Xcode Command Line Tools on macOS, or your distribution's GCC/Clang C++
development packages on Linux. No tools are installed by a local check.

## Pico VS Code Extension Tools

The Raspberry Pi Pico extension can install tools separately from your system
PATH. GPBuilder automatically searches the current user's `.pico-sdk` directory,
for example `C:\Users\thegu\.pico-sdk` on Windows or `~/.pico-sdk` on Linux/macOS.
You do not need to launch GPBuilder from a Pico terminal or add these tools to PATH.

The supported versioned layouts are:

| Tool | Location below `.pico-sdk` |
| --- | --- |
| CMake | `cmake/<version>/bin/cmake` or `cmake/<version>/CMake.app/Contents/bin/cmake` |
| Ninja | `ninja/<version>/ninja` or `ninja/<version>/bin/ninja` |
| Arm compilers | `toolchain/<version>/bin/arm-none-eabi-gcc` and `arm-none-eabi-g++` |

On Windows, managed executable names use `.exe`. These locations are inspected
directly; the extension itself does not need to be running. Node.js, Git, and Python
retain their existing PATH probes. Host C++ compilers use the platform-specific
discovery described above, independently of the managed Arm toolchain.

Selection follows these rules:

1. A working PATH tool takes precedence. Ninja and Make on PATH are tried before
   managed Ninja. An unusable tool, such as an old CMake version, permits fallback.
2. Version directories are tried in descending numeric-aware name order, ignoring
   an initial `v`. Only existing executable files in the listed layouts are probed;
   incomplete or inaccessible directories do not stop the other checks.
3. If a managed probe fails, discovery tries an older candidate. The report shows
   the accepted command's output and full executable path with `[Pico extension]`.
4. Once a managed Arm GCC is selected, Arm G++ is checked in the same installation.
   Library probes reuse the selected compilers and never switch versions to hide
   missing libraries. A broken companion compiler or library remains a failed check.

The same discovery runs in Action mode before considering package installation.
No installation under `.pico-sdk` is changed or deleted. Only trust managed binaries
that you would run yourself: discovery executes their version and library probes.

This is tool discovery, not project configuration discovery. GPBuilder does not
read the extension's selected project versions or certify that the newest working
tool is compatible with a particular firmware target. It does not count the Arm
cross-compiler as a host C++ compiler. It also does not validate `sdk/<version>` or
change `PICO_SDK_PATH`; SDK validation remains outside this host-tool check.

## Run as a GitHub Action

Replace `COMMIT_SHA` with a commit containing this feature (or a released tag):

```yaml
jobs:
  prerequisites:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: becauseimclever/GPBuilder@COMMIT_SHA
        with:
          command: check-prerequisites
```

The Action's `command` input defaults to `check-prerequisites`. The Action:

1. Probes all requirements and prints the initial report.
2. Does nothing further if they are all available.
3. On an Ubuntu GitHub Actions runner, installs only packages associated with
   failed checks using `sudo -n`, `apt-get update`, and noninteractive
   `apt-get install -y --no-install-recommends`.
4. Rechecks every requirement and prints the final report after any installation
   attempt, including a failed attempt.
5. Fails the step if installation failed or a requirement remains unavailable.

Provision Node.js 24 and npm with `actions/setup-node` before this Action. GitHub's
bundled Action runtime does not guarantee the version of `node` or `npm` on PATH.
GPBuilder deliberately does not replace them with Ubuntu's potentially different
Node.js packages. No GPBuilder dependency installation is required in the consumer.

Automatic installation requires Linux with `ID=ubuntu` in `/etc/os-release`,
`GITHUB_ACTIONS=true`, working apt repositories/network access, and passwordless
sudo. Ubuntu 24.04 is the recommended initial environment. Self-hosted runners
must satisfy these conditions and permit system package changes. Windows, macOS,
and non-Ubuntu Actions can pass with preinstalled tools, but fail with guidance
if a repair is needed; GPBuilder does not guess a package manager for them.

Tool probes have a ten-second timeout. Each apt command has a ten-minute timeout
and a one-MiB captured-output limit. Installation errors are propagated. There are
no interactive prompts or retries. Packages come from the runner's configured apt
repositories, so versions are not pinned; PATH entries and repositories must be
trusted. Successful partial installations are not rolled back if a later step fails.

## Mandatory Before Builds

The build entry points are:

```sh
npm start -- --build
node dist/cli.cjs --build
```

For the Action, select `command: build`. Both routes call the same prerequisite
gate before entering build execution. Local builds do not install tools; Action
builds apply the installation policy above. There is no skip-prerequisites option.
`--build` and `--check-prerequisites` are mutually exclusive because builds already
include the check. Unknown CLI flags or Action commands fail.

**Firmware compilation is not implemented yet.** If host prerequisites pass,
`--build` / `command: build` still fails explicitly with a not-implemented message.
It never reports a successful build or produces firmware. Running the CLI without
arguments, or with `--help`, prints usage without probing or installing tools.

`npm run build` is different: it bundles GPBuilder's TypeScript, not firmware,
and does not require firmware tools.

## Scope and Firmware Baseline

The initial checklist was reviewed against GP2040-CE revision
[`21947c9f2251960f1cbbd6bfc2bea38bc31f9454`](https://github.com/OpenStickCommunity/GP2040-CE/tree/21947c9f2251960f1cbbd6bfc2bea38bc31f9454),
using its root CMake configuration, Python code-generation configuration, and
CMake workflow. GPBuilder does not hard-code the developer's checkout path.

The firmware also needs Pico SDK 2.3.1 or newer, initialized submodules, a selected
board configuration, and source-dependent Python/npm dependencies. This host-tool
feature does not inspect or install those, fetch firmware, resolve SDK paths,
certify an Arm compiler version, or test network access. Every report explicitly
states this limit. SDK/source preparation and target validation must be added to
the build path before firmware compilation can be implemented.

## Acceptance and Verification

These requirements are maintained alongside the usage instructions above:

1. Every supported probe produces an available/missing/unusable row, remediation
   for failures, and a summary before the operation succeeds or fails.
2. The CLI never installs tools, even if `GITHUB_ACTIONS=true`; failed checks
   return a nonzero exit code.
3. A ready Action performs no installation. Ubuntu repair uses only the fixed
   package mapping, rechecks, and fails on install errors or unresolved checks.
4. Unsupported repair hosts fail after reporting; non-GitHub execution cannot
   trigger installation. Node/npm bootstrap failures have actionable guidance.
5. Both build entry points invoke the shared gate. A failed gate prevents build
   execution; a passed gate cannot turn the unfinished build into a success.
6. Fallbacks, version mismatches, missing Python modules, compiler library lookup
   failures, and probe timeouts are covered by focused tests.
7. Supported Pico-managed tools are found outside PATH without changing the
   environment. Tests cover PATH precedence, multiple versions, broken/missing
   installations, executable paths containing spaces, platform-specific layouts,
   compiler/library consistency, and avoiding unnecessary Action installation.
8. Host compiler detection covers GCC/Clang alternatives on Windows, macOS, and
   Linux, explicit `CXX`, macOS `xcrun`, and registered MSVC installations. Tests
   reject invalid banners, failed probes, malformed discovery data, and Arm
   cross-compilers selected as host compilers. Reports retain the version banner.

Run `npm run check` for linting, type checking, deterministic prerequisite tests,
and isolated CLI/Action bundle tests. Tests use injected command results for
installation scenarios and never install system packages on a developer machine.
CI invokes the real Action on Ubuntu as the installation integration check; it
must pass there before claiming hosted installation is verified. The local
Windows report has been exercised, but is not proof of firmware build support.