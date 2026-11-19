import { TestBed } from '@angular/core/testing';
import { AlertController, ToastController } from '@ionic/angular';
import type { Deck } from '@pokepaper/shared';
import { vi } from 'vitest';
import { DeckFullError } from '../../core/services/deck.service';
import { DeckDialogsService } from './deck-dialogs.service';

interface AlertButton {
  text: string;
  role?: string;
  cssClass?: string;
  handler?: (data: { name?: string }) => boolean;
}

const deck: Deck = {
  id: 'deck-1',
  name: 'Charizard ex',
  format: 'standard',
  cards: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('DeckDialogsService', () => {
  let dismissal: { role?: string; data?: unknown };
  const input = { focus: vi.fn() };
  const alert = {
    present: vi.fn(() => Promise.resolve()),
    onDidDismiss: vi.fn(() => Promise.resolve(dismissal)),
    querySelector: vi.fn(() => input),
  };
  const alerts = { create: vi.fn((_options: Record<string, unknown>) => Promise.resolve(alert)) };
  const toast = { present: vi.fn(() => Promise.resolve()) };
  const toasts = { create: vi.fn((_options: Record<string, unknown>) => Promise.resolve(toast)) };

  function create(): DeckDialogsService {
    TestBed.configureTestingModule({
      providers: [
        { provide: AlertController, useValue: alerts },
        { provide: ToastController, useValue: toasts },
      ],
    });
    return TestBed.inject(DeckDialogsService);
  }

  const options = () => alerts.create.mock.lastCall?.[0] ?? {};
  const buttons = () => options()['buttons'] as AlertButton[];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for a new name, focused, and returns it trimmed', async () => {
    dismissal = { role: 'confirm', data: { values: { name: '  Lugia VSTAR ' } } };

    expect(await create().askNewName()).toBe('Lugia VSTAR');

    expect(options()).toMatchObject({ header: 'New deck' });
    expect(options()['inputs']).toEqual([
      expect.objectContaining({ name: 'name', value: '', placeholder: 'Deck name' }),
    ]);
    expect(input.focus).toHaveBeenCalled();
  });

  it('keeps the alert open on a blank name', async () => {
    dismissal = { role: 'cancel' };
    await create().askNewName();

    const confirm = buttons().find((button) => button.role === 'confirm');
    expect(confirm?.text).toBe('Create');
    expect(confirm?.handler?.({ name: '   ' })).toBe(false);
    expect(confirm?.handler?.({ name: 'Zard' })).toBe(true);
  });

  it.each([
    ['cancelled', { role: 'cancel' }],
    ['dismissed by the backdrop', { role: 'backdrop' }],
    ['confirmed blank', { role: 'confirm', data: { values: { name: ' ' } } }],
  ])('returns null when %s', async (_label, outcome) => {
    dismissal = outcome;

    expect(await create().askNewName()).toBeNull();
  });

  it('asks for a new name prefilled with the current one, null if unchanged', async () => {
    const dialogs = create();
    dismissal = { role: 'confirm', data: { values: { name: 'Zard' } } };
    expect(await dialogs.askRename(deck)).toBe('Zard');
    expect(options()).toMatchObject({ header: 'Rename deck' });
    expect(options()['inputs']).toEqual([expect.objectContaining({ value: 'Charizard ex' })]);
    expect(buttons().find((button) => button.role === 'confirm')?.text).toBe('Rename');

    dismissal = { role: 'confirm', data: { values: { name: ' Charizard ex ' } } };
    expect(await dialogs.askRename(deck)).toBeNull();
  });

  it('confirms a delete with a red Delete button', async () => {
    const dialogs = create();
    dismissal = { role: 'confirm' };
    expect(await dialogs.confirmDelete(deck)).toBe(true);
    expect(options()).toMatchObject({ header: 'Delete "Charizard ex"?' });
    expect(buttons()).toEqual([
      { text: 'Cancel', role: 'cancel' },
      { text: 'Delete', role: 'confirm', cssClass: 'alert-button-danger' },
    ]);

    dismissal = { role: 'cancel' };
    expect(await dialogs.confirmDelete(deck)).toBe(false);
  });

  it('says a change could not be saved, or that the deck is full', async () => {
    const dialogs = create();

    await dialogs.showSaveError(new Error('disk full'));
    expect(toasts.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Couldn't save the deck. Try again.", color: 'danger' })
    );

    await dialogs.showSaveError(new DeckFullError());
    expect(toasts.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'A deck holds at most 200 different printings.' })
    );
    expect(toast.present).toHaveBeenCalledTimes(2);
  });
});
