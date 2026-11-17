# UI conventions

Standards for PokePaper's screens, so new pages look and behave like existing ones. When a screen needs something these don't cover, add the decision here.

## Platforms

- **iOS phone and desktop web are equal targets.** Design every page, modal and component for both, and check both before calling UI work done: a phone viewport (about 390×844) and a desktop one (about 1440×900).
- Prefer one responsive layout (Ionic breakpoints, `ion-split-pane`, adaptive modals) over separate code paths.

## Language

- **App text is US English** ("catalog", "color", "favorite"). Docs and code comments follow suit.
- **Card content is shown in the card's own language** (TCGdex's text). Switching languages happens in context, in the header of set, series and card views (see the card catalog plan), not through a global setting.

## Page layout

- **Large collapsing title:** pages use a translucent `ion-header` plus an `ion-header collapse="condense"` with a large `ion-title` inside `ion-content`.
- **Readable column on wide screens:** settings-style pages wrap their content in a centered column with `max-width: 760px`, and apply the same width to the large-title toolbar, so the title lines up with the content. On phones the column is full width. Example: `src/app/settings/settings.page.ts`.

## Lists

- **Flat, full-width lists:** use `<ion-list>` without `inset`. The only horizontal spacing is the rows' own 16 px padding, so section headers, row text and the page title all line up on one edge. Don't add extra padding or margins around lists.
- **One list per section,** titled with an `ion-list-header`.
- **Dividers between rows only:** no divider under the last row of a list. A global rule in `src/global.scss` enforces this.
- **Label and value rows:** the label in `ion-label`, the value as `<ion-note slot="end">`.
- **Hint text** under a label: `<p class="hint">` inside the `ion-label` (styled globally with a little top padding).
- **Progress:** an `ion-progress-bar` in its own row, directly under the row it belongs to.

## Actions

- **Actions belonging to a section are full-width button rows at the end of its list:** `<ion-item button="true" detail="false">` with an `ion-label` colored `primary`, e.g. "Check for updates", "Add passkey".
- **Destructive actions** use `color="danger"`, e.g. "Sign out of this device".
- **Actions on one row** (e.g. "Remove" on a passkey) are `fill="clear"` buttons at the row's end (`slot="end"`).
- **Disable actions while they run** (`[disabled]="busy()"`), rather than hiding them.
- **A screen's single main call to action outside any list** (e.g. the sign-in button) is an `ion-button expand="block"`.

## Tests

- Elements that tests or checks look up carry a `data-testid`.
- Component specs test the component's state (signals) with the template replaced. Real rendering is checked in the browser at both viewport sizes.
