import { Injectable, signal } from '@angular/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { Capacitor } from '@capacitor/core';

@Injectable({
    providedIn: 'root'
})
export class VoiceService {
    public isAvailable = signal(false);
    public readonly recording = signal(false);
    private audioStream: MediaStream | null = null;
    public readonly audioStream$ = signal<MediaStream | null>(null);


    constructor() {
        this.checkAvailability();
    }

    async checkAvailability() {
        if (Capacitor.isNativePlatform()) {
            const { available } = await SpeechRecognition.available();
            this.isAvailable.set(available);
        }
    }

    private resolvePromise: ((value: string) => void) | null = null;
    private lastTranscription = '';

    private async startStream() {
        try {
            // Check if we already have a stream
            if (this.audioStream) return;

            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioStream$.set(this.audioStream);
            console.log('Audio stream started', this.audioStream);
        } catch (err) {
            console.error('Error accessing microphone for visualization', err);
        }
    }

    private stopStream() {
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
            this.audioStream$.set(null);
            console.log('Audio stream stopped');
        }
    }

    async startListening(): Promise<string> {
        if (this.recording()) {
            await this.stopListening();
            return '';
        }

        this.lastTranscription = '';

        if (!Capacitor.isNativePlatform()) {
            await this.startStream();
            this.recording.set(true);
            return new Promise((resolve) => {
                this.resolvePromise = resolve;
                setTimeout(() => {
                    const mockPrompt = prompt('Simular entrada de voz (ej: "Maria viaje a Saenz 30000"):');
                    this.stopListening(mockPrompt || '');
                }, 3000);
            });
        }

        const { available } = await SpeechRecognition.available();
        if (!available) {
            console.warn('Speech recognition not available on this device');
            return '';
        }

        const permission = await SpeechRecognition.requestPermissions();
        if (permission.speechRecognition !== 'granted') {
            console.warn('Permission not granted for speech recognition');
            return '';
        }

        // 1. CLEANUP SIN BLOQUEO
        try {
            console.log('Cleaning listeners...');
            await SpeechRecognition.removeAllListeners().catch(() => { });
            await new Promise(r => setTimeout(r, 400));
        } catch (e) {
            console.log('Cleanup ignored');
        }

        return new Promise(async (resolve) => {
            this.resolvePromise = resolve;

            const setupListeners = async () => {
                try {
                    await SpeechRecognition.addListener('partialResults', (data: any) => {
                        if (data && data.matches && data.matches.length > 0) {
                            this.lastTranscription = data.matches[0];
                            console.log('Partial result:', this.lastTranscription);
                        }
                    });

                    await SpeechRecognition.addListener('listeningState', (data: any) => {
                        console.log('Native Listening state:', data.status);
                    });
                } catch (e) {
                    console.error('Error setting up listeners', e);
                }
            };

            // 2. SETUP LISTENERS
            await setupListeners();

            // 3. START RECOGNITION
            console.log('Launching Speech engine (Popup Mode)...');
            this.recording.set(true);

            try {
                const result = await SpeechRecognition.start({
                    language: 'es-AR',
                    partialResults: true,
                    popup: true, // VOLVEMOS A TRUE
                });

                console.log('Raw result from Native:', JSON.stringify(result));

                const finalResult = (result && result.matches && result.matches.length > 0)
                    ? result.matches[0]
                    : this.lastTranscription;

                console.log('Texto final capturado:', finalResult);

                // CRÍTICO: Esperar a que stopListening resuelva la promesa
                await this.stopListening(finalResult);
            } catch (err) {
                console.error('Error con popup:', err);
                await this.stopListening(this.lastTranscription);
            }
        });
    }

    async stopListening(value?: string) {
        // If no value is provided (manual stop), use the last thing we heard
        const finalValue = value !== undefined ? value : this.lastTranscription;

        this.recording.set(false);
        this.stopStream();

        // CRÍTICO: Resolver la promesa PRIMERO, antes de cualquier limpieza
        if (this.resolvePromise) {
            this.resolvePromise(finalValue);
            this.resolvePromise = null;
        }

        // Limpieza en segundo plano (sin await para no bloquear)
        if (Capacitor.isNativePlatform()) {
            SpeechRecognition.stop().catch(() => { });
            SpeechRecognition.removeAllListeners().catch(() => { });
        }
    }

    /**
     * Sanitización estricta: Elimina cualquier cosa que no sea número o punto decimal.
     * Ahora también maneja la palabra "mil" de forma inteligente.
     * Ejemplo: "$35.000" -> 35000, "30 mil" -> 30000
     */
    public parseAmount(text: string): number {
        if (!text) return 0;

        // 1. Detectar "mil" (frecuente en habla AR)
        let multiplier = 1;
        if (text.toLowerCase().includes(' mil')) {
            multiplier = 1000;
        }

        // 2. Eliminar todo excepto dígitos, puntos y comas
        let clean = text.replace(/[^\d.,]/g, '');

        // 3. Lógica para AR: si hay puntos/comas y terminan en 3 dígitos, son miles.
        if (clean.includes('.') && clean.includes(',')) {
            // Caso 1.250,50
            clean = clean.replace(/\./g, '').replace(',', '.');
        } else if (clean.includes('.')) {
            // Ejemplo 35.000 -> 35000
            const parts = clean.split('.');
            if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
                clean = clean.replace(/\./g, '');
            }
        } else if (clean.includes(',')) {
            // Ejemplo 35,000 -> 35000
            const parts = clean.split(',');
            if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
                clean = clean.replace(/,/g, '');
            } else {
                clean = clean.replace(',', '.');
            }
        }

        let val = parseFloat(clean);
        if (isNaN(val)) val = 0;

        return Math.abs(val * multiplier);
    }

    /**
     * Parser de hora: detecta patrones de tiempo en el texto
     * Ejemplos: "20 horas" -> "20:00", "15:30" -> "15:30", "3 de la tarde" -> "15:00"
     */
    public parseTime(text: string): string | null {
        if (!text) return null;

        const lowerText = text.toLowerCase();

        // Patrón 1: "HH:MM" (formato directo)
        const directTime = text.match(/(\d{1,2}):(\d{2})/);
        if (directTime) {
            const hours = parseInt(directTime[1]);
            const minutes = parseInt(directTime[2]);
            if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }
        }

        // Patrón 2: "X horas" o "X hs"
        const horasMatch = lowerText.match(/(\d{1,2})\s*(?:horas?|hs)/);
        if (horasMatch) {
            const hours = parseInt(horasMatch[1]);
            if (hours >= 0 && hours < 24) {
                return `${hours.toString().padStart(2, '0')}:00`;
            }
        }

        // Patrón 3: "X de la mañana/tarde/noche"
        const periodMatch = lowerText.match(/(\d{1,2})\s*(?:de\s+la\s+)?(mañana|tarde|noche)/);
        if (periodMatch) {
            let hours = parseInt(periodMatch[1]);
            const period = periodMatch[2];

            if (period === 'tarde' && hours < 12) {
                hours += 12;
            } else if (period === 'noche' && hours < 12) {
                hours += 12;
            }

            if (hours >= 0 && hours < 24) {
                return `${hours.toString().padStart(2, '0')}:00`;
            }
        }

        // Patrón 4: "X y media"
        const mediaMatch = lowerText.match(/(\d{1,2})\s*y\s*media/);
        if (mediaMatch) {
            const hours = parseInt(mediaMatch[1]);
            if (hours >= 0 && hours < 24) {
                return `${hours.toString().padStart(2, '0')}:30`;
            }
        }

        return null;
    }

    private toIsoDate(date: Date): string {
        return date.toISOString().split('T')[0];
    }

    /**
     * Parser de fecha (simple): soporta expresiones comunes.
     * - "hoy", "mañana", "pasado mañana"
     * - "dentro de 3 días" / "en 3 días"
     */
    public parseDate(text: string, baseDateIso?: string): string | null {
        if (!text) return null;

        const lower = text.toLowerCase();
        const base = baseDateIso ? new Date(baseDateIso + 'T12:00:00') : new Date();

        if (lower.includes('hoy')) {
            return this.toIsoDate(base);
        }

        if (lower.includes('pasado mañana') || lower.includes('pasadomañana')) {
            const d = new Date(base);
            d.setDate(d.getDate() + 2);
            return this.toIsoDate(d);
        }

        if (lower.includes('mañana')) {
            const d = new Date(base);
            d.setDate(d.getDate() + 1);
            return this.toIsoDate(d);
        }

        const relMatch = lower.match(/(?:dentro\s+de|en)\s+(\d{1,3})\s*(?:d[ií]as|dia)/i);
        if (relMatch) {
            const n = parseInt(relMatch[1], 10);
            if (!isNaN(n)) {
                const d = new Date(base);
                d.setDate(d.getDate() + n);
                return this.toIsoDate(d);
            }
        }

        return null;
    }

    private cleanForPassengerDestination(text: string, amountStr: string, time: string | null): string {
        let cleaned = text;

        // Remover frases de tiempo tipo "a las 21:00" / "a la 1" (evita que quede "a las" en descripción)
        cleaned = cleaned.replace(/\ba\s+las?\s+\d{1,2}(?::\d{2})?\b/gi, ' ');

        // Remover patrones de tiempo COMPLETOS
        cleaned = cleaned
            .replace(/\d{1,2}:\d{2}/g, '')
            .replace(/\d{1,2}\s+(?:horas?|hs)\b/gi, '')
            .replace(/\d{1,2}\s+(?:de\s+la\s+)?(?:mañana|tarde|noche)\b/gi, '')
            .replace(/\d{1,2}\s+y\s+media\b/gi, '');

        // Remover fecha relativa
        cleaned = cleaned
            .replace(/\b(hoy|mañana|pasado\s+mañana|pasadomañana)\b/gi, ' ')
            .replace(/(?:dentro\s+de|en)\s+\d{1,3}\s*(?:d[ií]as|dia)\b/gi, ' ');

        // Remover el monto detectado
        if (amountStr) {
            cleaned = cleaned.replace(new RegExp(amountStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
        }

        // Remover palabras de dinero que suelen quedar
        cleaned = cleaned.replace(/\b(pesos?|importe|monto|total|ars)\b/gi, ' ');

        // Remover símbolos de moneda sueltos (ej: "$" cuando el número ya fue removido)
        cleaned = cleaned.replace(/\$/g, ' ');

        // Compactar espacios
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        return cleaned;
    }

    private sanitizeNamePart(part: string): string {
        return (part || '')
            .replace(/\$/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/[\s.,;:¡!¿?\-]+$/g, '')
            .trim();
    }

    private toTitleCase(text: string): string {
        const s = (text || '').replace(/\s+/g, ' ').trim();
        if (!s) return s;
        return s
            .toLowerCase()
            .split(' ')
            .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
            .join(' ');
    }

    private parsePassengerDestination(text: string): { passenger: string | null; destination: string | null } {
        if (!text) return { passenger: null, destination: null };

        const lower = text.toLowerCase();

        // Preferir "viaje a" (más específico) y caer a " a "
        const idxViajeA = lower.lastIndexOf('viaje a ');
        if (idxViajeA >= 0) {
            const passenger = this.sanitizeNamePart(text.substring(0, idxViajeA));
            const destination = this.sanitizeNamePart(text.substring(idxViajeA + 'viaje a '.length));
            return {
                passenger: passenger ? passenger : null,
                destination: destination ? destination : null
            };
        }

        const idxA = lower.lastIndexOf(' a ');
        if (idxA >= 0) {
            const passenger = this.sanitizeNamePart(text.substring(0, idxA));
            const destination = this.sanitizeNamePart(text.substring(idxA + 3));
            return {
                passenger: passenger ? passenger : null,
                destination: destination ? destination : null
            };
        }

        const passenger = this.sanitizeNamePart(text);
        return { passenger: passenger || null, destination: null };
    }

    private detectPackageType(text: string): { type: string | null, cleanText: string } {
        const lower = text.toLowerCase();
        const types = [
            { key: 'sobre', normalized: 'Sobre' },
            { key: 'caja', normalized: 'Caja' },
            { key: 'bicicleta', normalized: 'Bicicleta' },
            { key: 'bici', normalized: 'Bicicleta' },
            { key: 'bolso', normalized: 'Bolso' },
            { key: 'paquete', normalized: 'Paquete' },
            { key: 'encomienda', normalized: 'Encomienda' }
        ];

        for (const t of types) {
            // Match isolated word or at start/end
            const regex = new RegExp(`\\b${t.key}\\b`, 'i');
            if (regex.test(lower)) {
                // Remove the word from the text to clean it up
                const clean = text.replace(new RegExp(`\\b${t.key}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
                return { type: t.normalized, cleanText: clean };
            }
        }
        return { type: null, cleanText: text };
    }

    parseSentence(sentence: string, baseDateIso?: string): { passenger: string | null, destination: string | null, description: string, amount: number, time: string | null, date: string | null, packageType: string | null } {
        console.log('Original sentence to parse:', sentence);

        // 1. Extraer tiempo PRIMERO
        const time = this.parseTime(sentence);

        // 1.1 Extraer fecha (si viene en la frase)
        const date = this.parseDate(sentence, baseDateIso);

        // 2. Buscar el monto con PRIORIDAD en símbolos de moneda y EXCLUYENDO patrones de tiempo
        let amountMatch = null;
        let amountStr = '';
        let amount = 0;

        // PRIORIDAD 1: Números con símbolo $ explícito
        amountMatch = sentence.match(/\$\s*(\d+(?:[.,]\d+)*\s?(?:mil)?)/i);

        // PRIORIDAD 2: Números seguidos de "pesos/peso"
        if (!amountMatch) {
            amountMatch = sentence.match(/(\d+(?:[.,]\d+)*\s?(?:mil)?)\s*(?:pesos?)/i);
        }

        // PRIORIDAD 3: Números precedidos por palabras clave de dinero
        if (!amountMatch) {
            amountMatch = sentence.match(/(?:importe|monto|total)\s+(\d+(?:[.,]\d+)*\s?(?:mil)?)/i);
        }

        // PRIORIDAD 4: Cualquier número PERO excluyendo los que están seguidos de palabras de tiempo
        if (!amountMatch) {
            // Buscar todos los números y filtrar los que NO son de tiempo
            const allNumbers = sentence.match(/\d+(?:[.,]\d+)*\s?(?:mil)?/gi);
            if (allNumbers) {
                for (const num of allNumbers) {
                    // Obtener el contexto después del número
                    const numIndex = sentence.indexOf(num);
                    const afterNum = sentence.substring(numIndex + num.length, numIndex + num.length + 10).toLowerCase();

                    // Si NO está seguido de palabras de tiempo, es probablemente el monto
                    if (!afterNum.match(/^\s*(?:horas?|hs|y\s+media|de\s+la|mañana|tarde|noche)/)) {
                        amountStr = num;
                        amount = this.parseAmount(num);
                        break;
                    }
                }
            }
        }

        if (amountMatch && !amountStr) {
            amountStr = amountMatch[1] || amountMatch[0];
            amount = this.parseAmount(amountStr);
        }

        // 3. Detectar Tipo de Encomienda
        let textForDescription = sentence;
        // Solo intentamos detectar tipo si NO es un viaje de pasajero obvio, a menos que queramos soportar todo.
        // Asumiremos que si detecta la palabra clave, es el tipo.
        const pkg = this.detectPackageType(sentence);
        const packageType = pkg.type;
        // Opcional: ¿removemos la palabra del texto original?
        // textForDescription = pkg.cleanText; 

        // 4. Extraer pasajero/destino y descripción final
        const cleaned = this.cleanForPassengerDestination(textForDescription, amountStr, time);
        let { passenger, destination } = this.parsePassengerDestination(cleaned);
        if (passenger) passenger = this.toTitleCase(passenger);
        if (destination) destination = this.toTitleCase(destination);

        let description = cleaned;
        if (passenger && destination) {
            description = `${passenger} a ${destination}`;
        } else if (passenger && !destination) {
            description = passenger;
        }

        description = description
            .replace(/\s+/g, ' ')
            .trim();

        if (!description) {
            description = 'Sin descripción';
        }

        description = this.toTitleCase(description);
        console.log('Parsed result:', { passenger, destination, description, amount, time, date, packageType });

        return { passenger, destination, description, amount, time, date, packageType };
    }
}
