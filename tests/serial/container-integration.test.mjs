import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const docker = spawnSync("docker", ["info"], { stdio: "ignore" });

test(
  "real container blocks lifecycle runner-command injection and validator mutation",
  {
    skip:
      docker.status !== 0
        ? "Docker daemon unavailable; real isolation not verified"
        : false,
    timeout: 240_000,
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "candidate-real-isolation-"));
    const tag = `serial-isolation-test-${randomUUID()}`;
    t.after(() => {
      spawnSync("docker", ["image", "rm", "-f", tag], { stdio: "ignore" });
      return rm(root, { recursive: true, force: true });
    });
    await mkdir(join(root, "attack"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        dependencies: { attack: "file:attack" },
        scripts: { validate: "node validate.cjs" },
      }),
    );
    await writeFile(
      join(root, "attack", "package.json"),
      JSON.stringify({
        name: "attack",
        version: "1.0.0",
        scripts: { install: "node attack.cjs" },
      }),
    );
    await writeFile(
      join(root, "attack", "attack.cjs"),
      `
const fs = require("node:fs");
if (process.env.GITHUB_PATH || process.env.GITHUB_ENV || process.env.BASH_ENV !== "/dev/null")
  throw new Error("runner command channel exposed");
fs.writeFileSync(process.env.HOME + "/.npmrc", "script-shell=/tmp/attacker-shell\\n");
fs.writeFileSync("/tmp/attacker-shell", "#!/bin/sh\\nexit 0\\n", {mode:0o755});
for (const path of ["/work/package.json", "/usr/local/bin/npm"]) {
  try { fs.writeFileSync(path, "poisoned"); throw new Error("unexpected write"); }
  catch (error) { if (!["EACCES", "EROFS"].includes(error.code)) throw error; }
}
fs.writeFileSync("/tmp/hook-ran", "yes");
`,
    );
    await writeFile(
      join(root, "validate.cjs"),
      `
const fs = require("node:fs");
if (fs.readFileSync("/tmp/hook-ran", "utf8") !== "yes") throw new Error("hook did not execute");
if (require("./package.json").scripts.validate !== "node validate.cjs") throw new Error("validator modified");
if (process.env.GITHUB_PATH || process.env.GITHUB_ENV || process.env.BASH_ENV !== "/dev/null") throw new Error("injected environment");
`,
    );
    const lock = spawnSync(
      "npm",
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(lock.status, 0, lock.stderr);
    const productionDockerfile = await readFile(
      "scripts/candidate-container.Dockerfile",
      "utf8",
    );
    await writeFile(join(root, "Dockerfile"), productionDockerfile);
    const build = spawnSync(
      "docker",
      ["build", "--no-cache", "-t", tag, root],
      { encoding: "utf8", timeout: 180_000 },
    );
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user",
        "1001:1001",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,mode=1777",
        tag,
        "/bin/bash",
        "--noprofile",
        "--norc",
        "-c",
        'set -eu; export HOME=/tmp/home; mkdir -p "$HOME"; npm rebuild --foreground-scripts; npm run validate',
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  },
);
