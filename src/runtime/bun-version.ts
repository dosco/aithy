export const minimumBunVersion = "1.4.0";

export function assertSupportedBunVersion(version = Bun.version): void {
  if (compareVersions(version, minimumBunVersion) >= 0) return;
  throw new Error(
    `Aithy requires Bun ${minimumBunVersion} or newer. Current Bun is ${version}. Upgrade Bun and restart.`,
  );
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseVersion(value: string): number[] {
  return value.split(/[.+-]/).slice(0, 3).map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}
