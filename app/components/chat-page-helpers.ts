export function sessionIdFromPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}
