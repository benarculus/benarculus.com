import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const mode = process.argv[2];
assert.ok(
  mode === "production" || mode === "preview",
  "Expected production or preview mode",
);

const articleSlug = "generate-clarity-by-establishing-a-writing-practice";
const article = await readFile(`dist/blog/${articleSlug}/index.html`, "utf8");
const index = await readFile("dist/index.html", "utf8");
const rss = await readFile("dist/rss.xml", "utf8");
const sitemap = await readFile("dist/sitemap.xml", "utf8");
const robots = await readFile("dist/robots.txt", "utf8");

const origin =
  mode === "preview"
    ? "https://benarculus.github.io"
    : "https://benarculus.com";
const base = mode === "preview" ? "/benarculus.com" : "";
const articleUrl = `${origin}${base}/blog/${articleSlug}/`;

assert.match(article, new RegExp(`<link rel="canonical" href="${articleUrl}"`));
assert.match(
  article,
  new RegExp(`<meta property="og:url" content="${articleUrl}"`),
);
assert.match(
  article,
  new RegExp(`${origin}${base}/images/writing-practice.svg`),
);
assert.match(article, /"@type":"BlogPosting"/);
assert.match(article, new RegExp(`"mainEntityOfPage":"${articleUrl}"`));
assert.match(index, new RegExp(`href="${base}/blog/"`));
assert.match(index, new RegExp(`src="${base}/images/writing-practice.svg"`));
assert.match(rss, new RegExp(`<link>${origin}${base}/</link>`));
assert.match(
  rss,
  new RegExp(`<link>${origin}${base}/blog/${articleSlug}/</link>`),
);
assert.match(
  sitemap,
  new RegExp(`<loc>${origin}${base}/blog/${articleSlug}/</loc>`),
);
assert.match(robots, new RegExp(`Sitemap: ${origin}${base}/sitemap.xml`));
const markupWithoutJsonLd = article.replace(
  /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
  "",
);
assert.doesNotMatch(markupWithoutJsonLd, /<script\b/);

console.log(`Generated ${mode} output passed route and metadata assertions.`);
