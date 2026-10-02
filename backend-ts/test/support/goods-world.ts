/**
 * Fixture rows for the goods master tests: a slice of what migrations 20261003010000_goods_master.sql (codes,
 * keywords, flags) and 20261005010000_hsn_master_gst2.sql (the GST 2.0 rates) give production, so the search and the
 * assistant are tested on data shaped like it.
 */
import { buildHsnIndex, HsnRow } from '../../src/services/goods/hsn-index';
import type { GoodsCategory, PincodePrefix, VehicleClass } from '../../src/services/goods/master';

const row = (hsn_code: string, description: string, rates: number[], category: string, keywords: string[], extra: Partial<HsnRow> = {}): HsnRow => ({
  hsn_code, description, gst_rate: rates[0], gst_rates: rates, rate_note: null, category, keywords, synonyms: [],
  is_hazmat: false, is_perishable: false, eway_always: false, is_active: true, ...extra,
});

const GARMENT_SYN = ['clothes', 'clothing', 'garments', 'garment', 'apparel', 'readymade', 'ready made', 'dress', 'shirt', 'trousers', 'kapde', 'kurta', 'saree', 'jeans'];

export const HSN_ROWS: HsnRow[] = [
  row('1006', 'Rice', [0], 'food_agri', ['rice', 'basmati', 'biryani', 'sella', 'raw rice', 'parboiled']),
  row('1101', 'Wheat or meslin flour', [0], 'food_agri', ['flour', 'atta', 'maida', 'wheat flour']),
  row('1512', 'Sunflower-seed or safflower oil', [5], 'food_agri', ['sunflower oil', 'safflower oil']),
  row('0910', 'Ginger, saffron, turmeric', [5], 'food_agri', ['ginger', 'saffron', 'turmeric', 'haldi', 'spice', 'spices']),
  row('3401', 'Soap and organic surface-active products', [5, 18], 'fmcg', ['soap', 'detergent', 'bath soap'], { gst_rate: 18, rate_note: '5%: Toilet soap in the form of bars, cakes; 18%: other soap' }),
  row('0401', 'Milk and cream, not concentrated', [0], 'perishables', ['milk', 'cream', 'dairy', 'doodh'], { is_perishable: true }),
  row('0803', 'Bananas', [0], 'perishables', ['banana', 'bananas', 'kela'], { is_perishable: true }),
  row('2523', 'Portland cement, aluminous cement', [18], 'construction', ['cement', 'portland cement', 'ultratech', 'acc', 'ambuja', 'ppc', 'opc', 'white cement']),
  row('6810', 'Articles of cement, concrete or artificial stone', [5, 18], 'construction', ['concrete block', 'cement block', 'precast', 'paver', 'rcc', 'concrete', 'tile']),
  row('6808', 'Panels, boards of vegetable fibre with cement', [18], 'construction', ['fibre board', 'cement board', 'particle board', 'gypsum board', 'drywall']),
  row('3004', 'Medicaments for therapeutic or prophylactic uses', [0, 5], 'pharma', ['medicine', 'tablet', 'capsule', 'syrup', 'pharmaceutical', 'drug', 'paracetamol', 'antibiotic'], { gst_rate: 5, synonyms: ['medicine', 'medicines', 'medical', 'medication', 'pharma', 'generic medicine'], rate_note: '5%: Medicaments put up in measured doses; nil: drugs or medicines listed in Annexure I of 10/2025' }),
  row('61', 'Articles of apparel and clothing accessories, knitted or crocheted (chapter 61)', [5, 18], 'textiles', ['knitwear', 'tshirt', 't-shirt', 'hosiery', 'innerwear'], { synonyms: GARMENT_SYN, rate_note: '5%: of sale value not exceeding Rs 2500 per piece; 18%: above' }),
  row('62', 'Articles of apparel and clothing accessories, not knitted or crocheted (chapter 62)', [5, 18], 'textiles', ['woven garments', 'shirt', 'trouser', 'suit', 'formal wear'], { synonyms: GARMENT_SYN }),
  row('6109', 'T-shirts, singlets and other vests, knitted', [5, 18], 'textiles', ['tshirt', 't-shirt', 'vest', 'tank top', 'singlet', 'innerwear']),
  row('5208', 'Woven fabrics of cotton (cotton fabric, headings 5208 to 5212)', [5], 'textiles', ['cotton', 'fabric', 'cloth']),
  row('8517', 'Telephone sets, smartphones', [18], 'electronics', ['mobile', 'smartphone', 'phone', 'iphone', 'samsung']),
  row('7214', 'Bars and rods of iron or steel', [18], 'steel_metal', ['tmt', 'tmt bar', 'rebar', 'steel bar', 'saria']),
  row('2710', 'Petroleum oils (diesel, petrol, kerosene, lubricants)', [18], 'chemicals', ['diesel', 'petrol', 'kerosene', 'lubricant', 'fuel'], { is_hazmat: true, eway_always: true }),
  row('3604', 'Fireworks, signalling flares and similar pyrotechnic articles', [18], 'hazmat', ['fireworks', 'crackers', 'firecracker', 'pataka', 'sparkler'], { is_hazmat: true, eway_always: true }),
];

const vc = (key: string, name: string, min_t: number | null, max_t: number | null, sort: number, over: Partial<VehicleClass> = {}): VehicleClass => ({
  key, name, min_t, max_t, best_for: null, notes: null, interstate_ok: true, is_reefer: false, is_open: false, is_tanker: false, sort, ...over,
});

export const VEHICLE_CLASSES: VehicleClass[] = [
  vc('mini_truck', 'Mini truck / Tata Ace', 0.5, 1.5, 10, { interstate_ok: false }),
  vc('truck_14ft', 'Medium truck (14 ft)', 2, 4, 20),
  vc('truck_17_20ft', 'Large truck (17-20 ft)', 5, 7, 30),
  vc('container_20ft', 'Container (20 ft)', 10, 12, 40),
  vc('container_32ft_sxl', 'Container (32 ft / SXL)', 15, 18, 50),
  vc('flatbed', 'Flatbed / Open truck', 10, 20, 60, { is_open: true }),
  vc('reefer', 'Reefer / Cold chain', 5, 15, 70, { is_reefer: true }),
  vc('trailer_40ft', 'Trailer (40 ft)', 20, 25, 80),
  vc('tanker', 'Tanker', null, null, 90, { is_tanker: true }),
];

const cat = (key: string, name: string, rec: string, over: Partial<GoodsCategory> = {}): GoodsCategory => ({
  key, name, examples: null, hsn_range: null, default_rates: [], eway_threshold_inr: 50000, is_hazmat: false, is_perishable: false, recommended_vehicle_class: rec, sort: 0, ...over,
});

export const CATEGORIES: GoodsCategory[] = [
  cat('food_agri', 'Food & Agriculture', 'truck_17_20ft'),
  cat('fmcg', 'FMCG / Consumer Goods', 'truck_14ft'),
  cat('steel_metal', 'Steel & Metal Products', 'flatbed'),
  cat('construction', 'Construction Materials', 'flatbed'),
  cat('perishables', 'Perishables / Cold Chain', 'reefer', { is_perishable: true }),
  cat('hazmat', 'Hazardous Goods', 'container_20ft', { is_hazmat: true, eway_threshold_inr: 0 }),
];

export const PREFIXES: PincodePrefix[] = [
  { prefix: '400', state_code: '27', state_name: 'Maharashtra' },
  { prefix: '411', state_code: '27', state_name: 'Maharashtra' },
  { prefix: '110', state_code: '07', state_name: 'Delhi' },
  { prefix: '560', state_code: '29', state_name: 'Karnataka' },
];

export const hsnIndex = () => buildHsnIndex(HSN_ROWS);

/** Database fixtures for the endpoint tests. */
export const goodsTables = () => ({
  hsn_codes: HSN_ROWS.map(r => ({ ...r })),
  vehicle_classes: VEHICLE_CLASSES.map(v => ({ ...v })),
  goods_categories: CATEGORIES.map(c => ({ ...c })),
  pincode_prefixes: PREFIXES.map(p => ({ ...p })),
  pincodes: [{ pincode: '400001', district: 'Mumbai', city: 'Mumbai', state_code: '27', state_name: 'Maharashtra' }, { pincode: '411001', district: 'Pune', city: null, state_code: '27', state_name: 'Maharashtra' }],
});
