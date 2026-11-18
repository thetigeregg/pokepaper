# UI conventions

Standards for PokePaper's screens, so new pages look and behave like existing ones. When a screen needs something these don't cover, add the decision here.

## Components

- **Stock Ionic first.** Build screens from Ionic components with their default styling. Add custom CSS only where Ionic has no equivalent, and keep it small. When proposing UI, describe it by component (`IonSplitPane`, `IonItem`, `IonModal`, …).
- **Agreed exceptions:**
  - **Swiper**, for paging through cards in the card detail modal.
  - **The energy symbol icons** (`EnergyIconComponent`): the TCG symbols as 118 px PNGs in `src/assets/energy/<type>.png` (lowercase type names, cropped from ilkcmp's symbol sheet, see `docs/catalog.md` → Attribution), prefetched by the service worker so they work offline. An unknown type or an image that fails to load falls back to a colored circle with the type's letter. Rarity symbols (`circle`, `diamond`, `star`, `three-stars`, each `-black` and `-white`, 40 px) from the same sheet are in `src/assets/rarity/`, not used yet.
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
- **At most two header buttons per slot on phones:** a toolbar's start and end slots each hold at most two icons or icon buttons on phones. Pass extra actions to `HeaderActionsComponent` (`app-header-actions`, inside the `ion-buttons`) as `HeaderAction`s (id, label, icon, disabled, run). On desktop it shows each one as an icon-only `IonButton`. On phones it keeps the first `pinned` (default 1) as buttons and moves the rest behind a More button (`ellipsis-horizontal-circle-outline`) that opens an `IonPopover` menu: `IonItem button` rows with the icon at the start and the label. A picked row runs once the menu has closed. Only one action left over stays a button, since a menu of one is pointless. Buttons with their own popover (like the language button) stay outside it and count toward the two.
- **Long lists move to a sub-page:** the parent page shows one summary row (e.g. "214 sets · 3.1 GB ›") instead of a list that can grow without limit.

## Lists

- **Flat, full-width lists:** use `<ion-list>` without `inset`. The only horizontal spacing is the rows' own 16 px padding, so section headers, row text and the page title all line up on one edge. Don't add extra padding or margins around lists.
- **One list per section,** titled with an `ion-list-header`.
- **Dividers between rows only:** no divider under the last row of a list. A global rule in `src/global.scss` enforces this.
- **Two-column lists on desktop:** for long lists of short rows (e.g. the set checklist), `class="list-grid"` on the `IonList` makes it two columns from the `lg` breakpoint (one on phones). Rows with `class="list-grid-full"` (e.g. a summary row) span both columns. The divider rule covers columns too: the last two rows (the bottom of each column) have none (global, in `src/global.scss`).
- **Label and value rows:** the label in `ion-label`, the value as `<ion-note slot="end">`.
- **Choice rows:** an `ion-select` inside the `ion-item`, with its `label` as the row label and `interface="popover"`, e.g. "Keep recently viewed up to".
- **Leading images and icons** (set logos, attack costs): inside the `ion-label`, not `slot="start"`, so a `lines="inset"` divider runs under them too. Inside the label, wrap them in `<div class="media-row">` with the text in `<div class="media-row-text">` (both global): the image sits beside the text, 16 px apart, and long text still truncates or wraps. The flex row is a div, not a class on `ion-label`, because Ionic's label rule (`display: block`) outranks one.
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
- **Sets list:** an `IonItemGroup` per series under a sticky `IonItemDivider`, newest first. Each row is an `IonItem lines="inset"` with the set logo in an `IonThumbnail` (inside the label, see Lists), name, "date · N cards", a second line "87 / 198 owned" once any of its cards is owned (counted in the language the set opens in), and a small `IonIcon` (cloud-done) when downloaded.
- **Set page:**
  - The header's `IonTitle` shows the set's logo (in the current language, else another) instead of its name when the set has one; the name is the image's alt text.
  - The header's end slot has the language button (opening an `IonPopover` with an `IonRadioGroup`), then a `HeaderActionsComponent` (`pinned` 0) with view ("Show as checklist" `list-outline` / "Show as grid" `grid-outline`: switches between the grid and the checklist, remembered on the device for every set) and download ("Download images" `cloud-download-outline` / "Downloaded for offline use" `cloud-done-outline`, opening an `IonActionSheet`; disabled while downloading). Desktop shows all three as icon buttons; phones show language plus More. An `IonProgressBar` shows while downloading.
  - Cards in an `IonGrid` with `IonCol size="4" sizeMd="3" sizeLg="2"`: the image plus a centered "001 · Pineco" caption that wraps (the row grows with it) rather than truncating.
  - **Checklist** (for entering a collection), one column on phones and two on desktop (a `list-grid` list, the summary row `list-grid-full`): a summary row ("87 / 124 owned", "In English" as a hint) with a `fill="clear"` "Mark all owned" button at its end, then one `IonItem lines="inset"` per card: its scan (52 px wide, leading the label in a `media-row`; tapping it opens the card), "001 · Pineco", its rarity below, and under those a row of small `IonButton`s (wrapping with 10 px between lines), one per variant (the card detail's variants): `outline` while unowned, `solid` when owned, with "×2" past one copy. TCGdex has one scan per language, so the row shows it once. A button toggles 0 ↔ 1 copy in the current language; with more copies it opens the card instead. An icon-only `information-circle-outline` button (24 px) at the row's end also opens the card. "Mark all owned" adds one copy of each unowned card (its first variant) after an alert ("Cancel" / "Mark all"). Toggles and Mark all stay disabled until the collection has loaded.
- **Card detail:**
  - An `IonModal`: a sheet on phones (`[breakpoints]="[0, 1]"`, handle), a centered dialog on desktop (`.card-detail-modal`, image beside the text).
  - Swiper with virtual slides; swipe on phones, ←/→ keys on desktop. No footer.
  - Attacks are `IonItem lines="inset"`. The cost column is as wide as the card's longest cost, so every attack name lines up. Ability and attack names are bold; ability names are dark red (`--ion-color-danger-shade`). Weakness | resistance | retreat are three equal columns (label above value) with vertical dividers in the item border color; retreat is shown as Colorless energy icons.
  - Full card text in `IonList` sections.
  - **Collection** comes after the attacks (or effect) and weakness · resistance · retreat, before Details, under an `ion-list-header` "Collection · German" naming the current language in English: one `IonItem lines="inset"` per variant the card comes in (TCGdex's flags, else just Normal) plus any other variant owned, with a stepper at the end: `fill="clear"` icon-only `IonButton`s (`remove-circle-outline`, `add-circle-outline`) around the count (larger on desktop). Remove is disabled at 0, and both are disabled until the collection has loaded. Switching the language shows and edits that language's copies. Copies in the card's other languages are noted in a row below ("Also 2 in German"). The modal re-measures a slide whenever its content changes height (a `ResizeObserver` around Swiper's `autoHeight`).
- **Card images:** a fallback-language scan gets an `IonBadge` with the language code (top right). A card without any scan is a type-tinted `IonCard` (name, HP · stage, energy icon, set number) at card proportions (63:88).
- **Owned cards:** a grid tile gets a `color="danger"` `IonBadge` (bottom right) with the copies owned in the tile's language, across variants. Unowned cards look unchanged.
- **Language:** switched in context with the header button (on the sets list too: before the Filters button on phones, in the side menu's title toolbar on desktop, offering every language of the catalog's sets), and remembered per catalog in synced settings. Every set and card opens in it. Languages are always named in English ("German", not "Deutsch"), in pickers and app text alike (`LANGUAGE_LABELS`), and listed in display order: English, German, French, Italian, then Japanese and Chinese (`inDisplayOrder`).
- **Search:**
  - An `IonSearchbar` ("Search cards") sits between the Cards title and the catalog segment: in the page header on phones, in the side `IonMenu` on desktop. The segment chooses which catalog is searched.
  - Focusing it, typing, or picking a filter shows search instead of the sets list (phones) or the open set (desktop, where results take the main pane, titled "Search"). On phones, the searchbar's Cancel clears the query and filters and brings the sets list back. On desktop, opening a set from the menu replaces the results, keeping the query in the searchbar; focusing it shows them again.
  - Before there's a query or filter, the results area lists recent searches (`IonItem button` rows with a clock icon, then a "Clear recent searches" action row), kept on the device. Enter, picking a recent search or opening a result remembers the query.
  - Results use the set page's card grid, grouped by set under sticky `IonItemDivider`s ("Paldea Evolved · 12"), newest set first, with a "128 cards in 41 sets" summary above. They load 60 at a time with `IonInfiniteScroll`. A card opens in the card detail modal, which pages through the results; within 5 cards of the last one loaded, it loads the next page and appends it to the virtual slides, so paging carries on to the end.
- **Filters on phones:** a Filters button (icon-only `IonButton`, `options-outline`) in the Cards title toolbar's end slot, with a small `IonBadge` on the icon's top-right corner counting the picked values (overlaid, so the button never moves). It shows search and opens the Filters sheet: Collection, Category, Type, Rarity and Set as `IonItem` rows (with chevrons) showing their picks as an `IonNote` ("Fighting", "Mega Evolution +1", colored `primary`) or "Any", then a red "Clear filters" action row while any is picked. A row opens that filter's picker as a second sheet stacked on top (the stock slide-up); its Done or a swipe down returns to the list. A row of chips doesn't fit a phone's width.
- **Filters on desktop:** a row of `IonChip`s in a toolbar under the results title: Collection, Category, Type, Rarity, Set, then a clear "Clear" button while any is in use. An unused chip is `outline` with a caret; a used one is `color="primary"`, shows "Type: Fire +1" and has a ✕ that clears it. A chip opens its picker in an `IonPopover` under it (`.filter-popover`, 340 px wide, fixed height so the list scrolls under its header).
- **Auto-height sheets:** sheets that should be only as tall as what they show (the Filters sheet and its pickers) open with `[breakpoints]="[0, 1]"` and the global `auto-height-sheet` class (Ionic's auto-height sheet: `--height: auto`, capped at the screen's height). Their scrolling part is a plain div, not `ion-content`, which can't size to its content; `IonNav` can't be used inside them either, since it positions its pages absolutely.
- **Filter pickers:** the header has the title and Done; changes apply as they're made.
  - Each value is an `IonItem` with an `ion-checkbox` (`justify="start" labelPlacement="end"`, so the box leads) and its card count as an `IonNote` at the end. Type values show their energy icon; set values their logo.
  - Only values the current search has cards for are listed, with counts for the current query and the other filters (not the filter's own picks, which add cards). Picked values always stay listed, at 0 if need be, so they can be cleared. When nothing is left, the list says "No cards match this search". The Collection picker always lists both of its values, Owned and Missing (docs/collection.md), even at 0.
  - Groups can be picked as a whole: categories with their subtypes as child rows (Trainer → Supporter, Item, …), and sets under sticky series dividers that hold the series' own checkbox. A picked group covers all its values (shown checked and disabled), and a partly picked one is indeterminate. The Set picker has its own `IonSearchbar` ("Search sets").

## Tests

- Elements that tests or checks look up carry a `data-testid`.
- Component specs render the real template: Vitest compiles components with Angular's compiler (`@analogjs/vite-plugin-angular` in `vitest.config.ts`), so set signal inputs with `fixture.componentRef.setInput()` and assert on the DOM. Layout and styling are still checked in the browser at both viewport sizes.
- Zone.js can't track native `async`/`await`, so `fixture.whenStable()` won't wait for a component's async loads. Flush a macrotask (`await new Promise((r) => setTimeout(r))`) before `fixture.detectChanges()`.
- In jsdom, Ionic patches some elements' text (`IonLabel` reads as empty), so look elements up by `data-testid` rather than by label text.
- For `ModalController` components, take `componentProps` as plain properties: Ionic assigns them directly and would overwrite signal inputs (and `modal` is a reserved name).
