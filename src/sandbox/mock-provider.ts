import type {
  SandboxFile,
  SandboxBashRequest,
  SandboxBashResult,
  SandboxProvider,
  SandboxSession,
  SessionMount
} from "./provider";

export class MockSandboxProvider implements SandboxProvider {
  readonly bashCalls: SandboxBashRequest[] = [];
  readonly files = new Map<string, string>();
  readonly mounts = new Map<string, SessionMount[]>();
  readonly recreates: Array<{ sessionId: string; mounts: SessionMount[] }> = [];
  readonly state = new Map<string, "live" | "parked">();
  readonly events: Array<{ kind: "create" | "park" | "resume" | "destroy"; sessionId: string }> = [];

  async createSession(
    conversationId: string,
    _hostWorkspacePath: string,
    mounts: SessionMount[]
  ): Promise<SandboxSession> {
    const id = `mock-${conversationId}`;
    this.mounts.set(id, [...mounts]);
    this.state.set(id, "live");
    this.events.push({ kind: "create", sessionId: id });
    return { id, name: id };
  }

  async recreate(
    sessionId: string,
    _hostWorkspacePath: string,
    mounts: SessionMount[]
  ): Promise<SandboxSession> {
    this.mounts.set(sessionId, [...mounts]);
    this.recreates.push({ sessionId, mounts: [...mounts] });
    this.state.set(sessionId, "live");
    return { id: sessionId, name: sessionId };
  }

  async bash(sessionId: string, request: SandboxBashRequest): Promise<SandboxBashResult> {
    await this.resume(sessionId);
    this.bashCalls.push(request);
    return {
      exitCode: 0,
      stdout: `mock: ${request.command}`,
      stderr: "",
      timedOut: false
    };
  }

  async read(sessionId: string, path: string): Promise<string> {
    await this.resume(sessionId);
    return this.files.get(path) ?? "";
  }

  async write(sessionId: string, path: string, content: string): Promise<SandboxFile> {
    await this.resume(sessionId);
    this.files.set(path, content);
    return { path, sizeBytes: content.length };
  }

  async edit(sessionId: string, path: string, search: string, replace: string): Promise<SandboxFile> {
    await this.resume(sessionId);
    const text = this.files.get(path) ?? "";
    if (!text.includes(search)) throw new Error("Search text not found in sandbox file");
    const updated = text.replace(search, replace);
    this.files.set(path, updated);
    return { path, sizeBytes: updated.length };
  }

  async park(sessionId: string): Promise<void> {
    if (this.state.get(sessionId) !== "live") return;
    this.state.set(sessionId, "parked");
    this.events.push({ kind: "park", sessionId });
  }

  async resume(sessionId: string): Promise<void> {
    if (!this.state.has(sessionId)) return;
    if (this.state.get(sessionId) === "live") return;
    this.state.set(sessionId, "live");
    this.events.push({ kind: "resume", sessionId });
  }

  async destroy(sessionId: string): Promise<void> {
    this.mounts.delete(sessionId);
    this.state.delete(sessionId);
    this.events.push({ kind: "destroy", sessionId });
  }
}
