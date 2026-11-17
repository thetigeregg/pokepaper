# Changelog

## v0.1.0 - 2026-11-17

- 0d654b7 ci: add PR checks, release/publish, secret scan, and CodeQL workflows (#11)
- 5b5b511 feat(deploy): add Docker images, edge proxy, and NAS deployment (#6)
- d2ef31a feat(auth): add passkey-only authentication (#5)
- a9ce221 feat(server): add Fastify + SQLite server with sync endpoints (#4)
- 61354f1 feat(app): add Ionic app shell with local-first data layer (#2)
- 308c54b Add CodeQL analysis workflow configuration
- ac66417 Merge pull request #3 from thetigeregg/add-claude-github-actions-1794901093407
- 240f9b7 "Claude Code Review workflow"
- 20dcdb7 "Claude PR Assistant workflow"
- 247bf40 chore: bootstrap repo tooling and conventions

## v0.1.1 - 2026-11-17

- 41f3f3d fix(deploy): let the server run as a host user (PUID/PGID) (#12)

## v0.1.2 - 2026-11-17

- d0412b7 fix(deploy): correct NAS setup steps for ROOT, token, and PGID (#14)

## v0.2.0 - 2026-11-17

- 968599e feat(deploy): add optional override to join NPM's Docker network (#13)

## v0.2.1 - 2026-11-17

- 651bfe2 fix(deploy): stop exposing edge on the LAN when it shares NPM's network (#15)

## v0.2.2 - 2026-11-17

- 296f7be fix(deploy): tidy leftover deployment doc and config issues (#16)

## v0.3.0 - 2026-11-17

- e81009a feat(catalog): import the TCGdex card catalogue on the server (#17)
- 5585e34 chore(ci): Bump actions/checkout from 4 to 7 (#9)

## v0.4.0 - 2026-11-17

- 65f2d18 feat(catalog): serve catalogue packs and cached card images (#18)

## v0.5.0 - 2026-11-17

- 3481e2b feat(catalog): keep the card catalog offline on the device (#19)

## v0.6.0 - 2026-11-17

- bca97cf feat(catalog): cache card images on the device, with offline sets (#20)
