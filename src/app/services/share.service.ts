import { Injectable } from '@angular/core';
import { Share } from '@capacitor/share';
import { Trip } from '../models/trip.model';

@Injectable({
    providedIn: 'root'
})
export class ShareService {

    constructor() { }

    async shareDailySummary(date: string, trips: Trip[], total: number) {
        const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });

        const currencyFormatter = new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS',
            minimumFractionDigits: 2
        });

        let text = `🚖 *Resumen de Viajes - ${formattedDate}*\n`;
        text += `💰 *Total Recaudado: ${currencyFormatter.format(total)}*\n\n`;

        const sections = [
            { key: 'ida', label: 'VIAJES DE IDA' },
            { key: 'vuelta', label: 'VIAJES DE VUELTA' },
            { key: 'encomienda', label: 'ENCOMIENDAS' }
        ];

        sections.forEach(sec => {
            const sectionTrips = trips.filter(t => t.section === sec.key);
            if (sectionTrips.length > 0) {
                text += `*${sec.label}*\n`;
                sectionTrips.forEach(t => {
                    text += `- ${t.description}: ${currencyFormatter.format(t.amount)}\n`;
                });
                text += `\n`;
            }
        });

        text += `_Generado por: VozRuta_`;

        await Share.share({
            title: 'Resumen Diario VozRuta',
            text: text,
            dialogTitle: 'Compartir resumen por...',
        });
    }
}
