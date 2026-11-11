import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  serial,
  digest,
  validateApproval,
  REQUIRED_CHECKS,
  atomicCheckpoint,
  assertChecks,
  verifyArtifact,
  boundedPoll,
  baselineDigest,
  selectDeploymentRun,
  assertCandidateRun,
} from "../../scripts/dependabot-serial.mjs";
import {
  sha256,
  deploymentManifest,
} from "../../scripts/write-deployment-manifest.mjs";

const sha = (n) => n.toString(16).padStart(40, "0");
const now = Date.parse("2026-11-11T21:00:00Z");
function approval() {
  const rendering = { desktop: { width: 1440, height: 1000 }, locale: "en-US" };
  return {
    schema: 1,
    repo: "benarculus/benarculus.com",
    origin: "https://benarculus.com",
    startingMain: sha(1),
    startingDeployment: {
      sha: sha(1),
      mode: "production",
      runId: "10",
      runAttempt: "1",
      deploymentId: "100",
    },
    verifierRevision: sha(1),
    baselineDigest: "b".repeat(64),
    rendering,
    renderingDigest: digest(rendering),
    executionAuthorized: true,
    approvedBy: "fixture-human",
    exclusiveControl: {
      confirmed: true,
      evidence: "fixture: independently held main and deployment freeze",
    },
    expiresAt: "2026-11-11T22:00:00Z",
    prs: [
      { number: 22, head: sha(2) },
      { number: 21, head: sha(3) },
    ],
  };
}
const checks = () =>
  REQUIRED_CHECKS.map((name) => ({
    name,
    app: { slug: "github-actions" },
    status: "completed",
    conclusion: "success",
  }));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "serial-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const a = approval();
  const events = [];
  let base = a.startingMain;
  const merged = new Map();
  const state = {
    approvalDigest: digest(a),
    phase: "verified",
    main: base,
    deployment: { ...a.startingDeployment },
    completed: [],
  };
  const io = {
    now: () => now,
    async validateInputs(value) {
      assert.equal(value.baselineDigest, a.baselineDigest);
      events.push("inputs");
    },
    async assertWorld(expected) {
      assert.equal(base, expected, "Concurrent push");
    },
    async pr(number) {
      const item = a.prs.find((p) => p.number === number);
      const merge = merged.get(number);
      return {
        state: merge ? "closed" : "open",
        draft: false,
        user: { login: "dependabot[bot]" },
        head: { sha: item.head, repo: { full_name: a.repo } },
        base: { sha: base, ref: "main", repo: { full_name: a.repo } },
        auto_merge: null,
        mergeable: true,
        mergeable_state: "clean",
        merged: Boolean(merge),
        merge_commit_sha: merge,
      };
    },
    async checks() {
      return checks();
    },
    async review() {
      return "APPROVED";
    },
    async candidate(b, item) {
      events.push(`candidate-${item.number}`);
      return { base: b, head: item.head, merge: sha(item.number + 100) };
    },
    async save(value) {
      await atomicCheckpoint(join(directory, "checkpoint.json"), value);
      assert.deepEqual(
        JSON.parse(await readFile(join(directory, "checkpoint.json"), "utf8")),
        value,
      );
      events.push(`durable-${value.phase}-${value.completed.length}`);
    },
    async merge(number, head) {
      assert.equal(head, a.prs.find((p) => p.number === number).head);
      events.push(`merge-${number}`);
      base = sha(number + 200);
      merged.set(number, base);
      return { merged: true, sha: base };
    },
    async commit(value) {
      const number = [...merged].find(([, merge]) => merge === value)[0];
      return {
        parents: [
          { sha: number === 22 ? sha(1) : sha(222) },
          { sha: a.prs.find((p) => p.number === number).head },
        ],
      };
    },
    async deployment(value) {
      events.push(`deployment-${value}`);
      return {
        sha: value,
        runId: value === sha(222) ? "11" : "12",
        runAttempt: "1",
        mode: "production",
        deploymentId: value === sha(222) ? "101" : "102",
      };
    },
    async live(value) {
      events.push(`live-${value}`);
      return { passed: true, digest: "e".repeat(64) };
    },
  };
  return { a, io, state, events, directory };
}

test("two PRs proceed only after first durable verified checkpoint", async (t) => {
  const f = await fixture(t);
  const final = await serial(f.a, f.io, f.state);
  assert.deepEqual(
    final.completed.map((entry) => entry.number),
    [22, 21],
  );
  assert(
    f.events.indexOf("durable-verified-1") < f.events.indexOf("candidate-21"),
  );
  assert(
    f.events.indexOf(`live-${sha(222)}`) <
      f.events.indexOf("durable-verified-1"),
  );
  assert(f.events.indexOf("durable-verified-1") < f.events.indexOf("merge-21"));
});

for (const stage of [
  "validateInputs",
  "assertWorld",
  "checks",
  "review",
  "candidate",
  "commit",
  "deployment",
  "live",
  "save",
]) {
  test(`two-PR fixture stops at ${stage} failure`, async (t) => {
    const f = await fixture(t);
    f.io[stage] = async () => {
      throw new Error(`injected-${stage}`);
    };
    await assert.rejects(serial(f.a, f.io, f.state));
    assert(!f.events.includes("merge-21"));
    if (
      [
        "validateInputs",
        "assertWorld",
        "checks",
        "review",
        "candidate",
        "save",
      ].includes(stage)
    )
      assert(!f.events.includes("merge-22"));
  });
}

for (const key of ["head", "base"]) {
  for (const beforeMerge of [false, true]) {
    test(`changed ${key} ${beforeMerge ? "after candidate" : "initially"} stops serial rollout`, async (t) => {
      const f = await fixture(t);
      const original = f.io.pr;
      let reads = 0;
      f.io.pr = async (number) => {
        const value = await original(number);
        if (++reads >= (beforeMerge ? 2 : 1)) value[key].sha = sha(999);
        return value;
      };
      await assert.rejects(serial(f.a, f.io, f.state), /head\/base/);
      assert(!f.events.some((event) => event.startsWith("merge-")));
    });
  }
}

test("ambiguous merge is reconciled once and never retried, even when accepted", async (t) => {
  const f = await fixture(t);
  const merge = f.io.merge;
  f.io.merge = async (...args) => {
    await merge(...args);
    throw new Error("lost response");
  };
  await assert.rejects(serial(f.a, f.io, f.state), /Ambiguous/);
  const checkpoint = JSON.parse(
    await readFile(join(f.directory, "checkpoint.json"), "utf8"),
  );
  assert.equal(checkpoint.phase, "ambiguous-merge");
  assert.equal(checkpoint.reconciliation.merged, true);
  await assert.rejects(serial(f.a, f.io, checkpoint), /Uncertain/);
  assert.deepEqual(
    f.events.filter((event) => event.startsWith("merge-")),
    ["merge-22"],
  );
});

test("uncertain candidate dispatch cannot be resumed automatically", async (t) => {
  const f = await fixture(t);
  f.io.candidate = async () => {
    throw new Error("dispatch response lost");
  };
  await assert.rejects(serial(f.a, f.io, f.state));
  const checkpoint = JSON.parse(
    await readFile(join(f.directory, "checkpoint.json"), "utf8"),
  );
  assert.equal(checkpoint.phase, "candidate-intent");
  await assert.rejects(serial(f.a, f.io, checkpoint), /Uncertain/);
});

for (const status of [
  "failure",
  "skipped",
  "cancelled",
  "neutral",
  "timed_out",
  null,
]) {
  test(`required check ${status} blocks first and second merge`, async (t) => {
    const f = await fixture(t);
    f.io.checks = async () =>
      checks().map((check, index) =>
        index ? check : { ...check, conclusion: status },
      );
    await assert.rejects(serial(f.a, f.io, f.state), /required check/);
    assert(!f.events.some((event) => event.startsWith("merge-")));
  });
}
test("missing, duplicate, pending and foreign-app checks are rejected", () => {
  for (const invalid of [
    checks().slice(1),
    [...checks(), checks()[0]],
    checks().map((c) => ({ ...c, status: "in_progress" })),
    checks().map((c) => ({ ...c, app: { slug: "other" } })),
  ])
    assert.throws(() => assertChecks(invalid));
});

for (const reason of [
  "expired",
  "not-approved",
  "no-exclusive-control",
  "changed-rendering",
  "changed-approval",
]) {
  test(`${reason} never enters rollout`, async (t) => {
    const f = await fixture(t);
    if (reason === "expired") f.a.expiresAt = "2026-11-11T20:00:00Z";
    if (reason === "not-approved") f.a.executionAuthorized = false;
    if (reason === "no-exclusive-control")
      f.a.exclusiveControl.confirmed = false;
    if (reason === "changed-rendering") f.a.rendering.locale = "en-GB";
    if (reason === "changed-approval") f.a.prs[1].head = sha(777);
    await assert.rejects(serial(f.a, f.io, f.state));
    assert.deepEqual(f.events, []);
  });
}

for (const field of ["base", "head"]) {
  test(`wrong cumulative candidate ${field} stops before merge`, async (t) => {
    const f = await fixture(t);
    const original = f.io.candidate;
    f.io.candidate = async (...args) => ({
      ...(await original(...args)),
      [field]: sha(999),
    });
    await assert.rejects(serial(f.a, f.io, f.state), /candidate identity/);
    assert(!f.events.includes("merge-22"));
  });
}

test("external deployment/push after first verification prevents second merge", async (t) => {
  const f = await fixture(t);
  const original = f.io.assertWorld;
  f.io.assertWorld = async (...args) => {
    if (f.events.includes("durable-verified-1"))
      throw new Error("external deployment");
    await original(...args);
  };
  await assert.rejects(serial(f.a, f.io, f.state), /external deployment/);
  assert(f.events.includes("merge-22"));
  assert(!f.events.includes("merge-21"));
});

test("baseline alteration stops before any merge", async (t) => {
  const f = await fixture(t);
  const baseline = join(f.directory, "baseline");
  await mkdir(baseline);
  await writeFile(join(baseline, "capture.py"), "approved capture");
  await writeFile(join(baseline, "observations.json"), "{}");
  await writeFile(join(baseline, "home.png"), "original");
  await writeFile(
    join(baseline, "summary.json"),
    JSON.stringify({
      screenshot_manifest: [
        { path: "/original/home.png", sha256: sha256("original") },
      ],
    }),
  );
  const approved = await baselineDigest(baseline);
  await writeFile(join(baseline, "home.png"), "altered");
  f.io.validateInputs = async () =>
    assert.equal(await baselineDigest(baseline), approved);
  await assert.rejects(serial(f.a, f.io, f.state), /Altered baseline/);
  assert(!f.events.includes("merge-22"));
});

function artifact() {
  const identity = {
    sha: sha(222),
    runId: "11",
    runAttempt: "1",
    mode: "production",
    deploymentId: "101",
  };
  const files = {
    "/index.html": Buffer.from("<html>home</html>"),
    "/404.html": Buffer.from("<html>not found</html>"),
    "/style.css": Buffer.from("body{}"),
    "/rss.xml": Buffer.from("<rss/>"),
  };
  const marker = {
    schema: 1,
    ...identity,
    files: Object.fromEntries(
      Object.entries(files).map(([p, b]) => [p, sha256(b)]),
    ),
  };
  const fetchBytes = async (path) => ({
    status: 200,
    body:
      path === "/deployment.json"
        ? Buffer.from(JSON.stringify(marker))
        : files[path === "/" ? "/index.html" : path],
  });
  return { identity, files, marker, fetchBytes };
}
test("manifest validates every file and its public route", async () => {
  const f = artifact();
  assert.match(
    await verifyArtifact(f.fetchBytes, f.identity),
    /^[a-f0-9]{64}$/,
  );
});
for (const fault of [
  "wrong-sha",
  "preview",
  "wrong-run",
  "rerun",
  "missing-marker",
  "mixed-html",
  "mixed-asset",
  "stale-route",
  "marker-changed",
]) {
  test(`two-PR fixture never continues on ${fault}`, async (t) => {
    const f = await fixture(t);
    const a = artifact();
    let reads = 0;
    let reachedLive = false;
    f.io.live = async () => {
      reachedLive = true;
      const fetchBytes = async (path) => {
        const value = await a.fetchBytes(path);
        if (fault === "wrong-sha") a.marker.sha = sha(333);
        if (fault === "preview") a.marker.mode = "preview";
        if (fault === "wrong-run") a.marker.runId = "12";
        if (fault === "rerun") a.marker.runAttempt = "2";
        if (fault === "missing-marker" && path === "/deployment.json")
          value.status = 404;
        if (
          (fault === "mixed-html" && path === "/index.html") ||
          (fault === "mixed-asset" && path === "/style.css") ||
          (fault === "stale-route" && path === "/")
        )
          value.body = Buffer.from("stale");
        if (
          fault === "marker-changed" &&
          path === "/deployment.json" &&
          ++reads === 2
        )
          value.body = Buffer.from("{}");
        // Reflect marker identity mutations on the very first marker response.
        if (path === "/deployment.json" && fault !== "marker-changed")
          value.body = Buffer.from(JSON.stringify(a.marker));
        return value;
      };
      await verifyArtifact(fetchBytes, a.identity);
      return { passed: true, digest: "e".repeat(64) };
    };
    await assert.rejects(serial(f.a, f.io, f.state));
    assert(reachedLive);
    assert(!f.events.includes("merge-21"));
  });
}
for (const failure of [
  "screenshot",
  "route",
  "feed",
  "duplicate-deployment",
  "failed-deployment",
  "stale-deployment",
]) {
  test(`two-PR fixture stops for ${failure}`, async (t) => {
    const f = await fixture(t);
    let reachedFailure = false;
    if (failure.includes("deployment")) {
      f.io.deployment = async () => {
        reachedFailure = true;
        const run = {
          id: 11,
          head_sha: sha(222),
          head_branch: "main",
          event: "push",
          run_attempt: 1,
          status: "completed",
          conclusion: "success",
        };
        if (failure === "failed-deployment") run.conclusion = "failure";
        if (failure === "stale-deployment") run.head_sha = sha(111);
        return selectDeploymentRun(
          failure === "duplicate-deployment"
            ? [run, { ...run, id: 12 }]
            : [run],
          sha(222),
          "10",
        );
      };
    } else {
      f.io.live = async () => {
        reachedFailure = true;
        throw new Error(failure);
      };
    }
    await assert.rejects(serial(f.a, f.io, f.state));
    assert(reachedFailure);
    assert(!f.events.includes("merge-21"));
  });
}

test("pending deployment is not success; wrong SHA/event/branch/attempt/status never passes", () => {
  const run = {
    id: 11,
    head_sha: sha(222),
    head_branch: "main",
    event: "push",
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
  };
  assert.equal(selectDeploymentRun([], sha(222), "10"), undefined);
  assert.equal(
    selectDeploymentRun([{ ...run, status: "queued" }], sha(222), "10"),
    undefined,
  );
  for (const patch of [
    { head_sha: sha(7) },
    { head_branch: "other" },
    { event: "workflow_dispatch" },
    { run_attempt: 2 },
    { conclusion: "skipped" },
    { conclusion: "cancelled" },
  ])
    assert.throws(() =>
      selectDeploymentRun([{ ...run, ...patch }], sha(222), "10"),
    );
});

test("candidate run must bind trusted base, workflow, nonce and attempt", () => {
  const run = {
    status: "completed",
    conclusion: "success",
    head_sha: sha(1),
    head_branch: "main",
    event: "workflow_dispatch",
    workflow_id: 123,
    display_title: "nonce",
    run_attempt: 1,
  };
  assertCandidateRun(run, sha(1), 123, "nonce");
  for (const patch of [
    { head_sha: sha(2) },
    { workflow_id: 124 },
    { display_title: "other" },
    { event: "pull_request" },
    { run_attempt: 2 },
    { status: "queued" },
    { conclusion: "skipped" },
    { conclusion: "cancelled" },
  ])
    assert.throws(() =>
      assertCandidateRun({ ...run, ...patch }, sha(1), 123, "nonce"),
    );
});

test("approval expiring during candidate CI stops before merge", async (t) => {
  const f = await fixture(t);
  const candidate = f.io.candidate;
  f.io.candidate = async (...args) => {
    const result = await candidate(...args);
    f.io.now = () => Date.parse(f.a.expiresAt) + 1;
    return result;
  };
  await assert.rejects(serial(f.a, f.io, f.state), /expired/);
  assert(!f.events.includes("merge-22"));
});

for (const transition of [
  "base-ref",
  "foreign-base",
  "foreign-head",
  "closed",
  "draft",
  "auto-merge",
  "author",
  "unknown-mergeability",
  "blocked",
  "behind",
]) {
  for (const finalRead of [false, true]) {
    test(`${transition} ${finalRead ? "after candidate" : "initially"} cannot invoke a merge`, async (t) => {
      const f = await fixture(t);
      const original = f.io.pr;
      let reads = 0;
      f.io.pr = async (...args) => {
        const value = await original(...args);
        if (++reads >= (finalRead ? 2 : 1)) {
          if (transition === "base-ref")
            value.base.ref = "other-branch-at-same-sha";
          if (transition === "foreign-base")
            value.base.repo.full_name = "foreign/repo";
          if (transition === "foreign-head")
            value.head.repo.full_name = "foreign/repo";
          if (transition === "closed") value.state = "closed";
          if (transition === "draft") value.draft = true;
          if (transition === "auto-merge")
            value.auto_merge = { enabled_by: "someone" };
          if (transition === "author") value.user.login = "other-bot";
          if (transition === "unknown-mergeability") value.mergeable = null;
          if (transition === "blocked") value.mergeable_state = "blocked";
          if (transition === "behind") value.mergeable_state = "behind";
        }
        return value;
      };
      await assert.rejects(serial(f.a, f.io, f.state));
      assert(!f.events.some((event) => event.startsWith("merge-")));
    });
  }
}

for (const review of [
  "REVIEW_REQUIRED",
  "CHANGES_REQUESTED",
  null,
  undefined,
]) {
  for (const finalRead of [false, true]) {
    test(`required review ${review} ${finalRead ? "after candidate" : "initially"} blocks even an owner-token merge`, async (t) => {
      const f = await fixture(t);
      let reads = 0;
      f.io.review = async () =>
        ++reads >= (finalRead ? 2 : 1) ? review : "APPROVED";
      await assert.rejects(serial(f.a, f.io, f.state), /CODEOWNER/);
      assert(!f.events.some((event) => event.startsWith("merge-")));
    });
  }
}
test("bounded polling times out and does not accept a missing result", async () => {
  await assert.rejects(
    boundedPoll(
      async () => [],
      () => false,
      { timeoutMs: 5, intervalMs: 1 },
    ),
    /Timed out/,
  );
});
test("approval cannot silently extend beyond one day", () => {
  const a = approval();
  a.expiresAt = "2026-12-01T22:00:00Z";
  assert.throws(() => validateApproval(a, now), /24 hours/);
});
test("deployment manifest captures final route and asset bytes only", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pages-manifest-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "index.html"), "production");
  await writeFile(join(dir, "404.html"), "missing");
  await writeFile(join(dir, "deployment.json"), "old marker");
  const result = await deploymentManifest(dir, artifact().identity);
  assert.deepEqual(result.files, {
    "/404.html": sha256("missing"),
    "/index.html": sha256("production"),
  });
  await assert.rejects(
    deploymentManifest(dir, { ...artifact().identity, mode: "unknown" }),
  );
});
