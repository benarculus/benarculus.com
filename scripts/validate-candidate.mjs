import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const { BASE, HEAD, PR, GITHUB_REPOSITORY, GITHUB_OUTPUT, GITHUB_SHA } =
  process.env;
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};
requireValue(
  /^[a-f0-9]{40}$/.test(BASE) && /^[a-f0-9]{40}$/.test(HEAD),
  "Full B/H SHAs required",
);
requireValue(
  /^[1-9]\d*$/.test(PR) && GITHUB_REPOSITORY === "benarculus/benarculus.com",
  "Invalid PR/repository",
);
requireValue(
  GITHUB_SHA === BASE,
  "Dispatch must execute trusted workflow from exact base",
);
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", timeout: 60_000 }).trim();
git("fetch", "--no-tags", "origin", `refs/pull/${PR}/merge`);
const merge = git("rev-parse", "FETCH_HEAD");
requireValue(
  git("show", "-s", "--format=%P", merge) === `${BASE} ${HEAD}`,
  "Synthetic merge parents are not exact B/H",
);
git("fetch", "--no-tags", "origin", "refs/heads/main");
requireValue(
  git("rev-parse", "FETCH_HEAD") === BASE,
  "Main changed during candidate setup",
);
const files = git("diff", "--name-only", BASE, merge).split("\n");
requireValue(
  files.length > 0 &&
    files.every((path) => ["package.json", "package-lock.json"].includes(path)),
  "Candidate changes trusted code/workflows; manual review required",
);
writeFileSync(
  "candidate.json",
  JSON.stringify({ base: BASE, head: HEAD, pr: PR, merge }),
);
appendFileSync(GITHUB_OUTPUT, `merge=${merge}\n`);
