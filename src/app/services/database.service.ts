import { Injectable, signal, computed } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Trip } from '../models/trip.model';

@Injectable({
    providedIn: 'root'
})
export class DatabaseService {
    private sqlite: SQLiteConnection = new SQLiteConnection(CapacitorSQLite);
    private db!: SQLiteDBConnection;
    private isWeb: boolean = Capacitor.getPlatform() === 'web';

    // Signals for state management
    private _currentDate = signal<string>(new Date().toISOString().split('T')[0]);
    public readonly currentDate = this._currentDate.asReadonly();

    private _trips = signal<Trip[]>([]);
    public readonly trips = this._trips.asReadonly();

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

    async addTrip(trip: Omit<Trip, 'id'>) {
        const { date, section, description, amount, time } = trip;
        await this.db.run(
            'INSERT INTO trips (date, section, description, amount, time) VALUES (?, ?, ?, ?, ?)',
            [date, section, description, amount, time || null]
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
        const d = new Date(this._currentDate());
        d.setDate(d.getDate() + 1);
        await this.updateDate(d.toISOString().split('T')[0]);
    }

    async prevDay() {
        const d = new Date(this._currentDate());
        d.setDate(d.getDate() - 1);
        await this.updateDate(d.toISOString().split('T')[0]);
    }
}
