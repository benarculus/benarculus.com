import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowFiles = readdirSync(".github/workflows").filter((file) =>
  /\.ya?ml$/.test(file),
);
const workflows = workflowFiles.map((file) =>
  readFileSync(`.github/workflows/${file}`, "utf8"),
);

const MALWARE_CHECK_PIN = "733acbdf20304f70ac0c9a763921cac4c23882ef";
const malwareCheckFile = workflowFiles.find(
  (file) => file === "malware-advisory-check.yml",
);
const malwareCheckWorkflow = malwareCheckFile
  ? readFileSync(`.github/workflows/${malwareCheckFile}`, "utf8")
  : undefined;

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

describe("malware advisory check caller policy", () => {
  it("is present with the caller workflow file", () => {
    expect(malwareCheckWorkflow).toBeDefined();
  });

  const workflow = malwareCheckWorkflow ?? "";

  it("is pinned exactly to the approved reusable workflow commit", () => {
    expect(workflow).toMatch(
      new RegExp(
        `uses:\\s+benarculus/malware-advisory-check/\\.github/workflows/reusable-malware-advisory-check\\.yml@${MALWARE_CHECK_PIN}\\b`,
      ),
    );
    // Only the one approved pin may appear; no other malware-advisory-check reference is allowed.
    const malwareReferences = [
      ...workflow.matchAll(/benarculus\/malware-advisory-check\/\S+@(\S+)/g),
    ];
    expect(malwareReferences.length).toBeGreaterThan(0);
    for (const reference of malwareReferences) {
      expect(reference[1]).toBe(MALWARE_CHECK_PIN);
    }
  });

  it("triggers only on pull_request, never pull_request_target", () => {
    expect(workflow).toMatch(/^on:\s*\n\s+pull_request:\s*$/m);
    expect(workflow).not.toContain("pull_request_target");
  });

  it("requests only contents: read permissions", () => {
    const lines = workflow.split("\n");
    const permissionsBlocks: string[][] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/^(\s*)permissions:\s*$/);
      if (!match) continue;
      const indent = match[1].length;
      const blockLines: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const lineIndent = lines[j].search(/\S/);
        if (lineIndent === -1 || lineIndent <= indent) break;
        blockLines.push(lines[j].trim());
      }
      permissionsBlocks.push(blockLines);
    }
    expect(permissionsBlocks.length).toBeGreaterThan(0);
    for (const block of permissionsBlocks) {
      expect(block).toEqual(["contents: read"]);
    }
  });

  it("passes explicit pull_request base.sha and head.sha, never a mutable ref", () => {
    expect(workflow).toContain(
      "base-ref: ${{ github.event.pull_request.base.sha }}",
    );
    expect(workflow).toContain(
      "head-ref: ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow).not.toMatch(
      /base-ref:\s*\$\{\{\s*github\.(base_ref|ref|sha)\s*\}\}/,
    );
    expect(workflow).not.toMatch(
      /head-ref:\s*\$\{\{\s*github\.(head_ref|ref|sha)\s*\}\}/,
    );
  });

  it("uses only a named github-token secret, never secrets: inherit", () => {
    expect(workflow).toContain(
      "secrets:\n      github-token: ${{ secrets.GITHUB_TOKEN }}",
    );
    expect(workflow).not.toContain("secrets: inherit");
  });

  it("does not check out any repository or couple to a deployment environment", () => {
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).not.toMatch(/^\s*environment:/m);
  });
});
