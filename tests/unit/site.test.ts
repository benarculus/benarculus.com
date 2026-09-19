import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  articleJsonLd,
  getPostSlug,
  getPublishedPosts,
  getSiteBase,
  postPath,
  withBase,
  type PostEntry,
} from "../../src/lib/site";

function post(
  id: string,
  overrides: Partial<PostEntry["data"]> = {},
): PostEntry {
  return {
    id,
    collection: "posts",
    data: {
      title: "A post",
      description: "A useful post",
      publishedDate: new Date("2024-01-01T12:00:00Z"),
      author: "Ben Arculus",
      heroImage: "/images/post.jpg",
      heroAlt: "A notebook on a table",
      tags: ["leadership"],
      draft: false,
      ...overrides,
    },
  } as PostEntry;
}

describe("post publishing helpers", () => {
  it("uses an explicit slug when supplied", () => {
    expect(getPostSlug(post("fallback.md", { slug: "chosen" }))).toBe("chosen");
  });

  it("derives a slug from the entry id", () => {
    expect(getPostSlug(post("derived.md"))).toBe("derived");
  });

  it("rejects an unsafe filename-derived slug", () => {
    expect(() => getPostSlug(post("nested/derived.md"))).toThrow(
      "URL-safe single segment",
    );
  });

  it("filters drafts and orders posts newest first", () => {
    const result = getPublishedPosts([
      post("older.md"),
      post("draft.md", {
        draft: true,
        publishedDate: new Date("2025-01-01T12:00:00Z"),
      }),
      post("newer.md", {
        publishedDate: new Date("2024-06-01T12:00:00Z"),
      }),
    ]);
    expect(result.map(getPostSlug)).toEqual(["newer", "older"]);
  });

  it("rejects duplicate published slugs", () => {
    expect(() =>
      getPublishedPosts([
        post("one.md", { slug: "same" }),
        post("two.md", { slug: "same" }),
      ]),
    ).toThrow("Duplicate published post slug: same");
  });
});

describe("URL helpers", () => {
  it("uses root-relative production URLs", () => {
    expect(getSiteBase("production")).toBe("/");
    expect(withBase("/blog/", "production")).toBe("/blog/");
    expect(absoluteUrl("/blog/", "production")).toBe(
      "https://benarculus.com/blog/",
    );
  });

  it("uses the project base for preview URLs", () => {
    expect(withBase("/blog/", "preview")).toBe("/benarculus.com/blog/");
    expect(absoluteUrl("/blog/", "preview")).toBe(
      "https://benarculus.github.io/benarculus.com/blog/",
    );
  });
});

describe("article metadata", () => {
  it("builds canonical paths and JSON-LD from the content record", () => {
    const entry = post("clarity.md", {
      slug: "clarity",
      updatedDate: new Date("2024-02-02T12:00:00Z"),
    });
    expect(postPath(entry)).toBe("/blog/clarity/");
    expect(articleJsonLd(entry)).toMatchObject({
      "@type": "BlogPosting",
      headline: "A post",
      datePublished: "2024-01-01T12:00:00.000Z",
      dateModified: "2024-02-02T12:00:00.000Z",
      mainEntityOfPage: "https://benarculus.com/blog/clarity/",
    });
  });
});
