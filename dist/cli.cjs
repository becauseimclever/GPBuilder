"use strict";

// src/cli.ts
var import_node_util = require("node:util");

// src/prerequisites.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var requirements = [
  {
    name: "Node.js 24 on PATH",
    command: "node",
    args: ["--version"],
    packages: [],
    guidance: "Install Node.js 24; in Actions use actions/setup-node with node-version: 24.",
    accepts: (output) => /^v24\./.test(output.trim())
  },
  {
    name: "npm",
    command: "npm",
    args: ["--version"],
    packages: [],
    guidance: "Install npm with Node.js 24; in Actions use actions/setup-node.",
    accepts: (output) => /^\d+\./.test(output.trim())
  },
  {
    name: "Git",
    command: "git",
    args: ["--version"],
    packages: ["git"],
    guidance: "Install Git and add it to PATH."
  },
  {
    name: "CMake >= 3.10",
    command: "cmake",
    args: ["--version"],
    packages: ["cmake"],
    guidance: "Install CMake 3.10 or newer and add it to PATH.",
    accepts: (output) => {
      const version = /cmake version (\d+)\.(\d+)/.exec(output);
      return version !== null && (Number(version[1]) > 3 || Number(version[1]) === 3 && Number(version[2]) >= 10);
    }
  },
  {
    name: "Ninja or Make",
    command: "ninja",
    args: ["--version"],
    packages: ["ninja-build"],
    guidance: "Install Ninja or Make and add it to PATH."
  },
  {
    name: "Host C++ compiler",
    command: "c++",
    args: ["--version"],
    packages: ["build-essential"],
    guidance: "Expose GCC/Clang on PATH or set CXX to its executable; on Windows use Visual Studio C++ Build Tools, and on macOS install Xcode Command Line Tools."
  },
  {
    name: "Python 3",
    command: "python3",
    args: ["--version"],
    packages: ["python3"],
    guidance: "Install Python 3 and expose python3 (or python on Windows) on PATH.",
    accepts: (output) => /^Python 3\./.test(output.trim())
  },
  {
    name: "Python venv and ensurepip",
    command: "python3",
    args: ["-c", 'import venv, ensurepip; print("venv and ensurepip available")'],
    packages: ["python3-venv"],
    guidance: "Install Python venv/ensurepip support; Ubuntu package: python3-venv."
  },
  {
    name: "Arm GCC",
    command: "arm-none-eabi-gcc",
    args: ["--version"],
    packages: ["gcc-arm-none-eabi"],
    guidance: "Install the Arm GNU bare-metal toolchain and add its bin directory to PATH."
  },
  {
    name: "Arm G++",
    command: "arm-none-eabi-g++",
    args: ["--version"],
    packages: ["gcc-arm-none-eabi"],
    guidance: "Install the Arm GNU bare-metal C++ compiler and add it to PATH."
  },
  {
    name: "Arm C library",
    command: "arm-none-eabi-gcc",
    args: ["-print-file-name=libc.a"],
    packages: ["gcc-arm-none-eabi", "libnewlib-arm-none-eabi"],
    guidance: "Install Arm newlib libraries; Ubuntu package: libnewlib-arm-none-eabi.",
    accepts: (output) => /[/\\]libc\.a$/.test(output.trim())
  },
  {
    name: "Arm C++ library",
    command: "arm-none-eabi-g++",
    args: ["-print-file-name=libstdc++.a"],
    packages: ["gcc-arm-none-eabi", "libstdc++-arm-none-eabi-newlib"],
    guidance: "Install Arm C++ libraries; Ubuntu package: libstdc++-arm-none-eabi-newlib.",
    accepts: (output) => /[/\\]libstdc\+\+\.a$/.test(output.trim())
  }
];
var executeCommand = (command, args, timeout) => {
  const windowsNpm = process.platform === "win32" && command === "npm";
  const result = (0, import_node_child_process.spawnSync)(
    windowsNpm ? "cmd.exe" : command,
    windowsNpm ? ["/d", "/s", "/c", "npm.cmd --version"] : args,
    {
      encoding: "utf8",
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" }
    }
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...result.error ? { error: result.error.message } : {},
    missing: result.error !== void 0 && "code" in result.error && result.error.code === "ENOENT"
  };
};
function currentHost() {
  let ubuntu = false;
  if (process.platform === "linux") {
    try {
      ubuntu = /^ID=(?:ubuntu|"ubuntu")$/m.test((0, import_node_fs.readFileSync)("/etc/os-release", "utf8"));
    } catch {
      ubuntu = false;
    }
  }
  return {
    platform: process.platform,
    ubuntu,
    githubActions: process.env.GITHUB_ACTIONS === "true",
    picoRoot: (0, import_node_path.join)((0, import_node_os.homedir)(), ".pico-sdk"),
    arch: process.arch,
    ...process.env.CXX ? { cxx: process.env.CXX } : {},
    ...process.platform === "win32" && process.env["ProgramFiles(x86)"] ? {
      vswhere: (0, import_node_path.join)(process.env["ProgramFiles(x86)"], "Microsoft Visual Studio", "Installer", "vswhere.exe")
    } : {}
  };
}
function visualStudioCompilers(execute, host) {
  const result = execute(host.vswhere ?? "vswhere", [
    "-all",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-format",
    "json",
    "-utf8"
  ], 1e4);
  if (result.status !== 0 || result.error) return [];
  try {
    const installations = JSON.parse(result.stdout);
    if (!Array.isArray(installations)) return [];
    const entries = installations;
    const compilers = [];
    const architecture = host.arch === "arm64" ? "arm64" : host.arch === "ia32" ? "x86" : "x64";
    for (const installation of entries) {
      if (typeof installation !== "object" || installation === null || !("installationPath" in installation) || typeof installation.installationPath !== "string") continue;
      const root = (0, import_node_path.join)(installation.installationPath, "VC", "Tools", "MSVC");
      try {
        const versions = (0, import_node_fs.readdirSync)(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
        for (const version of versions) {
          const compiler = (0, import_node_path.join)(root, version, "bin", `Host${architecture}`, architecture, "cl.exe");
          try {
            if ((0, import_node_fs.statSync)(compiler).isFile()) compilers.push(compiler);
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
    return compilers;
  } catch {
    return [];
  }
}
function detectHostCompiler(requirement, execute, host) {
  let failure = {
    name: requirement.name,
    status: "missing",
    detail: "No supported host compiler was found.",
    guidance: requirement.guidance
  };
  const probe = (command, source) => {
    const msvc = /(?:^|[/\\])cl(?:\.exe)?$/i.test(command);
    const result = execute(command, msvc ? ["/?"] : ["--version"], 1e4);
    const output = `${result.stdout}
${result.stderr}`.trim();
    const recognized = /(?:clang|g\+\+|gcc|Free Software Foundation|Microsoft.*C\/C\+\+)/i.test(output);
    const crossCompiler = /arm-none-eabi/i.test(command) || /arm-none-eabi/i.test(output);
    const accepted = result.status === 0 && !result.error && recognized && !crossCompiler;
    const lines = output.split(/\r?\n/);
    const banner = lines.find((line) => /(?:clang|gcc|g\+\+|Microsoft.*C\/C\+\+).*\b(?:version|\d+\.)/i.test(line));
    const detail = result.error ?? (banner || lines.find((line) => line.trim()) || `exit ${String(result.status)}`);
    const detected = {
      name: requirement.name,
      status: accepted ? "available" : result.missing ? "missing" : "unusable",
      detail: `[${source}] ${command}: ${detail}${crossCompiler ? " (Arm cross-compiler is not a host compiler)" : ""}`,
      guidance: requirement.guidance
    };
    if (accepted) return detected;
    if (failure.status === "missing") failure = detected;
    return void 0;
  };
  if (host.cxx?.trim()) {
    const result = probe(host.cxx.trim().replace(/^"(.*)"$/, "$1"), "CXX");
    return result ?? failure;
  }
  const candidates = ["c++", "g++", "clang++"];
  if (host.platform === "win32") candidates.push("cl", "clang-cl");
  for (const command of candidates) {
    const result = probe(command, "PATH");
    if (result) return result;
  }
  if (host.platform === "darwin") {
    const located = execute("xcrun", ["--find", "clang++"], 1e4);
    if (located.status === 0 && !located.error && (0, import_node_path.isAbsolute)(located.stdout.trim())) {
      const result = probe(located.stdout.trim(), "Xcode");
      if (result) return result;
    }
  }
  if (host.platform === "win32") {
    for (const command of visualStudioCompilers(execute, host)) {
      const result = probe(command, "Visual Studio");
      if (result) return result;
    }
  }
  return failure;
}
function picoCandidates(command, host) {
  if (!host.picoRoot) return [];
  const layouts = {
    cmake: { directory: "cmake", paths: [["bin"], ["CMake.app", "Contents", "bin"]] },
    ninja: { directory: "ninja", paths: [[], ["bin"]] },
    "arm-none-eabi-gcc": { directory: "toolchain", paths: [["bin"]] },
    "arm-none-eabi-g++": { directory: "toolchain", paths: [["bin"]] }
  };
  const layout = layouts[command];
  if (!layout) return [];
  const root = (0, import_node_path.join)(host.picoRoot, layout.directory);
  try {
    const versions = (0, import_node_fs.readdirSync)(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^v?\d/.test(entry.name)).map((entry) => entry.name).sort((left, right) => right.replace(/^v/, "").localeCompare(left.replace(/^v/, ""), "en", { numeric: true }));
    const executable = `${command}${host.platform === "win32" ? ".exe" : ""}`;
    return versions.flatMap((version) => layout.paths.map((parts) => (0, import_node_path.join)(root, version, ...parts, executable))).filter((candidate) => {
      try {
        return (0, import_node_fs.statSync)(candidate).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
function detect(execute, host) {
  const selected = /* @__PURE__ */ new Map();
  let armDirectory;
  return requirements.map((requirement) => {
    if (requirement.name === "Host C++ compiler") return detectHostCompiler(requirement, execute, host);
    const previous = selected.get(requirement.command);
    let candidates = [requirement.command];
    if (requirement.name === "Python 3" && host.platform === "win32") candidates.push("python");
    if (requirement.command === "ninja") candidates.push("make");
    candidates.push(...picoCandidates(requirement.command, host));
    if (armDirectory && requirement.command.startsWith("arm-none-eabi-")) {
      candidates = [(0, import_node_path.join)(armDirectory, `${requirement.command}${host.platform === "win32" ? ".exe" : ""}`)];
    }
    if (previous) candidates = [previous];
    let command = requirement.command;
    let result = { status: null, stdout: "", stderr: "", missing: true };
    let output = "";
    let available = false;
    for (const candidate of candidates) {
      const attempt = execute(candidate, requirement.args, 1e4);
      const text = `${attempt.stdout}
${attempt.stderr}`.trim();
      const accepted = attempt.status === 0 && !attempt.error && text.length > 0 && (requirement.accepts?.(text) ?? true);
      if (accepted || result.missing) {
        command = candidate;
        result = attempt;
        output = text;
      }
      if (accepted) {
        available = true;
        selected.set(requirement.command, candidate);
        if (requirement.command === "arm-none-eabi-gcc" && (0, import_node_path.isAbsolute)(candidate)) {
          armDirectory = (0, import_node_path.dirname)(candidate);
        }
        break;
      }
    }
    const status = available ? "available" : result.missing ? "missing" : "unusable";
    const detail = (result.error ?? output.split(/\r?\n/)[0] ?? "").trim();
    return {
      name: requirement.name,
      status,
      detail: `${(0, import_node_path.isAbsolute)(command) ? "[Pico extension] " : ""}${command}: ${detail || `exit ${String(result.status)}`}`,
      guidance: requirement.guidance
    };
  });
}
function report(results, log, title) {
  log(title);
  for (const result of results) {
    log(`[${result.status.toUpperCase()}] ${result.name}: ${result.detail}`);
    if (result.status !== "available") log(`  Fix: ${result.guidance}`);
  }
  log(`${results.filter((result) => result.status === "available").length}/${results.length} prerequisites available.`);
  log("Host-tool check only; firmware source, Pico SDK >= 2.3.1, and target compatibility are not validated.");
}
function checkPrerequisites(options) {
  const execute = options.execute ?? executeCommand;
  const host = options.host ?? currentHost();
  let results = detect(execute, host);
  report(results, options.log, "Prerequisite report");
  if (options.mode === "local" || results.every((result) => result.status === "available")) return results;
  if (!host.githubActions || host.platform !== "linux" || !host.ubuntu) {
    throw new Error("Automatic installation requires a GitHub Actions Ubuntu runner. Install the reported tools manually on other hosts.");
  }
  const failed = requirements.filter((requirement, index) => results[index]?.status !== "available");
  const packages = [...new Set(failed.flatMap((requirement) => requirement.packages))];
  if (packages.length > 0) {
    options.log(`Installing Ubuntu packages: ${packages.join(", ")}`);
    let installationError;
    for (const args of [
      ["-n", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "update"],
      ["-n", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", "--no-install-recommends", ...packages]
    ]) {
      const result = execute("sudo", args, 6e5);
      if (result.status !== 0 || result.error) {
        installationError = result.error ?? ((result.stderr || result.stdout).trim() || `exit ${String(result.status)}`);
        break;
      }
    }
    results = detect(execute, host);
    report(results, options.log, "Prerequisite report after installation");
    if (installationError) throw new Error(`Prerequisite installation failed: ${installationError}`);
  }
  return results;
}

// src/build-selection.ts
var import_node_child_process2 = require("node:child_process");
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var releasePattern = /^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
var boardPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function git(firmware, args) {
  try {
    return (0, import_node_child_process2.execFileSync)("git", ["-C", (0, import_node_path2.resolve)(firmware), ...args], {
      encoding: "utf8",
      timeout: 1e4,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read firmware repository at ${(0, import_node_path2.resolve)(firmware)}. Ensure Git is installed and the checkout/tag is available locally. ${detail}`, { cause: error });
  }
}
function listReleases(firmware) {
  if (git(firmware, ["rev-parse", "--is-inside-work-tree", "--show-prefix"]).trim() !== "true") {
    throw new Error("The firmware directory must be the repository root of a local Git checkout.");
  }
  return git(firmware, ["for-each-ref", "--format=%(refname:strip=2)", "refs/tags"]).split(/\r?\n/).filter((tag) => releasePattern.test(tag)).sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
}
function releaseCommit(firmware, release) {
  if (!releasePattern.test(release)) throw new Error("Select an exact release tag such as v0.7.10.");
  if (!listReleases(firmware).includes(release)) {
    throw new Error(`Release ${release} is not available locally. Fetch the desired tag into the firmware checkout first.`);
  }
  const commit = git(firmware, ["rev-parse", "--verify", `refs/tags/${release}^{commit}`]).trim();
  const root = git(firmware, ["ls-tree", "-z", commit, "--", "CMakeLists.txt"]);
  if (!/^100(?:644|755) blob [a-f0-9]+\tCMakeLists\.txt\0$/.test(root)) {
    throw new Error(`Release ${release} does not contain a regular root CMakeLists.txt.`);
  }
  return commit;
}
function externalDirectory(configs) {
  try {
    const directory = (0, import_node_fs2.realpathSync)((0, import_node_path2.resolve)(configs));
    if (!(0, import_node_fs2.lstatSync)(directory).isDirectory()) throw new Error("Not a directory");
    return directory;
  } catch (error) {
    throw new Error(`Cannot read external config directory: ${(0, import_node_path2.resolve)(configs)}`, { cause: error });
  }
}
function discoverBoards(firmware, commit, configs) {
  let boards;
  if (configs !== void 0) {
    const directory = externalDirectory(configs);
    try {
      boards = (0, import_node_fs2.readdirSync)(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && boardPattern.test(entry.name)).filter((entry) => {
        try {
          return (0, import_node_fs2.lstatSync)((0, import_node_path2.join)(directory, entry.name, "BoardConfig.h")).isFile();
        } catch {
          return false;
        }
      }).map((entry) => entry.name);
    } catch (error) {
      throw new Error(`Cannot read external config directory: ${directory}`, { cause: error });
    }
  } else {
    boards = git(firmware, ["ls-tree", "-r", "-z", commit, "--", "configs"]).split("\0").flatMap((record) => {
      const match = /^100(?:644|755) blob [a-f0-9]+\tconfigs\/([^/]+)\/BoardConfig\.h$/.exec(record);
      const board = match?.[1];
      return board && boardPattern.test(board) ? [board] : [];
    });
  }
  return boards.sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}
function listBoards(firmware, release, configs) {
  return discoverBoards(firmware, releaseCommit(firmware, release), configs);
}
function selectBuild(firmware, release, board, configs) {
  if (!boardPattern.test(board)) throw new Error("Select a board name, not a path.");
  const commit = releaseCommit(firmware, release);
  const boards = discoverBoards(firmware, commit, configs);
  if (!boards.includes(board)) {
    throw new Error(`Unknown board ${board} in ${configs === void 0 ? `release ${release}` : "external configs"}. Use list-boards to see available names.`);
  }
  return {
    firmware: (0, import_node_path2.resolve)(firmware),
    release,
    commit,
    board,
    configSource: configs === void 0 ? "firmware" : "external",
    configPath: configs === void 0 ? `configs/${board}` : (0, import_node_path2.join)(externalDirectory(configs), board)
  };
}

// src/orchestrator.ts
var operations = ["check-prerequisites", "list-releases", "list-boards", "select-build", "build"];
function required(options, name) {
  const value = options[name];
  if (!value?.trim()) throw new Error(`The ${name} input is required for ${options.operation}.`);
  return value;
}
function run(options) {
  if (options.operation === "check-prerequisites" || options.operation === "build") {
    const results = checkPrerequisites(options);
    const failed = results.filter((result) => result.status !== "available");
    if (failed.length > 0) {
      throw new Error(`Prerequisite check failed: ${failed.map((result) => result.name).join(", ")}. See the report for installation guidance.`);
    }
    if (options.operation === "check-prerequisites") return {};
  }
  const firmware = required(options, "firmware");
  if (options.operation === "list-releases") {
    const releases = listReleases(firmware);
    for (const release2 of releases) options.log(release2);
    return { releases };
  }
  const release = required(options, "release");
  if (options.configs !== void 0 && !options.configs.trim()) throw new Error("The configs input must be a non-empty directory path.");
  if (options.operation === "list-boards") {
    const boards = listBoards(firmware, release, options.configs);
    for (const board of boards) options.log(board);
    return { boards };
  }
  const selection = selectBuild(firmware, release, required(options, "board"), options.configs);
  options.log(`Release: ${selection.release}
Firmware commit: ${selection.commit}
Board: ${selection.board}
Config source: ${selection.configSource}
Config path: ${selection.configPath}`);
  if (options.operation === "build") {
    throw new Error("Firmware build orchestration is not implemented yet. Prerequisites passed; no firmware was built.");
  }
  options.log("Selection validated; no firmware was built.");
  return { selection };
}

// src/cli.ts
try {
  const { values } = (0, import_node_util.parseArgs)({
    options: {
      "check-prerequisites": { type: "boolean" },
      "list-releases": { type: "boolean" },
      "list-boards": { type: "boolean" },
      "select-build": { type: "boolean" },
      build: { type: "boolean" },
      firmware: { type: "string" },
      release: { type: "string" },
      board: { type: "string" },
      configs: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });
  const selected = operations.filter((operation2) => values[operation2]);
  if (selected.length > 1) {
    throw new Error("Choose one operation. Builds always check prerequisites.");
  }
  const operation = selected[0];
  if (!values.help && operation === void 0 && [values.firmware, values.release, values.board, values.configs].some((value) => value !== void 0)) {
    throw new Error("Choose an operation, such as --select-build or --list-boards.");
  }
  if (values.help || operation === void 0) {
    console.log(`GPBuilder

Usage: node dist/cli.cjs <operation> [options]

--check-prerequisites  Report host tools without installing anything.
--list-releases        List local release tags; requires --firmware.
--list-boards          List boards; requires --firmware and --release.
--select-build         Validate --firmware, --release, and --board without building.
--build                Check prerequisites and selection; compilation is not implemented.
--help                Show this help.

--firmware <path>      Local GP2040-CE Git checkout.
--release <tag>        Exact local release tag (for example v0.7.10).
--board <name>         Exact, case-sensitive board directory name.
--configs <path>       External directory containing board folders; replaces built-in configs.`);
  } else {
    run({
      mode: "local",
      log: console.log,
      operation,
      ...values.firmware !== void 0 && { firmware: values.firmware },
      ...values.release !== void 0 && { release: values.release },
      ...values.board !== void 0 && { board: values.board },
      ...values.configs !== void 0 && { configs: values.configs }
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
