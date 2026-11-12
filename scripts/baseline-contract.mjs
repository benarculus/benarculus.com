const routes = {
  home: "/",
  notes: "/blog/",
  article: "/blog/generate-clarity-by-establishing-a-writing-practice/",
  "not-found": "/production-baseline-missing-page/",
};
const devices = ["desktop", "mobile"];
const modes = ["viewport", "full"];
export const screenshotNames = devices.flatMap((device) =>
  Object.keys(routes).flatMap((route) =>
    modes.map((mode) => `${device}-${route}-${mode}.png`),
  ),
);
const insist = (condition, message) => {
  if (!condition) throw new Error(message);
};

function safeName(path) {
  insist(
    typeof path === "string" && path.startsWith("/"),
    "Invalid screenshot path",
  );
  const parts = path.split("/").slice(1);
  insist(
    parts.every(
      (part) => /^[A-Za-z0-9._-]+$/.test(part) && ![".", ".."].includes(part),
    ),
    "Unsafe screenshot path",
  );
  return parts.at(-1);
}

export function validateBaselineContract(summary, observations) {
  const entries = summary?.screenshot_manifest;
  insist(
    Array.isArray(entries) && entries.length === 16,
    "Baseline must declare exactly 16 screenshots",
  );
  const names = entries.map((entry) => {
    const name = safeName(entry.path);
    insist(/^[a-f0-9]{64}$/.test(entry.sha256), "Invalid screenshot hash");
    return name;
  });
  insist(
    new Set(names).size === 16 &&
      screenshotNames.every((name) => names.includes(name)),
    "Unexpected or duplicate baseline screenshots",
  );
  insist(
    Array.isArray(observations?.pages) && observations.pages.length === 8,
    "Baseline must declare eight page captures",
  );
  const seen = new Set();
  for (const page of observations.pages) {
    insist(
      devices.includes(page.device) && Object.hasOwn(routes, page.route_name),
      "Unexpected baseline route/device",
    );
    const key = `${page.device}-${page.route_name}`;
    insist(!seen.has(key), "Duplicate baseline route/device");
    seen.add(key);
    insist(
      page.url === `https://benarculus.com${routes[page.route_name]}`,
      "Wrong baseline route URL",
    );
    insist(
      Array.isArray(page.screenshots) && page.screenshots.length === 2,
      "Missing baseline captures",
    );
    const captures = page.screenshots.map(safeName);
    insist(
      new Set(captures).size === 2 &&
        modes.every((mode) => captures.includes(`${key}-${mode}.png`)),
      "Wrong baseline page screenshots",
    );
  }
  return entries;
}
