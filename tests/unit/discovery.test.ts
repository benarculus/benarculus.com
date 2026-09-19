import { describe, expect, it } from "vitest";
import { rssItem, sitemapPaths, sitemapXml } from "../../src/lib/discovery";
import type { PostEntry } from "../../src/lib/site";

const post = {
  id: "essay.md",
  collection: "posts",
  data: {
    title: "Clear thinking",
    description: "A short description",
    publishedDate: new Date("2024-02-12T16:50:00Z"),
    author: "Ben Arculus",
    heroImage: "/images/essay.jpg",
    heroAlt: "A desk",
    tags: [],
    draft: false,
    slug: "clear-thinking",
  },
} as PostEntry;

describe("discovery helpers", () => {
  it("creates an RSS item from canonical metadata", () => {
    expect(rssItem(post)).toEqual({
      title: "Clear thinking",
      description: "A short description",
      pubDate: new Date("2024-02-12T16:50:00Z"),
      link: "https://benarculus.com/blog/clear-thinking/",
      author: "Ben Arculus",
    });
  });

  it("selects public sitemap routes", () => {
    expect(sitemapPaths([post])).toEqual([
      "/",
      "/blog/",
      "/blog/clear-thinking/",
    ]);
  });

  it("renders absolute production sitemap entries", () => {
    expect(sitemapXml(["/", "/blog"])).toContain(
      "<loc>https://benarculus.com/blog</loc>",
    );
  });

  it("escapes XML-sensitive characters in sitemap locations", () => {
    expect(sitemapXml(["/blog?topic=writing&format=rss"])).toContain(
      "<loc>https://benarculus.com/blog?topic=writing&amp;format=rss</loc>",
    );
  });
});
