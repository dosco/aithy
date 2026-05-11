import { Check } from "lucide-react";
import { useState } from "react";
import {
  Field,
  FormTextarea,
  Section,
  fieldClass,
} from "@/components/settings-form-bits";
import { Button } from "@/components/ui/button";
import {
  ProfilePhotoInput,
  type PhotoUploadPayload,
} from "@/components/profile-photo-input";
import { saveSoul } from "@/server/actions.functions";
import {
  clearProfileImage,
  saveProfile,
  saveProfileImage,
} from "@/server/profile.functions";
import type { ProfileDto, SoulDto } from "@/server/dto";

export function UserProfileSection({
  profile,
  onChange,
}: {
  profile: ProfileDto;
  onChange: (profile: ProfileDto) => void;
}) {
  const [saved, setSaved] = useState(false);
  async function saveFields() {
    const next = await saveProfile({
      data: {
        userName: profile.userName,
        userLocation: profile.userLocation,
      },
    });
    onChange(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  }
  async function savePhoto(payload: PhotoUploadPayload) {
    onChange(await saveProfileImage({ data: { kind: "user", ...payload } }));
  }
  return (
    <Section title="User profile" subtitle="Basic context the responder can use when talking with you.">
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name">
            <input className={fieldClass} value={profile.userName} onChange={(e) => onChange({ ...profile, userName: e.target.value })} />
          </Field>
          <Field label="Location (optional)">
            <input className={fieldClass} value={profile.userLocation} onChange={(e) => onChange({ ...profile, userLocation: e.target.value })} />
          </Field>
        </div>
        <ProfilePhotoInput
          label="Your photo"
          image={profile.userPhoto}
          fallback={initials(profile.userName, "You")}
          onUpload={savePhoto}
          onClear={async () => onChange(await clearProfileImage({ data: { kind: "user" } }))}
        />
        <div className="flex justify-end">
          <Button onClick={() => void saveFields()} disabled={!profile.userName.trim()}>
            {saved ? <Check className="h-4 w-4" /> : null}
            Save profile
          </Button>
        </div>
      </div>
    </Section>
  );
}

export function AgentSettingsSection({
  soul,
  profile,
  onSoulChange,
  onProfileChange,
}: {
  soul: SoulDto;
  profile: ProfileDto;
  onSoulChange: (soul: SoulDto) => void;
  onProfileChange: (profile: ProfileDto) => void;
}) {
  const [saved, setSaved] = useState(false);
  async function saveSoulFields() {
    const next = await saveSoul({
      data: {
        name: soul.name,
        description: soul.description,
        coreNature: soul.coreNature,
        communicationStyle: soul.communicationStyle,
        behaviour: soul.behaviour,
        negativeBehavior: soul.negativeBehavior,
      },
    });
    onSoulChange(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  }
  async function saveAgentPhoto(payload: PhotoUploadPayload) {
    onProfileChange(await saveProfileImage({ data: { kind: "agent", ...payload } }));
  }
  return (
    <Section title="Agent" subtitle="Identity, photo, and the soul of the agent passed to the responder.">
      <div className="grid gap-4">
        <ProfilePhotoInput
          label="Agent photo"
          image={profile.agentPhoto}
          fallback={initials(soul.name, "AI")}
          onUpload={saveAgentPhoto}
          onClear={async () => onProfileChange(await clearProfileImage({ data: { kind: "agent" } }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className={fieldClass} value={soul.name} onChange={(e) => onSoulChange({ ...soul, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <input className={fieldClass} value={soul.description} onChange={(e) => onSoulChange({ ...soul, description: e.target.value })} />
          </Field>
        </div>
        <Field label="Core nature">
          <FormTextarea rows={4} value={soul.coreNature} onChange={(e) => onSoulChange({ ...soul, coreNature: e.target.value })} />
        </Field>
        <Field label="Communication style">
          <FormTextarea rows={4} value={soul.communicationStyle} onChange={(e) => onSoulChange({ ...soul, communicationStyle: e.target.value })} />
        </Field>
        <Field label="Behaviour">
          <FormTextarea rows={4} value={soul.behaviour} onChange={(e) => onSoulChange({ ...soul, behaviour: e.target.value })} />
        </Field>
        <Field label="What to avoid">
          <FormTextarea rows={4} value={soul.negativeBehavior} onChange={(e) => onSoulChange({ ...soul, negativeBehavior: e.target.value })} />
        </Field>
        <div className="flex justify-end pt-1">
          <Button onClick={() => void saveSoulFields()}>
            {saved ? <Check className="h-4 w-4" /> : null}
            Save agent
          </Button>
        </div>
      </div>
    </Section>
  );
}

function initials(value: string, fallback: string): string {
  const letters = value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return letters || fallback;
}
