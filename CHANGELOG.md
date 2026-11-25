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

## v0.20.0 - 2026-11-19

- 2649537 feat(decks): add the deck list, deck page and Add cards (#43)

## v0.21.0 - 2026-11-19

- 4d3e09d feat(decks): check decks against their format's rules (#44)

## v0.22.0 - 2026-11-19

- 5dbdbef feat(decks): show what the collection covers of each deck (#45)

## v0.23.0 - 2026-11-19

- 042b199 feat(decks): add deck covers and borrowed basic Energy scans (#46)

## v0.24.0 - 2026-11-20

- c47fc3c feat(decks): add a Considering pile to each deck (#47)

## v0.25.0 - 2026-11-20

- 1e0304e feat(decks): duplicate a deck under a name you choose (#48)

## v0.25.1 - 2026-11-20

- 17a8fa7 fix(ui): checklist rarity layout and sheet safe-area padding (#49)

## v0.26.0 - 2026-11-21

- ceab7d4 feat(catalog): import Cardmarket prices and serve them per region (#50)

## v0.27.0 - 2026-11-21

- b63eb22 feat(catalog): keep card prices on the device (#51)

## v0.28.0 - 2026-11-21

- f25979b feat(cards): show Cardmarket prices in card detail (#52)

## v0.29.0 - 2026-11-21

- 48760f8 feat(collection): show collection value in a preferred currency (#53)

## v0.30.0 - 2026-11-22

- 6ba54b9 feat(catalog): price cards from Cardmarket's daily price guide (#54)

## v0.31.0 - 2026-11-22

- 901e870 feat(decks): show the cost to complete a deck (#55)

## v0.32.0 - 2026-11-22

- 1a66d98 feat(cards): filter Cardmarket links by language and finish (#56)

## v0.32.1 - 2026-11-22

- cebc7fd fix(catalog): drop Taiwanese SV-P text filed on Japanese promos (#57)

## v0.32.2 - 2026-11-24

- 284ffc5 chore(deps): update dependencies, Node 24.22.3, rate-limit 11 (#63)

## v0.33.0 - 2026-11-24

- e986b13 feat(cards): search cards by their number in the set (#64)

## v0.33.1 - 2026-11-24

- d7940c5 fix(cards): hide reverse holo prices cards can't come in (#65)

## v0.34.0 - 2026-11-24

- c81523b feat(catalog): match unpriced cards to Cardmarket products by hand (#66)

## v0.34.1 - 2026-11-24

- d2e444d fix(catalog): refresh prices when no price guide is stored (#67)

## v0.34.2 - 2026-11-24

- 18b63ed fix(cards): clearer variant and price labels on card detail (#68)

## v0.35.0 - 2026-11-24

- b55a396 feat(cards): decide reverse holos by TCGplayer's finishes (#69)

## v0.35.1 - 2026-11-24

- 10d477a fix(cards): name holo rares TCGdex lists as normal Holo (#70)

## v0.35.2 - 2026-11-24

- 02bd315 fix(cards): show the 30-day average when the trend is an outlier (#71)

## v0.36.0 - 2026-11-25

- c095999 feat(cards): track stamped versions of cards (#72)

## v0.37.0 - 2026-11-25

- 7006af0 feat(prices): reject TCGdex products named for another card (#73)
