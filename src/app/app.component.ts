import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor() { }

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
