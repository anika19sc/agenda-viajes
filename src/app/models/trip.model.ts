export interface Trip {
    id?: number;
    date: string; // ISO string or YYYY-MM-DD
    section: 'ida' | 'vuelta' | 'encomienda';
    passenger?: string;
    destination?: string;
    description: string;
    amount: number;
    time?: string; // HH:mm format
    packageType?: string; // Encomienda type (e.g., Sobre, Caja)
}
