import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { validatePackageUpdate } from "../../scripts/validate-package-update.mjs";

const trustedManifest = {
  name: "fixture",
  private: true,
  type: "module",
  engines: { node: ">=24" },
  scripts: {
    validate: "node trusted-validation.mjs",
    "build:preview": "node trusted-build.mjs",
    "test:generated:preview": "node trusted-assertions.mjs",
    preinstall: "node trusted-install.mjs",
  },
  dependencies: { astro: "7.3.1" },
  devDependencies: { "@playwright/test": "1.63.0" },
};
const manifestText = (value) => JSON.stringify(value);

test("direct production/dev version updates and lock-only updates remain valid", () => {
  const updated = structuredClone(trustedManifest);
  updated.dependencies.astro = "7.3.2";
  updated.devDependencies["@playwright/test"] = "1.64.0";
  validatePackageUpdate(manifestText(trustedManifest), manifestText(updated));
  validatePackageUpdate(
    manifestText(trustedManifest),
    manifestText(trustedManifest),
  );
});

const invalidManifestChanges = {
  "successful no-op validation": (m) => {
    m.scripts.validate = "true";
  },
  "successful no-op preview build": (m) => {
    m.scripts["build:preview"] = "true";
  },
  "successful no-op preview assertions": (m) => {
    m.scripts["test:generated:preview"] = "true";
  },
  "lifecycle addition": (m) => {
    m.scripts.postinstall = "node unexpected.mjs";
  },
  "lifecycle removal": (m) => {
    delete m.scripts.preinstall;
  },
  "scripts removal": (m) => {
    delete m.scripts;
  },
  "engine changes": (m) => {
    m.engines.node = ">=1";
  },
  "package manager": (m) => {
    m.packageManager = "npm@1.0.0";
  },
  "module type": (m) => {
    m.type = "commonjs";
  },
  metadata: (m) => {
    m.name = "different";
  },
  "tool config": (m) => {
    m.config = { executable: "unexpected" };
  },
  overrides: (m) => {
    m.overrides = { astro: "0.0.1" };
  },
  workspaces: (m) => {
    m.workspaces = ["other"];
  },
  "optional section": (m) => {
    m.optionalDependencies = { unexpected: "1.0.0" };
  },
  "peer section": (m) => {
    m.peerDependencies = { unexpected: "1.0.0" };
  },
  "dependency section removal": (m) => {
    delete m.dependencies;
  },
  "dependency array": (m) => {
    m.dependencies = [];
  },
  "dependency null": (m) => {
    m.dependencies = null;
  },
  "dependency scalar": (m) => {
    m.dependencies = "unexpected";
  },
  "dependency object version": (m) => {
    m.dependencies.astro = { version: "7.3.2" };
  },
  "dependency null version": (m) => {
    m.dependencies.astro = null;
  },
  "dependency name addition": (m) => {
    m.dependencies.unexpected = "1.0.0";
  },
  "dependency name removal": (m) => {
    delete m.dependencies.astro;
  },
  "dependency section move": (m) => {
    m.devDependencies.astro = m.dependencies.astro;
    delete m.dependencies.astro;
  },
  "local dependency": (m) => {
    m.dependencies.astro = "file:../unexpected";
  },
  "git dependency": (m) => {
    m.dependencies.astro = "git+https://example.invalid/repo";
  },
  "npm alias": (m) => {
    m.dependencies.astro = "npm:unexpected@1.0.0";
  },
};
for (const [label, mutate] of Object.entries(invalidManifestChanges)) {
  test(`manifest preflight rejects ${label}`, () => {
    const updated = structuredClone(trustedManifest);
    mutate(updated);
    assert.throws(() =>
      validatePackageUpdate(
        manifestText(trustedManifest),
        manifestText(updated),
      ),
    );
  });
}
test("ambiguous JSON, escaped duplicate keys and invalid root shapes fail closed", () => {
  for (const text of [
    "null",
    "[]",
    '"string"',
    "1",
    "{",
    '{"scripts":{},"scripts":{}}',
    '{"scripts":{"validate":"true","\\u0076alidate":"false"}}',
    '{"dependencies":{"astro":"7.3.1","astro":"7.3.2"}}',
  ]) {
    assert.throws(() =>
      validatePackageUpdate(manifestText(trustedManifest), text),
    );
    assert.throws(() =>
      validatePackageUpdate(text, manifestText(trustedManifest)),
    );
  }
});

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
  const baseText = manifestText(trustedManifest);
  const baseTree = tree({ "package.json": baseText });
  const base = git(["commit-tree", baseTree, "-m", "base"]);
  const head = git([
    "commit-tree",
    tree({ "package.json": baseText, "package-lock.json": "{}\n" }),
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
  function candidateManifest(text) {
    const candidateHead = git([
      "commit-tree",
      tree({ "package.json": text, "package-lock.json": "{}\n" }),
      "-p",
      base,
      "-m",
      "update",
    ]);
    const synthetic = git([
      "commit-tree",
      git(["rev-parse", `${candidateHead}^{tree}`]),
      "-p",
      base,
      "-p",
      candidateHead,
      "-m",
      "synthetic",
    ]);
    git(["update-ref", "refs/pull/22/merge", synthetic]);
    return run({ HEAD: candidateHead });
  }
  const versionUpdate = structuredClone(trustedManifest);
  versionUpdate.dependencies.astro = "7.3.2";
  assert.equal(candidateManifest(manifestText(versionUpdate)).status, 0);
  for (const [label, mutate] of Object.entries(invalidManifestChanges)) {
    const updated = structuredClone(trustedManifest);
    mutate(updated);
    assert.notEqual(candidateManifest(manifestText(updated)).status, 0, label);
  }
  assert.notEqual(
    candidateManifest(
      baseText.replace(
        '"astro":"7.3.1"',
        '"astro":"7.3.1","\\u0061stro":"7.3.2"',
      ),
    ).status,
    0,
  );
  git(["update-ref", "refs/pull/22/merge", merge]);
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
