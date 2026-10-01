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

// src/orchestrator.ts
function run(options) {
  const results = checkPrerequisites(options);
  const failed = results.filter((result) => result.status !== "available");
  if (failed.length > 0) {
    throw new Error(`Prerequisite check failed: ${failed.map((result) => result.name).join(", ")}. See the report for installation guidance.`);
  }
  if (options.operation === "build") {
    throw new Error("Firmware build orchestration is not implemented yet. Prerequisites passed; no firmware was built.");
  }
}

// src/cli.ts
try {
  const { values } = (0, import_node_util.parseArgs)({
    options: {
      "check-prerequisites": { type: "boolean" },
      build: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });
  if (values["check-prerequisites"] && values.build) {
    throw new Error("Choose --check-prerequisites or --build, not both. Builds always check prerequisites.");
  }
  if (values.help || !values["check-prerequisites"] && !values.build) {
    console.log("GPBuilder\n\nUsage: node dist/cli.cjs [--check-prerequisites | --build | --help]\n\n--check-prerequisites  Report host tools without installing anything.\n--build                Check prerequisites, then request a firmware build (not implemented).");
  } else {
    run({
      mode: "local",
      log: console.log,
      operation: values.build ? "build" : "check-prerequisites"
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
