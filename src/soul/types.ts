export interface SoulFields {
  name: string;
  description: string;
  coreNature: string;
  communicationStyle: string;
  behaviour: string;
  negativeBehavior: string;
}

export interface SoulProfile extends SoulFields {
  responderDescription: string;
  updatedAt: string;
}

export interface SoulStore {
  loadSoulProfile(): SoulProfile | undefined;
  saveSoulProfile(fields: SoulFields): SoulProfile;
}
