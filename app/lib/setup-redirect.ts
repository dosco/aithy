const DEFAULT_SETUP_REDIRECT = "/chat/home";
const URL_BASE = "http://aithy.local";

export function sanitizeSetupRedirect(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETUP_REDIRECT;
  const raw = value.trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return DEFAULT_SETUP_REDIRECT;
  }

  let url: URL;
  try {
    url = new URL(raw, URL_BASE);
  } catch {
    return DEFAULT_SETUP_REDIRECT;
  }

  if (url.origin !== URL_BASE) return DEFAULT_SETUP_REDIRECT;
  const pathname = url.pathname || "/";
  if (pathname === "/") return DEFAULT_SETUP_REDIRECT;
  if (isSetupPath(pathname) || isApiPath(pathname)) {
    return DEFAULT_SETUP_REDIRECT;
  }
  return `${pathname}${url.search}${url.hash}`;
}

export function isSetupGuardExemptPath(pathname: string): boolean {
  return isSetupPath(pathname) || pathname === "/api/events";
}

function isSetupPath(pathname: string): boolean {
  return pathname === "/setup" || pathname.startsWith("/setup/");
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
