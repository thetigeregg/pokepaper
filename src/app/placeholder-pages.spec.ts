import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CollectionPage } from './collection/collection.page';
import { DecksPage } from './decks/decks.page';

describe.each<[string, Type<unknown>]>([
  ['CollectionPage', CollectionPage],
  ['DecksPage', DecksPage],
])('%s', (_name, page) => {
  it('creates', async () => {
    TestBed.overrideComponent(page, { set: { template: '<div></div>' } });
    await TestBed.compileComponents();

    expect(TestBed.createComponent(page).componentInstance).toBeTruthy();
  });
});
