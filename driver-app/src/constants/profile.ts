/**
 * Common Indian goods vehicles a driver can pick as their vehicle type.
 * Capacity and container size are the manufacturers' typical figures.
 */
export const INDIAN_VEHICLES = [
  { id: 'Tata Ace (Chota Hathi)', key: 'veh_tata_ace', capacity_kg: 750, container: '7×4.5×4.5 ft' },
  { id: 'Mahindra Bolero Pickup', key: 'veh_bolero', capacity_kg: 1200, container: '8×5×5 ft' },
  { id: 'Ashok Leyland Dost', key: 'veh_dost', capacity_kg: 1500, container: '9×5.5×5 ft' },
  { id: 'Ashok Leyland Bada Dost', key: 'veh_bada_dost', capacity_kg: 2000, container: '10×5.5×5.5 ft' },
  { id: 'Maruti Suzuki Super Carry', key: 'veh_super_carry', capacity_kg: 740, container: '7×4.5×4 ft' },
  { id: 'Tata Intra', key: 'veh_intra', capacity_kg: 1500, container: '9×5×5 ft' },
  { id: 'Tata Yodha', key: 'veh_yodha', capacity_kg: 2500, container: '10×6×6 ft' },
  { id: 'Mahindra Supro', key: 'veh_supro', capacity_kg: 1000, container: '8×4.5×4.5 ft' },
  { id: 'Piaggio Ape Cargo', key: 'veh_ape', capacity_kg: 500, container: '5×4×4 ft' },
  { id: 'Tata 407', key: 'veh_tata_407', capacity_kg: 3500, container: '14×6×6 ft' },
  { id: 'Eicher Pro 1049 / 2049', key: 'veh_eicher', capacity_kg: 5000, container: '17×7×7 ft' },
  { id: 'Mahindra Furio 7', key: 'veh_furio', capacity_kg: 7000, container: '17×7×7 ft' },
  { id: 'Tata 709 / 1109', key: 'veh_tata_709', capacity_kg: 9000, container: '19×7×7 ft' },
  { id: 'BharatBenz 1015R', key: 'veh_bharatbenz', capacity_kg: 10000, container: '20×7×7 ft' },
  { id: 'Tata Signa (Multi-axle)', key: 'veh_signa', capacity_kg: 25000, container: '32×8×8 ft' },
  { id: 'Ashok Leyland U-Truck', key: 'veh_utruck', capacity_kg: 25000, container: '32×8×8 ft' },
  { id: 'Volvo FM / FMX', key: 'veh_volvo', capacity_kg: 40000, container: '40×8×9 ft' },
] as const;

/** Languages the driver app is translated into (see src/locales). */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'bn', label: 'বাংলা' },
] as const;
