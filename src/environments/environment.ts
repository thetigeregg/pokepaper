// Replaced at build time via angular.json `fileReplacements`:
// - `production` (web, served by the edge container) → environment.prod.ts
// - `ios-local` / `ios-prod` → environment.ios.*.ts, generated (gitignored)
//   by scripts/write-environment-ios.mjs
//
// Local web dev keeps the API same-origin: `ng serve` proxies /api and
// /images to the server on :3000 (proxy.conf.json). Same-origin matters for
// the session cookie and for passkeys (origin http://localhost:4200, RP ID
// `localhost`).
export const environment = {
  production: false,
  apiUrl: '',
};
