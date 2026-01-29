import { Component, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { DatabaseService } from '../services/database.service';
import { VoiceService } from '../services/voice.service';
import { ShareService } from '../services/share.service';
import { HapticsService } from '../services/haptics.service';
import { NotificationService } from '../services/notification.service';
import { Trip } from '../models/trip.model';
import { AlertController, ToastController, ActionSheetController } from '@ionic/angular';

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
  private actionSheetCtrl = inject(ActionSheetController);
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

  // Signal to track which section is currently recording
  public recordingSection = signal<'ida' | 'vuelta' | 'encomienda' | null>(null);

  async recordVoice(section: 'ida' | 'vuelta' | 'encomienda') {
    this.haptics.impactLight();

    // If already recording
    if (this.isRecording()) {
      // If clicking the SAME button -> STOP
      if (this.recordingSection() === section) {
        this.voice.stopListening();
        this.recordingSection.set(null);
        return;
      } else {
        // If clicking a DIFFERENT button while recording -> Ignore or Stop previous?
        // Let's stop previous and start new for safety, or just block.
        // For simplicity: Stop previous, don't start new immediately to avoid confusion.
        await this.voice.stopListening();
        this.recordingSection.set(null);
        return;
      }
    }

    // Start Recording
    this.recordingSection.set(section);

    try {
      const toastStart = await this.toastCtrl.create({
        message: `🎤 Escuchando para ${section.toUpperCase()}...`,
        duration: 1000,
        position: 'top',
        color: 'warning'
      });
      await toastStart.present();

      const sentence = await this.voice.startListening();

      if (sentence) {
        console.log("Procesando entrada de voz:", sentence);

        const toastHeard = await this.toastCtrl.create({
          message: `👂 Escuché: "${sentence}"`,
          duration: 2000,
          position: 'top',
          color: 'dark'
        });
        await toastHeard.present();

        const parsed = this.voice.parseSentence(sentence, this.currentDate());
        const targetDate = parsed.date || this.currentDate();

        // LOGIC: Use the explicitly selected section
        const targetSection = section;

        console.log("Iniciando INSERT en DB...");
        await this.db.addTrip({
          date: targetDate,
          section: targetSection,
          passenger: parsed.passenger || undefined,
          destination: parsed.destination || undefined,
          description: parsed.description,
          amount: parsed.amount,
          time: parsed.time || undefined,
          packageType: parsed.packageType || undefined
        });

        // Notifications logic remains same
        if (parsed.time && targetDate) {
          await this.notifications.scheduleOneHourBefore({
            date: targetDate,
            time: parsed.time,
            description: parsed.description,
            section: targetSection,
          });
        }

        console.log("✅ Registro INSERT exitoso. Iniciando recarga SELECT...");
        await this.db.loadTrips(this.currentDate());

        this.haptics.success();
        this.cdr.detectChanges(); // Refresh UI
        this.recordingSection.set(null); // Reset state

        const toastSuccess = await this.toastCtrl.create({
          message: `✅ Guardado en ${targetSection.toUpperCase()}`,
          duration: 2000,
          position: 'top',
          color: 'success'
        });
        await toastSuccess.present();

      } else {
        // No sentence heard
        this.recordingSection.set(null);
        const toastEmpty = await this.toastCtrl.create({
          message: '❌ No escuché nada.',
          duration: 2000,
          position: 'top',
          color: 'medium'
        });
        await toastEmpty.present();
      }
    } catch (err) {
      this.recordingSection.set(null);
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
    const actionSheet = await this.actionSheetCtrl.create({
      header: '¿Qué deseas registrar?',
      buttons: [
        {
          text: 'Viaje de IDA',
          icon: 'arrow-forward',
          handler: () => { this.showManualForm('ida'); }
        },
        {
          text: 'Envíar ENCOMIENDA',
          icon: 'cube',
          handler: () => { this.showManualForm('encomienda'); }
        },
        {
          text: 'Viaje de VUELTA',
          icon: 'arrow-back',
          handler: () => { this.showManualForm('vuelta'); }
        },
        {
          text: 'Cancelar',
          icon: 'close',
          role: 'cancel',
          handler: () => { }
        }
      ]
    });
    await actionSheet.present();
  }

  async showManualForm(section: 'ida' | 'vuelta' | 'encomienda') {
    const isEncomienda = section === 'encomienda';

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;

    const inputs: any[] = [];

    if (isEncomienda) {
      inputs.push(
        { name: 'packageType', type: 'text', placeholder: 'Tipo (Sobre, Caja, Bici...)' },
        { name: 'destination', type: 'text', placeholder: 'Destino (Pueblo/Ciudad)' },
        { name: 'description', type: 'text', placeholder: 'Dirección (Calle y Número)' },
        { name: 'amount', type: 'number', placeholder: 'Importe ($)' },
        { name: 'time', type: 'time', placeholder: 'Hora (Requerido)', value: currentTime }
      );
    } else {
      inputs.push(
        { name: 'passenger', type: 'text', placeholder: 'Pasajero (opcional)' },
        { name: 'destination', type: 'text', placeholder: 'Destino (opcional)' },
        { name: 'description', type: 'text', placeholder: 'Descripción (Nombre/Lugar)' },
        { name: 'amount', type: 'number', placeholder: 'Importe ($)' },
        { name: 'time', type: 'time', placeholder: 'Hora (opcional)', value: currentTime }
      );
    }

    const alert = await this.alertCtrl.create({
      header: isEncomienda ? 'Nueva Encomienda' : (section === 'ida' ? 'Carga Manual (IDA)' : 'Carga Manual (VUELTA)'),
      inputs: inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: async (data) => {
            // Validación específica
            if (!data.description || !data.amount) {
              return false; // Mantiene abierto si faltan datos básicos
            }

            if (isEncomienda && !data.time) {
              // Feedback visual podría requerirse, por ahora impedimos guardar
              const toast = await this.toastCtrl.create({
                message: '⚠️ La hora es obligatoria para encomiendas',
                duration: 2000,
                color: 'danger',
                position: 'top'
              });
              await toast.present();
              return false;
            }

            try {
              const cleanAmount = this.voice.parseAmount(data.amount);
              // Sanitización
              const passenger = (data.passenger || '').trim();
              const destination = (data.destination || '').trim();
              const packageType = (data.packageType || '').trim();

              await this.db.addTrip({
                date: this.currentDate(),
                section: section,
                passenger: passenger ? passenger : undefined,
                destination: destination ? destination : undefined,
                description: data.description,
                amount: cleanAmount,
                time: data.time || undefined,
                packageType: packageType ? packageType : undefined
              });

              if (data.time) {
                await this.notifications.scheduleOneHourBefore({
                  date: this.currentDate(),
                  time: data.time,
                  description: data.description,
                  section: section,
                });
              }
              this.haptics.success();
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
            return true;
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
          text: 'Resumen Texto',
          handler: async () => {
            await this.share.shareDailySummary(this.currentDate(), this.trips(), this.totalRevenue());
          }
        },
        {
          text: 'PDF (Hoja de Ruta)',
          handler: async () => {
            try {
              await this.share.shareDailyPdf(this.currentDate(), this.trips(), this.totalRevenue());
            } catch (e) {
              console.error('Error sharing PDF', e);
              const toast = await this.toastCtrl.create({
                message: 'Error al generar PDF: ' + JSON.stringify(e),
                duration: 4000,
                color: 'danger'
              });
              await toast.present();
            }
          }
        },
        { text: 'Cancelar', role: 'cancel' }
      ]
    });
    await alert.present();
  }
}
