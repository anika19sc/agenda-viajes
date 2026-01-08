import { Injectable } from '@angular/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

@Injectable({
  providedIn: 'root'
})
export class HapticsService {

  constructor() { }

  async impactLight() {
    await Haptics.impact({ style: ImpactStyle.Light });
  }

  async impactMedium() {
    await Haptics.impact({ style: ImpactStyle.Medium });
  }

  async impactHeavy() {
    await Haptics.impact({ style: ImpactStyle.Heavy });
  }

  async vibrate() {
    await Haptics.vibrate();
  }

  async success() {
    await Haptics.notification({ type: 'SUCCESS' as any });
  }

  async selection() {
    await Haptics.selectionStart();
  }
}
