const softLimit = 300;
const hardLimit = 500;
const roots = ["app", "src", "scripts", "tests"];
const extensions = new Set([".ts", ".tsx"]);

const files = await collectFiles();
const reports = await Promise.all(files.map(reportFile));
const overHard = reports.filter((report) => report.lines > hardLimit);
const overSoft = reports.filter((report) => report.lines > softLimit && report.lines <= hardLimit);

for (const report of overSoft) {
  console.warn(`soft line limit: ${report.path} has ${report.lines} lines`);
}

if (overHard.length > 0) {
  for (const report of overHard) {
    console.error(`hard line limit: ${report.path} has ${report.lines} lines`);
  }
  process.exit(1);
}

console.log(`checked ${reports.length} files; hard limit ${hardLimit} lines`);

interface LineReport {
  path: string;
  lines: number;
}

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    const glob = new Bun.Glob(`${root}/**/*`);
    for await (const file of glob.scan(".")) {
      if (extensions.has(file.slice(file.lastIndexOf(".")))) files.push(file);
    }
  }
  return files.sort();
}

async function reportFile(path: string): Promise<LineReport> {
  const text = await Bun.file(path).text();
  return { path, lines: text.length === 0 ? 0 : text.split("\n").length };
}

export {};
