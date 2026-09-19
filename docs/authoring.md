# Authoring and publishing

## Local setup

Use Node.js 24.8.0 or a compatible Node.js 24 release and npm. Install exactly the committed
dependency graph:

```sh
npm ci
```

Run the development server with `npm run dev`. Before proposing publication, run
`npm run validate`, which checks formatting and types, enforces unit coverage, builds the static
site, and runs the cross-browser regression suite.

## Create a post

Create a plain Markdown file under `src/content/posts/`. The filename becomes the slug unless
frontmatter supplies an explicit `slug`.

```md
---
title: "Illustrative post title"
description: "A concise search and social description."
publishedDate: 2026-09-17T12:00:00Z
author: "Ben Arculus"
heroImage: "/images/example.jpg"
heroAlt: "A concrete description of the meaningful image content"
tags:
  - leadership
draft: false
---

Write the article in Markdown.
```

This example is illustrative; `src/content.config.ts` is the schema contract. Use Markdown for
ordinary posts. Raw HTML and MDX are not enabled. The site currently uses no Astro islands or
client-side application scripts.

Place publication-ready images in `public/images/`, remove unnecessary metadata, reserve their
rendered dimensions, and use meaningful alternative text. Do not copy unrelated theme assets or
material without publication rights.

## Public-repository boundary

Only publication-ready material belongs in this repository. Branches and pull requests are
publicly readable. Keep unfinished or private drafts, credentials, analytics exports, private
media, and sensitive metadata outside Git history. The `draft` field is only for publication-ready
content intentionally staged for a later trusted merge.

Deleting a committed file does not erase public history. If a credential is exposed, revoke or
rotate it first, then assess history cleanup.

## Publish and correct

1. Run `npm ci` and `npm run validate`.
2. Review the local production preview from `npm run preview`.
3. Open a pull request and wait for unit coverage, browser, build, and policy checks.
4. Merge only after the generated routes, metadata, images, and article text are correct.
5. Confirm the published page, RSS feed, and sitemap after deployment.

Correct a published post through another reviewed pull request. Use `updatedDate` when the public
article meaningfully changes; preserve the slug unless a redirect and search-migration plan is
approved.

## Hosting and recovery

GitHub Pages deployment is produced only from trusted `main` history. The temporary project-site
preview uses `https://benarculus.github.io/benarculus.com/`; the production site uses
`https://benarculus.com/` after controlled DNS cutover.

Before changing DNS, keep an external record of the existing DNS values and retain Squarespace.
Rollback means restoring those recorded DNS values while the prior service remains active. Never
store private Squarespace exports or analytics data in this public repository.

Use [`docs/migration-inventory.md`](migration-inventory.md) for the private owner-side export,
content, media, search, DNS, and rollback checklist.
