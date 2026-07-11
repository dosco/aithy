import type { McpServerProfile } from "../settings/types";
import { assertMcpServerId } from "./types";

export function normalizeMcpProfile(id: string, profile: McpServerProfile): McpServerProfile {
  assertMcpServerId(id);
  let url: URL;
  try { url = new URL(profile.url); } catch { throw new Error("MCP URL must be valid."); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("MCP URL must be HTTP(S) without embedded credentials.");
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !profile.allowHttp) throw new Error("Enable the explicit HTTP exception for this server.");
  if (loopback && !profile.allowLoopback) throw new Error("Enable the explicit loopback exception for this server.");
  if (profile.authMode === "header" && !profile.headerName?.trim()) throw new Error("A custom auth header name is required.");
  return { ...profile, url: url.href, headerName: profile.headerName?.trim() || null };
}
