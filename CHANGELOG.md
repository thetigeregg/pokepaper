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

## v0.7.0 - 2026-11-18

- 8ed92c6 feat(catalog): browse sets and cards by catalog and language (#21)

## v0.7.1 - 2026-11-18

- 2ee4bd7 test(vitest): add Angular compiler plugin and component specs (#22)

## v0.8.0 - 2026-11-18

- ad471b8 feat(cards): add energy icons and restyle card details (#23)

## v0.9.0 - 2026-11-18

- 006e55d feat(catalog): search cards by name with filters (#24)

## v0.10.0 - 2026-11-18

- e7a2185 feat(collection): store and sync collection entries (#25)

## v0.11.0 - 2026-11-18

- 89f2aba feat(collection): track copies from the Cards tab (#26)

## v0.12.0 - 2026-11-18

- 858840d feat(collection): filter card search by owned or missing (#27)

## v0.13.0 - 2026-11-18

- e796765 feat(collection): add a per-set checklist for quick entry (#28)

## v0.14.0 - 2026-11-18

- 80c09d8 feat(ui): collapse extra header actions into a More menu on phones (#29)

## v0.15.0 - 2026-11-18

- f232c83 feat(ios): add Capacitor iOS shell with DEV/PROD targets (#30)

## v0.16.0 - 2026-11-18

- b0ff5b5 feat(ios): sign in with native passkeys and a Keychain token (#31)

## v0.16.1 - 2026-11-18

- 4aac699 ci(ios): upload App PROD to TestFlight after app-changing releases (#32)

## v0.16.2 - 2026-11-18

- aec20c7 fix(ci): mask the backend host and build TestFlight with Xcode 27 (#34)

## v0.16.3 - 2026-11-18

- cfde1b3 ci(review): skip Claude review on bot-authored PRs (#35)

## v0.16.4 - 2026-11-18

- 3bd637e chore(deps): Bump addressable from 2.9.0 to 2.9.1 in /ios (#33)

## v0.17.0 - 2026-11-19

- 2445c2d feat(ios): check for and apply signed OTA web updates (#36)

## v0.17.1 - 2026-11-19

- 49105e8 ci(ios): publish signed OTA bundles in the edge image (#37)

## v0.17.2 - 2026-11-19

- 9f93cd6 chore(ios): add a temporary OTA test marker to Settings (#38)

## v0.17.3 - 2026-11-19

- ab78004 chore(ios): remove the temporary OTA test marker (#39)

## v0.18.0 - 2026-11-19

- 99040aa feat(cards): show rarity symbols in checklist, details and filter (#40)

## v0.19.0 - 2026-11-19

- c6af80c feat(decks): store and sync decks (#41)

## v0.19.1 - 2026-11-19

- 93a0523 refactor(search): let each screen have its own card search (#42)
