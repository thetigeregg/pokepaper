import { ChangeDetectionStrategy, Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AlertController, IonApp, IonRouterOutlet } from '@ionic/angular';
import { LiveUpdateService } from './core/services/live-update.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  private readonly alertController = inject(AlertController);
  private readonly liveUpdate = inject(LiveUpdateService);
  private readonly destroyRef = inject(DestroyRef);
  private updateAlertOpen = false;

  ngOnInit(): void {
    // Confirms this web bundle started, so an OTA update isn't rolled back.
    void this.liveUpdate.markReady();

    this.liveUpdate.staged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ semver }) => {
      void this.presentUpdateReadyAlert(semver);
    });
  }

  /** Offers to apply a staged OTA update now; "Later" applies it on the next cold start. */
  private async presentUpdateReadyAlert(semver: string): Promise<void> {
    if (this.updateAlertOpen) {
      return;
    }
    this.updateAlertOpen = true;
    try {
      const alert = await this.alertController.create({
        header: 'Update Ready',
        message: `A new version (${semver}) is ready. Reload now to apply it?`,
        buttons: [
          { text: 'Later', role: 'cancel' },
          { text: 'Reload', role: 'confirm' },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role === 'confirm') {
        await this.liveUpdate.reload();
      }
    } finally {
      this.updateAlertOpen = false;
    }
  }
}
