# Private migration inventory

Complete this checklist outside the public repository before changing DNS or cancelling
Squarespace. Store exports, screenshots, analytics, and DNS values in a private location with an
appropriate backup.

## 1. Export the site

In the Squarespace site dashboard, open the current import/export area (commonly **Settings >
Website > Import & Export Content**) and create the supported site export. Squarespace generally
exports through its WordPress-compatible format and does not include every block or site feature.

Keep the export private. Do not commit it, attach it to a public pull request, or paste it into a
public issue.

Record privately:

- Export date and filename.
- Squarespace site identifier and active subscription renewal date.
- Whether the export completed without warnings.
- A checksum for the saved export, if your storage tool supports one.

## 2. Inventory every content surface

Review the Squarespace Pages panel and compare it with the export and the public site. Include:

- Published pages and posts.
- Draft, scheduled, private, password-protected, members-only, disabled, and unlinked content.
- Unindexed pages and pages excluded from navigation.
- Redirects, URL mappings, announcement bars, pop-ups, forms, embeds, code blocks, and custom CSS.
- Categories, tags, authors, publication dates, modification dates, excerpts, SEO titles, and SEO
  descriptions.
- Downloadable files, galleries, videos, audio, favicons, social images, and image alternatives.

For each item, assign one private disposition:

- Migrated.
- Intentionally excluded.
- Retained in private storage.
- Requires additional work.
- Blocks cutover.

Only report aggregate, non-sensitive results back to this repository, such as “no additional
pages found” or “two private drafts retained outside Git.”

## 3. Save media separately

Download original media that must be retained. Do not rely on the XML export to contain every
asset. Keep private or unused media outside the repository.

For publication media:

- Confirm ownership or permission.
- Preserve the best available original.
- Record its current public URL and intended repository path.
- Remove unnecessary embedded metadata before publication.
- Confirm meaningful alternative text.

## 4. Capture search and analytics context

Privately record:

- Google Search Console properties and verification method.
- Submitted sitemap URLs.
- Indexed or high-traffic URLs that must remain stable.
- Any analytics property identifiers and the date range needed for historical comparison.
- Current RSS URL consumers or integrations.

Do not place analytics exports, visitor data, verification secrets, or private identifiers in the
public repository.

## 5. Capture DNS and domain state

In the domain provider's DNS panel, privately capture every current record before editing
anything:

- Record type, host/name, value/target, TTL, priority, and routing/proxy state.
- Current nameservers and domain registrar.
- `www` behavior and apex-domain forwarding or records.
- Email-related MX, SPF, DKIM, and DMARC records.
- Domain verification records for email, Search Console, or other services.
- DNSSEC state, if enabled.
- Domain expiration and automatic-renewal state.

Do not remove or alter mail and verification records during the web-hosting cutover.

## 6. Write the rollback record

The private rollback record should state:

1. The exact pre-cutover DNS values to restore.
2. Who can access the registrar and Squarespace accounts.
3. How to confirm Squarespace is still serving the prior site.
4. The maximum acceptable outage or certificate-wait window.
5. The checks that trigger rollback.
6. The date after successful cutover when Squarespace may be reconsidered for cancellation.

Keep Squarespace active until the GitHub Pages project-site preview, custom domain, HTTPS
certificate, known routes, assets, RSS, sitemap, and canonical metadata all pass validation.

## 7. Return only the safe summary

Provide these non-sensitive results when the inventory is complete:

- Additional public pages/posts found: count only.
- Private/draft/unindexed items found: count and disposition only.
- Additional publication media required: count only.
- Unsupported Squarespace features found: names without private content.
- DNS snapshot completed: yes or no.
- Rollback record completed: yes or no.
- Any unresolved cutover blockers: non-sensitive description.
