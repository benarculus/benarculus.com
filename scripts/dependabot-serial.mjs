import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  realpath,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { sha256 } from "./write-deployment-manifest.mjs";
import { validatePackageUpdate } from "./validate-package-update.mjs";
import { validateBaselineContract } from "./baseline-contract.mjs";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
export const REQUIRED_CHECKS = [
  "Unit tests and coverage",
  "Browser regression tests",
  "Production and preview builds",
  "Malware advisory check / check",
];
const insist = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const digest = (value) => sha256(JSON.stringify(value));

export function validateApproval(approval, now = Date.now()) {
  insist(approval.schema === 1, "Unsupported approval schema");
  insist(
    approval.executionAuthorized === true,
    "Explicit execution approval required",
  );
  insist(
    approval.repo === "benarculus/benarculus.com" &&
      approval.origin === "https://benarculus.com" &&
      SHA.test(approval.startingMain) &&
      SHA.test(approval.verifierRevision) &&
      approval.startingMain === approval.verifierRevision &&
      DIGEST.test(approval.baselineDigest) &&
      DIGEST.test(approval.renderingDigest),
    "Invalid immutable approval identity",
  );
  insist(
    Date.parse(approval.expiresAt) > now &&
      Date.parse(approval.expiresAt) <= now + 24 * 60 * 60 * 1000,
    "Approval expired or exceeds 24 hours",
  );
  insist(
    typeof approval.approvedBy === "string" && approval.approvedBy.length > 0,
    "Approval must identify its human approver",
  );
  insist(
    approval.exclusiveControl?.confirmed === true &&
      typeof approval.exclusiveControl.evidence === "string" &&
      approval.exclusiveControl.evidence.length > 20,
    "Exclusive main/write/deploy control must be independently established",
  );
  insist(
    Array.isArray(approval.prs) &&
      approval.prs.length > 0 &&
      approval.prs.every(
        (pr) =>
          Number.isSafeInteger(pr.number) && pr.number > 0 && SHA.test(pr.head),
      ) &&
      new Set(approval.prs.map((pr) => pr.number)).size === approval.prs.length,
    "Invalid ordered PR/head authorization",
  );
  insist(
    typeof approval.rendering === "object" &&
      digest(approval.rendering) === approval.renderingDigest,
    "Rendering settings changed",
  );
  insist(
    approval.startingDeployment?.sha === approval.startingMain &&
      approval.startingDeployment?.mode === "production" &&
      ["runId", "runAttempt", "deploymentId"].every((key) =>
        /^[1-9]\d*$/.test(approval.startingDeployment?.[key]),
      ),
    "Explicit initial production identity required",
  );
}

export async function atomicCheckpoint(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(state, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(resolve(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function baselineDigest(directory) {
  // Only immutable inputs, never browser profiles/logs from a capture.
  const summary = JSON.parse(
    await readFile(join(directory, "summary.json"), "utf8"),
  );
  const observations = JSON.parse(
    await readFile(join(directory, "observations.json"), "utf8"),
  );
  const screenshots = validateBaselineContract(summary, observations);
  const names = [
    "capture.py",
    "observations.json",
    "summary.json",
    ...screenshots.map((image) => image.path.split("/").at(-1)),
  ].sort();
  insist(new Set(names).size === names.length, "Duplicate baseline files");
  const hash = createHash("sha256");
  for (const name of names) {
    insist(/^[a-zA-Z0-9.-]+$/.test(name), "Unsafe baseline path");
    const bytes = await readFile(join(directory, name));
    const approvedImage = summary.screenshot_manifest.find((image) =>
      image.path.endsWith(`/${name}`),
    );
    if (approvedImage)
      insist(sha256(bytes) === approvedImage.sha256, "Altered baseline image");
    hash.update(`${name}\0${sha256(bytes)}\n`);
  }
  return hash.digest("hex");
}

export async function boundedPoll(
  read,
  accept,
  { timeoutMs = 900_000, intervalMs = 5_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((done) => setTimeout(done, intervalMs));
  }
  throw new Error("Timed out; manual inspection required");
}

export function assertChecks(checks) {
  for (const name of REQUIRED_CHECKS) {
    const matches = checks.filter((check) => check.name === name);
    insist(
      matches.length === 1 &&
        matches[0].app?.slug === "github-actions" &&
        matches[0].status === "completed" &&
        matches[0].conclusion === "success",
      `Missing, duplicate, stale, or unsuccessful required check: ${name}`,
    );
  }
}

export function assertPullRequest(value, approved, base, repo) {
  insist(
    value.head.sha === approved.head && value.base.sha === base,
    "Changed PR head/base; renew approval",
  );
  insist(
    value.base.ref === "main" &&
      value.base.repo?.full_name === repo &&
      value.head.repo?.full_name === repo,
    "PR retargeted or repository identity changed",
  );
  insist(
    value.state === "open" &&
      value.draft === false &&
      value.user.login === "dependabot[bot]" &&
      value.auto_merge === null,
    "PR closed/draft/author/auto-merge state is not authorized",
  );
  insist(
    value.mergeable === true && value.mergeable_state === "clean",
    "Merge readiness unknown/blocked/behind; manual review required",
  );
}

export function selectDeploymentRun(runs, sha, previousRunId) {
  const newer = runs.filter((run) => run.id > Number(previousRunId));
  insist(newer.length <= 1, "Duplicate deployment runs");
  if (!newer.length) return undefined;
  const run = newer[0];
  insist(
    run.head_sha === sha &&
      run.head_branch === "main" &&
      run.event === "push" &&
      run.run_attempt === 1,
    "Wrong/stale/external deployment event or identity",
  );
  if (run.status !== "completed") return undefined;
  insist(run.conclusion === "success", "Deployment failed/cancelled/skipped");
  return run;
}

export function assertCandidateRun(run, base, workflowId, nonce) {
  insist(
    run.status === "completed" &&
      run.conclusion === "success" &&
      run.head_sha === base &&
      run.head_branch === "main" &&
      run.event === "workflow_dispatch" &&
      run.workflow_id === workflowId &&
      run.display_title === nonce &&
      run.run_attempt === 1,
    "Candidate CI failed/stale/rerun/wrong identity",
  );
}

export async function verifyArtifact(fetchBytes, identity) {
  const first = await fetchBytes("/deployment.json");
  insist(first.status === 200, "Deployment marker missing");
  const marker = JSON.parse(first.body.toString());
  for (const key of ["sha", "runId", "runAttempt", "mode"])
    insist(marker[key] === identity[key], `Wrong deployment ${key}`);
  insist(
    marker.schema === 1 && marker.files && Object.keys(marker.files).length > 0,
    "Invalid marker",
  );
  insist(
    marker.files["/index.html"] && marker.files["/404.html"],
    "Missing route hashes",
  );
  for (const [path, hash] of Object.entries(marker.files)) {
    insist(
      /^\/[^?#\\]*$/.test(path) && !path.includes("..") && DIGEST.test(hash),
      "Unsafe artifact manifest",
    );
    const response = await fetchBytes(path);
    insist(
      response.status === 200 && sha256(response.body) === hash,
      `Stale/mixed artifact: ${path}`,
    );
    if (path.endsWith("/index.html")) {
      const route = path.slice(0, -"index.html".length);
      const routed = await fetchBytes(route);
      insist(
        routed.status === 200 && sha256(routed.body) === hash,
        `Stale route: ${route}`,
      );
    }
  }
  const last = await fetchBytes("/deployment.json");
  insist(
    last.status === 200 && first.body.equals(last.body),
    "Deployment changed while verifying",
  );
  return sha256(first.body);
}

// All external effects live behind this interface; fixtures never call GitHub.
export async function serial(approval, io, state) {
  validateApproval(approval, io.now?.() ?? Date.now());
  const approvalDigest = digest(approval);
  insist(
    state.approvalDigest === approvalDigest,
    "Checkpoint belongs to another approval",
  );
  insist(
    state.phase === "verified",
    "Uncertain previous operation; inspect checkpoint manually",
  );
  insist(
    Array.isArray(state.completed) &&
      state.completed.length <= approval.prs.length &&
      state.completed.every(
        (entry, index) =>
          entry.number === approval.prs[index].number &&
          entry.head === approval.prs[index].head &&
          SHA.test(entry.merge) &&
          entry.evidence?.passed === true &&
          DIGEST.test(entry.evidence?.digest),
      ),
    "Invalid completed authorization prefix",
  );
  let base = state.main;
  insist(
    base === (state.completed.at(-1)?.merge ?? approval.startingMain),
    "Invalid checkpoint main",
  );
  for (const pr of approval.prs.slice(state.completed.length)) {
    validateApproval(approval, io.now?.() ?? Date.now());
    await io.validateInputs(approval);
    await io.assertWorld(base, state.deployment);
    const head = await io.pr(pr.number);
    assertPullRequest(head, pr, base, approval.repo);
    assertChecks(await io.checks(pr.head));
    insist(
      (await io.review(pr.number)) === "APPROVED",
      "Required CODEOWNER/review approval missing or unknown",
    );
    validateApproval(approval, io.now?.() ?? Date.now());
    await io.save({
      ...state,
      phase: "candidate-intent",
      pending: { ...pr, base },
    });
    const candidate = await io.candidate(base, pr);
    insist(
      candidate.base === base &&
        candidate.head === pr.head &&
        SHA.test(candidate.merge),
      "Wrong cumulative candidate identity",
    );
    assertChecks(await io.checks(pr.head));
    insist(
      (await io.review(pr.number)) === "APPROVED",
      "Required CODEOWNER/review approval missing or unknown",
    );
    validateApproval(approval, io.now?.() ?? Date.now());
    await io.validateInputs(approval);
    await io.assertWorld(base, state.deployment);
    assertPullRequest(await io.pr(pr.number), pr, base, approval.repo);
    state = {
      ...state,
      phase: "merge-intent",
      pending: { ...pr, base, candidate },
    };
    await io.save(state);
    validateApproval(approval, io.now?.() ?? Date.now());
    let response;
    try {
      response = await io.merge(pr.number, pr.head);
    } catch (error) {
      // Reconcile exactly once for evidence; never retry a potentially accepted mutation.
      const reconciliation = await io.pr(pr.number);
      await io.save({
        ...state,
        phase: "ambiguous-merge",
        reconciliation,
        error: String(error),
      });
      throw new Error(
        "Ambiguous merge response; reconciled evidence saved, manual inspection required",
        { cause: error },
      );
    }
    insist(
      response.merged === true && SHA.test(response.sha),
      "Merge rejected",
    );
    const merge = await io.commit(response.sha);
    insist(
      merge.parents.length === 2 &&
        merge.parents[0].sha === base &&
        merge.parents[1].sha === pr.head,
      "Merge parents differ from approved B/H",
    );
    const mergedPR = await io.pr(pr.number);
    insist(
      mergedPR.merged === true && mergedPR.merge_commit_sha === response.sha,
      "PR merge identity mismatch",
    );
    await io.assertWorld(response.sha, state.deployment);
    const deployment = await io.deployment(response.sha, state.deployment);
    insist(
      deployment.sha === response.sha &&
        deployment.mode === "production" &&
        deployment.runAttempt === "1" &&
        /^[1-9]\d*$/.test(deployment.runId) &&
        Number(deployment.runId) > Number(state.deployment.runId) &&
        /^[1-9]\d*$/.test(deployment.deploymentId) &&
        Number(deployment.deploymentId) > Number(state.deployment.deploymentId),
      "Stale/wrong deployment identity",
    );
    await io.assertWorld(response.sha, deployment);
    const evidence = await io.live(response.sha, deployment, approval);
    insist(
      evidence.passed === true && DIGEST.test(evidence.digest),
      "Live gate failed",
    );
    await io.validateInputs(approval);
    await io.assertWorld(response.sha, deployment);
    state = {
      approvalDigest,
      phase: "verified",
      main: response.sha,
      deployment,
      completed: [
        ...state.completed,
        {
          number: pr.number,
          head: pr.head,
          merge: response.sha,
          candidate,
          evidence,
        },
      ],
    };
    await io.save(state); // Must be durable before even inspecting the next PR.
    base = response.sha;
  }
  return state;
}

function command(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}
const git = (...args) => command("git", args).trim();
const api = (path, method = "GET", data) => {
  const text = command(
    "gh",
    ["api", "-X", method, path, ...(data ? ["--input", "-"] : [])],
    data ? { input: JSON.stringify(data) } : {},
  );
  return text.trim() ? JSON.parse(text) : null;
};

export function githubIO(approval, directory, baseline, save) {
  const repo = `repos/${approval.repo}`;
  const pr = (number) => api(`${repo}/pulls/${number}`);
  const workflows = () => api(`${repo}/actions/workflows`).workflows;
  const pagesRuns = () => {
    const result = api(`${repo}/actions/workflows/pages.yml/runs?per_page=100`);
    insist(
      result.total_count <= 100,
      "Pages run pagination requires manual inspection",
    );
    return result.workflow_runs;
  };
  const deployments = () => {
    const records = api(
      `${repo}/deployments?environment=github-pages&per_page=100`,
    );
    insist(
      records.length < 100,
      "Deployment pagination requires manual inspection",
    );
    return records;
  };
  const deploymentStatus = (deployment, runId, requireSuccess = true) => {
    const statuses = api(
      `${repo}/deployments/${deployment.id}/statuses?per_page=1`,
    );
    const status = statuses[0];
    insist(
      status &&
        typeof status.log_url === "string" &&
        status.log_url.startsWith(
          `https://github.com/${approval.repo}/actions/runs/${runId}/job/`,
        ) &&
        (requireSuccess
          ? status.state === "success" &&
            status.environment_url === `${approval.origin}/`
          : ["queued", "pending", "in_progress", "success"].includes(
              status.state,
            )),
      "Pages environment status/run identity mismatch",
    );
    return status;
  };
  const snapshot = () =>
    pagesRuns().map((run) => ({
      id: run.id,
      sha: run.head_sha,
      branch: run.head_branch,
      attempt: run.run_attempt,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
    }));
  async function assertWorld(base, deployment) {
    insist(
      api(`${repo}/git/ref/heads/main`).object.sha === base,
      "Concurrent main push",
    );
    const runs = snapshot();
    insist(
      !runs.some(
        (run) =>
          run.status !== "completed" &&
          !(
            base !== deployment.sha &&
            run.sha === base &&
            run.branch === "main" &&
            run.event === "push" &&
            run.id > Number(deployment.runId) &&
            run.attempt === 1
          ),
      ),
      "Older/external Pages run is still active",
    );
    const foreign = runs.filter(
      (run) =>
        run.id > Number(deployment.runId) &&
        !(
          base !== deployment.sha &&
          run.sha === base &&
          run.branch === "main" &&
          run.event === "push" &&
          run.attempt === 1
        ),
    );
    insist(
      foreign.length === 0,
      "Concurrent/external/preview deployment detected",
    );
    const previous = runs.find((run) => run.id === Number(deployment.runId));
    insist(
      previous &&
        previous.attempt === Number(deployment.runAttempt) &&
        previous.conclusion === "success",
      "Prior deployment changed or disappeared",
    );
    const environments = deployments();
    const newer = environments.filter(
      (record) => record.id > Number(deployment.deploymentId),
    );
    insist(newer.length <= 1, "Duplicate/external environment deployments");
    if (newer.length) {
      const current = newer[0];
      const associatedRuns = runs.filter(
        (run) =>
          run.sha === base &&
          run.branch === "main" &&
          run.event === "push" &&
          run.attempt === 1 &&
          run.id > Number(deployment.runId),
      );
      insist(
        base !== deployment.sha &&
          current.sha === base &&
          associatedRuns.length === 1,
        "External environment deployment",
      );
      deploymentStatus(current, associatedRuns[0].id, false);
    } else {
      insist(
        environments[0]?.id === Number(deployment.deploymentId) &&
          environments[0].sha === deployment.sha,
        "Initial environment deployment changed",
      );
      deploymentStatus(environments[0], deployment.runId);
    }
  }
  return {
    save,
    pr,
    async review(number) {
      const rules = api(`${repo}/rules/branches/main`);
      const requiredChecks = rules.filter(
        (rule) => rule.type === "required_status_checks",
      );
      const reviewRules = rules.filter((rule) => rule.type === "pull_request");
      insist(
        requiredChecks.length > 0 &&
          requiredChecks.every(
            (rule) =>
              rule.parameters?.strict_required_status_checks_policy === true &&
              rule.parameters.required_status_checks.every((check) =>
                REQUIRED_CHECKS.includes(check.context),
              ),
          ) &&
          reviewRules.length > 0 &&
          reviewRules.every(
            (rule) =>
              rule.parameters?.require_code_owner_review === true &&
              rule.parameters.allowed_merge_methods.includes("merge"),
          ) &&
          rules.every((rule) =>
            [
              "deletion",
              "non_fast_forward",
              "required_status_checks",
              "pull_request",
              "copilot_code_review",
            ].includes(rule.type),
          ),
        "Main policy changed/unknown; required checks and CODEOWNER rules need manual inspection",
      );
      // GitHub computes CODEOWNER satisfaction; a list of review authors is not equivalent.
      // Authentication/unknown decisions fail closed, even for an owner token with bypass rights.
      const decision = JSON.parse(
        command("gh", [
          "pr",
          "view",
          String(number),
          "--repo",
          approval.repo,
          "--json",
          "reviewDecision,mergeStateStatus",
        ]),
      );
      insist(
        decision.mergeStateStatus === "CLEAN",
        "GitHub merge state is not clean",
      );
      return decision.reviewDecision;
    },
    async validateInputs(a) {
      insist(
        git("rev-parse", "HEAD") === a.verifierRevision &&
          git("status", "--porcelain") === "",
        "Verifier must be clean and at the approved revision",
      );
      insist(
        (await baselineDigest(baseline)) === a.baselineDigest,
        "Baseline digest mismatch",
      );
      insist(
        digest(
          JSON.parse(await readFile(join(baseline, "summary.json"), "utf8"))
            .settings,
        ) === a.renderingDigest,
        "Baseline rendering mismatch",
      );
    },
    assertWorld,
    async checks(head) {
      const result = api(`${repo}/commits/${head}/check-runs?per_page=100`);
      insist(
        result.total_count <= 100,
        "Check pagination requires manual inspection",
      );
      return result.check_runs;
    },
    async candidate(base, item) {
      const changed = api(`${repo}/pulls/${item.number}/files?per_page=100`);
      insist(
        changed.length > 0 &&
          changed.length < 100 &&
          changed.every(
            (file) =>
              ["package.json", "package-lock.json"].includes(file.filename) &&
              !file.previous_filename,
          ),
        "Only dependency manifests may change in a serial candidate",
      );
      const manifest = (sha) => {
        const file = api(`${repo}/contents/package.json?ref=${sha}`);
        insist(
          file.type === "file" && file.encoding === "base64",
          "Package manifest must be a regular file",
        );
        return Buffer.from(file.content, "base64").toString("utf8");
      };
      validatePackageUpdate(manifest(base), manifest(item.head));
      const nonce = `serial-${randomUUID()}`;
      const workflow = workflows().find(
        (w) => w.path === ".github/workflows/serial-candidate.yml",
      );
      insist(
        workflow?.state === "active",
        "Trusted candidate workflow is not installed",
      );
      await atomicCheckpoint(
        join(directory, `candidate-dispatch-${nonce}.json`),
        {
          nonce,
          workflowId: workflow.id,
          base,
          head: item.head,
          pr: item.number,
        },
      );
      // Dispatch failure is ambiguous too: never retry.
      api(`${repo}/actions/workflows/${workflow.id}/dispatches`, "POST", {
        ref: "main",
        inputs: { base, head: item.head, pr: String(item.number), nonce },
      });
      const run = await boundedPoll(
        () =>
          api(
            `${repo}/actions/workflows/${workflow.id}/runs?event=workflow_dispatch&per_page=100`,
          ).workflow_runs.filter((r) => r.display_title === nonce),
        (runs) => {
          insist(runs.length <= 1, "Duplicate candidate runs");
          return runs.length === 1;
        },
      );
      const id = run[0].id;
      const finished = await boundedPoll(
        () => api(`${repo}/actions/runs/${id}`),
        (r) => r.status === "completed",
      );
      await atomicCheckpoint(
        join(directory, `candidate-run-${id}.json`),
        finished,
      );
      assertCandidateRun(finished, base, workflow.id, nonce);
      const jobs = api(`${repo}/actions/runs/${id}/jobs?per_page=100`);
      await atomicCheckpoint(
        join(directory, `candidate-jobs-${id}.json`),
        jobs,
      );
      insist(
        jobs.total_count === 4 &&
          jobs.jobs.every((job) => job.conclusion === "success"),
        "Missing/skipped candidate jobs",
      );
      const evidence = join(directory, `candidate-${id}`);
      await mkdir(evidence);
      command("gh", [
        "run",
        "download",
        String(id),
        "--repo",
        approval.repo,
        "--name",
        "candidate-identity",
        "--dir",
        evidence,
      ]);
      const receipt = JSON.parse(
        await readFile(join(evidence, "candidate.json"), "utf8"),
      );
      insist(
        receipt.base === base &&
          receipt.head === item.head &&
          receipt.pr === String(item.number),
        "Candidate receipt mismatch",
      );
      const synthetic = api(`${repo}/commits/${receipt.merge}`);
      insist(
        synthetic.parents.length === 2 &&
          synthetic.parents[0].sha === base &&
          synthetic.parents[1].sha === item.head,
        "Candidate receipt merge parents mismatch",
      );
      return { base, head: item.head, merge: receipt.merge, runId: String(id) };
    },
    merge: (number, head) =>
      api(`${repo}/pulls/${number}/merge`, "PUT", {
        sha: head,
        merge_method: "merge",
      }),
    commit: (sha) => api(`${repo}/commits/${sha}`),
    async deployment(sha, previous) {
      const run = await boundedPoll(async () => {
        await assertWorld(sha, previous);
        return selectDeploymentRun(pagesRuns(), sha, previous.runId);
      }, Boolean);
      const jobs = api(`${repo}/actions/runs/${run.id}/jobs`);
      await atomicCheckpoint(join(directory, `deployment-run-${run.id}.json`), {
        run,
        jobs,
      });
      insist(
        jobs.total_count === 2 &&
          jobs.jobs.every((job) => job.conclusion === "success"),
        "Deployment job identity invalid",
      );
      const environments = deployments().filter(
        (record) => record.id > Number(previous.deploymentId),
      );
      await atomicCheckpoint(
        join(directory, `deployment-environment-${run.id}.json`),
        environments,
      );
      insist(
        environments.length === 1 && environments[0].sha === sha,
        "Wrong/duplicate Pages environment identity",
      );
      deploymentStatus(environments[0], run.id);
      return {
        sha,
        runId: String(run.id),
        runAttempt: "1",
        mode: "production",
        deploymentId: String(environments[0].id),
      };
    },
    async live(sha, deployment, a) {
      const evidence = join(directory, `live-${sha}`);
      await mkdir(evidence);
      let requestNumber = 0;
      const fetchBytes = async (path) => {
        const response = await fetch(`${a.origin}${path}`, {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
        const body = Buffer.from(await response.arrayBuffer());
        await atomicCheckpoint(
          join(evidence, `http-${++requestNumber}-${sha256(path)}.json`),
          {
            path,
            status: response.status,
            headers: Object.fromEntries(response.headers),
            sha256: sha256(body),
            bodyBase64: body.toString("base64"),
          },
        );
        return { status: response.status, body };
      };
      const marker = await verifyArtifact(fetchBytes, deployment);
      command("python3", ["scripts/verify-live.py", baseline, evidence], {
        timeout: 300_000,
      });
      insist(
        (await verifyArtifact(fetchBytes, deployment)) === marker,
        "Marker changed during visual verification",
      );
      const report = {
        passed: true,
        sha,
        deployment,
        marker,
        baselineDigest: a.baselineDigest,
      };
      await atomicCheckpoint(join(evidence, "verified.json"), report);
      return { passed: true, digest: digest(report), directory: evidence };
    },
  };
}

async function main() {
  const [approvalPath, outputPath, baselinePath] = process.argv.slice(2);
  insist(
    approvalPath && outputPath && baselinePath,
    "Usage: node scripts/dependabot-serial.mjs APPROVAL EXTERNAL_STATE_DIRECTORY BASELINE",
  );
  const approvalBytes = await readFile(approvalPath, "utf8");
  const approval = JSON.parse(approvalBytes);
  validateApproval(approval);
  const directory = resolve(outputPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const actual = await realpath(directory);
  const root = git("rev-parse", "--show-toplevel");
  insist(
    actual !== root && !actual.startsWith(`${root}/`),
    "Evidence/checkpoints must be outside source",
  );
  const locks = join(homedir(), ".copilot", "serial-locks");
  await mkdir(locks, { recursive: true, mode: 0o700 });
  const lockPath = join(locks, `${approval.repo.replace("/", "--")}.lock`);
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, approvalDigest: digest(approval) }),
    );
    await lock.sync();
    const checkpoint = join(directory, "checkpoint.json");
    const save = (state) => atomicCheckpoint(checkpoint, state);
    const baseline = await realpath(baselinePath);
    const io = githubIO(approval, directory, baseline, save);
    await io.validateInputs(approval);
    // Never initialize from "latest". The starting deployment is explicitly approved.
    let state;
    try {
      state = JSON.parse(await readFile(checkpoint, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await io.assertWorld(approval.startingMain, approval.startingDeployment);
      // Establish the exact identity and baseline BEFORE the first merge.
      const evidence = await io.live(
        approval.startingMain,
        approval.startingDeployment,
        approval,
      );
      insist(evidence.passed, "Initial live verification failed");
      state = {
        approvalDigest: digest(approval),
        phase: "verified",
        main: approval.startingMain,
        deployment: approval.startingDeployment,
        completed: [],
      };
      await save(state);
    }
    const originalValidation = io.validateInputs;
    io.validateInputs = async (a) => {
      insist(
        (await readFile(approvalPath, "utf8")) === approvalBytes,
        "Approval file changed",
      );
      await originalValidation(a);
    };
    try {
      await serial(approval, io, state);
    } catch (error) {
      const last = JSON.parse(await readFile(checkpoint, "utf8"));
      await save({
        ...last,
        phase: "stopped",
        previousPhase: last.phase,
        error: String(error),
      });
      throw error;
    }
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
