import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export async function deploymentManifest(root, identity) {
  if (
    !/^[a-f0-9]{40}$/.test(identity.sha) ||
    !["production", "preview"].includes(identity.mode) ||
    !/^[1-9]\d*$/.test(identity.runId) ||
    !/^[1-9]\d*$/.test(identity.runAttempt)
  ) {
    throw new Error("Invalid deployment identity");
  }
  const files = {};
  async function visit(directory) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Artifact contains a symlink");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && relative(root, path) !== "deployment.json")
        files[`/${relative(root, path).split("\\").join("/")}`] = sha256(
          await readFile(path),
        );
    }
  }
  await visit(root);
  if (!files["/index.html"] || !files["/404.html"])
    throw new Error("Incomplete Pages artifact");
  return { schema: 1, ...identity, files };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = resolve("dist");
  const manifest = await deploymentManifest(root, {
    sha: process.env.GITHUB_SHA ?? "",
    mode: process.env.SITE_MODE ?? "",
    runId: process.env.GITHUB_RUN_ID ?? "",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
  });
  await writeFile(
    resolve(root, "deployment.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
