import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CardmarketCandidates } from '@pokepaper/shared';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { CardmarketMatchService } from './cardmarket-match.service';
import { CatalogSyncService } from './catalog-sync.service';

describe('CardmarketMatchService', () => {
  const base = `${environment.apiUrl}/api/catalog/cardmarket/intl/xy8-63`;
  const catalogSync = { syncNow: vi.fn(() => Promise.resolve()) };
  let service: CardmarketMatchService;
  let http: HttpTestingController;

  beforeEach(() => {
    catalogSync.syncNow.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CatalogSyncService, useValue: catalogSync },
      ],
    });
    service = TestBed.inject(CardmarketMatchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('gets candidates, searched when there’s a query', async () => {
    const answer: CardmarketCandidates = { current: null, products: [], truncated: false };

    const suggested = service.candidates('intl', 'xy8-63');
    http.expectOne(`${base}/candidates`).flush(answer);
    const searched = service.candidates('intl', 'xy8-63', '  M Mewtwo ');
    http.expectOne(`${base}/candidates?q=M%20Mewtwo`).flush(answer);

    expect(await suggested).toEqual(answer);
    expect(await searched).toEqual(answer);
  });

  it('matches a card, then syncs its prices', async () => {
    const done = service.match('intl', 'xy8-63', 286309);
    const request = http.expectOne(`${base}/match`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ idProduct: 286309 });
    request.flush(null, { status: 204, statusText: 'No Content' });

    await done;
    expect(catalogSync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('clears a match, then syncs its prices', async () => {
    const done = service.clear('intl', 'xy8-63');
    const request = http.expectOne(`${base}/match`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });

    await done;
    expect(catalogSync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('syncs nothing when a change fails', async () => {
    const done = service.match('intl', 'xy8-63', 1);
    http
      .expectOne(`${base}/match`)
      .flush({ error: 'unknown_product' }, { status: 422, statusText: 'x' });

    await expect(done).rejects.toThrow();
    expect(catalogSync.syncNow).not.toHaveBeenCalled();
  });
});
