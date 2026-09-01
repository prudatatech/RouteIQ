/**
 * HSN Code Database — Indian Harmonized System of Nomenclature
 * Comprehensive lookup for auto-suggest based on product name, category, and description.
 */

export interface HSNEntry {
  hsn: string;
  description: string;
  gstRate: number; // percentage
  category: string;
  keywords: string[]; // for fuzzy matching
}

export const HSN_DATABASE: HSNEntry[] = [
  // ═══════════════════════════════════════════════════════
  // FMCG — Food & Beverages
  // ═══════════════════════════════════════════════════════
  { hsn: '1006', description: 'Rice', gstRate: 5, category: 'FMCG', keywords: ['rice', 'basmati', 'biryani', 'sella', 'raw rice', 'parboiled'] },
  { hsn: '1001', description: 'Wheat and meslin', gstRate: 0, category: 'FMCG', keywords: ['wheat', 'atta', 'flour', 'meslin', 'gehu'] },
  { hsn: '1101', description: 'Wheat or meslin flour', gstRate: 0, category: 'FMCG', keywords: ['flour', 'atta', 'maida', 'wheat flour'] },
  { hsn: '1701', description: 'Cane or beet sugar', gstRate: 5, category: 'FMCG', keywords: ['sugar', 'cheeni', 'cane sugar', 'beet sugar', 'jaggery'] },
  { hsn: '1901', description: 'Food preparations of flour, groats, meal, starch or malt extract', gstRate: 18, category: 'FMCG', keywords: ['biscuit', 'cookie', 'cake', 'pastry', 'bread', 'rusk', 'noodles', 'pasta', 'instant noodles', 'maggi'] },
  { hsn: '1905', description: 'Bread, pastry, cakes, biscuits', gstRate: 18, category: 'FMCG', keywords: ['bread', 'pastry', 'cake', 'biscuits', 'cookies', 'rusk', 'parle', 'britannia'] },
  { hsn: '0401', description: 'Milk and cream, not concentrated', gstRate: 0, category: 'FMCG', keywords: ['milk', 'cream', 'dairy', 'amul', 'doodh', 'fresh milk'] },
  { hsn: '0402', description: 'Milk and cream, concentrated or sweetened', gstRate: 5, category: 'FMCG', keywords: ['condensed milk', 'milk powder', 'skimmed milk', 'evaporated'] },
  { hsn: '0406', description: 'Cheese and curd', gstRate: 12, category: 'FMCG', keywords: ['cheese', 'paneer', 'curd', 'cottage cheese', 'mozzarella'] },
  { hsn: '1507', description: 'Soya-bean oil', gstRate: 5, category: 'FMCG', keywords: ['soybean oil', 'soya oil', 'cooking oil', 'edible oil'] },
  { hsn: '1508', description: 'Groundnut oil', gstRate: 5, category: 'FMCG', keywords: ['groundnut oil', 'peanut oil', 'cooking oil'] },
  { hsn: '1509', description: 'Olive oil', gstRate: 5, category: 'FMCG', keywords: ['olive oil', 'extra virgin'] },
  { hsn: '1510', description: 'Other oils - Mustard, Sesame', gstRate: 5, category: 'FMCG', keywords: ['mustard oil', 'sesame oil', 'til oil', 'sarso'] },
  { hsn: '1511', description: 'Palm oil', gstRate: 5, category: 'FMCG', keywords: ['palm oil', 'palmolein', 'cooking oil'] },
  { hsn: '1512', description: 'Sunflower-seed or safflower oil', gstRate: 5, category: 'FMCG', keywords: ['sunflower oil', 'safflower oil'] },
  { hsn: '1515', description: 'Other fixed vegetable fats and oils', gstRate: 5, category: 'FMCG', keywords: ['coconut oil', 'linseed oil', 'castor oil'] },
  { hsn: '0902', description: 'Tea', gstRate: 5, category: 'FMCG', keywords: ['tea', 'chai', 'green tea', 'black tea', 'darjeeling', 'assam', 'brooke bond', 'tata tea', 'wagh bakri'] },
  { hsn: '0901', description: 'Coffee', gstRate: 5, category: 'FMCG', keywords: ['coffee', 'instant coffee', 'nescafe', 'bru', 'coffee beans', 'filter coffee'] },
  { hsn: '2106', description: 'Food preparations not elsewhere specified', gstRate: 18, category: 'FMCG', keywords: ['protein powder', 'health drink', 'supplement', 'bournvita', 'horlicks', 'complan'] },
  { hsn: '2202', description: 'Waters with added sugar or sweetened', gstRate: 28, category: 'FMCG', keywords: ['soft drink', 'cola', 'pepsi', 'coca cola', 'sprite', 'soda', 'energy drink', 'redbull', 'fanta', 'limca', 'thumbs up', 'aerated'] },
  { hsn: '2201', description: 'Mineral waters and aerated waters', gstRate: 18, category: 'FMCG', keywords: ['water', 'mineral water', 'packaged water', 'bisleri', 'aquafina', 'kinley'] },
  { hsn: '0713', description: 'Dried leguminous vegetables (pulses)', gstRate: 0, category: 'FMCG', keywords: ['dal', 'daal', 'lentil', 'pulses', 'moong', 'toor', 'chana', 'masoor', 'urad', 'rajma'] },
  { hsn: '0904', description: 'Pepper and chilli', gstRate: 5, category: 'FMCG', keywords: ['pepper', 'chilli', 'mirch', 'kali mirch', 'black pepper', 'spice'] },
  { hsn: '0910', description: 'Ginger, saffron, turmeric', gstRate: 5, category: 'FMCG', keywords: ['ginger', 'saffron', 'turmeric', 'haldi', 'adrak', 'kesar', 'spice'] },
  { hsn: '2104', description: 'Soups, broths and preparations thereof', gstRate: 18, category: 'FMCG', keywords: ['soup', 'broth', 'knorr', 'maggi soup'] },
  { hsn: '1704', description: 'Sugar confectionery', gstRate: 18, category: 'FMCG', keywords: ['chocolate', 'candy', 'confectionery', 'toffee', 'sweet', 'cadbury', 'dairy milk', 'kit kat', 'gummy'] },
  { hsn: '2103', description: 'Sauces and preparations; mixed condiments', gstRate: 12, category: 'FMCG', keywords: ['sauce', 'ketchup', 'mustard', 'chutney', 'masala', 'maggi sauce', 'soy sauce'] },
  { hsn: '2005', description: 'Other vegetables prepared or preserved', gstRate: 12, category: 'FMCG', keywords: ['pickles', 'achar', 'preserved vegetables', 'frozen vegetables'] },
  { hsn: '1604', description: 'Prepared or preserved fish', gstRate: 12, category: 'FMCG', keywords: ['canned fish', 'tuna', 'sardine', 'preserved fish'] },

  // ═══════════════════════════════════════════════════════
  // FMCG — Personal Care & Household
  // ═══════════════════════════════════════════════════════
  { hsn: '3401', description: 'Soap and organic surface-active products', gstRate: 18, category: 'FMCG', keywords: ['soap', 'detergent bar', 'bathing bar', 'lux', 'lifebuoy', 'dove'] },
  { hsn: '3402', description: 'Organic surface-active agents; washing preparations', gstRate: 18, category: 'FMCG', keywords: ['detergent', 'washing powder', 'surf', 'ariel', 'tide', 'rin', 'liquid wash', 'fabric wash'] },
  { hsn: '3304', description: 'Beauty, make-up and skin-care preparations', gstRate: 28, category: 'FMCG', keywords: ['cosmetics', 'cream', 'lotion', 'sunscreen', 'lipstick', 'foundation', 'moisturizer', 'face wash'] },
  { hsn: '3305', description: 'Preparations for use on the hair', gstRate: 18, category: 'FMCG', keywords: ['shampoo', 'conditioner', 'hair oil', 'hair color', 'hair dye', 'clinic plus', 'head and shoulders'] },
  { hsn: '3306', description: 'Preparations for oral or dental hygiene', gstRate: 18, category: 'FMCG', keywords: ['toothpaste', 'mouthwash', 'toothbrush', 'colgate', 'pepsodent', 'closeup', 'dental'] },
  { hsn: '4818', description: 'Toilet paper, tissues, napkins, diapers', gstRate: 18, category: 'FMCG', keywords: ['tissue', 'napkin', 'diaper', 'sanitary pad', 'toilet paper', 'pampers', 'huggies'] },

  // ═══════════════════════════════════════════════════════
  // Electronics
  // ═══════════════════════════════════════════════════════
  { hsn: '8471', description: 'Automatic data processing machines (computers)', gstRate: 18, category: 'Electronics', keywords: ['computer', 'laptop', 'desktop', 'pc', 'server', 'dell', 'hp', 'lenovo', 'macbook', 'tablet', 'ipad'] },
  { hsn: '8517', description: 'Telephone sets, smartphones', gstRate: 18, category: 'Electronics', keywords: ['phone', 'smartphone', 'mobile', 'iphone', 'samsung', 'oneplus', 'vivo', 'oppo', 'realme', 'xiaomi', 'redmi', 'telephone'] },
  { hsn: '8528', description: 'Monitors and projectors; television receivers', gstRate: 18, category: 'Electronics', keywords: ['tv', 'television', 'monitor', 'led tv', 'lcd', 'oled', 'projector', 'smart tv', 'samsung tv', 'lg tv', 'sony'] },
  { hsn: '8415', description: 'Air conditioning machines', gstRate: 28, category: 'Electronics', keywords: ['ac', 'air conditioner', 'split ac', 'window ac', 'inverter ac', 'daikin', 'voltas', 'carrier'] },
  { hsn: '8418', description: 'Refrigerators, freezers', gstRate: 18, category: 'Electronics', keywords: ['refrigerator', 'fridge', 'freezer', 'deep freezer', 'godrej', 'lg fridge', 'samsung fridge', 'whirlpool'] },
  { hsn: '8450', description: 'Household or laundry-type washing machines', gstRate: 18, category: 'Electronics', keywords: ['washing machine', 'washer', 'dryer', 'front load', 'top load', 'ifb', 'bosch'] },
  { hsn: '8516', description: 'Electric water heaters, hair dryers, irons', gstRate: 18, category: 'Electronics', keywords: ['iron', 'water heater', 'geyser', 'hair dryer', 'heater', 'microwave', 'oven', 'toaster'] },
  { hsn: '8518', description: 'Microphones, loudspeakers, headphones', gstRate: 18, category: 'Electronics', keywords: ['speaker', 'headphone', 'earphone', 'microphone', 'bluetooth speaker', 'jbl', 'bose', 'airpods', 'earbuds'] },
  { hsn: '8443', description: 'Printing machinery; printers', gstRate: 18, category: 'Electronics', keywords: ['printer', 'scanner', 'photocopier', 'laser printer', 'inkjet', 'hp printer', 'canon', 'epson'] },
  { hsn: '8504', description: 'Electrical transformers, converters', gstRate: 18, category: 'Electronics', keywords: ['transformer', 'inverter', 'ups', 'power supply', 'stabilizer', 'voltage regulator', 'converter', 'charger'] },
  { hsn: '8506', description: 'Primary cells and batteries', gstRate: 18, category: 'Electronics', keywords: ['battery', 'cell', 'duracell', 'eveready', 'lithium battery', 'alkaline'] },
  { hsn: '8507', description: 'Electric accumulators', gstRate: 28, category: 'Electronics', keywords: ['lithium ion', 'lead acid', 'battery pack', 'ev battery', 'power bank', 'rechargeable battery'] },
  { hsn: '8523', description: 'Discs, tapes, storage devices', gstRate: 18, category: 'Electronics', keywords: ['pendrive', 'usb', 'sd card', 'memory card', 'hard drive', 'ssd', 'external drive'] },
  { hsn: '8473', description: 'Computer parts and accessories', gstRate: 18, category: 'Electronics', keywords: ['keyboard', 'mouse', 'ram', 'processor', 'motherboard', 'gpu', 'graphics card', 'cpu', 'cabinet'] },
  { hsn: '8525', description: 'Transmission apparatus, cameras', gstRate: 18, category: 'Electronics', keywords: ['camera', 'dslr', 'cctv', 'webcam', 'gopro', 'video camera', 'security camera', 'surveillance'] },

  // ═══════════════════════════════════════════════════════
  // Textile
  // ═══════════════════════════════════════════════════════
  { hsn: '5208', description: 'Woven fabrics of cotton', gstRate: 5, category: 'Textile', keywords: ['cotton fabric', 'cotton cloth', 'woven cotton', 'cotton textile', 'kapda'] },
  { hsn: '5209', description: 'Woven fabrics of cotton, 200g/m² or more', gstRate: 5, category: 'Textile', keywords: ['heavy cotton', 'denim', 'canvas', 'twill', 'drill fabric'] },
  { hsn: '5407', description: 'Woven fabrics of synthetic filament yarn', gstRate: 5, category: 'Textile', keywords: ['polyester fabric', 'nylon fabric', 'synthetic cloth', 'synthetic fabric'] },
  { hsn: '6109', description: 'T-shirts, singlets and other vests, knitted', gstRate: 5, category: 'Textile', keywords: ['tshirt', 't-shirt', 'vest', 'tank top', 'singlet', 'innerwear'] },
  { hsn: '6110', description: 'Jerseys, pullovers, cardigans, waistcoats', gstRate: 12, category: 'Textile', keywords: ['sweater', 'pullover', 'cardigan', 'hoodie', 'jacket', 'jersey', 'sweatshirt'] },
  { hsn: '6203', description: 'Men\'s suits, trousers, shorts', gstRate: 12, category: 'Textile', keywords: ['suit', 'trouser', 'pant', 'shorts', 'formal wear', 'blazer', 'men clothing'] },
  { hsn: '6204', description: 'Women\'s suits, dresses, skirts', gstRate: 12, category: 'Textile', keywords: ['dress', 'skirt', 'kurti', 'saree', 'salwar', 'women clothing', 'lehnga', 'dupatta'] },
  { hsn: '6205', description: 'Men\'s shirts', gstRate: 12, category: 'Textile', keywords: ['shirt', 'formal shirt', 'casual shirt', 'polo', 'men shirt'] },
  { hsn: '6301', description: 'Blankets and travelling rugs', gstRate: 12, category: 'Textile', keywords: ['blanket', 'bedsheet', 'bed linen', 'comforter', 'duvet', 'quilt'] },
  { hsn: '6302', description: 'Bed linen, table linen, toilet linen', gstRate: 12, category: 'Textile', keywords: ['bedsheet', 'pillowcase', 'towel', 'table cloth', 'napkin', 'curtain'] },
  { hsn: '5601', description: 'Wadding of textile materials', gstRate: 12, category: 'Textile', keywords: ['cotton bale', 'raw cotton', 'ginned cotton', 'cotton wadding'] },
  { hsn: '6401', description: 'Waterproof footwear', gstRate: 18, category: 'Textile', keywords: ['shoes', 'boots', 'sandals', 'footwear', 'sneakers', 'slippers', 'chappal'] },

  // ═══════════════════════════════════════════════════════
  // Steel & Metals
  // ═══════════════════════════════════════════════════════
  { hsn: '7210', description: 'Flat-rolled products of iron or steel, coated', gstRate: 18, category: 'Steel', keywords: ['steel sheet', 'galvanized sheet', 'tin plate', 'coated steel', 'gi sheet', 'cr coil'] },
  { hsn: '7214', description: 'Bars and rods of iron or steel', gstRate: 18, category: 'Steel', keywords: ['steel bar', 'rebar', 'rod', 'tmt bar', 'iron rod', 'saria', 'reinforcement bar'] },
  { hsn: '7216', description: 'Angles, shapes and sections of iron or steel', gstRate: 18, category: 'Steel', keywords: ['angle', 'channel', 'beam', 'i beam', 'h beam', 'steel section', 'ms angle'] },
  { hsn: '7304', description: 'Tubes, pipes and profiles, seamless, of iron or steel', gstRate: 18, category: 'Steel', keywords: ['steel pipe', 'seamless pipe', 'steel tube', 'ms pipe', 'gi pipe'] },
  { hsn: '7306', description: 'Other tubes, pipes — welded', gstRate: 18, category: 'Steel', keywords: ['welded pipe', 'erw pipe', 'steel tube welded'] },
  { hsn: '7308', description: 'Structures of iron or steel', gstRate: 18, category: 'Steel', keywords: ['steel structure', 'fabrication', 'steel frame', 'tower', 'bridge', 'gate', 'railing'] },
  { hsn: '7318', description: 'Screws, bolts, nuts, washers of iron or steel', gstRate: 18, category: 'Steel', keywords: ['bolt', 'nut', 'screw', 'washer', 'fastener', 'rivet'] },
  { hsn: '7601', description: 'Unwrought aluminium', gstRate: 18, category: 'Steel', keywords: ['aluminium', 'aluminum', 'ingot', 'billet', 'aluminium ingot'] },
  { hsn: '7606', description: 'Aluminium plates, sheets', gstRate: 18, category: 'Steel', keywords: ['aluminium sheet', 'aluminum plate', 'aluminium foil', 'al sheet'] },
  { hsn: '7403', description: 'Refined copper and alloys', gstRate: 18, category: 'Steel', keywords: ['copper', 'copper wire', 'copper rod', 'copper cathode'] },

  // ═══════════════════════════════════════════════════════
  // Cement & Construction
  // ═══════════════════════════════════════════════════════
  { hsn: '2523', description: 'Portland cement, aluminous cement', gstRate: 28, category: 'Cement', keywords: ['cement', 'portland cement', 'ultratech', 'acc', 'ambuja', 'ppc', 'opc', 'white cement'] },
  { hsn: '6810', description: 'Articles of cement, concrete or artificial stone', gstRate: 28, category: 'Cement', keywords: ['concrete block', 'cement block', 'precast', 'paver', 'rcc', 'concrete', 'tile'] },
  { hsn: '6808', description: 'Panels, boards of vegetable fibre with cement', gstRate: 18, category: 'Cement', keywords: ['fibre board', 'cement board', 'particle board', 'gypsum board', 'drywall'] },
  { hsn: '2505', description: 'Natural sands', gstRate: 5, category: 'Cement', keywords: ['sand', 'river sand', 'm sand', 'construction sand', 'silica sand'] },
  { hsn: '2517', description: 'Pebbles, gravel, broken or crushed stone', gstRate: 5, category: 'Cement', keywords: ['gravel', 'aggregate', 'stone chips', 'crusher', 'gitti', 'jelly'] },
  { hsn: '6802', description: 'Worked stone and articles thereof', gstRate: 28, category: 'Cement', keywords: ['granite', 'marble', 'stone slab', 'counter top', 'natural stone'] },
  { hsn: '6907', description: 'Ceramic flags and paving; ceramic tiles', gstRate: 18, category: 'Cement', keywords: ['tile', 'ceramic tile', 'floor tile', 'wall tile', 'porcelain tile', 'vitrified tile', 'kajaria', 'somany'] },

  // ═══════════════════════════════════════════════════════
  // Agriculture
  // ═══════════════════════════════════════════════════════
  { hsn: '3105', description: 'Mineral or chemical fertilisers containing NPK', gstRate: 5, category: 'Agriculture', keywords: ['fertilizer', 'npk', 'urea', 'dap', 'potash', 'manure', 'compost'] },
  { hsn: '3808', description: 'Insecticides, fungicides, herbicides', gstRate: 18, category: 'Agriculture', keywords: ['pesticide', 'insecticide', 'herbicide', 'fungicide', 'weedicide', 'crop protection'] },
  { hsn: '1201', description: 'Soya beans', gstRate: 0, category: 'Agriculture', keywords: ['soybean', 'soya', 'soya bean'] },
  { hsn: '0802', description: 'Other nuts', gstRate: 5, category: 'Agriculture', keywords: ['cashew', 'almond', 'walnut', 'pistachio', 'peanut', 'groundnut', 'dry fruit'] },
  { hsn: '0805', description: 'Citrus fruit', gstRate: 0, category: 'Agriculture', keywords: ['orange', 'lemon', 'grapefruit', 'lime', 'nimbu', 'santra', 'citrus'] },
  { hsn: '0803', description: 'Bananas', gstRate: 0, category: 'Agriculture', keywords: ['banana', 'kela', 'plantain'] },
  { hsn: '0804', description: 'Dates, figs, pineapples, avocados, mangoes', gstRate: 0, category: 'Agriculture', keywords: ['mango', 'pineapple', 'date', 'fig', 'avocado', 'aam', 'papaya', 'guava'] },
  { hsn: '0701', description: 'Potatoes', gstRate: 0, category: 'Agriculture', keywords: ['potato', 'aloo', 'potatoes'] },
  { hsn: '0702', description: 'Tomatoes', gstRate: 0, category: 'Agriculture', keywords: ['tomato', 'tamatar', 'tomatoes'] },
  { hsn: '0703', description: 'Onions, garlic, leeks', gstRate: 0, category: 'Agriculture', keywords: ['onion', 'garlic', 'pyaaz', 'lehsun', 'shallot'] },
  { hsn: '1005', description: 'Maize (corn)', gstRate: 0, category: 'Agriculture', keywords: ['maize', 'corn', 'makka', 'cornmeal'] },
  { hsn: '1202', description: 'Groundnuts', gstRate: 0, category: 'Agriculture', keywords: ['groundnut', 'peanut', 'moongfali'] },
  { hsn: '5201', description: 'Cotton, not carded or combed', gstRate: 5, category: 'Agriculture', keywords: ['raw cotton', 'cotton bale', 'kapas', 'ginned cotton', 'unginned'] },
  { hsn: '2401', description: 'Unmanufactured tobacco', gstRate: 28, category: 'Agriculture', keywords: ['tobacco', 'tambaku', 'beedi leaves'] },

  // ═══════════════════════════════════════════════════════
  // Chemicals
  // ═══════════════════════════════════════════════════════
  { hsn: '2804', description: 'Hydrogen, rare gases and other non-metals', gstRate: 18, category: 'Chemicals', keywords: ['hydrogen', 'nitrogen', 'oxygen', 'industrial gas', 'argon', 'helium'] },
  { hsn: '2806', description: 'Hydrogen chloride; hydrochloric acid', gstRate: 18, category: 'Chemicals', keywords: ['hcl', 'hydrochloric acid', 'acid'] },
  { hsn: '2815', description: 'Sodium hydroxide; potassium hydroxide', gstRate: 18, category: 'Chemicals', keywords: ['caustic soda', 'naoh', 'sodium hydroxide', 'potassium hydroxide', 'lye'] },
  { hsn: '3208', description: 'Paints and varnishes based on synthetic polymers', gstRate: 28, category: 'Chemicals', keywords: ['paint', 'varnish', 'enamel', 'asian paints', 'berger', 'nerolac', 'wall paint', 'emulsion'] },
  { hsn: '3209', description: 'Paints and varnishes (aqueous)', gstRate: 18, category: 'Chemicals', keywords: ['water based paint', 'distemper', 'primer', 'putty'] },
  { hsn: '3214', description: 'Glaziers putty and similar mastics', gstRate: 28, category: 'Chemicals', keywords: ['putty', 'sealant', 'adhesive putty', 'wall putty', 'birla white'] },
  { hsn: '3506', description: 'Prepared glues and adhesives', gstRate: 18, category: 'Chemicals', keywords: ['glue', 'adhesive', 'fevicol', 'araldite', 'epoxy', 'super glue'] },
  { hsn: '3901', description: 'Polymers of ethylene, in primary forms', gstRate: 18, category: 'Chemicals', keywords: ['polyethylene', 'hdpe', 'ldpe', 'lldpe', 'pe granules', 'plastic raw material'] },
  { hsn: '3902', description: 'Polymers of propylene', gstRate: 18, category: 'Chemicals', keywords: ['polypropylene', 'pp', 'pp granules'] },
  { hsn: '3904', description: 'Polymers of vinyl chloride', gstRate: 18, category: 'Chemicals', keywords: ['pvc', 'polyvinyl chloride', 'pvc resin', 'pvc pipe', 'vinyl'] },
  { hsn: '3923', description: 'Articles for packaging, of plastics', gstRate: 18, category: 'Chemicals', keywords: ['plastic bag', 'bottle', 'container', 'drum', 'jerry can', 'packaging', 'pouch'] },

  // ═══════════════════════════════════════════════════════
  // Furniture
  // ═══════════════════════════════════════════════════════
  { hsn: '9401', description: 'Seats and chairs', gstRate: 18, category: 'Furniture', keywords: ['chair', 'office chair', 'sofa', 'couch', 'seat', 'stool', 'bench', 'recliner', 'revolving chair'] },
  { hsn: '9403', description: 'Other furniture', gstRate: 18, category: 'Furniture', keywords: ['table', 'desk', 'wardrobe', 'cabinet', 'shelf', 'bookshelf', 'cupboard', 'almirah', 'rack', 'bed', 'cot', 'dressing table'] },
  { hsn: '9404', description: 'Mattress supports; mattresses', gstRate: 18, category: 'Furniture', keywords: ['mattress', 'bed mattress', 'foam mattress', 'spring mattress', 'pillow', 'cushion', 'sleepwell', 'wakefit'] },
  { hsn: '4421', description: 'Other articles of wood', gstRate: 18, category: 'Furniture', keywords: ['wooden furniture', 'wood craft', 'wooden box', 'hanger', 'wooden article'] },
  { hsn: '4410', description: 'Particle board', gstRate: 18, category: 'Furniture', keywords: ['plywood', 'particle board', 'mdf', 'block board', 'laminate', 'greenply', 'century'] },

  // ═══════════════════════════════════════════════════════
  // Automobile Parts
  // ═══════════════════════════════════════════════════════
  { hsn: '8708', description: 'Parts and accessories for motor vehicles', gstRate: 28, category: 'Automobile Parts', keywords: ['auto parts', 'car parts', 'vehicle parts', 'bumper', 'fender', 'bonnet', 'mudguard', 'brake pad', 'clutch', 'axle'] },
  { hsn: '4011', description: 'New pneumatic rubber tyres', gstRate: 28, category: 'Automobile Parts', keywords: ['tyre', 'tire', 'mrf', 'ceat', 'apollo', 'bridgestone', 'jk tyre', 'radial tyre'] },
  { hsn: '4013', description: 'Inner tubes, of rubber', gstRate: 28, category: 'Automobile Parts', keywords: ['tube', 'inner tube', 'tyre tube'] },
  { hsn: '8407', description: 'Spark-ignition reciprocating engines', gstRate: 28, category: 'Automobile Parts', keywords: ['engine', 'petrol engine', 'motor', 'combustion engine'] },
  { hsn: '8408', description: 'Compression-ignition internal combustion piston engines', gstRate: 28, category: 'Automobile Parts', keywords: ['diesel engine', 'engine block'] },
  { hsn: '8409', description: 'Parts for engines', gstRate: 28, category: 'Automobile Parts', keywords: ['piston', 'cylinder', 'valve', 'gasket', 'crankshaft', 'camshaft', 'engine parts'] },
  { hsn: '8511', description: 'Electrical ignition or starting equipment', gstRate: 18, category: 'Automobile Parts', keywords: ['spark plug', 'ignition', 'starter motor', 'alternator', 'distributor'] },
  { hsn: '8512', description: 'Electrical lighting or signalling equipment', gstRate: 18, category: 'Automobile Parts', keywords: ['headlight', 'tail light', 'indicator', 'horn', 'wiper', 'car light'] },
  { hsn: '7009', description: 'Glass mirrors', gstRate: 18, category: 'Automobile Parts', keywords: ['mirror', 'side mirror', 'rear view mirror', 'glass mirror'] },
  { hsn: '8703', description: 'Motor cars and other motor vehicles', gstRate: 28, category: 'Automobile Parts', keywords: ['car', 'suv', 'sedan', 'hatchback', 'vehicle', 'maruti', 'hyundai', 'tata', 'mahindra'] },

  // ═══════════════════════════════════════════════════════
  // Machinery
  // ═══════════════════════════════════════════════════════
  { hsn: '8428', description: 'Other lifting, handling, loading or unloading machinery', gstRate: 18, category: 'Machinery', keywords: ['crane', 'hoist', 'conveyor', 'lift', 'forklift', 'elevator', 'escalator'] },
  { hsn: '8429', description: 'Self-propelled bulldozers, graders, scrapers', gstRate: 18, category: 'Machinery', keywords: ['bulldozer', 'excavator', 'jcb', 'backhoe', 'grader', 'earth mover', 'construction equipment'] },
  { hsn: '8430', description: 'Other moving, grading, levelling machinery', gstRate: 18, category: 'Machinery', keywords: ['boring machine', 'drilling machine', 'pile driver'] },
  { hsn: '8431', description: 'Parts for machinery of heading 8425 to 8430', gstRate: 18, category: 'Machinery', keywords: ['crane parts', 'excavator parts', 'heavy equipment parts'] },
  { hsn: '8413', description: 'Pumps; liquid elevators', gstRate: 18, category: 'Machinery', keywords: ['pump', 'water pump', 'submersible pump', 'centrifugal pump', 'hydraulic pump'] },
  { hsn: '8414', description: 'Air or vacuum pumps; compressors', gstRate: 18, category: 'Machinery', keywords: ['compressor', 'air compressor', 'blower', 'fan', 'exhaust fan', 'industrial fan'] },
  { hsn: '8422', description: 'Dish washing machines; filling, sealing, labelling machinery', gstRate: 18, category: 'Machinery', keywords: ['packaging machine', 'filling machine', 'sealing machine', 'labelling machine', 'bottling'] },
  { hsn: '8424', description: 'Mechanical appliances for projecting, dispersing liquids or powders', gstRate: 18, category: 'Machinery', keywords: ['sprayer', 'fire extinguisher', 'spray gun', 'agricultural sprayer'] },
  { hsn: '8432', description: 'Agricultural, horticultural or forestry machinery', gstRate: 12, category: 'Machinery', keywords: ['tractor', 'plough', 'harvester', 'seeder', 'cultivator', 'farm equipment', 'thresher'] },
  { hsn: '8433', description: 'Harvesting or threshing machinery', gstRate: 12, category: 'Machinery', keywords: ['combine harvester', 'reaper', 'mower', 'hay baler'] },
  { hsn: '8438', description: 'Machinery for food or drink preparation', gstRate: 18, category: 'Machinery', keywords: ['food processing', 'flour mill', 'oil mill', 'mixer', 'grinder', 'juicer', 'food machine'] },
  { hsn: '8441', description: 'Machinery for making up paper pulp, paper or paperboard', gstRate: 18, category: 'Machinery', keywords: ['paper machine', 'cutting machine', 'die cutting'] },
  { hsn: '8462', description: 'Machine-tools for working metal, forging, bending', gstRate: 18, category: 'Machinery', keywords: ['press', 'hydraulic press', 'forging machine', 'bending machine', 'power press'] },
  { hsn: '8501', description: 'Electric motors and generators', gstRate: 18, category: 'Machinery', keywords: ['motor', 'electric motor', 'generator', 'dynamo', 'dg set', 'diesel generator'] },

  // ═══════════════════════════════════════════════════════
  // Pharma / Medical
  // ═══════════════════════════════════════════════════════
  { hsn: '3004', description: 'Medicaments for therapeutic or prophylactic uses', gstRate: 12, category: 'FMCG', keywords: ['medicine', 'tablet', 'capsule', 'syrup', 'pharmaceutical', 'drug', 'paracetamol', 'antibiotic'] },
  { hsn: '3005', description: 'Wadding, gauze, bandages and similar articles', gstRate: 12, category: 'FMCG', keywords: ['bandage', 'gauze', 'plaster', 'surgical dressing', 'first aid'] },
  { hsn: '9018', description: 'Instruments used in medical or surgical sciences', gstRate: 12, category: 'Machinery', keywords: ['syringe', 'stethoscope', 'medical device', 'surgical instrument', 'blood pressure monitor'] },

  // ═══════════════════════════════════════════════════════
  // Paper / Packaging
  // ═══════════════════════════════════════════════════════
  { hsn: '4802', description: 'Uncoated paper for writing or printing', gstRate: 12, category: 'FMCG', keywords: ['paper', 'a4 paper', 'printing paper', 'writing paper', 'copier paper'] },
  { hsn: '4819', description: 'Cartons, boxes, cases, bags of paper', gstRate: 18, category: 'FMCG', keywords: ['carton', 'cardboard box', 'corrugated box', 'packaging box', 'paper bag'] },
  { hsn: '4901', description: 'Printed books, brochures, leaflets', gstRate: 0, category: 'FMCG', keywords: ['book', 'textbook', 'novel', 'magazine', 'brochure', 'leaflet', 'printed material'] },

  // ═══════════════════════════════════════════════════════
  // Miscellaneous
  // ═══════════════════════════════════════════════════════
  { hsn: '2710', description: 'Petroleum oils (diesel, petrol, kerosene, lubricants)', gstRate: 18, category: 'Chemicals', keywords: ['diesel', 'petrol', 'lubricant', 'engine oil', 'fuel', 'kerosene', 'petroleum', 'motor oil'] },
  { hsn: '2711', description: 'Petroleum gases (LPG, CNG)', gstRate: 5, category: 'Chemicals', keywords: ['lpg', 'cng', 'gas cylinder', 'cooking gas', 'propane', 'butane'] },
  { hsn: '7013', description: 'Glassware for table, kitchen, toilet, office', gstRate: 18, category: 'Furniture', keywords: ['glass', 'glassware', 'bottle', 'jar', 'tumbler', 'glass container'] },
  { hsn: '6911', description: 'Tableware, kitchenware of porcelain or china', gstRate: 12, category: 'Furniture', keywords: ['crockery', 'plate', 'cup', 'saucer', 'dinner set', 'porcelain', 'ceramic'] },
  { hsn: '7323', description: 'Table, kitchen articles of iron or steel', gstRate: 18, category: 'Furniture', keywords: ['utensil', 'steel utensil', 'pot', 'pan', 'pressure cooker', 'kadhai', 'tawa', 'stainless steel'] },
  { hsn: '9503', description: 'Tricycles, scooters and similar toys; puzzles', gstRate: 12, category: 'FMCG', keywords: ['toy', 'toys', 'game', 'puzzle', 'doll', 'lego', 'board game', 'action figure'] },
  { hsn: '9506', description: 'Articles for gymnastics, athletics, sports', gstRate: 18, category: 'FMCG', keywords: ['sports', 'cricket bat', 'football', 'basketball', 'gym equipment', 'dumbbell', 'badminton', 'racket'] },
  { hsn: '9608', description: 'Ball point pens', gstRate: 18, category: 'FMCG', keywords: ['pen', 'ball pen', 'stationery', 'pencil', 'marker', 'highlighter'] },
  { hsn: '8539', description: 'Electric filament or discharge lamps', gstRate: 18, category: 'Electronics', keywords: ['bulb', 'led bulb', 'tube light', 'cfl', 'lamp', 'led light', 'philips', 'syska', 'havells'] },
  { hsn: '8544', description: 'Insulated wire, cable', gstRate: 18, category: 'Electronics', keywords: ['wire', 'cable', 'electric wire', 'copper wire', 'data cable', 'polycab', 'havells wire', 'finolex'] },
  { hsn: '3926', description: 'Other articles of plastics', gstRate: 18, category: 'Chemicals', keywords: ['plastic', 'plastic product', 'tarpaulin', 'raincoat', 'pvc product', 'plastic container'] },
];

// ═══════════════════════════════════════════════════════════════════
// SYNONYM MAP — Maps common Indian / alternate terms to standard keywords
// This is how the system "understands" what you mean even with regional terms
// ═══════════════════════════════════════════════════════════════════
const SYNONYM_MAP: Record<string, string[]> = {
  // Hindi / Regional Food terms
  'chawal': ['rice'], 'gehu': ['wheat'], 'atta': ['flour', 'wheat flour'],
  'cheeni': ['sugar'], 'shakkar': ['sugar'], 'gur': ['jaggery', 'sugar'],
  'doodh': ['milk'], 'ghee': ['butter', 'milk'], 'makhan': ['butter', 'cream'],
  'sabzi': ['vegetables'], 'pyaaz': ['onion'], 'tamatar': ['tomato'],
  'lehsun': ['garlic'], 'adrak': ['ginger'], 'aloo': ['potato'],
  'nimbu': ['lemon', 'lime'], 'santra': ['orange'], 'kela': ['banana'],
  'aam': ['mango'], 'chai': ['tea'], 'daal': ['dal', 'lentil'],
  'mirch': ['chilli', 'pepper'], 'haldi': ['turmeric'], 'kesar': ['saffron'],
  'sarso': ['mustard'], 'til': ['sesame'], 'moongfali': ['groundnut', 'peanut'],
  'kapas': ['cotton'], 'kapda': ['cloth', 'fabric', 'textile'],
  'tambaku': ['tobacco'], 'supari': ['betel nut'],
  'masala': ['spice', 'condiment'], 'namak': ['salt'],
  
  // Common product aliases
  'ac': ['air conditioner'], 'tv': ['television'], 'pc': ['computer'],
  'mobile': ['smartphone', 'phone'], 'fridge': ['refrigerator'],
  'bike': ['motorcycle'], 'scooter': ['motorcycle'], 'scooty': ['motorcycle'],
  'bulb': ['led bulb', 'lamp'], 'fan': ['electric fan'],
  'cooler': ['air cooler'], 'heater': ['water heater'],
  'charger': ['power supply', 'converter'],
  'earphones': ['earphone', 'headphone'], 'buds': ['earbuds', 'earphone'],
  'pendrive': ['usb', 'storage device'], 'harddisk': ['hard drive', 'ssd'],
  
  // Construction / Industrial
  'saria': ['tmt bar', 'rebar', 'steel bar'], 'gitti': ['gravel', 'aggregate'],
  'bajri': ['sand', 'gravel'], 'lakdi': ['wood', 'timber'],
  'ply': ['plywood'], 'pipe': ['steel pipe', 'pvc pipe'],
  'taar': ['wire', 'cable'],
  
  // Packaging
  'dabba': ['box', 'container'], 'bori': ['bag', 'sack'],
  'thela': ['cart'], 'peti': ['carton', 'box'],
};

/**
 * Levenshtein Distance — measures how many single-character edits needed
 * to change one word into another. Used for typo tolerance.
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Bigram Similarity — breaks words into character pairs and compares overlap.
 * "rice" → ["ri","ic","ce"], "rise" → ["ri","is","se"] → overlap = 1/5 = 0.2
 * Good for catching partial/phonetic matches.
 */
function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  
  const getBigrams = (s: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) bigrams.add(s.slice(i, i + 2));
    return bigrams;
  };
  
  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);
  let intersection = 0;
  bigramsA.forEach(bg => { if (bigramsB.has(bg)) intersection++; });
  
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * Expand synonyms — converts regional/alternate terms to standard keywords
 */
function expandSynonyms(terms: string[]): string[] {
  const expanded = [...terms];
  for (const term of terms) {
    const synonyms = SYNONYM_MAP[term];
    if (synonyms) expanded.push(...synonyms);
  }
  return [...new Set(expanded)];
}

/**
 * Smart HSN Search — Multi-layered intelligent matching
 * 
 * Layer 1: Exact HSN code match (highest priority)
 * Layer 2: Exact keyword match
 * Layer 3: Synonym expansion (Hindi/regional → English)
 * Layer 4: Starts-with / Contains match on keywords
 * Layer 5: Description word matching
 * Layer 6: Fuzzy matching via Levenshtein distance (typo tolerance)
 * Layer 7: Bigram similarity (phonetic/partial matches)
 * Layer 8: Category bonus
 */
export function searchHSN(query: string, category?: string): HSNEntry[] {
  if (!query || query.trim().length < 2) return [];
  
  const rawTerms = query.toLowerCase().trim().split(/\s+/);
  const terms = expandSynonyms(rawTerms);
  
  let results = HSN_DATABASE.map(entry => {
    let score = 0;
    
    // ── Layer 1: Exact HSN code match ──────────────────
    if (entry.hsn.startsWith(query.trim())) {
      score += 200;
    }
    
    // ── Layer 2-7: Check each search term ──────────────
    for (const term of terms) {
      if (term.length < 2) continue;
      
      // Layer 2: Exact keyword match
      if (entry.keywords.some(k => k === term)) {
        score += 60;
        continue;
      }
      
      // Layer 3: Keyword starts-with
      if (entry.keywords.some(k => k.startsWith(term) || term.startsWith(k))) {
        score += 40;
        continue;
      }
      
      // Layer 4: Keyword contains
      if (entry.keywords.some(k => k.includes(term) || term.includes(k))) {
        score += 25;
        continue;
      }
      
      // Layer 5: Description word match
      const descWords = entry.description.toLowerCase().split(/[\s,;()]+/);
      if (descWords.some(w => w === term || w.startsWith(term))) {
        score += 20;
        continue;
      }
      if (entry.description.toLowerCase().includes(term)) {
        score += 12;
        continue;
      }
      
      // Layer 6: Fuzzy match via Levenshtein (typo tolerance)
      // Only for terms >= 3 chars to avoid false positives
      if (term.length >= 3) {
        const maxDist = term.length <= 4 ? 1 : 2; // Allow 1 typo for short words, 2 for longer
        const fuzzyKeywordMatch = entry.keywords.some(k => {
          if (Math.abs(k.length - term.length) > maxDist) return false;
          return levenshtein(k, term) <= maxDist;
        });
        if (fuzzyKeywordMatch) {
          score += 15;
          continue;
        }
        
        // Also check description words
        const fuzzyDescMatch = descWords.some(w => {
          if (w.length < 3 || Math.abs(w.length - term.length) > maxDist) return false;
          return levenshtein(w, term) <= maxDist;
        });
        if (fuzzyDescMatch) {
          score += 8;
          continue;
        }
      }
      
      // Layer 7: Bigram similarity (phonetic matches)
      if (term.length >= 3) {
        const bestBigramScore = Math.max(
          ...entry.keywords.map(k => bigramSimilarity(k, term)),
          ...descWords.filter(w => w.length >= 3).map(w => bigramSimilarity(w, term))
        );
        if (bestBigramScore >= 0.5) {
          score += Math.round(bestBigramScore * 20);
        }
      }
    }
    
    // ── Layer 8: Category bonus ────────────────────────
    if (category && entry.category.toLowerCase() === category.toLowerCase()) {
      score += 25;
    }
    
    return { ...entry, score };
  })
  .filter(e => e.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 8);
  
  return results;
}

