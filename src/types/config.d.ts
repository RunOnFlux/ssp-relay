// Loose type shim for the `config` package, wired in via tsconfig `paths`.
//
// config@4 ships its own types where the default export is a `ConfigClass`
// exposing only get()/has(). This relay reads custom config keys directly
// (config.database, config.email, config.keys, config.collections, ...), which
// those strict types reject. This shim restores the permissive shape.
//
// Type-only: `tsx` ignores tsconfig paths at runtime, so the real `config`
// package is still used when the relay runs.
declare const config: {
  get<T = unknown>(setting: string): T;
  has(setting: string): boolean;
  util: Record<string, unknown>;
  // Custom config keys are accessed nested (config.database.username, ...), so
  // `any` is intentional here — `unknown` would block the downstream access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

export = config;
