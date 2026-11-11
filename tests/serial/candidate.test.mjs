import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("digest/verifier helpers can be imported from an inline preparation command", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'await import("./scripts/dependabot-serial.mjs"); await import("./scripts/write-deployment-manifest.mjs");',
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("trusted candidate script validates immutable B/H and restricted diff before code execution", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "candidate-parents-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const git = (args, input) =>
    execFileSync("git", args, {
      cwd: directory,
      env,
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  git(["init", "--initial-branch=main"]);
  git(["remote", "add", "origin", directory]);
  function tree(files) {
    return git(
      ["mktree"],
      Object.entries(files)
        .sort()
        .map(
          ([path, body]) =>
            `100644 blob ${git(["hash-object", "-w", "--stdin"], body)}\t${path}\n`,
        )
        .join(""),
    );
  }
  const baseTree = tree({ "package.json": "{}\n" });
  const base = git(["commit-tree", baseTree, "-m", "base"]);
  const head = git([
    "commit-tree",
    tree({ "package.json": "{}\n", "package-lock.json": "{}\n" }),
    "-p",
    base,
    "-m",
    "dependency",
  ]);
  const merge = git([
    "commit-tree",
    git(["rev-parse", `${head}^{tree}`]),
    "-p",
    base,
    "-p",
    head,
    "-m",
    "synthetic",
  ]);
  git(["update-ref", "refs/heads/main", base]);
  git(["update-ref", "refs/pull/22/merge", merge]);
  const script = resolve("scripts/validate-candidate.mjs");
  function run(patch = {}) {
    return spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...env,
        BASE: base,
        HEAD: head,
        PR: "22",
        GITHUB_SHA: base,
        GITHUB_REPOSITORY: "benarculus/benarculus.com",
        GITHUB_OUTPUT: join(directory, "outputs"),
        ...patch,
      },
    });
  }
  assert.equal(run().status, 0);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "candidate.json"), "utf8")),
    {
      base,
      head,
      pr: "22",
      merge,
    },
  );
  for (const patch of [
    { HEAD: base },
    { BASE: "refs/heads/main" },
    { PR: "22;exit 0" },
    { GITHUB_SHA: head },
    { GITHUB_REPOSITORY: "foreign/repo" },
  ])
    assert.notEqual(run(patch).status, 0);
  git(["update-ref", "refs/heads/main", head]);
  assert.match(run().stderr, /Main changed/);
  git(["update-ref", "refs/heads/main", base]);
  const unsafe = git([
    "commit-tree",
    tree({
      "package.json": "{}\n",
      "unsafe.mjs": "throw new Error('must never execute')\n",
    }),
    "-p",
    base,
    "-m",
    "unsafe",
  ]);
  const unsafeMerge = git([
    "commit-tree",
    git(["rev-parse", `${unsafe}^{tree}`]),
    "-p",
    base,
    "-p",
    unsafe,
    "-m",
    "synthetic",
  ]);
  git(["update-ref", "refs/pull/22/merge", unsafeMerge]);
  assert.match(run({ HEAD: unsafe }).stderr, /Candidate changes trusted code/);
});
