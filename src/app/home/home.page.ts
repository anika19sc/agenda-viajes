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

  async recordVoice(section?: 'ida' | 'vuelta' | 'encomienda') {
    this.haptics.impactLight();

    // If already recording
    if (this.isRecording()) {
      await this.voice.stopListening();
      this.recordingSection.set(null);
      return;
    }

    // Start Recording state (UI visual)
    this.recordingSection.set(section || 'ida'); // Visual feedback default

    try {
      const toastStart = await this.toastCtrl.create({
        message: `🎤 Escuchando...`,
        duration: 2000,
        position: 'top',
        color: 'warning'
      });
      await toastStart.present();

      const sentence = await this.voice.startListening();

      if (sentence) {
        console.log("Procesando entrada de voz:", sentence);

        const parsed = this.voice.parseSentence(sentence, this.currentDate());

        // 1. DATE HANDLING & NAVIGATION
        const targetDate = parsed.date || this.currentDate();
        if (targetDate !== this.currentDate()) {
          console.log(`Fecha detectada diferente (${targetDate}). Navegando...`);
          await this.db.updateDate(targetDate);
          const navToast = await this.toastCtrl.create({
            message: `📅 Navegando al ${targetDate}`,
            duration: 2000,
            position: 'bottom',
            color: 'secondary'
          });
          await navToast.present();
        }

        // 2. SECTION HANDLING
        let targetSection = parsed.section;

        // 3. PRICING AUTOMATION
        let amount = parsed.amount;

        // Prioridad: Si NO se dictó monto (amount == 0), buscamos en tabla rates
        if (amount === 0) {
          const loc = parsed.detectedLocation;
          const isEncomienda = targetSection === 'encomienda';

          if (loc) {
            const rate = await this.db.getRate(loc, targetSection);
            if (rate > 0) {
              amount = rate;
              const toast = await this.toastCtrl.create({
                message: `💰 Tarifa Auto: $${amount} (${loc})`,
                duration: 2000,
                position: 'middle',
                color: 'success'
              });
              toast.present();
            }
          } else if (isEncomienda) {
            // Fallback for Encomienda without clear location -> usage of "Resistencia" rate (25000)
            let rate = await this.db.getRate('Resistencia', 'encomienda');

            // HARD FALLBACK if DB fails
            if (rate === 0) {
              console.warn('DB Rate for Encomienda (Resistencia) was 0. Using hardcoded 25000.');
              rate = 25000;
            }

            if (rate > 0) {
              amount = rate;
              const toast = await this.toastCtrl.create({
                message: `📦 Envío Estándar: $${amount}`,
                duration: 2000,
                position: 'middle',
                color: 'warning'
              });
              toast.present();
            }
          }
        }

        console.log("Iniciando INSERT en DB...");
        await this.db.addTrip({
          date: targetDate,
          section: targetSection,
          passenger: parsed.passenger || undefined,
          destination: parsed.destination || undefined,
          description: parsed.description,
          amount: amount,
          time: parsed.time || undefined,
          packageType: parsed.packageType || undefined,
          quantity: parsed.quantity || 1
        });

        // Notifications logic
        if (parsed.time && targetDate) {
          await this.notifications.scheduleOneHourBefore({
            date: targetDate,
            time: parsed.time,
            description: parsed.description,
            section: targetSection,
          });
        }

        console.log("✅ Registro INSERT exitoso. Refreshing...");
        if (targetDate === this.currentDate()) {
          await this.db.loadTrips(targetDate);
        }

        this.haptics.success();
        this.cdr.detectChanges();
        this.recordingSection.set(null);

        const toastSuccess = await this.toastCtrl.create({
          message: `✅ Guardado en ${targetSection.toUpperCase()} (${parsed.quantity} lug)`,
          duration: 3000,
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
          text: 'Viaje de VUELTA',
          icon: 'arrow-back',
          handler: () => { this.showManualForm('vuelta'); }
        },
        {
          text: 'Envíar ENCOMIENDA',
          icon: 'cube',
          handler: () => { this.showManualForm('encomienda'); }
        },
        {
          text: 'Nota / Observación',
          icon: 'document-text',
          handler: () => { this.showManualForm('observaciones'); }
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

  async editTrip(trip: Trip) {
    // Determinar la sección del trip para abrir el form correcto
    const section = trip.section as 'ida' | 'vuelta' | 'encomienda' | 'observaciones';
    await this.showManualForm(section, trip);
  }

  async showManualForm(section: 'ida' | 'vuelta' | 'encomienda' | 'observaciones', tripToEdit?: Trip) {
    const isEncomienda = section === 'encomienda';
    const isObservacion = section === 'observaciones';
    const isEdit = !!tripToEdit;

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    let defaultTime = `${hours}:${minutes}`;

    // Valores iniciales (vacíos o del trip)
    const initVal = {
      passenger: tripToEdit?.passenger || '',
      destination: tripToEdit?.destination || '',
      description: tripToEdit?.description || '',
      amount: tripToEdit?.amount || '',
      time: tripToEdit?.time || defaultTime,
      packageType: tripToEdit?.packageType || '',
      quantity: tripToEdit?.quantity || '1'
    };

    const inputs: any[] = [];

    if (isObservacion) {
      inputs.push(
        { name: 'description', type: 'textarea', placeholder: 'Escribe tu nota aquí...', value: initVal.description },
        { name: 'time', type: 'time', placeholder: 'Hora (opcional)', value: initVal.time }
      );
    } else if (isEncomienda) {
      inputs.push(
        { name: 'packageType', type: 'text', placeholder: 'Tipo (Sobre, Caja, Bici...)', value: initVal.packageType },
        { name: 'destination', type: 'text', placeholder: 'Destino (Pueblo/Ciudad)', value: initVal.destination },
        { name: 'description', type: 'text', placeholder: 'Dirección (Calle y Número)', value: initVal.description },
        { name: 'amount', type: 'number', placeholder: 'Importe ($)', value: initVal.amount },
        { name: 'time', type: 'time', placeholder: 'Hora (Requerido)', value: initVal.time }
      );
    } else {
      inputs.push(
        { name: 'passenger', type: 'text', placeholder: 'Pasajero (opcional)', value: initVal.passenger },
        { name: 'quantity', type: 'number', placeholder: 'Lugares (1)', value: initVal.quantity },
        { name: 'destination', type: 'text', placeholder: 'Destino (opcional)', value: initVal.destination },
        { name: 'description', type: 'text', placeholder: 'Descripción (Nombre/Lugar)', value: initVal.description },
        { name: 'amount', type: 'number', placeholder: 'Importe ($)', value: initVal.amount },
        { name: 'time', type: 'time', placeholder: 'Hora (opcional)', value: initVal.time }
      );
    }

    const alert = await this.alertCtrl.create({
      header: isEdit ? 'Editar Registro' : (isObservacion ? 'Nueva Nota' : (isEncomienda ? 'Nueva Encomienda' : (section === 'ida' ? 'Carga Manual (IDA)' : 'Carga Manual (VUELTA)'))),
      inputs: inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: async (data) => {
            // Validación específica
            if (isObservacion && !data.description) {
              return false;
            }

            if (isEncomienda && !data.time) {
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
              const cleanAmount = data.amount ? this.voice.parseAmount(data.amount.toString()) : 0;
              // Sanitización
              const passenger = (data.passenger || '').trim();
              const destination = (data.destination || '').trim();
              const packageType = (data.packageType || '').trim();
              const quantity = data.quantity ? parseInt(data.quantity) : 1;

              const tripData = {
                date: this.currentDate(), // Si es edit, mantenemos la fecha? Asumamos que edita el día actual, o podriamos usar tripToEdit.date
                section: section,
                passenger: passenger ? passenger : undefined,
                destination: destination ? destination : undefined,
                description: data.description || 'Nota sin texto',
                amount: cleanAmount,
                time: data.time || undefined,
                packageType: packageType ? packageType : undefined,
                quantity: quantity
              };

              if (isEdit && tripToEdit && tripToEdit.id) {
                // UPDATE
                await this.db.updateTrip({
                  ...tripToEdit,
                  ...tripData,
                  date: tripToEdit.date // Preserve original date
                });
              } else {
                // CREATE
                await this.db.addTrip(tripData);
              }

              if (data.time) {
                // TODO: Update notification if edited? For now simple add.
                await this.notifications.scheduleOneHourBefore({
                  date: isEdit && tripToEdit ? tripToEdit.date : this.currentDate(),
                  time: data.time,
                  description: data.description,
                  section: section,
                });
              }
              this.haptics.success();
              // Refresh
              if (this.currentDate()) await this.db.loadTrips(this.currentDate());
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
    // Confirm delete?
    const alert = await this.alertCtrl.create({
      header: 'Confirmar',
      message: '¿Borrar este elemento?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Borrar',
          role: 'destructive',
          handler: async () => {
            if (trip.id) {
              await this.db.deleteTrip(trip.id, this.currentDate());
              this.haptics.impactLight();
              this.cdr.detectChanges();
            }
          }
        }
      ]
    });
    await alert.present();
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
