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

export interface Rate {
    id?: number;
    location: string;
    type: 'passenger' | 'encomienda';
    price: number;
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
        const totals = { ida: 0, vuelta: 0, encomienda: 0, observaciones: 0 };
        this._trips().forEach(trip => {
            if (trip.section in totals) {
                totals[trip.section] += trip.amount;
            }
        });
        return totals;
    });

    public readonly sectionCounts = computed(() => {
        const counts = { ida: 0, vuelta: 0, encomienda: 0, observaciones: 0 };
        this._trips().forEach(trip => {
            if (trip.section in counts) {
                counts[trip.section]++;
            }
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
        if (this.db) {
            console.log('⚠️ Database already initialized');
            return;
        }

        try {
            console.log('🔄 Initializing Database...');
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
            console.log('✅ Database connection opened');

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
            } catch (e) { }

            // Migración: Agregar columnas passenger/destination si no existen
            try {
                await this.db.execute(`ALTER TABLE trips ADD COLUMN passenger TEXT;`);
            } catch (e) { }

            try {
                await this.db.execute(`ALTER TABLE trips ADD COLUMN destination TEXT;`);
            } catch (e) { }

            // Migración: Agregar columna packageType si no existe (para Encomiendas)
            try {
                await this.db.execute(`ALTER TABLE trips ADD COLUMN packageType TEXT;`);
            } catch (e) { }

            // Migración: Agregar columna quantity si no existe (para Pasajeros)
            try {
                await this.db.execute(`ALTER TABLE trips ADD COLUMN quantity INTEGER DEFAULT 1;`);
            } catch (e) { }

            // Migración: Agregar columna observations si no existe
            try {
                await this.db.execute(`ALTER TABLE trips ADD COLUMN observations TEXT;`);
            } catch (e) { }

            // Crear tabla de Tarifas (Rates)
            // Updated schema to include 'type' and make location+type unique
            const ratesSchema = `
        CREATE TABLE IF NOT EXISTS rates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          location TEXT NOT NULL,
          type TEXT NOT NULL,
          price REAL NOT NULL,
          UNIQUE(location, type)
        );
      `;
            await this.db.execute(ratesSchema);

            // Migration for Rates: If table existed without 'type', we might need to recreate or alter.
            // Since this is dev, let's try to add column 'type' if missing, defaulting to 'passenger'
            try {
                await this.db.execute(`ALTER TABLE rates ADD COLUMN type TEXT DEFAULT 'passenger';`);
            } catch (e) {
                // Column likely exists
            }

            // Inicializar tarifas por defecto si no existen
            await this.initDefaultRates();

            await this.loadTrips(this._currentDate());
            console.log('🚀 Database fully initialized');

        } catch (err) {
            console.error('❌ Database initialization failed', err);
            // DO NOT THROW. Resolve so app can start, even if DB is broken.
            // Optionally set a signal to show error UI.
        }
    }

    private async ensureDb() {
        if (!this.db) {
            console.warn('⚠️ DB not initialized when calling operation. Forcing init...');
            await this.initializeApp();
        }
    }

    async loadTrips(date: string) {
        await this.ensureDb();
        const res = await this.db.query('SELECT * FROM trips WHERE date = ? ORDER BY time IS NULL, time ASC, id DESC', [date]);
        const data = res.values as Trip[] || [];
        this._trips.set(data);
        console.log(`[DB] loadTrips para ${date}: ${data.length} registros cargados.`);
    }

    async loadMonthlySummary() {
        await this.ensureDb();
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
        await this.ensureDb();
        const res = await this.db.query('SELECT * FROM trips WHERE date = ? ORDER BY time IS NULL, time ASC, id DESC', [date]);
        return (res.values as Trip[]) || [];
    }

    async getDayCountsForMonth(monthIso: string): Promise<Record<string, number>> {
        await this.ensureDb();
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
        await this.ensureDb();
        const { date, section, passenger, destination, description, amount, time, packageType, quantity } = trip;
        await this.db.run(
            'INSERT INTO trips (date, section, passenger, destination, description, amount, time, packageType, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [date, section, passenger || null, destination || null, description, amount, time || null, packageType || null, quantity || 1]
        );
        await this.loadTrips(date);
    }

    async deleteTrip(id: number, date: string) {
        await this.ensureDb();
        await this.db.run('DELETE FROM trips WHERE id = ?', [id]);
        await this.loadTrips(date);
    }

    async updateTrip(trip: Trip) {
        await this.ensureDb();
        const { id, date, section, passenger, destination, description, amount, time, packageType, quantity } = trip;
        if (!id) return;

        await this.db.run(
            `UPDATE trips SET 
                passenger = ?, 
                destination = ?, 
                description = ?, 
                amount = ?, 
                time = ?, 
                packageType = ?, 
                quantity = ?
             WHERE id = ?`,
            [passenger || null, destination || null, description, amount, time || null, packageType || null, quantity || 1, id]
        );
        await this.loadTrips(date);
    }

    async updateDate(date: string) {
        // No DB call here properly, but loadTrips is called next line usually.
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

    // --- RATES METHODS ---

    private async initDefaultRates() {
        console.log('Initializing/Verifying default rates');

        const defaults = [
            { loc: 'Resistencia', type: 'passenger', price: 50000 },
            { loc: 'Corrientes', type: 'passenger', price: 64000 },
            { loc: 'Resistencia', type: 'encomienda', price: 25000 },
            { loc: 'Corrientes', type: 'encomienda', price: 25000 }
        ];

        try {
            // WIPE AND RELOAD to ensure consistency with new values
            await this.db.run('DELETE FROM rates');

            for (const r of defaults) {
                await this.db.run(
                    'INSERT INTO rates (location, type, price) VALUES (?, ?, ?)',
                    [r.loc, r.type, r.price]
                );
            }
            console.log('✅ Rates re-seeded successfully:', defaults.length);
        } catch (e) {
            console.error('❌ Error re-seeding rates:', e);
        }
    }

    async getRate(location: string, section?: string): Promise<number> {
        await this.ensureDb();

        // Map section to rate type
        let type = 'passenger';
        if (section === 'encomienda') type = 'encomienda';

        const res = await this.db.query(
            'SELECT price FROM rates WHERE UPPER(location) = UPPER(?) AND type = ?',
            [location, type]
        );

        if (res.values && res.values.length > 0) {
            return res.values[0].price;
        }
        return 0;
    }

    async updateRate(location: string, type: string, price: number) {
        await this.ensureDb();
        const res = await this.db.run('UPDATE rates SET price = ? WHERE UPPER(location) = UPPER(?) AND type = ?', [price, location, type]);
        if (res.changes?.changes === 0) {
            await this.db.run('INSERT INTO rates (location, type, price) VALUES (?, ?, ?)', [location, type, price]);
        }
    }

    async getAllRates(): Promise<Rate[]> {
        await this.ensureDb();
        const res = await this.db.query('SELECT * FROM rates');
        return (res.values as Rate[]) || [];
    }
}
