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
    firmware: (0, import_node_path2.resolve)(firmware),
    release,
    commit,
    board,
    configSource: configs === void 0 ? "firmware" : "external",
    configPath: configs === void 0 ? `configs/${board}` : (0, import_node_path2.join)(externalDirectory(configs), board)
  };
}

// src/firmware-build.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs5 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path5 = require("node:path");

// src/artifact-publisher.ts
var import_node_crypto = require("node:crypto");
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");

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
function publishArtifact(options) {
  if (!/^[A-Za-z0-9-]+$/.test(options.runId)) throw new Error("Artifact run ID contains unsupported characters.");
  if (options.release !== "v0.7.12" || options.board !== "Pico" || options.buildType !== "release") {
    throw new Error("Artifact publication currently supports v0.7.12, Pico, and release builds only.");
  }
  const source = (0, import_node_path3.resolve)(options.source);
  const sourceStats = (0, import_node_fs3.lstatSync)(source);
  if (!sourceStats.isFile()) throw new Error("The UF2 source must be a regular file.");
  const input = (0, import_node_fs3.readFileSync)(source);
  const validation = validateUf2(input);
  const parent = (0, import_node_path3.resolve)(options.workingDirectory, "artifacts", "Pico", "v0.7.12", "release");
  (0, import_node_fs3.mkdirSync)(parent, { recursive: true });
  const destination = (0, import_node_path3.join)(parent, options.runId);
  if ((0, import_node_fs3.existsSync)(destination)) throw new Error(`Artifact run ${options.runId} already exists.`);
  const staging = (0, import_node_fs3.mkdtempSync)((0, import_node_path3.join)(parent, `.tmp-${options.runId}-`));
  const filename = "GP2040-CE_0.7.12_Pico.uf2";
  const stagedUf2 = (0, import_node_path3.join)(staging, filename);
  const stagedMetadata = (0, import_node_path3.join)(staging, "build.json");
  const digest = (0, import_node_crypto.createHash)("sha256").update(input).digest("hex");
  try {
    (0, import_node_fs3.copyFileSync)(source, stagedUf2);
    const published = (0, import_node_fs3.readFileSync)(stagedUf2);
    const publishedDigest = (0, import_node_crypto.createHash)("sha256").update(published).digest("hex");
    if (published.length !== input.length || publishedDigest !== digest) {
      throw new Error("Published UF2 size or SHA-256 does not match the validated build output.");
    }
    (0, import_node_fs3.writeFileSync)(stagedMetadata, `${JSON.stringify({
      ...options.metadata,
      requested: { release: options.release, board: options.board, buildType: options.buildType },
      artifact: {
        filename,
        byteSize: published.length,
        sha256: publishedDigest,
        validation: { ...validation, flashStartHex: `0x${validation.addressStart.toString(16)}`, flashEndHex: `0x${validation.addressEnd.toString(16)}` }
      }
    }, null, 2)}
`, { flag: "wx" });
    (0, import_node_fs3.renameSync)(staging, destination);
  } catch (error) {
    (0, import_node_fs3.rmSync)(staging, { recursive: true, force: true });
    throw error;
  }
  const path = (0, import_node_path3.join)(destination, filename);
  const metadataPath = (0, import_node_path3.join)(destination, "build.json");
  const finalStats = (0, import_node_fs3.lstatSync)(path);
  if (!finalStats.isFile()) throw new Error("Published UF2 is not a regular file.");
  const finalBytes = (0, import_node_fs3.readFileSync)(path);
  const finalDigest = (0, import_node_crypto.createHash)("sha256").update(finalBytes).digest("hex");
  if (finalStats.size !== input.length || finalDigest !== digest) throw new Error("Published UF2 verification failed.");
  return { path: (0, import_node_path3.resolve)(path), metadataPath: (0, import_node_path3.resolve)(metadataPath), sha256: finalDigest, byteSize: finalStats.size };
}

// src/firmware-source.ts
var import_node_fs4 = require("node:fs");
var import_node_path4 = require("node:path");

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
var supportedRelease = "v0.7.12";
async function git2(execute, directory, args, timeoutMs = 6e5) {
  const result = await execute("git", ["-C", directory, ...args], { cwd: directory, timeoutMs, stage: `Git ${args[0]}` });
  return result.stdout.trim();
}
async function materializeFirmware(options) {
  const { release } = options;
  if (release !== supportedRelease) throw new Error("This build currently supports the exact tag v0.7.12 only.");
  const execute = options.execute ?? executeProcess;
  const directory = (0, import_node_path4.resolve)(options.destination);
  if ((0, import_node_fs4.existsSync)(directory)) throw new Error(`Firmware destination already exists: ${directory}`);
  if (options.source !== void 0) {
    await execute("git", ["clone", "--no-hardlinks", "--no-checkout", "--", (0, import_node_path4.resolve)(options.source), directory], {
      timeoutMs: 6e5,
      stage: "Clone local firmware source"
    });
  } else {
    await execute("git", ["init", "--quiet", directory], { timeoutMs: 1e4, stage: "Initialize firmware source" });
    await git2(execute, directory, ["remote", "add", "origin", upstreamRepository], 1e4);
    await git2(execute, directory, ["fetch", "--depth=1", "origin", `refs/tags/${release}:refs/tags/${release}`]);
  }
  const commit = await git2(execute, directory, ["rev-parse", "--verify", `refs/tags/${release}^{commit}`], 1e4);
  await git2(execute, directory, ["checkout", "--quiet", "--detach", commit], 1e4);
  if (await git2(execute, directory, ["rev-parse", "HEAD"], 1e4) !== commit) {
    throw new Error(`Materialized firmware does not match release ${release}.`);
  }
  const rootCmake = await git2(execute, directory, ["ls-tree", "-z", "HEAD", "--", "CMakeLists.txt"], 1e4);
  if (!/^100(?:644|755) blob [a-f0-9]+\tCMakeLists\.txt\0$/.test(rootCmake)) {
    throw new Error(`Release ${release} does not contain a regular root CMakeLists.txt.`);
  }
  await git2(execute, directory, ["submodule", "update", "--init", "--recursive"]);
  if (await git2(execute, directory, ["status", "--porcelain", "--untracked-files=all"], 1e4)) {
    throw new Error(`Materialized firmware checkout for ${release} is not clean.`);
  }
  return { directory, commit, tag: release };
}

// src/firmware-build.ts
var firmwareRelease = "v0.7.12";
var firmwareCommit = "0014e4ae2a312332e2582f6708dcc7d6bec5de8c";
var sdkCommit = "bddd20f928ce76142793bef434d4f75f4af6e433";
var cmakeVersion = "4.3.4";
var ninjaVersion = "1.13.2";
var armToolchainVersion = "15_2_Rel1";
var armCompilerVersion = "15.2.1";
var sdkTag = "2.1.1";
function validateFirmwareBuildRequest(options) {
  if (options.release !== firmwareRelease || options.board !== "Pico" || options.configs !== void 0) {
    throw new Error("Firmware builds currently support only release v0.7.12, board Pico, built-in configs, and Release build type.");
  }
  if ((options.platform ?? process.platform) !== "win32") {
    throw new Error("The v0.7.12 Pico build has only been integration-qualified on Windows x64.");
  }
}
function requireFile(path, description) {
  if (!(0, import_node_fs5.existsSync)(path) || !(0, import_node_fs5.lstatSync)(path).isFile()) throw new Error(`${description} was not found: ${path}`);
  return path;
}
async function runProcess(execute, command, args, stage, timeoutMs, options = {}) {
  return execute(command, args, { ...options, timeoutMs, stage });
}
async function discoverToolchain(options, execute) {
  const picoRoot = (0, import_node_path5.resolve)(options.picoRoot ?? (0, import_node_path5.join)((0, import_node_os2.homedir)(), ".pico-sdk"));
  const cmake = requireFile((0, import_node_path5.join)(picoRoot, "cmake", `v${cmakeVersion}`, "bin", "cmake.exe"), `CMake ${cmakeVersion}`);
  const ninja = requireFile((0, import_node_path5.join)(picoRoot, "ninja", `v${ninjaVersion}`, "ninja.exe"), `Ninja ${ninjaVersion}`);
  const armBin = (0, import_node_path5.join)(picoRoot, "toolchain", armToolchainVersion, "bin");
  const gcc = requireFile((0, import_node_path5.join)(armBin, "arm-none-eabi-gcc.exe"), `Arm GNU ${armToolchainVersion} GCC`);
  const gxx = requireFile((0, import_node_path5.join)(armBin, "arm-none-eabi-g++.exe"), `Arm GNU ${armToolchainVersion} G++`);
  const vswhere = (0, import_node_path5.resolve)(options.vswhere ?? (0, import_node_path5.join)(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe"));
  requireFile(vswhere, "Visual Studio instance locator");
  const gccVersion = await runProcess(execute, gcc, ["--version"], "Check Arm GCC version", 1e4);
  const gxxVersion = await runProcess(execute, gxx, ["--version"], "Check Arm G++ version", 1e4);
  if (!gccVersion.stdout.includes(armCompilerVersion) || !gxxVersion.stdout.includes(armCompilerVersion)) {
    throw new Error(`The qualified Arm toolchain must be ${armCompilerVersion}; detected ${gccVersion.stdout.split(/\r?\n/)[0]} / ${gxxVersion.stdout.split(/\r?\n/)[0]}.`);
  }
  const libraries = [[gcc, "libc.a"], [gxx, "libstdc++.a"]];
  for (const [compiler, library] of libraries) {
    const result = await runProcess(execute, compiler, [`-print-file-name=${library}`], `Check Arm ${library}`, 1e4);
    const path = result.stdout.trim();
    if (path === library || !(0, import_node_fs5.existsSync)(path)) throw new Error(`Arm library ${library} was not found in the selected toolchain.`);
  }
  const cmakeResult = await runProcess(execute, cmake, ["--version"], "Check CMake version", 1e4);
  const ninjaResult = await runProcess(execute, ninja, ["--version"], "Check Ninja version", 1e4);
  if (!cmakeResult.stdout.includes(cmakeVersion)) throw new Error(`CMake ${cmakeVersion} is required; detected ${cmakeResult.stdout.trim()}.`);
  if (!ninjaResult.stdout.trim().startsWith(ninjaVersion)) throw new Error(`Ninja ${ninjaVersion} is required; detected ${ninjaResult.stdout.trim()}.`);
  const pythonResult = await runProcess(execute, "py.exe", ["-3.13", "-c", "import sys; print(sys.executable)"], "Locate Python 3.13", 1e4);
  const python = (0, import_node_path5.resolve)(pythonResult.stdout.trim());
  requireFile(python, "Python 3.13");
  const pythonVersion = await runProcess(execute, python, ["--version"], "Check Python version", 1e4);
  if (!/^Python 3\.13\./.test(pythonVersion.stdout.trim())) throw new Error(`Python 3.13 is required for this qualified Windows build; detected ${pythonVersion.stdout.trim()}.`);
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
  const vsDevCmd = requireFile((0, import_node_path5.join)(installation, "Common7", "Tools", "VsDevCmd.bat"), "Visual Studio developer environment script");
  return { root: picoRoot, cmake, ninja, python, armBin, vsDevCmd, vswhere };
}
async function visualStudioEnvironment(execute, toolchain, profile) {
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
  const execute = options.execute ?? executeProcess;
  const workingDirectory = (0, import_node_path5.resolve)(options.workingDirectory ?? process.cwd());
  const runId = (0, import_node_crypto2.randomUUID)();
  const runDirectory = (0, import_node_fs5.mkdtempSync)((0, import_node_path5.join)((0, import_node_os2.tmpdir)(), "gpbuilder-build-"));
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
    const sourceDirectory = (0, import_node_path5.join)(runDirectory, "firmware");
    await recordStage("materialize firmware tag and submodules", async () => {
      const source = await materializeFirmware({
        ...options.firmware !== void 0 && { source: options.firmware },
        release: options.release,
        destination: sourceDirectory,
        execute
      });
      if (source.commit !== firmwareCommit) throw new Error(`Release ${firmwareRelease} resolved to unexpected commit ${source.commit}; expected ${firmwareCommit}.`);
      return { stdout: `Firmware commit ${source.commit}`, stderr: "" };
    });
    const selection = selectBuild(sourceDirectory, options.release, options.board);
    options.log(`Release: ${selection.release}
Firmware commit: ${selection.commit}
Board: ${selection.board}
Config source: ${selection.configSource}
Config path: ${selection.configPath}`);
    stage = "validate qualified toolchain";
    options.log(`Build stage: ${stage}`);
    const toolchain = await discoverToolchain(options, execute);
    const profile = (0, import_node_path5.join)(runDirectory, "host-profile");
    (0, import_node_fs5.mkdirSync)(profile);
    let preparedEnvironment;
    await recordStage("prepare qualified Windows host tools", async () => {
      preparedEnvironment = await visualStudioEnvironment(execute, toolchain, profile);
      return { stdout: preparedEnvironment.VCToolsInstallDir ?? "", stderr: "" };
    });
    if (!preparedEnvironment) throw new Error("Visual Studio environment preparation returned no environment.");
    const nativeEnvironment = preparedEnvironment;
    const sdkDirectory = (0, import_node_path5.join)(runDirectory, "pico-sdk");
    (0, import_node_fs5.mkdirSync)((0, import_node_path5.join)(runDirectory, "tools"));
    await recordStage("materialize Pico SDK 2.1.1", async () => {
      await execute("git", ["clone", "--depth=1", "--branch", sdkTag, "https://github.com/raspberrypi/pico-sdk.git", sdkDirectory], {
        timeoutMs: 6e5,
        stage: "Clone Pico SDK 2.1.1"
      });
      const commit = await gitValue(execute, sdkDirectory, ["rev-parse", "HEAD"]);
      if (commit !== sdkCommit) throw new Error(`Pico SDK ${sdkTag} resolved to unexpected commit ${commit}; expected ${sdkCommit}.`);
      const submodules = await runProcess(execute, "git", ["-C", sdkDirectory, "submodule", "update", "--init", "--recursive"], "Initialize Pico SDK submodules", 6e5);
      return { stdout: `Pico SDK ${sdkTag} commit ${commit}
${submodules.stdout}`, stderr: submodules.stderr };
    });
    const webDirectory = (0, import_node_path5.join)(sourceDirectory, "www");
    const fsdata = (0, import_node_path5.join)(sourceDirectory, "lib", "httpd", "fsdata.c");
    if ((0, import_node_fs5.existsSync)(fsdata)) (0, import_node_fs5.rmSync)(fsdata);
    const npm = process.platform === "win32" ? "cmd.exe" : "npm";
    const npmArgs = (args) => process.platform === "win32" ? ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`] : args;
    await recordStage("install web dependencies", () => runProcess(execute, npm, npmArgs(["ci"]), "Install firmware web dependencies", 12e5, { cwd: webDirectory }));
    await recordStage("generate embedded web assets", async () => {
      const result = await runProcess(execute, npm, npmArgs(["run", "build"]), "Generate firmware web assets", 12e5, { cwd: webDirectory });
      if (!(0, import_node_fs5.existsSync)(fsdata) || !(0, import_node_fs5.lstatSync)(fsdata).isFile() || (0, import_node_fs5.lstatSync)(fsdata).size === 0) {
        throw new Error("The web build did not generate a nonempty lib/httpd/fsdata.c.");
      }
      return result;
    });
    const constraint = (0, import_node_path5.join)(runDirectory, "pip-constraints.txt");
    (0, import_node_fs5.writeFileSync)(constraint, "setuptools<81\n", { flag: "wx" });
    const environment = {
      ...nativeEnvironment,
      HOME: profile,
      USERPROFILE: profile,
      PICO_SDK_PATH: sdkDirectory,
      PICO_TOOLCHAIN_PATH: (0, import_node_path5.join)(toolchain.root, "toolchain", armToolchainVersion),
      PICO_PIO_USB_PATH: (0, import_node_path5.join)(sourceDirectory, "lib", "pico_pio_usb"),
      PICO_BOARD: "pico",
      PICO_PLATFORM: "rp2040",
      GP2040_BOARDCONFIG: "Pico",
      PICO_COMPILER: "pico_arm_cortex_m0plus_gcc",
      SKIP_SUBMODULES: "TRUE",
      SKIP_WEBBUILD: "TRUE",
      PIP_CONSTRAINT: constraint,
      PATH: `${toolchain.armBin};${(0, import_node_path5.dirname)(toolchain.cmake)};${(0, import_node_path5.dirname)(toolchain.ninja)};${nativeEnvironment.PATH ?? process.env.PATH ?? ""}`
    };
    for (const key of ["CC", "CXX", "CMAKE_TOOLCHAIN_FILE", "PICO_SDK_FETCH_FROM_GIT", "PICO_SDK_FETCH_FROM_GIT_TAG", "PICO_SDK_FETCH_FROM_GIT_PATH"]) {
      delete environment[key];
    }
    const buildDirectory = (0, import_node_path5.join)(runDirectory, "build");
    await recordStage("configure firmware", () => runProcess(execute, toolchain.cmake, [
      "-S",
      sourceDirectory,
      "-B",
      buildDirectory,
      "-G",
      "Ninja",
      `-DCMAKE_MAKE_PROGRAM=${toolchain.ninja}`,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DGP2040_BOARDCONFIG=Pico",
      "-DPICO_BOARD=pico",
      "-DPICO_PLATFORM=rp2040",
      `-DPICO_SDK_PATH=${sdkDirectory}`,
      `-DPython3_EXECUTABLE=${toolchain.python}`,
      "-DSKIP_SUBMODULES=TRUE",
      "-DSKIP_WEBBUILD=TRUE",
      `-DPICOTOOL_FETCH_FROM_GIT_PATH=${(0, import_node_path5.join)(runDirectory, "tools")}`
    ], "Configure GP2040-CE Pico firmware", 18e5, { env: environment }));
    await recordStage("compile firmware and generate UF2", () => runProcess(execute, toolchain.cmake, [
      "--build",
      buildDirectory,
      "--config",
      "Release",
      "--target",
      "GP2040-CE"
    ], "Compile GP2040-CE and generate UF2", 36e5, { env: environment }));
    const cachePath = (0, import_node_path5.join)(buildDirectory, "CMakeCache.txt");
    stage = "validate and publish UF2";
    options.log(`Build stage: ${stage}`);
    const cache = (0, import_node_fs5.readFileSync)(cachePath, "utf8");
    const expectedCache = /* @__PURE__ */ new Map([
      ["CMAKE_BUILD_TYPE", "Release"],
      ["GP2040_BOARDCONFIG", "Pico"],
      ["PICO_BOARD", "pico"],
      ["PICO_SDK_PATH", sdkDirectory.replaceAll("\\", "/")],
      ["Python3_EXECUTABLE", toolchain.python.replaceAll("\\", "/")]
    ]);
    for (const [key, value] of expectedCache) {
      const actual = readCacheValue(cache, key)?.replaceAll("\\", "/");
      if (actual !== value) throw new Error(`CMake cache ${key} was ${actual ?? "missing"}, expected ${value}.`);
    }
    const version = await gitValue(execute, sourceDirectory, ["describe", "--tags", "--always", "--dirty", "--abbrev=7"]);
    if (version !== firmwareRelease) throw new Error(`Materialized source reports ${version}, expected ${firmwareRelease}.`);
    const artifactSource = (0, import_node_path5.join)(buildDirectory, "GP2040-CE_0.7.12_Pico.uf2");
    const elf = requireFile((0, import_node_path5.join)(buildDirectory, "GP2040-CE_0.7.12_Pico.elf"), "Expected Pico ELF");
    requireFile(artifactSource, "Expected Pico UF2");
    const elfBytes = (0, import_node_fs5.readFileSync)(elf);
    if (!elfBytes.includes(Buffer.from("GP2040-CE_0.7.12_Pico")) || !elfBytes.includes(Buffer.from("v0.7.12"))) {
      throw new Error("The built ELF does not identify the expected v0.7.12 Pico firmware target.");
    }
    const elfInfo = {
      filename: "GP2040-CE_0.7.12_Pico.elf",
      byteSize: elfBytes.length,
      sha256: (0, import_node_crypto2.createHash)("sha256").update(elfBytes).digest("hex")
    };
    const sourceSubmodules = await gitValue(execute, sourceDirectory, ["submodule", "status", "--recursive"]);
    const sdkSubmodules = await gitValue(execute, sdkDirectory, ["submodule", "status", "--recursive"]);
    const arduinoJsonCommit = await gitValue(execute, (0, import_node_path5.join)(buildDirectory, "_deps", "arduinojson-src"), ["rev-parse", "HEAD"]);
    const picotoolCommit = await gitValue(execute, (0, import_node_path5.join)(runDirectory, "tools", "picotool-src"), ["rev-parse", "HEAD"]);
    const freeze = await runProcess(execute, (0, import_node_path5.join)(buildDirectory, "venv", "Scripts", "python.exe"), ["-m", "pip", "freeze"], "Record build-local Python dependencies", 3e4);
    const metadata = {
      firmware: { repository: options.firmware ? (0, import_node_path5.resolve)(options.firmware) : "https://github.com/OpenStickCommunity/GP2040-CE.git", requestedRelease: firmwareRelease, commit: firmwareCommit, submodules: sourceSubmodules },
      sdk: { tag: sdkTag, commit: sdkCommit, submodules: sdkSubmodules },
      dependencies: { arduinoJsonCommit, picotoolCommit, pythonPackages: freeze.stdout.trim().split(/\r?\n/) },
      tools: { node: process.version, cmake: cmakeVersion, ninja: ninjaVersion, armGcc: armCompilerVersion, python: "3.13", buildType: "Release" },
      configuration: { board: "Pico", picoBoard: "pico", firmwareVersion: version, configSource: "firmware", elf: elfInfo },
      qualification: { platform: "Windows x64", hardwareSmokeTest: false }
    };
    const artifact = publishArtifact({
      source: artifactSource,
      workingDirectory,
      runId,
      release: firmwareRelease,
      board: "Pico",
      buildType: "release",
      metadata
    });
    options.log(`UF2: ${artifact.path}
Size: ${artifact.byteSize} bytes
SHA-256: ${artifact.sha256}
Metadata: ${artifact.metadataPath}`);
    return { sourceCommit: firmwareCommit, selection, artifact };
  } catch (error) {
    const logDirectory = (0, import_node_path5.resolve)(workingDirectory, "artifacts", "logs", runId);
    try {
      (0, import_node_fs5.mkdirSync)(logDirectory, { recursive: true });
      (0, import_node_fs5.writeFileSync)((0, import_node_path5.join)(logDirectory, "build.log"), `Stage: ${stage}
${diagnostics.join("\n")}
${error instanceof Error ? error.stack ?? error.message : String(error)}
`, { flag: "wx" });
    } catch {
    }
    const logPath = (0, import_node_path5.join)(logDirectory, "build.log");
    throw new Error(`Firmware build failed during ${stage}: ${error instanceof Error ? error.message : String(error)}. Diagnostics: ${logPath}`, { cause: error });
  } finally {
    (0, import_node_fs5.rmSync)(runDirectory, { recursive: true, force: true });
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
--build                Check prerequisites and selection; compilation is not implemented.
                       A complete --release and --board pair also implies --build.
--help                Show this help.

--firmware <path>      Local GP2040-CE Git checkout.
--release <tag|main>   Exact local release tag or local refs/heads/main.
--board <name>         Exact, case-sensitive board directory name.
--configs <path>       External directory containing board folders; replaces built-in configs.`);
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
