import { Component, inject } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { App } from '@capacitor/app';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  private platform = inject(Platform);
  private router = inject(Router);
  private location = inject(Location);

  constructor() {
    this.platform.ready().then(() => {
      this.platform.backButton.subscribeWithPriority(10, () => {
        const url = this.router.url;

        if (url === '/' || url === '/home') {
          App.exitApp();
          return;
        }

        this.location.back();
      });
    });
  }

  get greeting(): string {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 13) {
      return 'Buenos Días, Marcelo';
    } else if (hour >= 13 && hour < 20) {
      return 'Buenas Tardes, Marcelo';
    } else {
      // De 20:00 a 04:59
      return 'Buenas Noches, Marcelo';
    }
  }
}
