import { Component, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { DatabaseService } from '../services/database.service';
import { VoiceService } from '../services/voice.service';
import { ShareService } from '../services/share.service';
import { HapticsService } from '../services/haptics.service';
import { NotificationService } from '../services/notification.service';
import { Trip } from '../models/trip.model';
import { AlertController, ToastController } from '@ionic/angular';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  private db = inject(DatabaseService);
  private voice = inject(VoiceService);
  private share = inject(ShareService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private haptics = inject(HapticsService);
  private notifications = inject(NotificationService);
  private cdr = inject(ChangeDetectorRef);

  public selectedSection = signal<'ida' | 'vuelta' | 'encomienda'>('ida');
  public currentDate = this.db.currentDate;
  public isAvailable = this.voice.isAvailable;

  // Expose signals from DB
  public trips = this.db.trips;
  public totalRevenue = this.db.totalRevenue;
  public sectionTotals = this.db.sectionTotals;
  public sectionCounts = this.db.sectionCounts;
  public isRecording = this.voice.recording;
  public audioStream = this.voice.audioStream$;

  stopListening() {
    this.voice.stopListening();
  }

  constructor() { }

  async prevDay() {
    await this.db.prevDay();
  }

  async nextDay() {
    await this.db.nextDay();
  }

  async recordVoice() {
    this.haptics.impactLight();

    if (this.isRecording()) {
      this.voice.stopListening();
      return;
    }

    try {
      // DEBUG: Toast de inicio
      const toastStart = await this.toastCtrl.create({
        message: '🎤 Escuchando...',
        duration: 1000,
        position: 'top',
        color: 'warning'
      });
      await toastStart.present();

      const sentence = await this.voice.startListening();

      if (sentence) {
        console.log("Procesando entrada de voz:", sentence);

        // DEBUG: Toast con lo que escuchó
        const toastHeard = await this.toastCtrl.create({
          message: `👂 Escuché: "${sentence}"`,
          duration: 2000,
          position: 'top',
          color: 'dark'
        });
        await toastHeard.present();

        const parsed = this.voice.parseSentence(sentence, this.currentDate());
        const targetDate = parsed.date || this.currentDate();

        // CICLO DE GUARDADO Y CARGA ESTRICTA
        console.log("Iniciando INSERT en DB...");
        await this.db.addTrip({
          date: targetDate,
          section: this.selectedSection(),
          passenger: parsed.passenger || undefined,
          destination: parsed.destination || undefined,
          description: parsed.description,
          amount: parsed.amount,
          time: parsed.time || undefined
        });

        if (parsed.time && targetDate) {
          await this.notifications.scheduleOneHourBefore({
            date: targetDate,
            time: parsed.time,
            description: parsed.description,
            section: this.selectedSection(),
          });
        }

        console.log("✅ Registro INSERT exitoso. Iniciando recarga SELECT...");
        // Aseguramos la recarga explícita para que el signal se actualice
        await this.db.loadTrips(this.currentDate());

        this.haptics.success();
        this.cdr.detectChanges();
        console.log("🚀 SELECT completado y UI refrescada.");

        // DEBUG: Toast de éxito final
        const toastSuccess = await this.toastCtrl.create({
          message: '✅ Guardado correctamente en Base de Datos',
          duration: 2000,
          position: 'top',
          color: 'success'
        });
        await toastSuccess.present();
      } else {
        // DEBUG: Toast si no escuchó nada
        const toastEmpty = await this.toastCtrl.create({
          message: '❌ No escuché nada. Intenta de nuevo.',
          duration: 2000,
          position: 'top',
          color: 'medium'
        });
        await toastEmpty.present();
      }
    } catch (err) {
      console.error('❌ Error en el flujo de voz/DB:', err);
      const alert = await this.alertCtrl.create({
        header: 'Error Crítico',
        message: 'Falló al guardar: ' + JSON.stringify(err),
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async manualEntry() {
    const alert = await this.alertCtrl.create({
      header: 'Carga Manual',
      inputs: [
        { name: 'passenger', type: 'text', placeholder: 'Pasajero (opcional)' },
        { name: 'destination', type: 'text', placeholder: 'Destino (opcional)' },
        { name: 'description', type: 'text', placeholder: 'Descripción (Nombre/Lugar)' },
        { name: 'amount', type: 'number', placeholder: 'Importe ($)' },
        { name: 'time', type: 'time', placeholder: 'Hora (opcional)' }
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: async (data) => {
            if (data.description && data.amount) {
              try {
                // Sanitización estricta para carga manual también
                const cleanAmount = this.voice.parseAmount(data.amount);

                const passenger = (data.passenger || '').trim();
                const destination = (data.destination || '').trim();

                await this.db.addTrip({
                  date: this.currentDate(),
                  section: this.selectedSection(),
                  passenger: passenger ? passenger : undefined,
                  destination: destination ? destination : undefined,
                  description: data.description,
                  amount: cleanAmount,
                  time: data.time || undefined
                });

                if (data.time) {
                  await this.notifications.scheduleOneHourBefore({
                    date: this.currentDate(),
                    time: data.time,
                    description: data.description,
                    section: this.selectedSection(),
                  });
                }
                this.haptics.success();

                // Recarga explícita y forzado de UI
                await this.db.loadTrips(this.currentDate());
                this.cdr.detectChanges();
              } catch (e) {
                const errAlert = await this.alertCtrl.create({
                  header: 'Error',
                  message: 'Falló al guardar: ' + JSON.stringify(e),
                  buttons: ['OK']
                });
                await errAlert.present();
              }
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async deleteTrip(trip: Trip) {
    if (trip.id) {
      await this.db.deleteTrip(trip.id, this.currentDate());
      this.haptics.impactLight();
      this.cdr.detectChanges();
    }
  }

  async shareSummary() {
    const alert = await this.alertCtrl.create({
      header: 'Exportar / Compartir',
      buttons: [
        {
          text: 'Resumen',
          handler: async () => {
            await this.share.shareDailySummary(this.currentDate(), this.trips(), this.totalRevenue());
          }
        },
        { text: 'Cancelar', role: 'cancel' }
      ]
    });
    await alert.present();
  }
}
