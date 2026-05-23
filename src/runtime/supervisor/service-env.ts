import { tmpdir } from "node:os";

export function managedServiceEnv(extra: Record<string, string>): Record<string, string> {
  return {
    ...safeHostEnv(),
    ...extra,
  };
}

function safeHostEnv(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: safeSystemPath(),
  };
  copyIfPresent(env, "HOME");
  copyIfPresent(env, "USER");
  copyIfPresent(env, "LOGNAME");
  copyIfPresent(env, "XDG_CONFIG_HOME");
  copyIfPresent(env, "XDG_CACHE_HOME");
  copyIfPresent(env, "XDG_RUNTIME_DIR");
  copyIfPresent(env, "SSL_CERT_FILE");
  copyIfPresent(env, "SSL_CERT_DIR");
  env.TMPDIR = process.env.TMPDIR || process.env.TMP || process.env.TEMP || tmpdir();
  return env;
}

function copyIfPresent(target: Record<string, string>, name: string): void {
  const value = process.env[name];
  if (value) target[name] = value;
}

function safeSystemPath(): string {
  return process.platform === "darwin"
    ? "/usr/bin:/bin:/usr/sbin:/sbin"
    : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
}
