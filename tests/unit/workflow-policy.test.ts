import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflows = readdirSync(".github/workflows")
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => readFileSync(`.github/workflows/${file}`, "utf8"));

describe("workflow trust policy", () => {
  it("pins every Action to a full commit SHA", () => {
    for (const workflow of workflows) {
      const references = [...workflow.matchAll(/uses:\s+\S+@(\S+)/g)];
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference[1]).toMatch(/^[a-f0-9]{40}$/);
      }
    }
  });

  it("does not use privileged pull request execution", () => {
    for (const workflow of workflows) {
      expect(workflow).not.toContain("pull_request_target");
    }
  });
});
