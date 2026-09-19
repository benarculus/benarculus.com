import { getCollection } from "astro:content";
import { sitemapPaths, sitemapXml } from "../lib/discovery";
import { getPublishedPosts } from "../lib/site";

export async function GET() {
  const posts = getPublishedPosts(await getCollection("posts"));
  return new Response(sitemapXml(sitemapPaths(posts)), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
