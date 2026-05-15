import type {
  SandboxBashRequest,
  SandboxBashResult,
  SandboxFile,
  SandboxProvider,
  SandboxSession,
  SessionMount,
} from "./provider";

export class UnavailableSandboxProvider implements SandboxProvider {
  async createSession(
    _botId: string,
    _hostWorkspacePath: string,
    _hostOutboxPathOrMounts: string | SessionMount[],
    _mounts?: SessionMount[],
  ): Promise<SandboxSession> {
    throw unavailable();
  }

  async recreate(
    _sessionId: string,
    _hostWorkspacePath: string,
    _hostOutboxPathOrMounts: string | SessionMount[],
    _mounts?: SessionMount[],
  ): Promise<SandboxSession> {
    throw unavailable();
  }

  async bash(_sessionId: string, _request: SandboxBashRequest): Promise<SandboxBashResult> {
    throw unavailable();
  }

  async read(_sessionId: string, _path: string, _maxBytes?: number): Promise<string> {
    throw unavailable();
  }

  async write(_sessionId: string, _path: string, _content: string): Promise<SandboxFile> {
    throw unavailable();
  }

  async edit(_sessionId: string, _path: string, _search: string, _replace: string): Promise<SandboxFile> {
    throw unavailable();
  }

  async park(_sessionId: string): Promise<void> {}

  async resume(_sessionId: string): Promise<void> {
    throw unavailable();
  }

  async destroy(_sessionId: string): Promise<void> {}
}

function unavailable(): Error {
  return new Error("Sandbox execution is owned by the agent-worker service.");
}
