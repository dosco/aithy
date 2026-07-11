export interface StreamingDraft {
  turnKey: string;
  seq: number;
  text: string;
}

export interface StreamingDelta {
  turnKey: string;
  seq: number;
  text: string;
  reset?: boolean;
}

export function reduceStreamingDraft(
  current: StreamingDraft | null,
  delta: StreamingDelta,
): StreamingDraft {
  if (current?.turnKey === delta.turnKey && delta.seq <= current.seq) return current;
  const prior = current?.turnKey === delta.turnKey && !delta.reset ? current.text : "";
  return { turnKey: delta.turnKey, seq: delta.seq, text: prior + delta.text };
}
