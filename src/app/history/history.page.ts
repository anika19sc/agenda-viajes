import { Component, inject, signal } from '@angular/core';
import { DatabaseService } from '../services/database.service';
import { Trip } from '../models/trip.model';

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
})
export class HistoryPage {
  private db = inject(DatabaseService);

  public currentMonth = signal<string>(this.toLocalMonthIso(new Date()));
  public selectedDate = signal<string>(this.toLocalIsoDate(new Date()));

  public dayCounts = signal<Record<string, number>>({});
  public daysGrid = signal<Array<{ date: string; day: number; isCurrentMonth: boolean; count: number }>>([]);

  public selectedTrips = signal<Trip[]>([]);

  public idaTrips = signal<Trip[]>([]);
  public encomiendaTrips = signal<Trip[]>([]);
  public vueltaTrips = signal<Trip[]>([]);

  constructor() {
  }

  async ionViewWillEnter() {
    await this.refreshMonth();
    await this.selectDay(this.selectedDate());
  }

  private toLocalIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private toLocalMonthIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private monthLabel(monthIso: string): string {
    const [year, month] = monthIso.split('-').map(Number);
    const d = new Date(year, month - 1, 1, 12, 0, 0);
    return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }

  public currentMonthLabel(): string {
    return this.monthLabel(this.currentMonth());
  }

  async prevMonth() {
    const [year, month] = this.currentMonth().split('-').map(Number);
    const d = new Date(year, month - 1, 1, 12, 0, 0);
    d.setMonth(d.getMonth() - 1);
    this.currentMonth.set(this.toLocalMonthIso(d));
    await this.refreshMonth();
  }

  async nextMonth() {
    const [year, month] = this.currentMonth().split('-').map(Number);
    const d = new Date(year, month - 1, 1, 12, 0, 0);
    d.setMonth(d.getMonth() + 1);
    this.currentMonth.set(this.toLocalMonthIso(d));
    await this.refreshMonth();
  }

  async refreshMonth() {
    const monthIso = this.currentMonth();
    const counts = await this.db.getDayCountsForMonth(monthIso);
    this.dayCounts.set(counts);

    const [year, month] = monthIso.split('-').map(Number);
    const firstOfMonth = new Date(year, month - 1, 1, 12, 0, 0);
    const start = new Date(firstOfMonth);

    const dayOfWeek = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayOfWeek);

    const grid: Array<{ date: string; day: number; isCurrentMonth: boolean; count: number }> = [];
    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(start);
      cellDate.setDate(start.getDate() + i);
      const iso = this.toLocalIsoDate(cellDate);
      grid.push({
        date: iso,
        day: cellDate.getDate(),
        isCurrentMonth: iso.startsWith(monthIso),
        count: counts[iso] || 0,
      });
    }
    this.daysGrid.set(grid);

    const selected = this.selectedDate();
    if (!selected.startsWith(monthIso)) {
      const firstDayIso = this.toLocalIsoDate(firstOfMonth);
      await this.selectDay(firstDayIso);
    }
  }

  async selectDay(dateIso: string) {
    this.selectedDate.set(dateIso);
    const trips = await this.db.getTripsByDate(dateIso);
    this.selectedTrips.set(trips);

    this.idaTrips.set(trips.filter(t => t.section === 'ida'));
    this.encomiendaTrips.set(trips.filter(t => t.section === 'encomienda'));
    this.vueltaTrips.set(trips.filter(t => t.section === 'vuelta'));
  }

  public selectedDayTotal(): number {
    return this.selectedTrips().length;
  }
}
