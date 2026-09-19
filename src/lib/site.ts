import type { CollectionEntry } from "astro:content";
import { slugPattern } from "./content-schema";

export const SITE = {
  name: "Ben Arculus",
  title: "Ben Arculus — Technical leadership, cybersecurity, AI, and startups",
  description:
    "Personal notes on technical leadership, cybersecurity, AI, and the work of building startups—shared from experience, curiosity, and lessons still in progress.",
  productionOrigin: "https://benarculus.com",
  previewOrigin: "https://benarculus.github.io",
  previewBase: "/benarculus.com",
  author: "Ben Arculus",
} as const;

export type PostEntry = CollectionEntry<"posts">;

export function getPostSlug(post: PostEntry): string {
  const slug = post.data.slug ?? post.id.replace(/\.md$/, "");
  if (!slugPattern.test(slug)) {
    throw new Error(`Post slug must be a URL-safe single segment: ${slug}`);
  }
  return slug;
}

export function getPublishedPosts(posts: PostEntry[]): PostEntry[] {
  const seen = new Set<string>();
  const published = posts.filter((post) => !post.data.draft);

  for (const post of published) {
    const slug = getPostSlug(post);
    if (seen.has(slug)) {
      throw new Error(`Duplicate published post slug: ${slug}`);
    }
    seen.add(slug);
  }

  return published.toSorted(
    (a, b) => b.data.publishedDate.getTime() - a.data.publishedDate.getTime(),
  );
}

export function getSiteOrigin(mode = import.meta.env.SITE_MODE): string {
  return mode === "preview" ? SITE.previewOrigin : SITE.productionOrigin;
}

export function getSiteBase(mode = import.meta.env.SITE_MODE): string {
  return mode === "preview" ? SITE.previewBase : "/";
}

export function withBase(
  pathname: string,
  mode = import.meta.env.SITE_MODE,
): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const base = getSiteBase(mode);
  return base === "/" ? path : `${base}${path === "/" ? "/" : path}`;
}

export function absoluteUrl(
  pathname: string,
  mode = import.meta.env.SITE_MODE,
): string {
  return new URL(withBase(pathname, mode), getSiteOrigin(mode)).toString();
}

export function postPath(post: PostEntry): string {
  return `/blog/${getPostSlug(post)}/`;
}

export function articleJsonLd(post: PostEntry) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.data.title,
    description: post.data.description,
    author: {
      "@type": "Person",
      name: post.data.author,
    },
    datePublished: post.data.publishedDate.toISOString(),
    dateModified: (
      post.data.updatedDate ?? post.data.publishedDate
    ).toISOString(),
    image: absoluteUrl(post.data.heroImage),
    mainEntityOfPage: absoluteUrl(postPath(post)),
  };
}
