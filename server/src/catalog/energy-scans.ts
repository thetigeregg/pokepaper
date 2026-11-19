import {
  basicEnergyType,
  type AssetPath,
  type CatalogCard,
  type CatalogLanguage,
} from '@pokepaper/shared';

/**
 * Basic Energy scans (docs/catalog.md → Basic Energy scans). TCGdex has no
 * scan for many basic Energy printings (all of Mega Evolution Energy, about
 * half overall). Their art barely changes between printings, so a language
 * without a scan of its own borrows a regular printing's scan of the same
 * Energy type in that language, marked with `imageFrom`.
 */

/**
 * How plain a printing's rarity is, lower first: donors are regular basic
 * Energy, never the gold or full-art ones (Hyper rare, Secret Rare, …),
 * whose art doesn't stand in for a regular card.
 */
function plainness(rarity: string | null): number | null {
  if (rarity === null || rarity === 'None' || rarity === 'Common') {
    return 0;
  }
  return rarity === 'Uncommon' ? 1 : null;
}

/** A stored Energy card and its set's release date. */
export interface EnergyCard {
  card: CatalogCard;
  releaseDate: string | null;
}

/** A card language whose scan should change. */
export interface EnergyScanChange {
  setId: string;
  cardId: string;
  language: CatalogLanguage;
  /** The borrowed scan, or null to drop a borrowed scan whose source is gone. */
  image: AssetPath | null;
  imageFrom: string | null;
}

/**
 * The scans to borrow (or drop): for each basic Energy language without a
 * scan of its own, a regular printing of its type with one, in the same
 * language: the plainest rarity (`plainness`), then the newest set, then the
 * card ID. Languages with no such scan get none; the app then shows another
 * language's scan, as for any card.
 */
export function planEnergyScans(cards: readonly EnergyCard[]): EnergyScanChange[] {
  const typed = cards.flatMap((entry) => {
    const type = entry.card.text.en ? basicEnergyType(entry.card.text.en.name) : null;
    return entry.card.category === 'Energy' && type ? [{ ...entry, type }] : [];
  });

  const donors = new Map<
    string,
    { card: CatalogCard; image: AssetPath; releaseDate: string; plain: number }
  >();
  for (const { card, releaseDate, type } of typed) {
    const plain = plainness(card.rarity);
    if (plain === null) {
      continue;
    }
    for (const [language, text] of Object.entries(card.text)) {
      if (!text.image || text.imageFrom) {
        continue;
      }
      const key = `${type}|${language}`;
      const current = donors.get(key);
      const date = releaseDate ?? '';
      if (
        !current ||
        plain < current.plain ||
        (plain === current.plain &&
          (date > current.releaseDate ||
            (date === current.releaseDate && card.id < current.card.id)))
      ) {
        donors.set(key, { card, image: text.image, releaseDate: date, plain });
      }
    }
  }

  const changes: EnergyScanChange[] = [];
  for (const { card, type } of typed) {
    for (const [language, text] of Object.entries(card.text) as [
      CatalogLanguage,
      NonNullable<CatalogCard['text'][CatalogLanguage]>,
    ][]) {
      if (text.image && !text.imageFrom) {
        continue; // Its own scan.
      }
      const donor = donors.get(`${type}|${language}`);
      const change = { setId: card.setId, cardId: card.id, language };
      if (donor && donor.card.id !== card.id) {
        if (text.image !== donor.image || text.imageFrom !== donor.card.id) {
          changes.push({ ...change, image: donor.image, imageFrom: donor.card.id });
        }
      } else if (text.imageFrom) {
        changes.push({ ...change, image: null, imageFrom: null });
      }
    }
  }
  return changes;
}

/** Applies scan changes to one set's cards (in place); returns how many applied. */
export function applyEnergyScans(
  cards: CatalogCard[],
  changes: readonly EnergyScanChange[]
): number {
  const byCard = new Map(cards.map((card) => [card.id, card]));
  let applied = 0;
  for (const change of changes) {
    const text = byCard.get(change.cardId)?.text[change.language];
    if (!text) {
      continue;
    }
    text.image = change.image;
    if (change.imageFrom) {
      text.imageFrom = change.imageFrom;
    } else {
      delete text.imageFrom;
    }
    applied += 1;
  }
  return applied;
}
