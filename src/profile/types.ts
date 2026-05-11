export type ProfileImageKind = "user" | "agent";

export interface UserProfileFields {
  userName: string;
  userLocation: string;
}

export interface ProfileImage {
  kind: ProfileImageKind;
  mimeType: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  updatedAt: string;
}

export type StoredProfileImage = Omit<ProfileImage, "kind" | "updatedAt">;

export interface UserProfile extends UserProfileFields {
  updatedAt: string;
  userPhoto?: ProfileImage;
  agentPhoto?: ProfileImage;
}

export interface ProfileStore {
  loadProfile(): UserProfile | undefined;
  saveProfile(fields: UserProfileFields): UserProfile;
  saveImage(kind: ProfileImageKind, image: StoredProfileImage): UserProfile;
  clearImage(kind: ProfileImageKind): UserProfile;
}
