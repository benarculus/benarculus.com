import { describe, expect, it } from "vitest";
import { postSchema } from "../../src/lib/content-schema";

const validPost = {
  title: "A clear title",
  description: "A useful description",
  publishedDate: "2024-02-12T16:50:00Z",
  author: "Ben Arculus",
  heroImage: "/images/post.jpg",
  heroAlt: "A notebook on a desk",
};

describe("post schema", () => {
  it("coerces dates and supplies safe publication defaults", () => {
    const result = postSchema.parse(validPost);
    expect(result.publishedDate).toEqual(new Date("2024-02-12T16:50:00Z"));
    expect(result.tags).toEqual([]);
    expect(result.draft).toBe(false);
  });

  it("accepts optional update and slug metadata", () => {
    const result = postSchema.parse({
      ...validPost,
      updatedDate: "2024-03-01T12:00:00Z",
      slug: "clear-title",
      tags: ["leadership"],
      draft: true,
    });
    expect(result.updatedDate).toEqual(new Date("2024-03-01T12:00:00Z"));
    expect(result.slug).toBe("clear-title");
  });

  it.each(["title", "description", "author", "heroImage", "heroAlt"])(
    "rejects a missing %s",
    (field) => {
      const invalid = { ...validPost };
      delete invalid[field as keyof typeof invalid];
      expect(postSchema.safeParse(invalid).success).toBe(false);
    },
  );

  it("rejects invalid dates and field types", () => {
    expect(
      postSchema.safeParse({
        ...validPost,
        publishedDate: "not-a-date",
        tags: "leadership",
      }).success,
    ).toBe(false);
  });

  it.each([
    "nested/slug",
    "query?slug",
    "fragment#slug",
    "space slug",
    "../slug",
  ])("rejects a non-segment slug of %s", (slug) => {
    expect(postSchema.safeParse({ ...validPost, slug }).success).toBe(false);
  });
});
