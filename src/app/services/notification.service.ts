import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {

  constructor() { }

  async ensurePermissions(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'granted') return true;

    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  }

  async scheduleOneHourBefore(params: { date: string; time: string; description: string; section: string }): Promise<void> {
    const granted = await this.ensurePermissions();
    if (!granted) return;

    const tripAt = new Date(`${params.date}T${params.time}:00`);
    if (isNaN(tripAt.getTime())) return;

    const notifyAt = new Date(tripAt.getTime() - 60 * 60 * 1000);
    const now = new Date();
    if (notifyAt.getTime() <= now.getTime()) return;

    const id = Math.floor(Date.now() % 2147483647);

    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title: 'Recordatorio de viaje',
          body: `${params.section.toUpperCase()}: ${params.description} (en 1 hora)`,
          schedule: { at: notifyAt }
        }
      ]
    });
  }
}
