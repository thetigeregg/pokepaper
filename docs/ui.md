# UI conventions

Standards for PokePaper's screens, so new pages look and behave like existing ones. When a screen needs something these don't cover, add the decision here.

## Components

- **Stock Ionic first.** Build screens from Ionic components with their default styling. Add custom CSS only where Ionic has no equivalent, and keep it small. When proposing UI, describe it by component (`IonSplitPane`, `IonItem`, `IonModal`, …).
- **Agreed exceptions:**
  - **Swiper**, for paging through cards in the card detail modal.
  - **The energy symbol icons** (`EnergyIconComponent`): the TCG symbols as PNGs in `src/assets/energy/<type>.png` (Bulbapedia's 85 px attack-cost icons, e.g. `Fairy-attack.png`), prefetched by the service worker so they work offline. An unknown type or a missing image falls back to a colored circle with the type's letter.
  - **The type tint** on cards without a scan.

## Platforms

- **iOS phone and desktop web are equal targets.** Design every page, modal and component for both, and check both before calling UI work done: a phone viewport (about 390×844) and a desktop one (about 1440×900).
- Prefer one responsive layout (Ionic breakpoints, `ion-split-pane`, adaptive modals) over separate code paths.

## Language

- **App text is US English** ("catalog", "color", "favorite"). Docs and code comments follow suit.
- **Card content is shown in the card's own language** (TCGdex's text). Switching languages happens in context, in the header of set, series and card views (see the card catalog plan), not through a global setting.

## Page layout

- **Large collapsing title:** pages use a translucent `ion-header` plus an `ion-header collapse="condense"` with a large `ion-title` inside `ion-content`.
- **Readable column on wide screens:** settings-style pages wrap their content in `<div class="page-column">` (centered, `max-width: 760px`; both classes are global in `src/global.scss`). The large-title header gets `class="page-column-header"` so the title lines up with the content. On phones the column is full width.
- **Sub-pages** opened from a page (e.g. Settings → Downloaded sets) get a back button labeled with the parent page and a standard (small) title, with no large title. A search field sits in a second header toolbar, with the `page-column` width. Open them with `NavController.navigateForward` from a row with a chevron (`ion-item button`, whose detail arrow shows).
- **Long lists move to a sub-page:** the parent page shows one summary row (e.g. "214 sets · 3.1 GB ›") instead of a list that can grow without limit.

## Lists

- **Flat, full-width lists:** use `<ion-list>` without `inset`. The only horizontal spacing is the rows' own 16 px padding, so section headers, row text and the page title all line up on one edge. Don't add extra padding or margins around lists.
- **One list per section,** titled with an `ion-list-header`.
- **Dividers between rows only:** no divider under the last row of a list. A global rule in `src/global.scss` enforces this.
- **Label and value rows:** the label in `ion-label`, the value as `<ion-note slot="end">`.
- **Choice rows:** an `ion-select` inside the `ion-item`, with its `label` as the row label and `interface="popover"`, e.g. "Keep recently viewed up to".
- **Hint text** under a label: `<p class="hint">` inside the `ion-label` (styled globally with a little top padding).
- **Grouped lists:** collapsible groups use `ion-accordion-group` (multiple open). The group row is the accordion header; its rows sit one step in (`class="child-row"`, global). Searching opens every matching group.
- **Progress:** an `ion-progress-bar` in its own row, directly under the row it belongs to.

## Actions

- **Actions belonging to a section are full-width button rows at the end of its list:** `<ion-item button="true" detail="false">` with an `ion-label` colored `primary`, e.g. "Check for updates", "Add passkey".
- **Destructive actions** use `color="danger"`, e.g. "Sign out of this device".
- **Actions on one row** (e.g. "Remove" on a passkey) are `fill="clear"` buttons at the row's end (`slot="end"`).
- **Disable actions while they run** (`[disabled]="busy()"`), rather than hiding them.
- **Confirm bulk or hard-to-undo removals** (a whole series, everything, a passkey) with an alert: "Cancel" plus a red "Remove". Removing a single item that's easy to redo (one downloaded set) doesn't ask.
- **A screen's single main call to action outside any list** (e.g. the sign-in button) is an `ion-button expand="block"`.

## Cards

- **Catalogs:** an `IonSegment` ("International | Japan & Asia") in a second header `IonToolbar`, remembered on the device.
- **Desktop layout:** `IonSplitPane when="lg"` wraps `IonTabs` (`TabsPage`). Its `IonMenu` holds the segment and the sets list and is enabled only while the Cards tab is open, so other tabs stay full width. The selected set opens beside it; picking another set replaces it rather than stacking. Phones push pages: sets, then set.
- **Tab stacks are stock Ionic:** each tab keeps its pages when you switch away, and tapping the current tab pops to its root. Sub-pages are routes at the tab level (`cards/set/:region/:setId`, `settings/downloads`); don't nest an `IonRouterOutlet` inside a tab page, because Ionic then forgets the tab's position.
- **Sets list:** an `IonItemGroup` per series under a sticky `IonItemDivider`, newest first. Each row is an `IonItem lines="inset"` with the set logo in an `IonThumbnail`, name, "date · N cards", and a small `IonIcon` (cloud-done) when downloaded.
- **Set page:**
  - The header's `IonTitle` shows the set's logo (in the current language, else another) instead of its name when the set has one; the name is the image's alt text.
  - The header's end slot has two icon-only `IonButton`s: language (opening an `IonPopover` with an `IonRadioGroup`) and download (an `IonActionSheet`). An `IonProgressBar` shows while downloading.
  - Cards in an `IonGrid` with `IonCol size="4" sizeMd="3" sizeLg="2"`: the image plus a centered "001 · Pineco" caption that wraps (the row grows with it) rather than truncating.
- **Card detail:**
  - An `IonModal`: a sheet on phones (`[breakpoints]="[0, 1]"`, handle), a centered dialog on desktop (`.card-detail-modal`, image beside the text).
  - Swiper with virtual slides; swipe on phones, ←/→ keys on desktop. No footer.
  - Attacks are `IonItem lines="inset"`. The cost column is as wide as the card's longest cost, so every attack name lines up. Weakness · resistance · retreat is one centered row.
  - Full card text in `IonList` sections.
- **Card images:** a fallback-language scan gets an `IonBadge` with the language code. A card without any scan is a type-tinted `IonCard` (name, HP · stage, energy icon, set number) at card proportions (63:88).
- **Language:** switched in context with the header button, and remembered per catalog in synced settings. Every set and card opens in it.

## Tests

- Elements that tests or checks look up carry a `data-testid`.
- Component specs test the component's state (signals) with the template replaced. Real rendering is checked in the browser at both viewport sizes.
- **Known limit:** Vitest here runs without Angular's compiler plugin, so a component's signal `input()`s and signal queries can't be set or resolved in tests. Keep logic in tested services and pure functions. For `ModalController` components, take `componentProps` as plain properties: Ionic assigns them directly and would overwrite signal inputs (and `modal` is a reserved name).
