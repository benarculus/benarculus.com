import { z } from "astro/zod";

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const postSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  publishedDate: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),
  author: z.string().min(1),
  heroImage: z.string().min(1),
  heroAlt: z.string().min(1),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  slug: z
    .string()
    .regex(slugPattern, "Slug must be a URL-safe, lowercase single segment.")
    .optional(),
});
