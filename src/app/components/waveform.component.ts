import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, Input } from '@angular/core';

@Component({
    selector: 'app-waveform',
    template: `<canvas #waveformCanvas class="w-full h-12"></canvas>`,
    standalone: true,
    styles: [`
    canvas {
      display: block;
      width: 100%;
      height: 48px;
    }
  `]
})
export class WaveformComponent implements AfterViewInit, OnDestroy {
    @ViewChild('waveformCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
    @Input() stream: MediaStream | null = null;

    private animationId: number | null = null;
    private audioCtx: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private dataArray: Uint8Array | null = null;

    ngAfterViewInit() {
        if (this.stream) {
            this.initAudio(this.stream);
        }
    }

    ngOnChanges() {
        if (this.stream) {
            this.initAudio(this.stream);
        } else {
            this.stopAudio();
        }
    }

    private initAudio(stream: MediaStream) {
        this.stopAudio();

        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AudioContextClass();

        const source = this.audioCtx!.createMediaStreamSource(stream);
        this.analyser = this.audioCtx!.createAnalyser();
        this.analyser.fftSize = 256;

        source.connect(this.analyser);

        const bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(bufferLength);

        // Resume AudioContext on user gesture (it's inside button click hopefully)
        if (this.audioCtx!.state === 'suspended') {
            this.audioCtx!.resume();
        }

        // Set canvas resolution
        if (this.canvasRef) {
            const canvas = this.canvasRef.nativeElement;
            canvas.width = canvas.offsetWidth || 300;
            canvas.height = canvas.offsetHeight || 48;
        }

        this.draw();
    }

    private stopAudio() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        if (this.audioCtx) {
            this.audioCtx.close();
        }
        this.audioCtx = null;
        this.analyser = null;
    }

    private draw() {
        if (!this.canvasRef || !this.analyser || !this.dataArray) return;

        this.animationId = requestAnimationFrame(() => this.draw());

        const canvas = this.canvasRef.nativeElement;
        const ctx = canvas.getContext('2d')!;
        const width = canvas.width;
        const height = canvas.height;

        this.analyser.getByteFrequencyData(this.dataArray as any);

        ctx.clearRect(0, 0, width, height);

        const barWidth = (width / this.dataArray.length) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < this.dataArray.length; i++) {
            barHeight = (this.dataArray[i] / 255) * height;

            // Naranja Energético
            ctx.fillStyle = `#f7941d`; // orange-500
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    ngOnDestroy() {
        this.stopAudio();
    }
}
