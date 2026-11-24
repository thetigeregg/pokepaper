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
});
