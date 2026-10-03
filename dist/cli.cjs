"use strict";

// src/cli.ts
var import_node_util = require("node:util");

// src/prerequisites.ts
var import_node_child_process = require("node:child_process");
var import_node_fs2 = require("node:fs");
var import_node_os = require("node:os");
var import_node_path2 = require("node:path");

// src/pico-prebuilt-tools.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var MINIMUM_PREBUILT_PICOTOOL = "2.3.0";
var compareNumeric = (left, right) => left.replace(/^v/, "").localeCompare(right.replace(/^v/, ""), "en", { numeric: true });
function versionDirectories(root) {
  try {
    return (0, import_node_fs.readdirSync)(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^v?\d/.test(entry.name)).map((entry) => entry.name).sort((left, right) => compareNumeric(right, left));
  } catch {
    return [];
  }
}
function isFile(path) {
  try {
    return (0, import_node_fs.statSync)(path).isFile();
  } catch {
    return false;
  }
}
function findPicoPrebuiltTools(picoRoot, sdkTag) {
  const pioasmRoot = (0, import_node_path.join)(picoRoot, "tools");
  const pioasmVersion = versionDirectories(pioasmRoot).filter((version) => sdkTag === void 0 || version.replace(/^v/, "") === sdkTag.replace(/^v/, "")).find((version) => isFile((0, import_node_path.join)(pioasmRoot, version, "pioasm", "pioasmConfig.cmake")));
  const picotoolRoot = (0, import_node_path.join)(picoRoot, "picotool");
  const picotoolVersion = versionDirectories(picotoolRoot).filter((version) => compareNumeric(version, MINIMUM_PREBUILT_PICOTOOL) >= 0).find((version) => isFile((0, import_node_path.join)(picotoolRoot, version, "picotool", "picotoolConfig.cmake")));
  if (!pioasmVersion || !picotoolVersion) return void 0;
  return {
    pioasmVersion,
    pioasmDir: (0, import_node_path.join)(pioasmRoot, pioasmVersion, "pioasm"),
    picotoolVersion,
    picotoolDir: (0, import_node_path.join)(picotoolRoot, picotoolVersion, "picotool")
  };
}

// src/prerequisites.ts
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
      ubuntu = /^ID=(?:ubuntu|"ubuntu")$/m.test((0, import_node_fs2.readFileSync)("/etc/os-release", "utf8"));
    } catch {
      ubuntu = false;
    }
  }
  return {
    platform: process.platform,
    ubuntu,
    githubActions: process.env.GITHUB_ACTIONS === "true",
    picoRoot: (0, import_node_path2.join)((0, import_node_os.homedir)(), ".pico-sdk"),
    arch: process.arch,
    ...process.env.CXX ? { cxx: process.env.CXX } : {},
    ...process.platform === "win32" && process.env["ProgramFiles(x86)"] ? {
      vswhere: (0, import_node_path2.join)(process.env["ProgramFiles(x86)"], "Microsoft Visual Studio", "Installer", "vswhere.exe")
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
      const root = (0, import_node_path2.join)(installation.installationPath, "VC", "Tools", "MSVC");
      try {
        const versions = (0, import_node_fs2.readdirSync)(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
        for (const version of versions) {
          const compiler = (0, import_node_path2.join)(root, version, "bin", `Host${architecture}`, architecture, "cl.exe");
          try {
            if ((0, import_node_fs2.statSync)(compiler).isFile()) compilers.push(compiler);
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
    if (located.status === 0 && !located.error && (0, import_node_path2.isAbsolute)(located.stdout.trim())) {
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
  const prebuilt = host.picoRoot ? findPicoPrebuiltTools(host.picoRoot) : void 0;
  if (prebuilt) {
    return {
      name: requirement.name,
      status: "available",
      detail: `[Pico extension] prebuilt pioasm ${prebuilt.pioasmVersion} and picotool ${prebuilt.picotoolVersion}; host compiler not required`,
      guidance: requirement.guidance
    };
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
  const root = (0, import_node_path2.join)(host.picoRoot, layout.directory);
  try {
    const versions = (0, import_node_fs2.readdirSync)(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^v?\d/.test(entry.name)).map((entry) => entry.name).sort((left, right) => right.replace(/^v/, "").localeCompare(left.replace(/^v/, ""), "en", { numeric: true }));
    const executable = `${command}${host.platform === "win32" ? ".exe" : ""}`;
    return versions.flatMap((version) => layout.paths.map((parts) => (0, import_node_path2.join)(root, version, ...parts, executable))).filter((candidate) => {
      try {
        return (0, import_node_fs2.statSync)(candidate).isFile();
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
      candidates = [(0, import_node_path2.join)(armDirectory, `${requirement.command}${host.platform === "win32" ? ".exe" : ""}`)];
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
        if (requirement.command === "arm-none-eabi-gcc" && (0, import_node_path2.isAbsolute)(candidate)) {
          armDirectory = (0, import_node_path2.dirname)(candidate);
        }
        break;
      }
    }
    const status = available ? "available" : result.missing ? "missing" : "unusable";
    const detail = (result.error ?? output.split(/\r?\n/)[0] ?? "").trim();
    return {
      name: requirement.name,
      status,
      detail: `${(0, import_node_path2.isAbsolute)(command) ? "[Pico extension] " : ""}${command}: ${detail || `exit ${String(result.status)}`}`,
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
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");
var releasePattern = /^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
var boardPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function git(firmware, args) {
  try {
    return (0, import_node_child_process2.execFileSync)("git", ["-C", (0, import_node_path3.resolve)(firmware), ...args], {
      encoding: "utf8",
      timeout: 1e4,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read firmware repository at ${(0, import_node_path3.resolve)(firmware)}. Ensure Git is installed and the checkout/tag is available locally. ${detail}`, { cause: error });
  }
}
function listReleases(firmware) {
  if (git(firmware, ["rev-parse", "--is-inside-work-tree", "--show-prefix"]).trim() !== "true") {
    throw new Error("The firmware directory must be the repository root of a local Git checkout.");
  }
  return git(firmware, ["for-each-ref", "--format=%(refname:strip=2)", "refs/tags"]).split(/\r?\n/).filter((tag) => releasePattern.test(tag)).sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
}
function targetCommit(firmware, target) {
  let ref;
  if (target === "main") {
    ref = "refs/heads/main";
    try {
      git(firmware, ["show-ref", "--verify", "--quiet", ref]);
    } catch {
      throw new Error("Firmware target main requires local refs/heads/main. Fetch or create that branch in the firmware checkout first.");
    }
  } else {
    if (!releasePattern.test(target)) throw new Error("Select an exact release tag such as v0.7.10, or the literal main.");
    if (!listReleases(firmware).includes(target)) {
      throw new Error(`Release ${target} is not available locally. Fetch the desired tag into the firmware checkout first.`);
    }
    ref = `refs/tags/${target}`;
  }
  const commit = git(firmware, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  const root = git(firmware, ["ls-tree", "-z", commit, "--", "CMakeLists.txt"]);
  if (!/^100(?:644|755) blob [a-f0-9]+\tCMakeLists\.txt\0$/.test(root)) {
    throw new Error(`Firmware target ${target} does not contain a regular root CMakeLists.txt.`);
  }
  return commit;
}
function externalDirectory(configs) {
  try {
    const directory = (0, import_node_fs3.realpathSync)((0, import_node_path3.resolve)(configs));
    if (!(0, import_node_fs3.lstatSync)(directory).isDirectory()) throw new Error("Not a directory");
    return directory;
  } catch (error) {
    throw new Error(`Cannot read external config directory: ${(0, import_node_path3.resolve)(configs)}`, { cause: error });
  }
}
function discoverBoards(firmware, commit, configs) {
  let boards;
  if (configs !== void 0) {
    const directory = externalDirectory(configs);
    try {
      boards = (0, import_node_fs3.readdirSync)(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && boardPattern.test(entry.name)).filter((entry) => {
        try {
          return (0, import_node_fs3.lstatSync)((0, import_node_path3.join)(directory, entry.name, "BoardConfig.h")).isFile();
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
  return discoverBoards(firmware, targetCommit(firmware, release), configs);
}
function selectBuild(firmware, release, board, configs) {
  if (!boardPattern.test(board)) throw new Error("Select a board name, not a path.");
  const commit = targetCommit(firmware, release);
  const boards = discoverBoards(firmware, commit, configs);
  if (!boards.includes(board)) {
    throw new Error(`Unknown board ${board} in ${configs === void 0 ? `release ${release}` : "external configs"}. Use list-boards to see available names.`);
  }
  return {
    firmware: (0, import_node_path3.resolve)(firmware),
    release,
    commit,
    board,
    configSource: configs === void 0 ? "firmware" : "external",
    configPath: configs === void 0 ? `configs/${board}` : (0, import_node_path3.join)(externalDirectory(configs), board)
  };
}

// src/firmware-build.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs6 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path6 = require("node:path");

// src/artifact-publisher.ts
var import_node_crypto = require("node:crypto");
var import_node_fs4 = require("node:fs");
var import_node_path4 = require("node:path");

// src/uf2.ts
var blockSize = 512;
var magicStart0 = 171066965;
var magicStart1 = 2656915799;
var magicEnd = 179400496;
var familyIdFlag = 8192;
var rp2040FamilyId = 3834380118;
var picoFlashStart = 268435456;
var picoFlashEnd = 270532608;
var maxPayloadSize = 476;
function validateUf2(data) {
  if (data.byteLength === 0 || data.byteLength % blockSize !== 0) {
    throw new Error("UF2 must contain complete 512-byte blocks.");
  }
  const blockCount = data.byteLength / blockSize;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const seenBlocks = /* @__PURE__ */ new Set();
  const ranges = [];
  let familyId;
  let flags;
  for (let index = 0; index < blockCount; index++) {
    const offset = index * blockSize;
    if (view.getUint32(offset, true) !== magicStart0 || view.getUint32(offset + 4, true) !== magicStart1 || view.getUint32(offset + 508, true) !== magicEnd) {
      throw new Error(`UF2 block ${index} has invalid magic values.`);
    }
    const blockFlags = view.getUint32(offset + 8, true);
    if (blockFlags !== familyIdFlag) throw new Error(`UF2 block ${index} has unsupported flags.`);
    if (flags !== void 0 && blockFlags !== flags) throw new Error("UF2 blocks have inconsistent flags.");
    flags = blockFlags;
    const address = view.getUint32(offset + 12, true);
    const payloadSize = view.getUint32(offset + 16, true);
    const blockNumber = view.getUint32(offset + 20, true);
    const declaredCount = view.getUint32(offset + 24, true);
    const blockFamilyId = view.getUint32(offset + 28, true);
    if (blockFamilyId !== rp2040FamilyId) throw new Error(`UF2 block ${index} is not for the RP2040 family.`);
    if (familyId !== void 0 && blockFamilyId !== familyId) throw new Error("UF2 blocks have inconsistent family IDs.");
    familyId = blockFamilyId;
    if (declaredCount !== blockCount) throw new Error(`UF2 block ${index} declares an inconsistent block count.`);
    if (blockNumber >= blockCount || seenBlocks.has(blockNumber)) throw new Error("UF2 block numbers must be unique and cover the declared block count.");
    seenBlocks.add(blockNumber);
    if (payloadSize === 0 || payloadSize > maxPayloadSize || payloadSize % 4 !== 0) {
      throw new Error(`UF2 block ${index} has an invalid payload size.`);
    }
    if (address % 4 !== 0) throw new Error(`UF2 block ${index} has a target address that is not aligned.`);
    const end = address + payloadSize;
    if (address < picoFlashStart || end > picoFlashEnd) throw new Error(`UF2 block ${index} is outside the RP2040 Pico flash range.`);
    ranges.push({ start: address, end });
  }
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index].start < ranges[index - 1].end) throw new Error("UF2 payload address ranges overlap.");
  }
  if (ranges[0].start !== picoFlashStart) throw new Error("UF2 does not include the RP2040 Pico bootable flash region.");
  return {
    blockCount,
    addressStart: ranges[0].start,
    addressEnd: ranges.at(-1).end,
    familyId
  };
}

// src/artifact-publisher.ts
function artifactLayout(options) {
  if (!/^[A-Za-z0-9_-]+$/.test(options.board)) {
    throw new Error("Artifact board name contains unsupported characters.");
  }
  if (options.buildType !== "release") {
    throw new Error("Artifact publication currently supports release builds only.");
  }
  const { board, buildType } = options;
  if (options.release === "v0.7.12") {
    return {
      segments: [board, "v0.7.12", buildType],
      filename: `GP2040-CE_0.7.12_${board}.uf2`,
      requested: { release: options.release, board, buildType }
    };
  }
  if (options.release === "main") {
    const commit = options.commit;
    if (commit === void 0 || !/^[0-9a-f]{40}$/.test(commit)) {
      throw new Error("Publishing a main build requires the full 40-character lowercase firmware commit.");
    }
    return {
      segments: [board, "main", commit, buildType],
      filename: `GP2040-CE_main_${commit}_${board}.uf2`,
      requested: { release: "main", commit, board, buildType }
    };
  }
  throw new Error("Artifact publication currently supports v0.7.12 and main builds only.");
}
function publishArtifact(options) {
  if (!/^[A-Za-z0-9-]+$/.test(options.runId)) throw new Error("Artifact run ID contains unsupported characters.");
  const layout = artifactLayout(options);
  const source = (0, import_node_path4.resolve)(options.source);
  const sourceStats = (0, import_node_fs4.lstatSync)(source);
  if (!sourceStats.isFile()) throw new Error("The UF2 source must be a regular file.");
  const input = (0, import_node_fs4.readFileSync)(source);
  const validation = validateUf2(input);
  const parent = (0, import_node_path4.resolve)(options.workingDirectory, "artifacts", ...layout.segments);
  (0, import_node_fs4.mkdirSync)(parent, { recursive: true });
  const destination = (0, import_node_path4.join)(parent, options.runId);
  if ((0, import_node_fs4.existsSync)(destination)) throw new Error(`Artifact run ${options.runId} already exists.`);
  const staging = (0, import_node_fs4.mkdtempSync)((0, import_node_path4.join)(parent, `.tmp-${options.runId}-`));
  const { filename } = layout;
  const stagedUf2 = (0, import_node_path4.join)(staging, filename);
  const stagedMetadata = (0, import_node_path4.join)(staging, "build.json");
  const digest = (0, import_node_crypto.createHash)("sha256").update(input).digest("hex");
  try {
    (0, import_node_fs4.copyFileSync)(source, stagedUf2);
    const published = (0, import_node_fs4.readFileSync)(stagedUf2);
    const publishedDigest = (0, import_node_crypto.createHash)("sha256").update(published).digest("hex");
    if (published.length !== input.length || publishedDigest !== digest) {
      throw new Error("Published UF2 size or SHA-256 does not match the validated build output.");
    }
    (0, import_node_fs4.writeFileSync)(stagedMetadata, `${JSON.stringify({
      ...options.metadata,
      requested: layout.requested,
      artifact: {
        filename,
        byteSize: published.length,
        sha256: publishedDigest,
        validation: { ...validation, flashStartHex: `0x${validation.addressStart.toString(16)}`, flashEndHex: `0x${validation.addressEnd.toString(16)}` }
      }
    }, null, 2)}
`, { flag: "wx" });
    (0, import_node_fs4.renameSync)(staging, destination);
  } catch (error) {
    (0, import_node_fs4.rmSync)(staging, { recursive: true, force: true });
    throw error;
  }
  const path = (0, import_node_path4.join)(destination, filename);
  const metadataPath = (0, import_node_path4.join)(destination, "build.json");
  const finalStats = (0, import_node_fs4.lstatSync)(path);
  if (!finalStats.isFile()) throw new Error("Published UF2 is not a regular file.");
  const finalBytes = (0, import_node_fs4.readFileSync)(path);
  const finalDigest = (0, import_node_crypto.createHash)("sha256").update(finalBytes).digest("hex");
  if (finalStats.size !== input.length || finalDigest !== digest) throw new Error("Published UF2 verification failed.");
  return { path: (0, import_node_path4.resolve)(path), metadataPath: (0, import_node_path4.resolve)(metadataPath), sha256: finalDigest, byteSize: finalStats.size };
}

// src/firmware-source.ts
var import_node_fs5 = require("node:fs");
var import_node_path5 = require("node:path");

// src/process-runner.ts
var import_node_child_process3 = require("node:child_process");
var maxOutputBytes = 1024 * 1024;
function appendBounded(current, chunk) {
  const next = current + chunk.toString("utf8");
  return Buffer.byteLength(next) <= maxOutputBytes ? next : Buffer.from(next).subarray(-maxOutputBytes).toString("utf8");
}
function terminateTree(pid) {
  if (process.platform === "win32") {
    const killer = (0, import_node_child_process3.spawn)("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => {
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      return;
    }
    const forceKill = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        return;
      }
    }, 2e3);
    forceKill.unref();
  }
}
var executeProcess = (command, args, options) => new Promise((resolve5, reject) => {
  const child = (0, import_node_child_process3.spawn)(command, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    windowsVerbatimArguments: process.platform === "win32" && command.toLowerCase() === "cmd.exe",
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.pid !== void 0) terminateTree(child.pid);
  }, options.timeoutMs);
  const finishError = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    reject(error);
  };
  child.stdout.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk);
  });
  child.on("error", (error) => finishError(new Error(`${options.stage}: could not start ${command}: ${error.message}`, { cause: error })));
  child.on("close", (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (timedOut) {
      reject(new Error(`${options.stage} timed out after ${Math.ceil(options.timeoutMs / 6e4)} minutes.
${stderr || stdout}`));
    } else if (code !== 0) {
      reject(new Error(`${options.stage} failed with exit ${String(code)}${signal ? ` (${signal})` : ""}.
${stderr || stdout}`));
    } else {
      resolve5({ stdout, stderr });
    }
  });
});

// src/firmware-source.ts
var upstreamRepository = "https://github.com/OpenStickCommunity/GP2040-CE.git";
var taggedRelease = "v0.7.12";
var mainTarget = "main";
var excludedCopySegments = /* @__PURE__ */ new Set(["node_modules", "build"]);
var byteExactGitConfig = ["-c", "core.autocrlf=false"];
async function git2(execute, directory, args, timeoutMs = 6e5) {
  const result = await execute("git", [...byteExactGitConfig, "-C", directory, ...args], { cwd: directory, timeoutMs, stage: `Git ${args[0]}` });
  return result.stdout.trim();
}
async function checkoutVerified(execute, directory, commit, release) {
  await git2(execute, directory, ["checkout", "--quiet", "--detach", commit], 1e4);
  if (await git2(execute, directory, ["rev-parse", "HEAD"], 1e4) !== commit) {
    throw new Error(`Materialized firmware does not match ${release}.`);
  }
}
async function requireRootCmake(execute, directory, release) {
  const rootCmake = await git2(execute, directory, ["ls-tree", "-z", "HEAD", "--", "CMakeLists.txt"], 1e4);
  if (!/^100(?:644|755) blob [a-f0-9]+\tCMakeLists\.txt\0$/.test(rootCmake)) {
    throw new Error(`Firmware ${release} does not contain a regular root CMakeLists.txt.`);
  }
}
function copyWorkingTree(source, directory) {
  (0, import_node_fs5.cpSync)(source, directory, {
    recursive: true,
    filter: (path) => !(0, import_node_path5.relative)(source, path).split(import_node_path5.sep).some((segment) => excludedCopySegments.has(segment))
  });
}
async function materializeLocalMain(execute, source, directory) {
  copyWorkingTree(source, directory);
  const commit = await git2(execute, directory, ["rev-parse", "--verify", "HEAD^{commit}"], 1e4);
  await git2(execute, directory, ["submodule", "update", "--init", "--recursive"]);
  const dirty = await git2(execute, directory, ["status", "--porcelain"], 6e4) !== "";
  return { directory, commit, tag: mainTarget, dirty };
}
async function materializeUpstreamMain(execute, directory) {
  await execute("git", [...byteExactGitConfig, "init", "--quiet", directory], { timeoutMs: 1e4, stage: "Initialize firmware source" });
  await git2(execute, directory, ["remote", "add", "origin", upstreamRepository], 1e4);
  await git2(execute, directory, ["fetch", "--filter=blob:none", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  const commit = await git2(execute, directory, ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"], 1e4);
  await checkoutVerified(execute, directory, commit, mainTarget);
  await requireRootCmake(execute, directory, mainTarget);
  await git2(execute, directory, ["submodule", "update", "--init", "--recursive"]);
  return { directory, commit, tag: mainTarget, dirty: false };
}
async function materializeTag(execute, source, directory, release) {
  if (source !== void 0) {
    await execute("git", [...byteExactGitConfig, "clone", "--no-hardlinks", "--no-checkout", "--", source, directory], {
      timeoutMs: 6e5,
      stage: "Clone local firmware source"
    });
  } else {
    await execute("git", [...byteExactGitConfig, "init", "--quiet", directory], { timeoutMs: 1e4, stage: "Initialize firmware source" });
    await git2(execute, directory, ["remote", "add", "origin", upstreamRepository], 1e4);
    await git2(execute, directory, ["fetch", "--depth=1", "origin", `refs/tags/${release}:refs/tags/${release}`]);
  }
  const commit = await git2(execute, directory, ["rev-parse", "--verify", `refs/tags/${release}^{commit}`], 1e4);
  await checkoutVerified(execute, directory, commit, release);
  await requireRootCmake(execute, directory, release);
  await git2(execute, directory, ["submodule", "update", "--init", "--recursive"]);
  if (await git2(execute, directory, ["status", "--porcelain", "--untracked-files=all"], 1e4)) {
    throw new Error(`Materialized firmware checkout for ${release} is not clean.`);
  }
  return { directory, commit, tag: release, dirty: false };
}
async function materializeFirmware(options) {
  const { release } = options;
  if (release !== taggedRelease && release !== mainTarget) {
    throw new Error("This build currently supports the exact tag v0.7.12 or main only.");
  }
  const execute = options.execute ?? executeProcess;
  const directory = (0, import_node_path5.resolve)(options.destination);
  if ((0, import_node_fs5.existsSync)(directory)) throw new Error(`Firmware destination already exists: ${directory}`);
  const source = options.source === void 0 ? void 0 : (0, import_node_path5.resolve)(options.source);
  if (release === mainTarget) {
    return source === void 0 ? materializeUpstreamMain(execute, directory) : materializeLocalMain(execute, source, directory);
  }
  return materializeTag(execute, source, directory, release);
}
function applyConfigsOverlay(firmwareDirectory, configsDirectory, board) {
  const overlaySource = (0, import_node_path5.resolve)(configsDirectory, board);
  if (!(0, import_node_fs5.existsSync)((0, import_node_path5.join)(overlaySource, "BoardConfig.h"))) {
    throw new Error(`Configs folder must contain ${board}/BoardConfig.h: ${overlaySource}`);
  }
  const target = (0, import_node_path5.resolve)(firmwareDirectory, "configs", board);
  (0, import_node_fs5.rmSync)(target, { recursive: true, force: true });
  (0, import_node_fs5.mkdirSync)((0, import_node_path5.dirname)(target), { recursive: true });
  (0, import_node_fs5.cpSync)(overlaySource, target, { recursive: true });
  return target;
}

// src/firmware-build.ts
var taggedRelease2 = "v0.7.12";
var cmakeVersion = "4.3.4";
var ninjaVersion = "1.13.2";
var armToolchainVersion = "15_2_Rel1";
var armCompilerVersion = "15.2.1";
var toolProfiles = {
  [taggedRelease2]: {
    sdkTag: "2.1.1",
    sdkCommit: "bddd20f928ce76142793bef434d4f75f4af6e433",
    picotool: "2.1.1",
    firmwareCommit: "0014e4ae2a312332e2582f6708dcc7d6bec5de8c"
  },
  main: { sdkTag: "2.3.1", picotool: "2.3.1" }
};
function selectToolProfile(release) {
  const profile = Object.hasOwn(toolProfiles, release) ? toolProfiles[release] : void 0;
  if (!profile) throw new Error(`Firmware builds support only release v0.7.12 or main; received ${release}.`);
  return profile;
}
function versionParts(version) {
  return version.split(/[._]|Rel/).filter((part) => part !== "").map((part) => Number.parseInt(part, 10) || 0);
}
function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}
function parseCmakeMinimums(text) {
  const setting = (name) => new RegExp(`^\\s*set\\(\\s*${name}\\s+([^\\s)]+)\\s*\\)`, "im").exec(text)?.[1];
  const guard = /PICO_SDK_VERSION_STRING\s+VERSION_LESS\s+"([^"]+)"/i.exec(text)?.[1];
  const sdkCandidates = [setting("sdkVersion"), guard].filter((value) => value !== void 0);
  const minimums = {};
  if (sdkCandidates.length > 0) {
    minimums.sdk = sdkCandidates.reduce((highest, value) => compareVersions(value, highest) > 0 ? value : highest);
  }
  const toolchain = setting("toolchainVersion");
  if (toolchain !== void 0) minimums.toolchain = toolchain;
  const picotool = setting("picotoolVersion");
  if (picotool !== void 0) minimums.picotool = picotool;
  return minimums;
}
function checkMinimums(minimums, profile) {
  const requirements2 = [
    ["Pico SDK", minimums.sdk, profile.sdkTag],
    ["Arm GNU toolchain", minimums.toolchain, armToolchainVersion],
    ["picotool", minimums.picotool, profile.picotool]
  ];
  for (const [name, required2, pinned] of requirements2) {
    if (required2 === void 0) {
      if (name !== "Pico SDK") continue;
      throw new Error(`The ${name} minimum version is not declared in the firmware CMakeLists.txt; refusing to guess.`);
    }
    if (compareVersions(required2, pinned) > 0) {
      throw new Error(`The firmware requires ${name} ${required2}, but this build profile pinned ${pinned}.`);
    }
  }
}
function firmwareOutputName(describe, board) {
  const version = /^v(\d+\.\d+\.\d+)/.exec(describe)?.[1] ?? "0.0.0";
  return `GP2040-CE_${version}_${board}`;
}
function cmakeSetValue(cmakeText, name) {
  for (const rawLine of cmakeText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "");
    const match = new RegExp(`^\\s*set\\s*\\(\\s*${name}\\s+("([^"]*)"|[^\\s)]+)`, "i").exec(line);
    if (match) return match[2] ?? match[1];
  }
  return void 0;
}
function resolveBoardPlatform(board, boardCmakeText) {
  const picoBoard = boardCmakeText && cmakeSetValue(boardCmakeText, "PICO_BOARD") || "pico";
  const picoPlatform = boardCmakeText && cmakeSetValue(boardCmakeText, "PICO_PLATFORM") || "rp2040";
  if (picoPlatform !== "rp2040") {
    throw new Error(`Board ${board} targets ${picoPlatform}; GPBuilder currently supports only RP2040 boards.`);
  }
  return { picoBoard, picoPlatform };
}
function nanopbPipConstraint(requirementsText) {
  if (requirementsText !== void 0 && /^\s*setuptools\b/im.test(requirementsText)) {
    return void 0;
  }
  return "setuptools<81\n";
}
function firmwareConfigureArgs(input) {
  const hostTools = input.prebuilt === void 0 ? [`-DPICOTOOL_FETCH_FROM_GIT_PATH=${input.toolsDirectory}`] : [`-Dpioasm_DIR=${input.prebuilt.pioasmDir}`, `-Dpicotool_DIR=${input.prebuilt.picotoolDir}`];
  return [
    "-S",
    input.sourceDirectory,
    "-B",
    input.buildDirectory,
    "-G",
    "Ninja",
    `-DCMAKE_MAKE_PROGRAM=${input.ninja}`,
    "-DCMAKE_BUILD_TYPE=Release",
    `-DGP2040_BOARDCONFIG=${input.board}`,
    `-DPICO_BOARD=${input.picoBoard}`,
    `-DPICO_PLATFORM=${input.picoPlatform}`,
    `-DPICO_SDK_PATH=${input.sdkDirectory}`,
    `-DPython3_EXECUTABLE=${input.python}`,
    "-DSKIP_SUBMODULES=TRUE",
    "-DSKIP_WEBBUILD=TRUE",
    ...hostTools
  ];
}
var pythonExecutableProbe = ["-c", "import sys; print(sys.executable)"];
function hostProfile(platform) {
  if (platform === "win32") {
    return {
      label: "Windows x64",
      executable: (name) => `${name}.exe`,
      pythonLocator: { command: "py.exe", args: ["-3.13", ...pythonExecutableProbe] },
      venvPython: (directory) => (0, import_node_path6.join)(directory, "venv", "Scripts", "python.exe"),
      npm: (args) => ({ command: "cmd.exe", args: ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`] }),
      pathDelimiter: ";",
      hostCompiler: "visual-studio"
    };
  }
  if (platform === "linux") {
    return {
      label: "Ubuntu x64",
      executable: (name) => name,
      pythonLocator: { command: "python3.13", args: [...pythonExecutableProbe] },
      venvPython: (directory) => (0, import_node_path6.join)(directory, "venv", "bin", "python"),
      npm: (args) => ({ command: "npm", args: [...args] }),
      pathDelimiter: ":",
      hostCompiler: "path"
    };
  }
  throw new Error(`Firmware builds are only qualified on Windows x64 and Ubuntu x64; detected ${platform}.`);
}
function validateFirmwareBuildRequest(options) {
  selectToolProfile(options.release);
  hostProfile(options.platform ?? process.platform);
  if (options.firmware !== void 0 && !isDirectory(options.firmware)) {
    throw new Error(`Firmware source folder was not found: ${options.firmware}`);
  }
  if (options.configs !== void 0 && !isDirectory(options.configs)) {
    throw new Error(`Configs folder was not found: ${options.configs}`);
  }
}
function isDirectory(path) {
  try {
    return (0, import_node_fs6.statSync)(path).isDirectory();
  } catch {
    return false;
  }
}
function requireFile(path, description) {
  if (!(0, import_node_fs6.existsSync)(path) || !(0, import_node_fs6.lstatSync)(path).isFile()) throw new Error(`${description} was not found: ${path}`);
  return path;
}
async function runProcess(execute, command, args, stage, timeoutMs, options = {}) {
  return execute(command, args, { ...options, timeoutMs, stage });
}
async function discoverToolchain(options, execute, sdkTag) {
  const picoRoot = (0, import_node_path6.resolve)(options.picoRoot ?? (0, import_node_path6.join)((0, import_node_os2.homedir)(), ".pico-sdk"));
  const host = hostProfile(options.platform ?? process.platform);
  const prebuilt = findPicoPrebuiltTools(picoRoot, sdkTag);
  const cmake = requireFile((0, import_node_path6.join)(picoRoot, "cmake", `v${cmakeVersion}`, "bin", host.executable("cmake")), `CMake ${cmakeVersion}`);
  const ninja = requireFile((0, import_node_path6.join)(picoRoot, "ninja", `v${ninjaVersion}`, host.executable("ninja")), `Ninja ${ninjaVersion}`);
  const armBin = (0, import_node_path6.join)(picoRoot, "toolchain", armToolchainVersion, "bin");
  const gcc = requireFile((0, import_node_path6.join)(armBin, host.executable("arm-none-eabi-gcc")), `Arm GNU ${armToolchainVersion} GCC`);
  const gxx = requireFile((0, import_node_path6.join)(armBin, host.executable("arm-none-eabi-g++")), `Arm GNU ${armToolchainVersion} G++`);
  const gccVersion = await runProcess(execute, gcc, ["--version"], "Check Arm GCC version", 1e4);
  const gxxVersion = await runProcess(execute, gxx, ["--version"], "Check Arm G++ version", 1e4);
  if (!gccVersion.stdout.includes(armCompilerVersion) || !gxxVersion.stdout.includes(armCompilerVersion)) {
    throw new Error(`The qualified Arm toolchain must be ${armCompilerVersion}; detected ${gccVersion.stdout.split(/\r?\n/)[0]} / ${gxxVersion.stdout.split(/\r?\n/)[0]}.`);
  }
  const libraries = [[gcc, "libc.a"], [gxx, "libstdc++.a"]];
  for (const [compiler, library] of libraries) {
    const result = await runProcess(execute, compiler, [`-print-file-name=${library}`], `Check Arm ${library}`, 1e4);
    const path = result.stdout.trim();
    if (path === library || !(0, import_node_fs6.existsSync)(path)) throw new Error(`Arm library ${library} was not found in the selected toolchain.`);
  }
  const cmakeResult = await runProcess(execute, cmake, ["--version"], "Check CMake version", 1e4);
  const ninjaResult = await runProcess(execute, ninja, ["--version"], "Check Ninja version", 1e4);
  if (!cmakeResult.stdout.includes(cmakeVersion)) throw new Error(`CMake ${cmakeVersion} is required; detected ${cmakeResult.stdout.trim()}.`);
  if (!ninjaResult.stdout.trim().startsWith(ninjaVersion)) throw new Error(`Ninja ${ninjaVersion} is required; detected ${ninjaResult.stdout.trim()}.`);
  const pythonResult = await runProcess(execute, host.pythonLocator.command, host.pythonLocator.args, "Locate Python 3.13", 1e4);
  const python = (0, import_node_path6.resolve)(pythonResult.stdout.trim());
  requireFile(python, "Python 3.13");
  const pythonVersion = await runProcess(execute, python, ["--version"], "Check Python version", 1e4);
  if (!/^Python 3\.13\./.test(pythonVersion.stdout.trim())) throw new Error(`Python 3.13 is required for this qualified ${host.label} build; detected ${pythonVersion.stdout.trim()}.`);
  if (prebuilt !== void 0) return { root: picoRoot, cmake, ninja, python, armBin, prebuilt };
  if (host.hostCompiler === "path") return { root: picoRoot, cmake, ninja, python, armBin };
  const vswhere = (0, import_node_path6.resolve)(options.vswhere ?? (0, import_node_path6.join)(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe"));
  requireFile(vswhere, "Visual Studio instance locator");
  const vsResult = await runProcess(execute, vswhere, [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath"
  ], "Locate Visual Studio C++ tools", 1e4);
  const installation = vsResult.stdout.trim();
  if (!installation) throw new Error("A Visual Studio C++ Build Tools installation is required for SDK host tools.");
  const vsDevCmd = requireFile((0, import_node_path6.join)(installation, "Common7", "Tools", "VsDevCmd.bat"), "Visual Studio developer environment script");
  return { root: picoRoot, cmake, ninja, python, armBin, vsDevCmd, vswhere };
}
async function visualStudioEnvironment(execute, toolchain, profile) {
  if (toolchain.vsDevCmd === void 0) throw new Error("A Visual Studio developer environment script is required to build SDK host tools.");
  const command = `call "${toolchain.vsDevCmd}" -no_logo -host_arch=x64 -arch=x64 >nul && set`;
  const output = await runProcess(execute, "cmd.exe", ["/d", "/c", command], "Prepare Visual Studio host compiler", 6e4, {
    env: { ...process.env, USERPROFILE: profile, HOME: profile }
  });
  const environment = { ...process.env };
  for (const line of output.stdout.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) {
      const name = line.slice(0, separator);
      const existing = Object.keys(environment).find((key) => key.toUpperCase() === name.toUpperCase());
      if (existing !== void 0) delete environment[existing];
      environment[name.toUpperCase() === "PATH" ? "PATH" : name] = line.slice(separator + 1);
    }
  }
  if (!environment.VCToolsInstallDir || !environment.WindowsSdkDir) {
    throw new Error("Visual Studio host compiler environment did not expose C++ tools and the Windows SDK.");
  }
  return environment;
}
async function gitValue(execute, directory, args) {
  const result = await runProcess(execute, "git", ["-C", directory, ...args], "Read build provenance", 1e4, { cwd: directory });
  return result.stdout.trim();
}
function readCacheValue(cache, key) {
  const line = cache.split(/\r?\n/).find((entry) => entry.startsWith(`${key}:`));
  const separator = line?.indexOf("=") ?? -1;
  return separator < 0 ? void 0 : line.slice(separator + 1);
}
async function runFirmwareBuild(options) {
  validateFirmwareBuildRequest(options);
  const host = hostProfile(options.platform ?? process.platform);
  const execute = options.execute ?? executeProcess;
  const workingDirectory = (0, import_node_path6.resolve)(options.workingDirectory ?? process.cwd());
  const runId = (0, import_node_crypto2.randomUUID)();
  const runDirectory = (0, import_node_fs6.mkdtempSync)((0, import_node_path6.join)((0, import_node_os2.tmpdir)(), "gpbuilder-build-"));
  const diagnostics = [];
  let stage = "build initialization";
  const recordStage = async (name, work) => {
    stage = name;
    options.log(`Build stage: ${name}`);
    try {
      const result = await work();
      diagnostics.push(`
## ${name}
${result.stdout}
${result.stderr}`);
      return result;
    } catch (error) {
      diagnostics.push(`
## ${name}
${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      throw error;
    }
  };
  try {
    const sourceDirectory = (0, import_node_path6.join)(runDirectory, "firmware");
    const toolProfile = selectToolProfile(options.release);
    let firmwareCommit = "";
    let dirty = false;
    await recordStage(`materialize firmware ${options.release} and submodules`, async () => {
      const source = await materializeFirmware({
        ...options.firmware !== void 0 && { source: options.firmware },
        release: options.release,
        destination: sourceDirectory,
        execute
      });
      if (toolProfile.firmwareCommit !== void 0 && source.commit !== toolProfile.firmwareCommit) {
        throw new Error(`Release ${options.release} resolved to unexpected commit ${source.commit}; expected ${toolProfile.firmwareCommit}.`);
      }
      firmwareCommit = source.commit;
      dirty = source.dirty;
      if (options.release === "main") {
        await runProcess(execute, "git", ["-C", sourceDirectory, "update-ref", "refs/heads/main", source.commit], "Record materialized main commit", 3e4);
      }
      if (options.configs !== void 0) applyConfigsOverlay(sourceDirectory, options.configs, options.board);
      checkMinimums(parseCmakeMinimums((0, import_node_fs6.readFileSync)((0, import_node_path6.join)(sourceDirectory, "CMakeLists.txt"), "utf8")), toolProfile);
      return { stdout: `Firmware commit ${source.commit}${source.dirty ? " (dirty)" : ""}`, stderr: "" };
    });
    const selection = selectBuild(sourceDirectory, options.release, options.board, options.configs);
    const boardCmake = (0, import_node_path6.join)(sourceDirectory, "configs", options.board, `${options.board}.cmake`);
    const { picoBoard, picoPlatform } = resolveBoardPlatform(options.board, (0, import_node_fs6.existsSync)(boardCmake) ? (0, import_node_fs6.readFileSync)(boardCmake, "utf8") : void 0);
    options.log(`Release: ${selection.release}
Firmware commit: ${selection.commit}
Board: ${selection.board}
Config source: ${selection.configSource}
Config path: ${selection.configPath}`);
    stage = "validate qualified toolchain";
    options.log(`Build stage: ${stage}`);
    const toolchain = await discoverToolchain(options, execute, toolProfile.sdkTag);
    const profile = (0, import_node_path6.join)(runDirectory, "host-profile");
    (0, import_node_fs6.mkdirSync)(profile);
    let nativeEnvironment;
    if (toolchain.prebuilt !== void 0) {
      const { pioasmVersion, pioasmDir, picotoolVersion, picotoolDir } = toolchain.prebuilt;
      options.log(`Using prebuilt pioasm ${pioasmVersion} (${pioasmDir}) and picotool ${picotoolVersion} (${picotoolDir}); no host C++ compiler required.`);
      nativeEnvironment = { ...process.env };
    } else if (host.hostCompiler === "path") {
      options.log("Using host GCC/G++ from PATH to build pioasm and picotool.");
      nativeEnvironment = { ...process.env };
    } else {
      let preparedEnvironment;
      await recordStage("prepare qualified Windows host tools", async () => {
        preparedEnvironment = await visualStudioEnvironment(execute, toolchain, profile);
        return { stdout: preparedEnvironment.VCToolsInstallDir ?? "", stderr: "" };
      });
      if (!preparedEnvironment) throw new Error("Visual Studio environment preparation returned no environment.");
      nativeEnvironment = preparedEnvironment;
    }
    const sdkDirectory = (0, import_node_path6.join)(runDirectory, "pico-sdk");
    (0, import_node_fs6.mkdirSync)((0, import_node_path6.join)(runDirectory, "tools"));
    const { sdkTag } = toolProfile;
    let sdkCommit = "";
    await recordStage(`materialize Pico SDK ${sdkTag}`, async () => {
      await execute("git", ["clone", "--depth=1", "--branch", sdkTag, "https://github.com/raspberrypi/pico-sdk.git", sdkDirectory], {
        timeoutMs: 6e5,
        stage: `Clone Pico SDK ${sdkTag}`
      });
      const commit = await gitValue(execute, sdkDirectory, ["rev-parse", "HEAD"]);
      if (toolProfile.sdkCommit !== void 0 && commit !== toolProfile.sdkCommit) {
        throw new Error(`Pico SDK ${sdkTag} resolved to unexpected commit ${commit}; expected ${toolProfile.sdkCommit}.`);
      }
      sdkCommit = commit;
      const submodules = await runProcess(execute, "git", ["-C", sdkDirectory, "submodule", "update", "--init", "--recursive"], "Initialize Pico SDK submodules", 6e5);
      return { stdout: `Pico SDK ${sdkTag} commit ${commit}
${submodules.stdout}`, stderr: submodules.stderr };
    });
    const webDirectory = (0, import_node_path6.join)(sourceDirectory, "www");
    const fsdata = (0, import_node_path6.join)(sourceDirectory, "lib", "httpd", "fsdata.c");
    if ((0, import_node_fs6.existsSync)(fsdata)) (0, import_node_fs6.rmSync)(fsdata);
    const npmInstall = host.npm(["ci"]);
    const npmBuild = host.npm(["run", "build"]);
    await recordStage("install web dependencies", () => runProcess(execute, npmInstall.command, npmInstall.args, "Install firmware web dependencies", 12e5, { cwd: webDirectory }));
    await recordStage("generate embedded web assets", async () => {
      const result = await runProcess(execute, npmBuild.command, npmBuild.args, "Generate firmware web assets", 12e5, { cwd: webDirectory });
      if (!(0, import_node_fs6.existsSync)(fsdata) || !(0, import_node_fs6.lstatSync)(fsdata).isFile() || (0, import_node_fs6.lstatSync)(fsdata).size === 0) {
        throw new Error("The web build did not generate a nonempty lib/httpd/fsdata.c.");
      }
      return result;
    });
    const nanopbRequirements = (0, import_node_path6.join)(sourceDirectory, "lib", "nanopb", "extra", "requirements.txt");
    const pipConstraint = nanopbPipConstraint((0, import_node_fs6.existsSync)(nanopbRequirements) ? (0, import_node_fs6.readFileSync)(nanopbRequirements, "utf8") : void 0);
    const environment = {
      ...nativeEnvironment,
      HOME: profile,
      USERPROFILE: profile,
      PICO_SDK_PATH: sdkDirectory,
      PICO_TOOLCHAIN_PATH: (0, import_node_path6.join)(toolchain.root, "toolchain", armToolchainVersion),
      PICO_PIO_USB_PATH: (0, import_node_path6.join)(sourceDirectory, "lib", "pico_pio_usb"),
      PICO_BOARD: picoBoard,
      PICO_PLATFORM: picoPlatform,
      GP2040_BOARDCONFIG: options.board,
      PICO_COMPILER: "pico_arm_cortex_m0plus_gcc",
      SKIP_SUBMODULES: "TRUE",
      SKIP_WEBBUILD: "TRUE",
      PATH: `${toolchain.armBin}${host.pathDelimiter}${(0, import_node_path6.dirname)(toolchain.cmake)}${host.pathDelimiter}${(0, import_node_path6.dirname)(toolchain.ninja)}${host.pathDelimiter}${nativeEnvironment.PATH ?? process.env.PATH ?? ""}`
    };
    for (const key of ["CC", "CXX", "CMAKE_TOOLCHAIN_FILE", "PICO_SDK_FETCH_FROM_GIT", "PICO_SDK_FETCH_FROM_GIT_TAG", "PICO_SDK_FETCH_FROM_GIT_PATH"]) {
      delete environment[key];
    }
    if (pipConstraint !== void 0) {
      const constraint = (0, import_node_path6.join)(runDirectory, "pip-constraints.txt");
      (0, import_node_fs6.writeFileSync)(constraint, pipConstraint, { flag: "wx" });
      environment.PIP_CONSTRAINT = constraint;
    } else {
      delete environment.PIP_CONSTRAINT;
    }
    const buildDirectory = (0, import_node_path6.join)(runDirectory, "build");
    await recordStage("configure firmware", () => runProcess(execute, toolchain.cmake, firmwareConfigureArgs({
      sourceDirectory,
      buildDirectory,
      ninja: toolchain.ninja,
      sdkDirectory,
      python: toolchain.python,
      toolsDirectory: (0, import_node_path6.join)(runDirectory, "tools"),
      prebuilt: toolchain.prebuilt,
      board: options.board,
      picoBoard,
      picoPlatform
    }), `Configure GP2040-CE ${options.board} firmware`, 18e5, { env: environment }));
    await recordStage("compile firmware and generate UF2", () => runProcess(execute, toolchain.cmake, [
      "--build",
      buildDirectory,
      "--config",
      "Release",
      "--target",
      "GP2040-CE"
    ], "Compile GP2040-CE and generate UF2", 36e5, { env: environment }));
    const cachePath = (0, import_node_path6.join)(buildDirectory, "CMakeCache.txt");
    stage = "validate and publish UF2";
    options.log(`Build stage: ${stage}`);
    const cache = (0, import_node_fs6.readFileSync)(cachePath, "utf8");
    const expectedCache = /* @__PURE__ */ new Map([
      ["CMAKE_BUILD_TYPE", "Release"],
      ["GP2040_BOARDCONFIG", options.board],
      ["PICO_BOARD", picoBoard],
      ["PICO_SDK_PATH", sdkDirectory.replaceAll("\\", "/")],
      ["Python3_EXECUTABLE", toolchain.python.replaceAll("\\", "/")]
    ]);
    for (const [key, value] of expectedCache) {
      const actual = readCacheValue(cache, key)?.replaceAll("\\", "/");
      if (actual !== value) throw new Error(`CMake cache ${key} was ${actual ?? "missing"}, expected ${value}.`);
    }
    const version = await gitValue(execute, sourceDirectory, ["describe", "--tags", "--always", "--dirty", "--abbrev=7"]);
    if (options.release === taggedRelease2 && version !== taggedRelease2) {
      throw new Error(`Materialized source reports ${version}, expected ${taggedRelease2}.`);
    }
    const outputName = firmwareOutputName(version, options.board);
    const artifactSource = (0, import_node_path6.join)(buildDirectory, `${outputName}.uf2`);
    const elf = requireFile((0, import_node_path6.join)(buildDirectory, `${outputName}.elf`), `Expected ${options.board} ELF`);
    requireFile(artifactSource, `Expected ${options.board} UF2`);
    const elfBytes = (0, import_node_fs6.readFileSync)(elf);
    if (!elfBytes.includes(Buffer.from(outputName)) || !elfBytes.includes(Buffer.from(version))) {
      throw new Error(`The built ELF does not identify the expected ${version} ${options.board} firmware target.`);
    }
    const elfInfo = {
      filename: `${outputName}.elf`,
      byteSize: elfBytes.length,
      sha256: (0, import_node_crypto2.createHash)("sha256").update(elfBytes).digest("hex")
    };
    const sourceSubmodules = await gitValue(execute, sourceDirectory, ["submodule", "status", "--recursive"]);
    const sdkSubmodules = await gitValue(execute, sdkDirectory, ["submodule", "status", "--recursive"]);
    const arduinoJsonCommit = await gitValue(execute, (0, import_node_path6.join)(buildDirectory, "_deps", "arduinojson-src"), ["rev-parse", "HEAD"]);
    const prebuilt = toolchain.prebuilt;
    const hostToolDependencies = prebuilt !== void 0 ? { prebuiltTools: { pioasm: { version: prebuilt.pioasmVersion, dir: prebuilt.pioasmDir }, picotool: { version: prebuilt.picotoolVersion, dir: prebuilt.picotoolDir } } } : { picotoolCommit: await gitValue(execute, (0, import_node_path6.join)(runDirectory, "tools", "picotool-src"), ["rev-parse", "HEAD"]) };
    const freeze = await runProcess(execute, host.venvPython(buildDirectory), ["-m", "pip", "freeze"], "Record build-local Python dependencies", 3e4);
    const metadata = {
      firmware: { repository: options.firmware ? (0, import_node_path6.resolve)(options.firmware) : "https://github.com/OpenStickCommunity/GP2040-CE.git", requestedRelease: options.release, commit: firmwareCommit, dirty, submodules: sourceSubmodules },
      sdk: { tag: sdkTag, commit: sdkCommit, submodules: sdkSubmodules },
      dependencies: { arduinoJsonCommit, ...hostToolDependencies, pythonPackages: freeze.stdout.trim().split(/\r?\n/) },
      tools: { node: process.version, cmake: cmakeVersion, ninja: ninjaVersion, armGcc: armCompilerVersion, python: "3.13", buildType: "Release" },
      configuration: { board: options.board, picoBoard, picoPlatform, firmwareVersion: version, upstreamFilename: `${outputName}.uf2`, configSource: selection.configSource, configPath: selection.configPath, elf: elfInfo },
      qualification: { platform: host.label, hardwareSmokeTest: false }
    };
    const artifact = publishArtifact({
      source: artifactSource,
      workingDirectory,
      runId,
      release: options.release,
      commit: firmwareCommit,
      board: options.board,
      buildType: "release",
      metadata
    });
    options.log(`UF2: ${artifact.path}
Size: ${artifact.byteSize} bytes
SHA-256: ${artifact.sha256}
Metadata: ${artifact.metadataPath}`);
    return { sourceCommit: firmwareCommit, selection, artifact };
  } catch (error) {
    const logDirectory = (0, import_node_path6.resolve)(workingDirectory, "artifacts", "logs", runId);
    try {
      (0, import_node_fs6.mkdirSync)(logDirectory, { recursive: true });
      (0, import_node_fs6.writeFileSync)((0, import_node_path6.join)(logDirectory, "build.log"), `Stage: ${stage}
${diagnostics.join("\n")}
${error instanceof Error ? error.stack ?? error.message : String(error)}
`, { flag: "wx" });
    } catch {
    }
    const logPath = (0, import_node_path6.join)(logDirectory, "build.log");
    throw new Error(`Firmware build failed during ${stage}: ${error instanceof Error ? error.message : String(error)}. Diagnostics: ${logPath}`, { cause: error });
  } finally {
    (0, import_node_fs6.rmSync)(runDirectory, { recursive: true, force: true });
  }
}
function buildFirmware(options) {
  validateFirmwareBuildRequest(options);
  return runFirmwareBuild(options);
}

// src/orchestrator.ts
var operations = ["check-prerequisites", "list-releases", "list-boards", "select-build", "build"];
function inferOperation(explicit, options) {
  if (explicit !== void 0) return explicit;
  return options.release?.trim() && options.board?.trim() ? "build" : void 0;
}
function required(options, name) {
  const value = options[name];
  if (!value?.trim()) throw new Error(`The ${name} input is required for ${options.operation}.`);
  return value;
}
function run(options) {
  if (options.operation === "build" && options.release?.trim() && options.board?.trim()) {
    validateFirmwareBuildRequest({
      release: options.release,
      board: options.board,
      ...options.configs !== void 0 && { configs: options.configs },
      platform: options.host?.platform ?? process.platform
    });
  }
  if (options.operation === "check-prerequisites" || options.operation === "build") {
    const results = checkPrerequisites(options);
    const failed = results.filter((result) => result.status !== "available");
    if (failed.length > 0) {
      throw new Error(`Prerequisite check failed: ${failed.map((result) => result.name).join(", ")}. See the report for installation guidance.`);
    }
    if (options.operation === "check-prerequisites") return {};
  }
  const firmware = options.firmware?.trim();
  if (options.operation === "build") {
    return buildFirmware({
      ...firmware && { firmware },
      release: required(options, "release"),
      board: required(options, "board"),
      ...options.configs !== void 0 && { configs: options.configs },
      log: options.log,
      ...options.host?.picoRoot && { picoRoot: options.host.picoRoot },
      ...options.host?.vswhere && { vswhere: options.host.vswhere },
      ...options.host?.platform && { platform: options.host.platform },
      ...options.process && { execute: options.process }
    }).then((result) => ({ selection: result.selection, artifact: result.artifact }));
  }
  if (!firmware) throw new Error(`The firmware input is required for ${options.operation}.`);
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
  options.log("Selection validated; no firmware was built.");
  return { selection };
}

// src/cli.ts
async function main() {
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
    const operation = inferOperation(selected[0], values);
    if (!values.help && operation === void 0 && [values.firmware, values.release, values.board, values.configs].some((value) => value !== void 0)) {
      throw new Error("Choose an operation, such as --select-build or --list-boards.");
    }
    if (values.help || operation === void 0) {
      console.log(`GPBuilder

Usage: node dist/cli.cjs <operation> [options]

--check-prerequisites  Report host tools without installing anything.
--list-releases        List local release tags; requires --firmware.
--list-boards          List boards; --release accepts a local tag or main.
--select-build         Validate --firmware, --release, and --board without building.
--build                Build a Pico UF2 for v0.7.12 or main on Windows x64.
                       A complete --release and --board pair also implies --build.
--help                Show this help.

--firmware <path>      Local GP2040-CE Git checkout; builds default to upstream.
--release <tag|main>   Exact release tag (v0.7.12 for builds) or main.
--board <name>         Exact, case-sensitive board directory name (Pico for builds).
--configs <path>       Directory of board folders. Builds overlay only configs/<board>,
                       which must contain BoardConfig.h.`);
    } else {
      await run({
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
}
void main();
