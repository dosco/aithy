import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProfileImageDto } from "@/server/dto";

export interface PhotoUploadPayload {
  mimeType: string;
  base64: string;
}

export function ProfilePhotoInput({
  label,
  image,
  fallback,
  onUpload,
  onClear,
}: {
  label: string;
  image: ProfileImageDto | null;
  fallback: string;
  onUpload: (payload: PhotoUploadPayload) => Promise<void> | void;
  onClear?: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await onUpload({
        mimeType: file.type,
        base64: await fileToBase64(file),
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="group grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--muted))] text-lg font-medium shadow-sm transition hover:border-[rgb(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))] focus:ring-offset-2 focus:ring-offset-[rgb(var(--background))] disabled:opacity-60"
          aria-label={`Choose ${label}`}
          title={`Choose ${label}`}
        >
          {image ? <img src={image.dataUrl} alt="" className="h-full w-full object-cover" /> : fallback}
          <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
            <ImagePlus className="h-5 w-5" />
          </span>
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <p className="mt-1 text-xs text-[rgb(var(--muted-foreground))]">
          {busy ? "Processing image" : image ? "Click the photo to change it." : "Click the circle to add one."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {image && onClear ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void onClear()}>
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/avif"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}
