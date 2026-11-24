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
  row('1001', 'Wheat and meslin', [0], 'food_agri', ['wheat', 'meslin', 'gehu']),
  row('1101', 'Wheat or meslin flour', [0], 'food_agri', ['flour', 'atta', 'maida', 'wheat flour']),
  row('1901', 'Food preparations of flour, groats, meal, starch or malt extract', [18], 'food_agri', ['malt extract', 'food preparation', 'corn flakes', 'muesli', 'cereal']),
  row('1902', 'Pasta, whether or not cooked or stuffed', [18], 'food_agri', ['pasta', 'noodles', 'macaroni', 'spaghetti', 'instant noodles', 'maggi']),
  row('1905', 'Bread, pastry, cakes, biscuits', [18], 'food_agri', ['bread', 'pastry', 'cake', 'biscuits', 'biscuit', 'cookies', 'rusk']),
  row('1704', 'Sugar confectionery', [18], 'food_agri', ['candy', 'confectionery', 'toffee', 'sweet', 'gummy']),
  row('1806', 'Chocolate and other food preparations containing cocoa', [18], 'food_agri', ['chocolate', 'cocoa', 'cadbury', 'dairy milk', 'kit kat']),
  row('1510', 'Other oils - sesame', [5], 'food_agri', ['sesame oil', 'til oil', 'other oils']),
  row('1514', 'Rape, colza or mustard oil', [5], 'food_agri', ['mustard oil', 'sarso', 'rapeseed oil', 'mustard seed oil']),
  row('1512', 'Sunflower-seed or safflower oil', [5], 'food_agri', ['sunflower oil', 'safflower oil']),
  row('0910', 'Ginger, saffron, turmeric', [5], 'food_agri', ['ginger', 'saffron', 'turmeric', 'haldi', 'spice', 'spices']),
  row('3401', 'Soap and organic surface-active products', [5, 18], 'fmcg', ['soap', 'detergent', 'bath soap'], { gst_rate: 18, rate_note: '5%: Toilet soap in the form of bars, cakes; 18%: other soap' }),
  row('0401', 'Milk and cream, not concentrated', [0], 'perishables', ['milk', 'cream', 'dairy', 'doodh'], { is_perishable: true }),
  row('0405', 'Butter and other fats and oils derived from milk', [12], 'perishables', ['ghee', 'desi ghee', 'butter', 'makhan', 'clarified butter'], { is_perishable: true }),
  row('0803', 'Bananas', [0], 'perishables', ['banana', 'bananas', 'kela'], { is_perishable: true }),
  row('2523', 'Portland cement, aluminous cement', [18], 'construction', ['cement', 'portland cement', 'ultratech', 'acc', 'ambuja', 'ppc', 'opc', 'white cement']),
  row('6810', 'Articles of cement, concrete or artificial stone', [5, 18], 'construction', ['concrete block', 'cement block', 'precast', 'paver', 'rcc', 'concrete']),
  row('6907', 'Ceramic flags and paving; ceramic tiles', [18], 'construction', ['tile', 'tiles', 'ceramic tile', 'floor tile', 'wall tile', 'vitrified tile']),
  row('6808', 'Panels, boards of vegetable fibre with cement', [18], 'construction', ['fibre board', 'cement board', 'particle board', 'gypsum board', 'drywall']),
  row('4407', 'Wood sawn or chipped lengthwise, sliced or peeled', [18], 'construction', ['timber', 'wood', 'lumber', 'sawn wood', 'teak', 'pine']),
  row('3004', 'Medicaments for therapeutic or prophylactic uses', [0, 5], 'pharma', ['medicine', 'tablet', 'capsule', 'syrup', 'pharmaceutical', 'drug', 'paracetamol', 'antibiotic'], { gst_rate: 5, synonyms: ['medicine', 'medicines', 'medical', 'medication', 'pharma', 'generic medicine'], rate_note: '5%: Medicaments put up in measured doses; nil: drugs or medicines listed in Annexure I of 10/2025' }),
  row('61', 'Articles of apparel and clothing accessories, knitted or crocheted (chapter 61)', [5, 18], 'textiles', ['knitwear', 'tshirt', 't-shirt', 'hosiery', 'innerwear'], { synonyms: GARMENT_SYN, rate_note: '5%: of sale value not exceeding Rs 2500 per piece; 18%: above' }),
  row('62', 'Articles of apparel and clothing accessories, not knitted or crocheted (chapter 62)', [5, 18], 'textiles', ['woven garments', 'shirt', 'trouser', 'suit', 'formal wear'], { synonyms: GARMENT_SYN }),
  row('6109', 'T-shirts, singlets and other vests, knitted', [5, 18], 'textiles', ['tshirt', 't-shirt', 'vest', 'tank top', 'singlet', 'innerwear']),
  row('6401', 'Waterproof footwear', [18], 'textiles', ['waterproof footwear', 'gumboots', 'rain boots', 'rubber boots']),
  row('6403', 'Footwear with outer soles of rubber, plastics, leather', [18], 'textiles', ['shoes', 'footwear', 'sandals', 'sneakers', 'slippers', 'chappal', 'boots', 'leather shoes']),
  row('9401', 'Seats and chairs', [18], 'fmcg', ['chair', 'chairs', 'office chair', 'sofa', 'couch', 'seat', 'stool', 'plastic chair']),
  row('3926', 'Other articles of plastics', [18], 'fmcg', ['plastic', 'plastic product', 'plastic container']),
  row('5208', 'Woven fabrics of cotton (cotton fabric, headings 5208 to 5212)', [5], 'textiles', ['cotton', 'fabric', 'cloth']),
  row('8517', 'Telephone sets, smartphones', [18], 'electronics', ['mobile', 'smartphone', 'phone', 'iphone', 'samsung']),
  row('8415', 'Air conditioning machines', [28], 'electronics', ['ac', 'air conditioner', 'split ac', 'window ac']),
  row('3305', 'Preparations for use on the hair', [18], 'fmcg', ['shampoo', 'conditioner', 'hair oil', 'hair color']),
  row('7214', 'Bars and rods of iron or steel', [18], 'steel_metal', ['tmt', 'tmt bar', 'rebar', 'steel bar', 'saria']),
  row('7304', 'Tubes, pipes and profiles, seamless, of iron or steel', [18], 'steel_metal', ['steel pipe', 'seamless pipe', 'steel tube', 'ms pipe']),
  row('3904', 'Polymers of vinyl chloride', [18], 'chemicals', ['pvc', 'pvc pipe', 'pvc resin']),
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
