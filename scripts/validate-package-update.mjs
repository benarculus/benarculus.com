import { isDeepStrictEqual } from "node:util";

const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function parseManifest(text) {
  const parsed = JSON.parse(text);
  // JSON.parse alone silently accepts duplicate keys, including escaped aliases.
  const tokens = text.match(
    /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]/g,
  );
  let position = 0;
  function value() {
    const token = tokens[position++];
    if (token === "{") {
      const keys = new Set();
      while (tokens[position] !== "}") {
        const key = JSON.parse(tokens[position++]);
        requireValue(!keys.has(key), `Duplicate package manifest key: ${key}`);
        keys.add(key);
        position++; // Colon; JSON.parse already validated the grammar.
        value();
        if (tokens[position] !== ",") break;
        position++;
      }
      position++;
    } else if (token === "[") {
      while (tokens[position] !== "]") {
        value();
        if (tokens[position] !== ",") break;
        position++;
      }
      position++;
    }
  }
  value();
  requireValue(record(parsed), "Package manifest must be an object");
  return parsed;
}

export function validatePackageUpdate(baseText, candidateText) {
  const base = parseManifest(baseText);
  const candidate = parseManifest(candidateText);
  const sections = new Set(["dependencies", "devDependencies"]);
  const otherFields = (manifest) =>
    Object.fromEntries(
      Object.entries(manifest).filter(([key]) => !sections.has(key)),
    );
  requireValue(
    isDeepStrictEqual(otherFields(base), otherFields(candidate)),
    "Candidate changes trusted package manifest fields",
  );
  for (const section of sections) {
    requireValue(
      Object.hasOwn(base, section) === Object.hasOwn(candidate, section),
      `Candidate adds/removes dependency section: ${section}`,
    );
    if (!Object.hasOwn(base, section)) continue;
    requireValue(
      record(base[section]) && record(candidate[section]),
      `Invalid dependency section: ${section}`,
    );
    requireValue(
      isDeepStrictEqual(
        Object.keys(base[section]).sort(),
        Object.keys(candidate[section]).sort(),
      ),
      `Candidate adds/removes dependency names: ${section}`,
    );
    for (const [name, version] of Object.entries(candidate[section])) {
      requireValue(
        typeof version === "string" && typeof base[section][name] === "string",
        `Invalid dependency version: ${name}`,
      );
      if (version === base[section][name]) continue;
      // This repository pins direct registry dependencies to exact versions.
      requireValue(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
          version,
        ),
        `Dependency update must be an exact registry version: ${name}`,
      );
    }
  }
}
