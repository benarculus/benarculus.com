import type { PostEntry } from "./site";
import { absoluteUrl, postPath } from "./site";

const xmlEntities: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  "'": "&apos;",
  '"': "&quot;",
};

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => xmlEntities[character]);
}

export function rssItem(post: PostEntry) {
  return {
    title: post.data.title,
    description: post.data.description,
    pubDate: post.data.publishedDate,
    link: absoluteUrl(postPath(post)),
    author: post.data.author,
  };
}

export function sitemapPaths(posts: PostEntry[]): string[] {
  return ["/", "/blog/", ...posts.map(postPath)];
}

export function sitemapXml(paths: string[]): string {
  const entries = paths
    .map((path) => `  <url><loc>${escapeXml(absoluteUrl(path))}</loc></url>`)
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    "</urlset>",
  ].join("\n");
}
