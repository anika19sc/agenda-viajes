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

    parseSentence(sentence: string): { description: string, amount: number, time: string | null } {
        console.log('Original sentence to parse:', sentence);

        // 1. Extraer tiempo PRIMERO
        const time = this.parseTime(sentence);

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

        // 3. Extraer descripción (limpiando el bloque del monto, tiempo y palabras clave)
        let description = sentence;

        // Remover patrones de tiempo COMPLETOS (antes de remover el monto)
        description = description
            .replace(/\d{1,2}:\d{2}/g, '') // HH:MM
            .replace(/\d{1,2}\s+(?:horas?|hs)\b/gi, '') // X horas (con espacio y word boundary)
            .replace(/\d{1,2}\s+(?:de\s+la\s+)?(?:mañana|tarde|noche)\b/gi, '') // X de la tarde
            .replace(/\d{1,2}\s+y\s+media\b/gi, ''); // X y media

        // Remover el monto y sus variantes
        if (amountStr) {
            // Remover el monto exacto
            description = description.replace(new RegExp(amountStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
        }

        // Remover cualquier número suelto que quede (probablemente sea parte del monto)
        description = description.replace(/\d+(?:[.,]\d+)*/g, '');

        // Limpieza profunda de "basura" linguística repetida
        description = description
            .replace(/pesos|peso|p\b|\$|importe|monto|total|\+| de | para | x | por /gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!description || description === '') {
            description = 'Sin descripción';
        }

        description = description.charAt(0).toUpperCase() + description.slice(1);
        console.log('Parsed result:', { description, amount, time });

        return { description, amount, time };
    }
}
