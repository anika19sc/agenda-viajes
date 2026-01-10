import { Injectable } from '@angular/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Trip } from '../models/trip.model';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

    async shareDailyTable(date: string, trips: Trip[], total: number) {
        const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });

        const currencyFormatter = new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });

        const row = (t: Trip) => {
            const who = (t.passenger || '').trim() || t.description;
            const where = (t.destination || '').trim();
            const time = (t.time || '').trim();
            const amount = currencyFormatter.format(t.amount);
            const left = [time ? time : '--:--', who, where ? `a ${where}` : ''].filter(Boolean).join(' ');
            return `- ${left}  |  ${amount}`;
        };

        let text = `📅 *${formattedDate}*\n`;
        text += `💰 *TOTAL: ${currencyFormatter.format(total)}*\n\n`;

        const sections: Array<{ key: Trip['section']; label: string }> = [
            { key: 'ida', label: 'VIAJES DE IDA' },
            { key: 'encomienda', label: 'VIAJES DE ENCOMIENDA' },
            { key: 'vuelta', label: 'VIAJES DE VUELTA' }
        ];

        sections.forEach(sec => {
            const sectionTrips = trips.filter(t => t.section === sec.key);
            text += `*${sec.label}* (${sectionTrips.length})\n`;
            if (sectionTrips.length === 0) {
                text += `- Sin registros\n\n`;
                return;
            }
            sectionTrips.forEach(t => {
                text += `${row(t)}\n`;
            });
            text += `\n`;
        });

        text += `_Generado por: VozRuta_`;

        await Share.share({
            title: 'Planilla diaria VozRuta',
            text,
            dialogTitle: 'Compartir planilla por...'
        });
    }

    async shareDailyCsv(date: string, trips: Trip[]) {
        const header = ['fecha', 'seccion', 'hora', 'pasajero', 'destino', 'descripcion', 'importe'].join(',');
        const escape = (v: string) => {
            const s = (v || '').replace(/\r?\n/g, ' ').trim();
            if (s.includes('"') || s.includes(',') || s.includes(';')) {
                return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
        };

        const lines = trips.map(t => {
            return [
                date,
                t.section,
                t.time || '',
                t.passenger || '',
                t.destination || '',
                t.description || '',
                String(t.amount)
            ].map(x => escape(String(x))).join(',');
        });

        const csv = [header, ...lines].join('\n');

        await Share.share({
            title: `CSV ${date}`,
            text: csv,
            dialogTitle: 'Compartir CSV por...'
        });
    }

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    private async assetToDataUrl(path: string): Promise<string | null> {
        try {
            const res = await fetch(path);
            const blob = await res.blob();
            return await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
        } catch {
            return null;
        }
    }

    async shareDailyPdf(date: string, trips: Trip[], total: number) {
        const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        const currencyFormatter = new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });

        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const margin = 40;
        const pageWidth = doc.internal.pageSize.getWidth();
        const blueColor: [number, number, number] = [41, 128, 185];

        doc.setDrawColor(blueColor[0], blueColor[1], blueColor[2]);
        doc.setLineWidth(0.5);
        doc.roundedRect(margin, 20, pageWidth - (margin * 2), 80, 15, 15, 'S');

        const logoDataUrl = await this.assetToDataUrl('assets/icon/favicon.png');
        if (logoDataUrl) {
            doc.addImage(logoDataUrl, 'PNG', (pageWidth / 2) - 20, 26, 40, 40);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(blueColor[0], blueColor[1], blueColor[2]);
        doc.text('Voz Ruta', pageWidth / 2, 75, { align: 'center' });

        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text('Servicios de Paquetería - Servicios Puerta a Puerta', pageWidth / 2, 92, { align: 'center' });

        let y = 115;

        const amountStr = (v: number) => currencyFormatter.format(v);
        const toIdaRow = (t: Trip) => {
            const who = (t.passenger || '').trim() || (t.description || '').trim();
            const where = (t.destination || '').trim();
            return [who, where, amountStr(t.amount)];
        };
        const toEncRow = (t: Trip) => {
            const what = (t.description || '').trim();
            const where = (t.destination || '').trim();
            return [what, where, amountStr(t.amount)];
        };

        const fillRows = (rows: any[][], target: number) => {
            while (rows.length < target) rows.push(['', '', '']);
            return rows;
        };

        const columnStyles = {
            0: { cellWidth: 280 },
            1: { cellWidth: 120 },
            2: { cellWidth: 80, halign: 'right' as const }
        };

        const tableBase = {
            theme: 'grid' as const,
            styles: { lineColor: blueColor as any, lineWidth: 0.5, cellPadding: 4, textColor: [0, 0, 0] as any, font: 'helvetica', fontSize: 9 },
            headStyles: { fillColor: [255, 255, 255] as any, textColor: [0, 0, 0] as any, fontStyle: 'bold' as const, halign: 'center' as const },
            margin: { left: margin, right: margin }
        };

        autoTable(doc, {
            ...tableBase,
            startY: y,
            head: [['FECHA', formattedDate]],
            body: [],
            columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 280 + 120 + 80 - 60 } },
            styles: { ...tableBase.styles, fontStyle: 'bold' as const },
            headStyles: { ...tableBase.headStyles, halign: 'left' as const }
        });
        y = ((doc as any).lastAutoTable?.finalY ?? y);

        const idaRows = fillRows(trips.filter(t => t.section === 'ida').map(toIdaRow), 4);
        autoTable(doc, {
            ...tableBase,
            startY: y,
            head: [['PASAJEROS PARA IR', 'DESTINO', 'IMPORTE']],
            body: idaRows,
            columnStyles
        });
        y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;

        const encRows = fillRows(trips.filter(t => t.section === 'encomienda').map(toEncRow), 30);
        autoTable(doc, {
            ...tableBase,
            startY: y,
            head: [['ENCOMIENDAS', 'DESTINO', 'IMPORTE']],
            body: encRows,
            columnStyles
        });
        y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;

        const vueltaRows = fillRows(trips.filter(t => t.section === 'vuelta').map(toIdaRow), 4);
        autoTable(doc, {
            ...tableBase,
            startY: y,
            head: [['PASAJEROS PARA VOLVER', 'DESDE', 'IMPORTE']],
            body: vueltaRows,
            columnStyles
        });

        const arrayBuffer = doc.output('arraybuffer');
        const base64 = this.arrayBufferToBase64(arrayBuffer);
        const filename = `VozRuta-${date}.pdf`;

        await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory: Directory.Cache
        });

        const uriResult = await Filesystem.getUri({
            path: filename,
            directory: Directory.Cache
        });

        await Share.share({
            title: `PDF ${date}`,
            url: uriResult.uri,
            dialogTitle: 'Compartir PDF por...'
        });
    }
}
