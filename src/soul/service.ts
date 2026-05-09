import defaultConfig from "../../config/config.json" with { type: "json" };
import type { SoulFields, SoulProfile, SoulStore } from "./types";

export function renderResponderDescription(
  fields: SoulFields,
  options: { staticPreamble?: string } = {},
): string {
  // Per-bot identity / persona content is rendered LAST so any caller-supplied
  // preamble above it can be prefix-cached across bots and sessions.
  const personaSections: string[] = [];
  if (fields.coreNature) personaSections.push(`## Core Nature\n${fields.coreNature}`);
  if (fields.communicationStyle)
    personaSections.push(`## Communication Style\n${fields.communicationStyle}`);
  if (fields.behaviour) personaSections.push(`## Behaviour\n${fields.behaviour}`);
  if (fields.negativeBehavior)
    personaSections.push(`## What to Avoid\n${fields.negativeBehavior}`);

  const persona = personaSections.join("\n\n").trim();
  const preamble = options.staticPreamble?.trim() ?? "";
  return preamble ? `${preamble}\n\n${persona}` : persona;
}

export function defaultSoulFields(): SoulFields {
  const soul = (defaultConfig as { soul: SoulFields }).soul;
  return {
    name: soul.name ?? "aithy",
    description: soul.description ?? "aithy",
    coreNature: soul.coreNature ?? "",
    communicationStyle: soul.communicationStyle ?? "",
    behaviour: soul.behaviour ?? "",
    negativeBehavior: soul.negativeBehavior ?? "",
  };
}

export function loadOrSeedSoul(store: SoulStore): SoulProfile {
  const existing = store.loadSoulProfile();
  if (existing) return existing;
  return store.saveSoulProfile(defaultSoulFields());
}

export function saveSoul(store: SoulStore, fields: SoulFields): SoulProfile {
  return store.saveSoulProfile(fields);
}
