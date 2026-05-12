const acceptedAdvisories = new Set([
  "https://github.com/advisories/GHSA-rmmr-r34h-pfm5",
]);

const audit = Bun.spawn(["bun", "audit", "--json"], {
  stdout: "pipe",
  stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(audit.stdout).text(),
  new Response(audit.stderr).text(),
  audit.exited,
]);

const report = parseAuditReport(stdout);
const unexpected = collectUnexpectedFindings(report);

if (unexpected.length > 0) {
  for (const finding of unexpected) {
    console.error(`dependency audit failed: ${finding.packageName} ${finding.severity}: ${finding.title} (${finding.url})`);
  }
  process.exit(1);
}

if (exitCode !== 0 && report === undefined) {
  console.error(stderr.trim() || stdout.trim() || "dependency audit failed without a parseable report");
  process.exit(exitCode);
}

const accepted = collectAcceptedFindings(report);
for (const finding of accepted) {
  console.warn(`accepted advisory: ${finding.packageName} ${finding.title} (${finding.url})`);
}

console.log("dependency audit passed");

function parseAuditReport(output: string): AuditReport | undefined {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;

  return JSON.parse(output.slice(start, end + 1)) as AuditReport;
}

function collectUnexpectedFindings(report: AuditReport | undefined): Finding[] {
  if (report === undefined) return [];

  return collectFindings(report).filter((finding) => !acceptedAdvisories.has(finding.url));
}

function collectAcceptedFindings(report: AuditReport | undefined): Finding[] {
  if (report === undefined) return [];

  return collectFindings(report).filter((finding) => acceptedAdvisories.has(finding.url));
}

function collectFindings(report: AuditReport): Finding[] {
  const findings: Finding[] = [];
  for (const [packageName, advisories] of Object.entries(report)) {
    for (const advisory of advisories) {
      findings.push({ packageName, ...advisory });
    }
  }
  return findings;
}

interface AuditReport {
  [packageName: string]: Advisory[];
}

interface Advisory {
  url: string;
  title: string;
  severity: string;
}

interface Finding extends Advisory {
  packageName: string;
}

export {};
