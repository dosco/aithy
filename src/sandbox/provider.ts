export interface SandboxSession {
  id: string;
  name: string;
}

export interface SandboxBashRequest {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export interface SandboxBashResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SandboxFile {
  path: string;
  sizeBytes: number;
}

export interface SessionMount {
  hostPath: string;
  mountName: string;
}

export interface SandboxProvider {
  createSession(
    botId: string,
    hostWorkspacePath: string,
    mounts: SessionMount[]
  ): Promise<SandboxSession>;
  recreate(
    sessionId: string,
    hostWorkspacePath: string,
    mounts: SessionMount[]
  ): Promise<SandboxSession>;
  bash(sessionId: string, request: SandboxBashRequest): Promise<SandboxBashResult>;
  read(sessionId: string, path: string, maxBytes?: number): Promise<string>;
  write(sessionId: string, path: string, content: string): Promise<SandboxFile>;
  edit(sessionId: string, path: string, search: string, replace: string): Promise<SandboxFile>;
  /** Stop the sandbox VM but keep its persisted state (workspace + cache mounts). */
  park(sessionId: string): Promise<void>;
  /** Bring a parked sandbox back online. Idempotent for already-live sessions. */
  resume(sessionId: string): Promise<void>;
  destroy(sessionId: string): Promise<void>;
}
