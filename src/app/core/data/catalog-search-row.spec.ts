import { describe, expect, it } from 'vitest';
import { catalogSearchRow } from './catalog-search-row';
import { makeContractCard } from './storage-engine.contract';

describe('catalogSearchRow', () => {
  it('skips names with nothing searchable, and takes the Energy subtype', () => {
    const card = makeContractCard('intl', 'sve', 'sve-1', 0);
    const english = card.text.en;
    if (!english) {
      throw new Error('The contract card has English text');
    }
    card.category = 'Energy';
    card.energyType = 'Normal';
    card.text = { en: { ...english, name: 'Fire Energy' }, fr: { ...english, name: '★' } };

    expect(catalogSearchRow(card, 'intl:sve')).toEqual(
      expect.objectContaining({
        names: ['fire energy'],
        number: '1',
        subtype: 'Normal',
        setKey: 'intl:sve',
      })
    );
  });

  it('keeps the illustrator as spelled, without TCGdex\'s "N/A"', () => {
    const card = makeContractCard('intl', 'sv01', 'sv01-1', 0);

    expect(catalogSearchRow({ ...card, illustrator: ' Ken Sugimori ' }, 'intl:sv01')).toEqual(
      expect.objectContaining({ illustrator: 'Ken Sugimori' })
    );
    expect(catalogSearchRow({ ...card, illustrator: 'N/A' }, 'intl:sv01').illustrator).toBeNull();
    expect(catalogSearchRow({ ...card, illustrator: '' }, 'intl:sv01').illustrator).toBeNull();
    expect(catalogSearchRow({ ...card, illustrator: null }, 'intl:sv01').illustrator).toBeNull();
  });
});
