# benarculus.com

This repository contains the source for [benarculus.com](https://benarculus.com/), Ben Arculus' personal site and notes archive.

The site is built with Astro, authored in Markdown, and deployed to GitHub Pages. It publishes the homepage, blog index, article pages, RSS feed, sitemap, and public media for the site.

## Local development

Use Node.js 24.8.0 or a compatible Node.js 24 release, then install the committed dependency graph:

```sh
npm ci
```

Run the development server:

```sh
npm run dev
```

Before proposing publication, run the validation suite:

```sh
npm run validate
```

## Publishing model

Preview builds target `https://benarculus.github.io/benarculus.com/` and are produced by manually
dispatching the Pages workflow in preview mode. Production builds target `https://benarculus.com/`
and are produced automatically on every push to `main`; GitHub Pages serves this apex domain with
HTTPS enforced.

Every selected Pages build now receives a public `deployment.json` immediately before upload.
It binds the commit, production/preview mode, Actions run/attempt, and SHA-256 of every
published route and asset. Preview dispatch still publishes through the same Pages
environment; it is **not** an isolated staging deployment.

## Serial Dependabot regression gate

The opt-in controller is `npm run dependabot:serial -- APPROVAL.json STATE_DIRECTORY BASELINE_DIRECTORY`.
Do not run it as part of ordinary CI. It can dispatch candidate CI and merge approved PRs;
implementation/testing does not authorize either production execution or a rollout.
The checked-in code contains no approval or executable PR list. `npm run test:serial`
uses two-PR fixtures only and does not contact GitHub.

Before any real run, integrate/review this change using the normal CODEOWNER process.
The trusted `serial-candidate.yml` workflow and deployment marker must already be on
`main`, with an identified successful **production** deployment. Independently establish
exclusive control of all repository writers (including PR retarget/head/auto-merge
changes and review decisions) and Pages publishers, including humans, bots,
queued workflows, reruns, and preview dispatch. This implementation does not change
repository rules, acquire a distributed GitHub lock, or establish that control for you.
Its per-repository local lock only prevents concurrent controllers on the same host.
Without that external freeze, **do not authorize execution**: GitHub's merge API pins
the PR head, not the base. Re-reading main cannot atomically lock main, and detecting
a racing push after a merge cannot undo that merge.

Supply a human-reviewed JSON approval with all of these fields:

| Field                               | Required value                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`, `repo`, `origin`          | `1`, `benarculus/benarculus.com`, `https://benarculus.com`                                                                                                                                  |
| `executionAuthorized`, `approvedBy` | Explicit `true` and human approver identifier; never inferred from screenshot acceptance                                                                                                    |
| `expiresAt`                         | UTC timestamp no more than 24 hours ahead; checked again for each PR                                                                                                                        |
| `startingMain`                      | Exact 40-character current main SHA                                                                                                                                                         |
| `startingDeployment`                | `{ "sha": "...", "mode": "production", "runId": "...", "runAttempt": "...", "deploymentId": "..." }`, matching the exact initial Pages run, github-pages environment deployment, and marker |
| `prs`                               | Ordered `{ "number": 22, "head": "<40-character SHA>" }` entries; refreshing a head requires renewed approval                                                                               |
| `verifierRevision`                  | Exact clean local Git revision containing this trusted controller/verifier; must equal `startingMain`                                                                                       |
| `baselineDigest`                    | SHA-256 from the exported `baselineDigest(directory)` helper                                                                                                                                |
| `rendering`, `renderingDigest`      | Exact approved `summary.json` settings object and `digest(rendering)`                                                                                                                       |
| `exclusiveControl`                  | `{ "confirmed": true, "evidence": "<independent main/write/deploy freeze evidence>" }`; an assertion is not a substitute for actually establishing control                                  |

Computing a digest is preparation, **not approval**. The baseline digest binds `capture.py`,
`summary.json`, `observations.json`, and every approved PNG, including their recorded hashes.
Use the original approved baseline unchanged in an external directory. The live verifier
replays its digest-bound CDP capture using Python's standard library and the exact cached
Chromium binary, OS, system fonts, user agent, viewports, mobile emulation, DPR, locale,
timezone, color scheme, and reduced-motion settings. It is independent of candidate
Playwright/browser upgrades. It compares all 16 viewport/full-page PNGs using decoded
pixels, with **zero** changed pixels allowed, and checks content, metadata, actual 404,
navigation, images, overflow, errors, feeds, sitemap, robots, and local assets. Every
published sitemap URL must already have an approved capture; new content needs review,
not an automatically adopted baseline. A different host/browser/font environment must
be recaptured and visually approved rather than relaxing the comparison.

The controller validates the initial live identity/baseline before the first merge.
For each PR it requires the four named checks (unit/coverage, three-browser regression,
production/preview build, pinned malware check), then dispatches cumulative validation
of immutable B/H. A trusted job verifies the synthetic merge's exact two parents and
limits changes to `package.json`/`package-lock.json` **before** candidate code runs on
another runner with only read permissions and no persisted checkout credentials.
The shared manifest preflight also compares parsed immutable base/candidate
`package.json` documents, rejecting duplicate JSON keys and invalid shapes. Only
version strings for existing names in existing `dependencies`/`devDependencies`
sections may change, and changed values must be exact registry versions. Scripts
(including lifecycle hooks), engines, module type, package manager, metadata and
all other configuration must remain identical. Adding/removing dependency names
or sections requires separate manual review. Thus candidate `npm ci` and validation
commands retain the trusted base's entrypoints; dependency installation itself can
still execute dependency-provided code on the isolated read-only candidate runner.
Controller preflight uses this same validator; the trusted identity job repeats it
against the verified synthetic merge before any candidate installation or execution.
The malware job uses the unchanged approved reusable SHA with explicit B/H; skipped,
cancelled, missing, stale, duplicate, or unsuccessful jobs stop progression.
The approved malware caller workflow is unchanged.

Initial and final PR reads must identify the same repository's `main` base and
same-repository Dependabot head, with an open, non-draft PR, no existing auto-merge,
and known clean mergeability. GitHub's computed review decision must be `APPROVED`
and merge state `CLEAN`, including CODEOWNER satisfaction, even for an owner token
that might otherwise bypass rules. Changed/unknown branch policy, new required checks,
or unavailable GraphQL review evidence stops execution. An outdated branch must be
refreshed separately and its new SHA reauthorized; the controller never refreshes it.

Only a head-pinned ordinary merge (never admin bypass) follows the final main/head
re-read. The controller checks the resulting two merge parents, PR merge identity,
unique successful push-to-main Pages run/attempt, production marker, and hashes of
every published file and public route. A stale/mixed CDN response is a stop, not an
excuse to accept another build. No next merge occurs until the live gate passes and
the verified checkpoint is atomically written and synced to disk.

Keep state/evidence outside the checkout. The controller retains checkpoints,
candidate receipts, deployment identities/HTTP hashes, full HTTP observations and
headers, CDP trace, browser log, original/after/diff PNGs, and pixel counts. Keep the
complete run directory for at least 30 days after review (longer for incidents);
candidate identity artifacts in Actions also retain for 30 days. Do not publish private
approval/control evidence in Git. Snapshots are never refreshed and rollback is never
automatic. On a failure, changed authorization, external push/deployment, timeout, or
ambiguous mutation, stop for manual inspection. Merge-intent/candidate-intent/ambiguous
checkpoints cannot auto-resume: reconcile GitHub, main, Pages, marker and evidence,
then issue a new reviewed authorization in a new state directory. A stale local
`~/.copilot/serial-locks/benarculus--benarculus.com.lock` after a crash may only be removed
after independently confirming its recorded PID/controller no longer owns the rollout.

Only publication-ready material belongs in this public repository. Keep private drafts, credentials, analytics exports, private media, and sensitive metadata outside Git history.

## Related repositories

The GitHub profile repository is [`benarculus/benarculus`](https://github.com/benarculus/benarculus). It should remain profile-focused and link here for website source.

Source code is available under the [MIT License](LICENSE). Authored notes and original media are covered by the separate [content license](CONTENT_LICENSE.md).
