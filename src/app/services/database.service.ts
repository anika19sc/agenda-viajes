import { Injectable, signal, computed } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Trip } from '../models/trip.model';

export interface MonthlySummaryRow {
    month: string;
    label: string;
    total: number;
    ida: number;
    vuelta: number;
    encomienda: number;
}

@Injectable({
    providedIn: 'root'
})
export class DatabaseService {
    private sqlite: SQLiteConnection = new SQLiteConnection(CapacitorSQLite);
    private db!: SQLiteDBConnection;
    private isWeb: boolean = Capacitor.getPlatform() === 'web';

    // Signals for state management
    private _currentDate = signal<string>(this.toLocalIsoDate(new Date()));
    public readonly currentDate = this._currentDate.asReadonly();

    private _trips = signal<Trip[]>([]);
    public readonly trips = this._trips.asReadonly();

    private _monthlySummary = signal<MonthlySummaryRow[]>([]);
    public readonly monthlySummary = this._monthlySummary.asReadonly();

    // Derived signals for totals
    public readonly totalRevenue = computed(() =>
        this._trips().reduce((acc, trip) => acc + trip.amount, 0)
    );

    public readonly sectionTotals = computed(() => {
        const totals = { ida: 0, vuelta: 0, encomienda: 0 };
        this._trips().forEach(trip => {
            totals[trip.section] += trip.amount;
        });
        return totals;
    });

    public readonly sectionCounts = computed(() => {
        const counts = { ida: 0, vuelta: 0, encomienda: 0 };
        this._trips().forEach(trip => {
            counts[trip.section]++;
        });
        return counts;
    });

    constructor() { }

    private toLocalIsoDate(d: Date): string {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    private parseIsoAsLocalMidday(dateIso: string): Date {
        // Evita problemas de UTC / DST: trabajamos al mediodía local
        return new Date(`${dateIso}T12:00:00`);
    }

    async initializeApp() {
        try {
            if (this.isWeb) {
                // Initialize jeep-sqlite for web
                const jeepSqlite = document.createElement('jeep-sqlite');
                document.body.appendChild(jeepSqlite);
                await customElements.whenDefined('jeep-sqlite');
                await this.sqlite.initWebStore();
            }

            this.db = await this.sqlite.createConnection(
                'taxi_agenda',
                false,
                'no-encryption',
                1,
                false
            );

            await this.db.open();

            const schema = `
        CREATE TABLE IF NOT EXISTS trips (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          section TEXT NOT NULL,
          passenger TEXT,
          destination TEXT,
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          time TEXT
        );
      `;

            await this.db.execute(schema);

            // Migración: Agregar columna time si no existe
            try {
                await this.db.execute(`ALTER TABLE trips ADD COLUMN time TEXT;`);
                console.log('✅ Columna time agregada a la base de datos');
            } catch (e) {
                // La columna ya existe, ignorar error
            }

            // Migración: Agregar columnas passenger/destination si no existen
            try {
                await this.db.execute(`ALTER TABLE trips ADD COLUMN passenger TEXT;`);
                console.log('✅ Columna passenger agregada a la base de datos');
            } catch (e) {
                // La columna ya existe, ignorar error
            }

            try {
                await this.db.execute(`ALTER TABLE trips ADD COLUMN destination TEXT;`);
                console.log('✅ Columna destination agregada a la base de datos');
            } catch (e) {
                // La columna ya existe, ignorar error
            }

            await this.loadTrips(this._currentDate());

        } catch (err) {
            console.error('Database initialization failed', err);
        }
    }

    async loadTrips(date: string) {
        const res = await this.db.query('SELECT * FROM trips WHERE date = ?', [date]);
        const data = res.values as Trip[] || [];
        this._trips.set(data);
        console.log(`[DB] loadTrips para ${date}: ${data.length} registros cargados.`);
    }

    async loadMonthlySummary() {
        const res = await this.db.query(`
            SELECT
              substr(date, 1, 7) as month,
              COUNT(*) as total,
              SUM(CASE WHEN section = 'ida' THEN 1 ELSE 0 END) as ida,
              SUM(CASE WHEN section = 'vuelta' THEN 1 ELSE 0 END) as vuelta,
              SUM(CASE WHEN section = 'encomienda' THEN 1 ELSE 0 END) as encomienda
            FROM trips
            GROUP BY substr(date, 1, 7)
            ORDER BY month DESC
        `);

        const rows = (res.values || []) as any[];
        const formatted: MonthlySummaryRow[] = rows.map(r => {
            const month = String(r.month || '');
            const label = month ? new Date(month + '-01T12:00:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : '';
            return {
                month,
                label,
                total: Number(r.total || 0),
                ida: Number(r.ida || 0),
                vuelta: Number(r.vuelta || 0),
                encomienda: Number(r.encomienda || 0),
            };
        });

        this._monthlySummary.set(formatted);
    }

    async getTripsByDate(date: string): Promise<Trip[]> {
        const res = await this.db.query('SELECT * FROM trips WHERE date = ? ORDER BY time IS NULL, time ASC, id DESC', [date]);
        return (res.values as Trip[]) || [];
    }

    async getDayCountsForMonth(monthIso: string): Promise<Record<string, number>> {
        const res = await this.db.query(`
            SELECT
              date as date,
              COUNT(*) as total
            FROM trips
            WHERE substr(date, 1, 7) = ?
            GROUP BY date
        `, [monthIso]);

        const rows = (res.values || []) as any[];
        const map: Record<string, number> = {};
        rows.forEach(r => {
            if (r.date) {
                map[String(r.date)] = Number(r.total || 0);
            }
        });
        return map;
    }

    async addTrip(trip: Omit<Trip, 'id'>) {
        const { date, section, passenger, destination, description, amount, time } = trip;
        await this.db.run(
            'INSERT INTO trips (date, section, passenger, destination, description, amount, time) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [date, section, passenger || null, destination || null, description, amount, time || null]
        );
        await this.loadTrips(date);
    }

    async deleteTrip(id: number, date: string) {
        await this.db.run('DELETE FROM trips WHERE id = ?', [id]);
        await this.loadTrips(date);
    }

    async updateDate(date: string) {
        this._currentDate.set(date);
        await this.loadTrips(date);
    }

    async nextDay() {
        const d = this.parseIsoAsLocalMidday(this._currentDate());
        d.setDate(d.getDate() + 1);
        await this.updateDate(this.toLocalIsoDate(d));
    }

    async prevDay() {
        const d = this.parseIsoAsLocalMidday(this._currentDate());
        d.setDate(d.getDate() - 1);
        await this.updateDate(this.toLocalIsoDate(d));
    }
}
