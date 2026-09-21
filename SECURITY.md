# Security policy

## Supported versions

Security fixes are applied to the current version published from the `main` branch. Older
revisions and third-party copies are not supported.

## Report a vulnerability privately

Please use [GitHub private vulnerability reporting](https://github.com/benarculus/benarculus.com/security/advisories/new)
for a suspected vulnerability. Do not publish sensitive details, proof-of-concept material,
credentials, or personal information in a public issue.

For this personal static site, an initial acknowledgement is normally expected within seven days.
Resolution timing depends on severity and availability. Reports involving a leaked credential
will prioritize revocation and containment before code or history cleanup.

Ordinary broken links, typographical corrections, or non-sensitive site feedback are not security
reports.

## Malware advisory check on pull requests

Every pull request runs `.github/workflows/malware-advisory-check.yml`, which calls the
`benarculus/malware-advisory-check` reusable workflow pinned to the immutable release commit
`733acbdf20304f70ac0c9a763921cac4c23882ef` (`v1.0.2`). The caller requests only
`contents: read` permission, checks out nothing, passes the pull request's explicit
`github.event.pull_request.base.sha` and `head.sha`, and supplies `github.token` through the
named `github-token` secret input only (never `secrets: inherit`).

- **Owner**: [@benarculus](https://github.com/benarculus), per [CODEOWNERS](.github/CODEOWNERS)
  for `.github/workflows/`.
- **Fail-closed outcomes**: only the `clean` outcome (exit `0`) succeeds the check. `malware_match`
  (`1`), `coverage_incomplete` (`2`), `configuration_error` (`3`), and `service_error` (`4`) all
  fail the job; there is no soft-fail or continue-on-error path, so any uncertain or incomplete
  result blocks the pull request check by default.
- **Evidence location**: the reusable workflow's redacted GitHub Step Summary on the
  `malware-advisory-check` job run records the outcome, match count, and coverage-gap count for
  each pull request; the run itself is the durable evidence of what was evaluated.
- **Rollback**: active ruleset `23698819` requires the exact status-check context
  `Malware advisory check / check`. If the check must be disabled in an emergency, follow the
  ruleset-first order: remove or update that requirement in the ruleset before removing or
  disabling `.github/workflows/malware-advisory-check.yml`, so a required-but-missing check does
  not block merges.
- **Pin updates**: update the `@<commit-sha>` pin only to another reviewed, released commit SHA
  in `benarculus/malware-advisory-check`. Never point the caller at a branch, floating tag, or
  unreleased commit.
