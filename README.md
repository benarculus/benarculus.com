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

Only publication-ready material belongs in this public repository. Keep private drafts, credentials, analytics exports, private media, and sensitive metadata outside Git history.

## Related repositories

The GitHub profile repository is [`benarculus/benarculus`](https://github.com/benarculus/benarculus). It should remain profile-focused and link here for website source.

Source code is available under the [MIT License](LICENSE). Authored notes and original media are covered by the separate [content license](CONTENT_LICENSE.md).
