import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const outputDirectory = "lighthouse-results";
const routes = [
  ["/", "home"],
  ["/blog/", "blog"],
  ["/blog/generate-clarity-by-establishing-a-writing-practice/", "article"],
];
const categories = {
  performance: 0.9,
  accessibility: 0.95,
  "best-practices": 0.95,
  seo: 0.95,
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Preview server did not become ready at ${url}`);
}

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await run("npm", ["run", "build"]);

const server = spawn(
  "npm",
  ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4322"],
  { stdio: "inherit" },
);

try {
  await waitForServer("http://127.0.0.1:4322");
  for (const [route, name] of routes) {
    const scores = Object.fromEntries(
      Object.keys(categories).map((category) => [category, []]),
    );
    for (let runNumber = 1; runNumber <= 3; runNumber += 1) {
      const outputPath = `${outputDirectory}/${name}-${runNumber}.json`;
      await run(
        "npx",
        [
          "lighthouse",
          `http://127.0.0.1:4322${route}`,
          "--quiet",
          "--only-categories=performance,accessibility,best-practices,seo",
          "--output=json",
          `--output-path=${outputPath}`,
          "--chrome-flags=--headless --no-sandbox",
        ],
        {
          env: {
            ...process.env,
            CHROME_PATH: chromium.executablePath(),
          },
        },
      );
      const report = JSON.parse(
        await (await import("node:fs/promises")).readFile(outputPath, "utf8"),
      );
      for (const category of Object.keys(categories)) {
        scores[category].push(report.categories[category].score);
      }
    }
    for (const [category, threshold] of Object.entries(categories)) {
      const result = median(scores[category]);
      console.log(`${name} ${category}: ${Math.round(result * 100)}`);
      if (result < threshold) {
        throw new Error(
          `${name} ${category} median ${result} is below ${threshold}`,
        );
      }
    }
  }
} finally {
  server.kill("SIGTERM");
}
