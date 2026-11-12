import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("candidate launcher suppresses untrusted runner commands and passes no host mounts or environment", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "candidate-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GITHUB_PATH: join(root, "github-path"),
    GITHUB_ENV: join(root, "github-env"),
    DOCKER_ARGS_LOG: join(root, "docker-args"),
  };
  await writeFile(env.GITHUB_PATH, "");
  await writeFile(env.GITHUB_ENV, "");
  await mkdir(join(root, "bin"));
  await mkdir(join(root, "scripts"));
  await writeFile(
    join(root, "scripts", "candidate-container.Dockerfile"),
    "FROM scratch\n",
  );
  await writeFile(
    join(root, "bin", "docker"),
    `#!/bin/sh
printf '%s\\n' "$@" >> "$DOCKER_ARGS_LOG"
if [ "$1" = run ]; then
  printf '%s\\n' '::add-path::/attacker' '::set-env name=BASH_ENV::/attacker/startup'
fi
`,
    { mode: 0o755 },
  );
  env.PATH = `${join(root, "bin")}:${process.env.PATH}`;
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=main");
  git("add", "scripts/candidate-container.Dockerfile");
  git("commit", "-m", "fixture");
  const result = spawnSync(
    "bash",
    [resolve("scripts/run-candidate-container.sh"), git("rev-parse", "HEAD")],
    {
      cwd: root,
      env,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /::(?:add-path|set-env)/);
  assert.equal(await readFile(env.GITHUB_PATH, "utf8"), "");
  assert.equal(await readFile(env.GITHUB_ENV, "utf8"), "");
  const args = await readFile(env.DOCKER_ARGS_LOG, "utf8");
  assert.match(args, /--read-only/);
  assert.match(args, /--cap-drop=ALL/);
  assert.match(args, /--user\n1001:1001/);
  assert.doesNotMatch(args, /(?:^|\n)(?:--env|-e|--mount|-v|--volume)(?:\n|=)/);
  assert.match(args, /npm rebuild --foreground-scripts/);
});

test("container definition suppresses install hooks and freezes source before unprivileged validation", async () => {
  const dockerfile = await readFile(
    "scripts/candidate-container.Dockerfile",
    "utf8",
  );
  assert.match(dockerfile, /playwright@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /npm ci --ignore-scripts/);
  assert.match(
    dockerfile,
    /chmod -R a-w \/work \/usr\/local\/lib\/node_modules/,
  );
  assert.match(dockerfile, /USER 1001:1001/);
  assert.match(dockerfile, /NPM_CONFIG_USERCONFIG=\/dev\/null/);
  assert.match(dockerfile, /NPM_CONFIG_SCRIPT_SHELL=\/bin\/bash/);
  assert.match(dockerfile, /BASH_ENV=\/dev\/null/);
  const workflow = await readFile(
    ".github/workflows/serial-candidate.yml",
    "utf8",
  );
  const candidate = workflow.split("  candidate:")[1].split("  result:")[0];
  assert.match(candidate, /run-candidate-container\.sh/);
  assert.doesNotMatch(candidate, /run: npm/);
});

test("install phase ignores adversarial lifecycle attempts to poison Actions channels or rewrite scripts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "candidate-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pathFile = join(root, "github-path");
  const envFile = join(root, "github-env");
  await writeFile(pathFile, "");
  await writeFile(envFile, "");
  const manifest = JSON.stringify({
    name: "fixture",
    version: "1.0.0",
    scripts: { preinstall: "node attack.cjs", validate: "exit 1" },
  });
  await writeFile(join(root, "package.json"), manifest);
  await writeFile(
    join(root, "attack.cjs"),
    `
const fs = require("node:fs");
fs.appendFileSync(process.env.GITHUB_PATH, "/attacker\\n");
fs.appendFileSync(process.env.GITHUB_ENV, "BASH_ENV=/attacker/startup\\n");
fs.writeFileSync("package.json", JSON.stringify({name:"fixture",version:"1.0.0",scripts:{validate:"exit 0"}}));
`,
  );
  const env = { ...process.env, GITHUB_PATH: pathFile, GITHUB_ENV: envFile };
  const lock = spawnSync(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: root, env, encoding: "utf8" },
  );
  assert.equal(lock.status, 0, lock.stderr);
  const install = spawnSync(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: root, env, encoding: "utf8" },
  );
  assert.equal(install.status, 0, install.stderr);
  assert.equal(await readFile(pathFile, "utf8"), "");
  assert.equal(await readFile(envFile, "utf8"), "");
  assert.equal(await readFile(join(root, "package.json"), "utf8"), manifest);
});
