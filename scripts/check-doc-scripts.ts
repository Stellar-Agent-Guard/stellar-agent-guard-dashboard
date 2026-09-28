import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const scripts = Object.keys(packageJson.scripts ?? {});
const docFiles = ["README.md", "CONTRIBUTING.md"];
const pattern = /npm run ([A-Za-z0-9:_-]+)/g;
const seen = new Map<string, string[]>();
const missing: Array<{ name: string; file: string; line: number }> = [];

for (const file of docFiles) {
  const content = readFileSync(resolve(repoRoot, file), "utf8");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const command = match[1];
    if (!command) continue;
    const line = lineFromIndex(content, match.index);
    if (!scripts.includes(command)) {
      missing.push({ name: command, file, line });
    }
    seen.set(command, [...(seen.get(command) ?? []), `${file}:${line}`]);
  }
}

const uniqueMissing = missing.filter(
  (item, index, all) => all.findIndex((candidate) => candidate.name === item.name && candidate.file === item.file && candidate.line === item.line) === index,
);

if (uniqueMissing.length > 0) {
  console.error("Documented npm scripts missing from package.json:");
  for (const item of uniqueMissing) {
    console.error(`- ${item.name} (${item.file}:${item.line})`);
  }
  process.exitCode = 1;
} else {
  const documented = new Set<string>();
  for (const [command, places] of seen) {
    if (scripts.includes(command)) documented.add(command);
  }
  const undocumented = scripts.filter((name) => !documented.has(name));
  console.log(`Validated ${documented.size} documented npm scripts in README.md and CONTRIBUTING.md.`);
  if (undocumented.length > 0) {
    console.log("Informational: package scripts not referenced in docs:");
    for (const name of undocumented) {
      console.log(`- ${name}`);
    }
  }
}

function lineFromIndex(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}
