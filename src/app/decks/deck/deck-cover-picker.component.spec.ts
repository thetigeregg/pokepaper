import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { vi } from 'vitest';
import { makeContractCard } from '../../core/data/storage-engine.contract';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { VisibilityService } from '../../core/services/visibility.service';
import { DeckCoverPickerComponent } from './deck-cover-picker.component';
import type { DeckRow } from './deck.page';

const row = (cardId: string, card = true): DeckRow => ({
  key: `intl:${cardId}`,
  list: 'cards',
  slot: { region: 'intl', cardId, count: 1 },
  card: card ? makeContractCard('intl', 'sv01', cardId, 0) : null,
  language: 'en',
  name: cardId,
  line: `SVI · ${cardId}`,
});

describe('DeckCoverPickerComponent', () => {
  const modals = { dismiss: vi.fn(() => Promise.resolve(true)) };
  let fixture: ComponentFixture<DeckCoverPickerComponent>;

  function create(current: string | null): DeckCoverPickerComponent {
    fixture = TestBed.createComponent(DeckCoverPickerComponent);
    fixture.componentInstance.rowsProp = [row('sv01-001'), row('sv01-166'), row('gone', false)];
    fixture.componentInstance.currentProp = current;
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const query = (selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(selector);

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: ModalController, useValue: modals },
        {
          provide: ImageCacheService,
          useValue: { resolve: vi.fn(() => Promise.resolve(null)), release: vi.fn() },
        },
        { provide: VisibilityService, useValue: { whenVisible: () => () => undefined } },
      ],
    });
  });

  it('lists the default, then the deck’s cards on this device, checking the current one', () => {
    create('intl:sv01-166');

    expect(query('[data-testid="cover-default"]')?.textContent).toContain('First Pokémon');
    expect(query('[data-testid="cover-intl:sv01-001"]')).not.toBeNull();
    expect(query('[data-testid="cover-intl:gone"]')).toBeNull(); // No scan to show.
    expect(query('[data-testid="cover-intl:sv01-166"] ion-icon')).not.toBeNull();
    expect(query('[data-testid="cover-default"] ion-icon')).toBeNull();
  });

  it('checks the default when there’s no choice', () => {
    create(null);

    expect(query('[data-testid="cover-default"] ion-icon')).not.toBeNull();
  });

  it('closes with the printing picked, the default, or nothing on Cancel', () => {
    create(null);

    (query('[data-testid="cover-intl:sv01-001"]') as HTMLElement).click();
    expect(modals.dismiss).toHaveBeenLastCalledWith({ key: 'intl:sv01-001' }, 'select');

    (query('[data-testid="cover-default"]') as HTMLElement).click();
    expect(modals.dismiss).toHaveBeenLastCalledWith({ key: null }, 'select');

    (query('[data-testid="cover-cancel"]') as HTMLElement).click();
    expect(modals.dismiss).toHaveBeenLastCalledWith(undefined, 'cancel');
  });
});
