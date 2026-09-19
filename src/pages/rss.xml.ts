import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { rssItem } from "../lib/discovery";
import { getPublishedPosts, SITE } from "../lib/site";

export async function GET(context: { site?: URL }) {
  const posts = getPublishedPosts(await getCollection("posts"));
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: context.site ?? SITE.productionOrigin,
    items: posts.map(rssItem),
    customData: "<language>en-US</language>",
  });
}
