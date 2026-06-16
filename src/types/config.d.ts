// Type-only override for the `config` package (node-config v4+).
//
// config@4 ships strict bundled types where the default export is a
// `ConfigClass` exposing only get()/has()/util. This relay reads custom config
// keys directly (config.database, config.email, config.keys, config.collections,
// config.freshdesk, config.services, ...), which those strict types reject with
// TS2339.
//
// This is purely a type-level override — there is NO tsconfig `paths` redirect,
// so at runtime `tsx` loads the real `config` package unchanged. (A `paths`
// redirect would make tsx resolve `config` to this declaration file and crash
// with "config is not defined".)
declare module 'config' {
  const config: {
    get<T = unknown>(setting: string): T;
    has(setting: string): boolean;
    // Custom keys are accessed nested (config.database.username, ...), so `any`
    // is intentional — `unknown` would block the downstream property access.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  export = config;
}
