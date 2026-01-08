export interface Trip {
    id?: number;
    date: string; // ISO string or YYYY-MM-DD
    section: 'ida' | 'vuelta' | 'encomienda';
    description: string;
    amount: number;
    time?: string; // HH:mm format
}
