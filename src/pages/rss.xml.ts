import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { rssItem } from "../lib/discovery";
import { absoluteUrl, getPublishedPosts, SITE } from "../lib/site";

export async function GET() {
  const posts = getPublishedPosts(await getCollection("posts"));
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: absoluteUrl("/"),
    items: posts.map(rssItem),
    customData: "<language>en-US</language>",
  });
}
