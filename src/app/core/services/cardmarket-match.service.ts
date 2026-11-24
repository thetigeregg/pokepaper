import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CardmarketCandidates,
  CardmarketMatchRequest,
  CatalogRegion,
} from '@pokepaper/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CatalogSyncService } from './catalog-sync.service';

/**
 * Matching a card to a Cardmarket product by hand, on the server
 * (docs/catalog.md → Matching by hand). Needs a connection: the product
 * list and the matches live on the server. After a change, a catalog sync
 * fetches the card's new prices.
 */
@Injectable({ providedIn: 'root' })
export class CardmarketMatchService {
  private readonly http = inject(HttpClient);
  private readonly catalogSync = inject(CatalogSyncService);

  /** Products the card could be matched to, searched by `query` when given. */
  candidates(region: CatalogRegion, cardId: string, query = ''): Promise<CardmarketCandidates> {
    const q = query.trim();
    return firstValueFrom(
      this.http.get<CardmarketCandidates>(this.url(region, cardId, 'candidates'), {
        params: q ? { q } : {},
      })
    );
  }

  /** Matches the card to `idProduct`, then fetches its new prices. */
  async match(region: CatalogRegion, cardId: string, idProduct: number): Promise<void> {
    const body: CardmarketMatchRequest = { idProduct };
    await firstValueFrom(this.http.put(this.url(region, cardId, 'match'), body));
    void this.catalogSync.syncNow();
  }

  /** Forgets the card's match, then fetches its prices again. */
  async clear(region: CatalogRegion, cardId: string): Promise<void> {
    await firstValueFrom(this.http.delete(this.url(region, cardId, 'match')));
    void this.catalogSync.syncNow();
  }

  private url(region: CatalogRegion, cardId: string, path: 'candidates' | 'match'): string {
    return `${environment.apiUrl}/api/catalog/cardmarket/${region}/${encodeURIComponent(cardId)}/${path}`;
  }
}
