import type { UserProfile } from "./types";

export function userProfileForAgent(profile?: UserProfile): Record<string, string> | undefined {
  if (!profile?.userName.trim()) return undefined;
  const input: Record<string, string> = {
    name: profile.userName.trim(),
  };
  const location = profile.userLocation.trim();
  if (location) input.location = location;
  return input;
}

export function combineResponderDescription(soulDescription?: string): string | undefined {
  return soulDescription?.trim() || undefined;
}
