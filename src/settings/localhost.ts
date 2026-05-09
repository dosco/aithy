const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (!isLoopbackHost(url.hostname)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function assertLoopbackRequest(request: Request): void {
  if (!isLoopbackRequest(request)) {
    throw new Error("Aithy web mutations are restricted to localhost.");
  }
}

function isLoopbackHost(hostname: string): boolean {
  return loopbackHosts.has(hostname.toLowerCase());
}
