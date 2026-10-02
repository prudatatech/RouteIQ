-- Goods master for load posting (docs/load-posting-design.md section 1, PRD sections 3, 5, 7.1, 12 and 13).
--
--  1. public.hsn_codes (the table already exists and is unused) gets: gst_rates (one rate, or several for multi-rate
--     codes; gst_rate stays the default), rate_note, synonyms, is_hazmat, is_perishable, eway_always (hazardous goods
--     need an e-way bill at any value), effective_from, needs_review and source. category now holds a
--     goods_categories.key.
--  2. public.goods_categories (PRD 3.3), public.vehicle_classes (PRD 7.1; the key doubles as the pricing
--     vehicle_type, rate_per_km_<key>), public.pincode_prefixes (the first 3 digits of a pin code -> GST state) and
--     public.pincodes (full pin code -> district and state; empty until the owner imports the India Post directory).
--  3. Row-level security: everybody (anon and authenticated) reads; platform admins write (app.is_platform_admin()).
--  4. Seed data, every statement ON CONFLICT DO NOTHING so an admin's edits survive a re-run:
--       - the PRD section 13 top-50 freight goods, the 150 entries of frontend/src/utils/hsnDatabase.ts, and the
--         hazmat chapter 36 rows the PRD category table asks for (3602, 3604);
--       - the 17 goods categories of PRD 3.3 and the 9 vehicle classes of PRD 7.1;
--       - the 3-digit pin prefix -> state map (Indian postal circles).
--
-- GST RATES: the PRD rates, and the frontend ones, PREDATE GST 2.0 (effective 22 Sep 2025; slabs 5 / 18 / 40, the 12%
-- and 28% slabs went away). Every seeded rate therefore carries needs_review = true. A platform admin reviews them in
-- the admin console, or reloads the whole master with backend-ts/scripts/import-hsn.ts from the CBIC list.
--
-- Pin prefixes: a prefix that is shared by two states (160 Chandigarh/Punjab, 396 Gujarat/Daman, 605 Puducherry/Tamil
-- Nadu, 673 Kerala/Mahe, 682 Kerala/Lakshadweep) is left out on purpose: a wrong state would flip CGST+SGST to IGST.
-- Those resolve only once the full pincodes directory is imported.
--
-- Runs as app_owner where that role exists (Azure: the tables belong to it). Idempotent; safe to run again.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

-- ── 1. hsn_codes ────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.hsn_codes
  ADD COLUMN IF NOT EXISTS gst_rates     numeric(5,2)[],
  ADD COLUMN IF NOT EXISTS rate_note     text,
  ADD COLUMN IF NOT EXISTS synonyms      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_hazmat     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_perishable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eway_always   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS needs_review  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source        text;

-- One row per HSN code (already unique on a bootstrapped database; this makes sure on any other)
CREATE UNIQUE INDEX IF NOT EXISTS idx_hsn_codes_code ON public.hsn_codes (hsn_code);

-- ── 2. The other tables ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.goods_categories (
  key                       text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  name                      text NOT NULL,
  examples                  text,
  hsn_range                 text,
  default_rates             numeric(5,2)[] NOT NULL DEFAULT '{}',
  eway_threshold_inr        numeric(12,2) NOT NULL DEFAULT 50000 CHECK (eway_threshold_inr >= 0),
  is_hazmat                 boolean NOT NULL DEFAULT false,
  is_perishable             boolean NOT NULL DEFAULT false,
  recommended_vehicle_class text,
  sort                      integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.vehicle_classes (
  key           text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  name          text NOT NULL,
  min_t         numeric(6,2),
  max_t         numeric(6,2),
  best_for      text,
  notes         text,
  interstate_ok boolean NOT NULL DEFAULT true,
  is_reefer     boolean NOT NULL DEFAULT false,
  is_open       boolean NOT NULL DEFAULT false,
  is_tanker     boolean NOT NULL DEFAULT false,
  sort          integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.pincode_prefixes (
  prefix     text PRIMARY KEY CHECK (prefix ~ '^[0-9]{3}$'),
  state_code text NOT NULL CHECK (state_code ~ '^[0-9]{2}$'),   -- as in backend-ts/src/core/gst.ts
  state_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.pincodes (
  pincode    text PRIMARY KEY CHECK (pincode ~ '^[0-9]{6}$'),
  district   text,
  city       text,
  state_code text NOT NULL CHECK (state_code ~ '^[0-9]{2}$'),
  state_name text
);
CREATE INDEX IF NOT EXISTS idx_pincodes_state ON public.pincodes (state_code);

-- ── 3. Row-level security: public read, platform-admin write ─────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hsn_codes', 'goods_categories', 'vehicle_classes', 'pincode_prefixes', 'pincodes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_public_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t || '_public_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING ((SELECT app.is_platform_admin())) WITH CHECK ((SELECT app.is_platform_admin()))', t || '_admin_write', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role', t);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $$;

-- ── 4a. Goods categories (PRD 3.3) ──────────────────────────────────────────────────────────────────
INSERT INTO public.goods_categories (key, name, examples, hsn_range, default_rates, eway_threshold_inr, is_hazmat, is_perishable, recommended_vehicle_class, sort) VALUES
  ('textiles',         'Textiles & Garments',        'Fabric, readymade clothes, yarn',             '50-63',          ARRAY[5, 12]::numeric[],      50000, false, false, 'truck_17_20ft',     10),
  ('food_agri',        'Food & Agriculture',         'Rice, wheat, vegetables, spices',             '01-24',          ARRAY[0, 5]::numeric[],       50000, false, false, 'truck_17_20ft',     20),
  ('fmcg',             'FMCG / Consumer Goods',      'Soaps, toiletries, packaged food',            '33-34, 21',      ARRAY[12, 18]::numeric[],     50000, false, false, 'truck_14ft',        30),
  ('pharma',           'Pharmaceuticals',            'Medicines, medical devices',                  '30, 90',         ARRAY[5, 12]::numeric[],      50000, false, false, 'truck_14ft',        40),
  ('auto_parts',       'Auto Parts & Components',    'Engine parts, tyres, accessories',            '87, 40',         ARRAY[18, 28]::numeric[],     50000, false, false, 'truck_17_20ft',     50),
  ('electronics',      'Electronics & IT Hardware',  'Mobiles, laptops, components',                '84-85',          ARRAY[18]::numeric[],         50000, false, false, 'container_20ft',    60),
  ('steel_metal',      'Steel & Metal Products',     'Bars, sheets, pipes, coils',                  '72-73',          ARRAY[18]::numeric[],         50000, false, false, 'flatbed',           70),
  ('chemicals',        'Chemicals',                  'Industrial chemicals, dyes, paints',          '28-38',          ARRAY[18]::numeric[],         50000, false, false, 'container_20ft',    80),
  ('plastics_rubber',  'Plastics & Rubber',          'PVC pipes, sheets, raw plastic',              '39-40',          ARRAY[12, 18]::numeric[],     50000, false, false, 'truck_17_20ft',     90),
  ('paper_packaging',  'Paper & Packaging',          'Boxes, cartons, paper rolls',                 '48-49',          ARRAY[12, 18]::numeric[],     50000, false, false, 'truck_17_20ft',    100),
  ('furniture_wood',   'Furniture & Wood',           'Wooden furniture, MDF, plywood',              '44, 94',         ARRAY[12, 18, 28]::numeric[], 50000, false, false, 'truck_17_20ft',    110),
  ('machinery',        'Machinery & Equipment',      'Industrial machines, tools',                  '84-85',          ARRAY[18]::numeric[],         50000, false, false, 'flatbed',          120),
  ('construction',     'Construction Materials',     'Cement, bricks, TMT bars',                    '25, 68, 72',     ARRAY[12, 18]::numeric[],     50000, false, false, 'flatbed',          130),
  ('perishables',      'Perishables / Cold Chain',   'Fish, meat, dairy, vegetables',               '02-08, 16',      ARRAY[0, 5]::numeric[],       50000, false, true,  'reefer',           140),
  ('hazmat',           'Hazardous Goods',            'Chemicals, explosives, gas cylinders',        '28, 36',         ARRAY[18]::numeric[],             0, true,  false, 'container_20ft',   150),
  ('ecommerce_returns','E-Commerce Returns',         'Mixed consumer goods returns',                'Various',        '{}'::numeric[],              50000, false, false, 'truck_14ft',       160),
  ('exempt',           'Exempt / Nil Rated',         'Fresh vegetables, milk, eggs, newspapers',    '01-04, 49',      ARRAY[0]::numeric[],          50000, false, false, 'truck_17_20ft',    170),
  ('general',          'General goods',              'Anything not listed above',                   NULL,             '{}'::numeric[],              50000, false, false, 'truck_17_20ft',    999)
ON CONFLICT (key) DO NOTHING;

-- ── 4b. Vehicle classes (PRD 7.1) ───────────────────────────────────────────────────────────────────
INSERT INTO public.vehicle_classes (key, name, min_t, max_t, best_for, notes, interstate_ok, is_reefer, is_open, is_tanker, sort) VALUES
  ('mini_truck',         'Mini truck / Tata Ace',   0.5,  1.5,  'Local, intra-city, small PTL loads',                    'Cannot run interstate without permit',        false, false, false, false, 10),
  ('truck_14ft',         'Medium truck (14 ft)',    2,    4,    'Short distance interstate, PTL',                      'Common in FMCG distribution',                 true,  false, false, false, 20),
  ('truck_17_20ft',      'Large truck (17-20 ft)',  5,    7,    'Mid-distance interstate, FTL',                        NULL,                                          true,  false, false, false, 30),
  ('container_20ft',     'Container (20 ft)',       10,   12,   'Secure goods, interstate FTL',                        'Weather protected',                           true,  false, false, false, 40),
  ('container_32ft_sxl', 'Container (32 ft / SXL)', 15,   18,   'High-volume FTL interstate',                         'Most common long-haul vehicle',               true,  false, false, false, 50),
  ('flatbed',            'Flatbed / Open truck',    10,   20,   'Construction, steel, machinery, ODC',                 'No weather protection',                       true,  false, true,  false, 60),
  ('reefer',             'Reefer / Cold chain',     5,    15,   'Perishables, pharma, dairy',                          'Temperature-controlled',                      true,  true,  false, false, 70),
  ('trailer_40ft',       'Trailer (40 ft)',         20,   25,   'Heavy machinery, large FTL',                          'Requires special route clearance for some roads', true, false, false, false, 80),
  ('tanker',             'Tanker',                  NULL, NULL, 'Liquids, chemicals, fuel',                            'Specialized; not standard in open marketplace', true, false, false, true,  90)
ON CONFLICT (key) DO NOTHING;

-- ── 4c. Pin prefix -> state (the first 3 digits of a pin code; GST state codes) ─────────────────────────
INSERT INTO public.pincode_prefixes (prefix, state_code, state_name)
SELECT lpad(g::text, 3, '0'), r.code, r.name
FROM (VALUES
  (110, 110, '07', 'Delhi'),
  (121, 136, '06', 'Haryana'),
  (140, 159, '03', 'Punjab'),
  (171, 177, '02', 'Himachal Pradesh'),
  (180, 185, '01', 'Jammu and Kashmir'),
  (190, 193, '01', 'Jammu and Kashmir'),
  (194, 194, '38', 'Ladakh'),
  (201, 245, '09', 'Uttar Pradesh'),
  (246, 246, '05', 'Uttarakhand'),
  (247, 247, '09', 'Uttar Pradesh'),
  (248, 249, '05', 'Uttarakhand'),
  (250, 261, '09', 'Uttar Pradesh'),
  (262, 263, '05', 'Uttarakhand'),
  (271, 285, '09', 'Uttar Pradesh'),
  (301, 345, '08', 'Rajasthan'),
  (360, 395, '24', 'Gujarat'),
  (400, 402, '27', 'Maharashtra'),
  (403, 403, '30', 'Goa'),
  (410, 416, '27', 'Maharashtra'),
  (421, 425, '27', 'Maharashtra'),
  (431, 445, '27', 'Maharashtra'),
  (450, 488, '23', 'Madhya Pradesh'),
  (490, 497, '22', 'Chhattisgarh'),
  (500, 509, '36', 'Telangana'),
  (515, 535, '37', 'Andhra Pradesh'),
  (560, 577, '29', 'Karnataka'),
  (580, 591, '29', 'Karnataka'),
  (600, 604, '33', 'Tamil Nadu'),
  (606, 643, '33', 'Tamil Nadu'),
  (670, 672, '32', 'Kerala'),
  (674, 681, '32', 'Kerala'),
  (683, 695, '32', 'Kerala'),
  (700, 736, '19', 'West Bengal'),
  (737, 737, '11', 'Sikkim'),
  (741, 743, '19', 'West Bengal'),
  (744, 744, '35', 'Andaman and Nicobar Islands'),
  (751, 770, '21', 'Odisha'),
  (781, 788, '18', 'Assam'),
  (790, 792, '12', 'Arunachal Pradesh'),
  (793, 794, '17', 'Meghalaya'),
  (795, 795, '14', 'Manipur'),
  (796, 796, '15', 'Mizoram'),
  (797, 798, '13', 'Nagaland'),
  (799, 799, '16', 'Tripura'),
  (800, 813, '10', 'Bihar'),
  (814, 816, '20', 'Jharkhand'),
  (821, 821, '10', 'Bihar'),
  (822, 822, '20', 'Jharkhand'),
  (823, 824, '10', 'Bihar'),
  (825, 835, '20', 'Jharkhand'),
  (841, 855, '10', 'Bihar')
) AS r(lo, hi, code, name), generate_series(r.lo, r.hi) AS g
ON CONFLICT (prefix) DO NOTHING;

-- ── 4d. HSN codes: PRD section 13 + frontend/src/utils/hsnDatabase.ts (+ chapter 36 hazmat rows) ──────
-- needs_review = true on every row: these rates predate GST 2.0 (22 Sep 2025). is_hazmat rows need an e-way bill at
-- any value (eway_always).
INSERT INTO public.hsn_codes
  (hsn_code, description, gst_rate, gst_rates, rate_note, category, keywords, synonyms, is_hazmat, is_perishable, eway_always, source, needs_review) VALUES
  ('0401', 'Milk and cream, not concentrated', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['milk', 'cream', 'dairy', 'amul', 'doodh', 'fresh milk'], '{}'::text[], false, true, false, 'frontend-hsn-v1', true),
  ('0402', 'Milk and cream, concentrated or sweetened', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['condensed milk', 'milk powder', 'skimmed milk', 'evaporated'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('0406', 'Cheese and curd', 12, ARRAY[12]::numeric[], NULL, 'perishables', ARRAY['cheese', 'paneer', 'curd', 'cottage cheese', 'mozzarella'], '{}'::text[], false, true, false, 'frontend-hsn-v1', true),
  ('0701', 'Potatoes', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['potato', 'aloo', 'potatoes'], '{}'::text[], false, true, false, 'frontend-hsn-v1', true),
  ('0702', 'Tomatoes', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['tomato', 'tamatar', 'tomatoes'], '{}'::text[], false, true, false, 'frontend-hsn-v1', true),
  ('0703', 'Onions, garlic, leeks', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['onion', 'garlic', 'pyaaz', 'lehsun', 'shallot'], '{}'::text[], false, true, false, 'frontend-hsn-v1', true),
  ('0713', 'Dried leguminous vegetables (pulses)', 0, ARRAY[0]::numeric[], NULL, 'food_agri', ARRAY['dal', 'daal', 'lentil', 'pulses', 'moong', 'toor', 'chana', 'masoor', 'urad', 'rajma'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('0802', 'Other nuts', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['cashew', 'almond', 'walnut', 'pistachio', 'peanut', 'groundnut', 'dry fruit'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('0803', 'Bananas', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['banana', 'kela', 'plantain'], '{}'::text[], false, true, false, 'frontend-hsn-v1', true),
  ('0804', 'Dates, figs, pineapples, avocados, mangoes', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['mango', 'pineapple', 'date', 'fig', 'avocado', 'aam', 'papaya', 'guava'], '{}'::text[], false, true, false, 'frontend-hsn-v1', true),
  ('0805', 'Citrus fruit', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['orange', 'lemon', 'grapefruit', 'lime', 'nimbu', 'santra', 'citrus'], '{}'::text[], false, true, false, 'frontend-hsn-v1', true),
  ('0901', 'Coffee', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['coffee', 'instant coffee', 'nescafe', 'bru', 'coffee beans', 'filter coffee'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('0902', 'Tea', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['tea', 'chai', 'green tea', 'black tea', 'darjeeling', 'assam', 'brooke bond', 'tata tea', 'wagh bakri'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('0904', 'Pepper and chilli (spices, headings 0904 to 0910)', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['pepper', 'chilli', 'mirch', 'kali mirch', 'black pepper', 'spice'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('0910', 'Ginger, saffron, turmeric', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['ginger', 'saffron', 'turmeric', 'haldi', 'adrak', 'kesar', 'spice'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1001', 'Wheat and meslin', 0, ARRAY[0]::numeric[], 'Nil rated', 'food_agri', ARRAY['wheat', 'atta', 'flour', 'meslin', 'gehu'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('1005', 'Maize (corn)', 0, ARRAY[0]::numeric[], NULL, 'food_agri', ARRAY['maize', 'corn', 'makka', 'cornmeal'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1006', 'Rice', 0, ARRAY[0]::numeric[], 'Nil GST; no e-way bill if the value is under 50,000', 'food_agri', ARRAY['rice', 'basmati', 'biryani', 'sella', 'raw rice', 'parboiled'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('1101', 'Wheat or meslin flour', 0, ARRAY[0]::numeric[], 'Nil rated', 'food_agri', ARRAY['flour', 'atta', 'maida', 'wheat flour'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('1201', 'Soya beans', 0, ARRAY[0]::numeric[], NULL, 'food_agri', ARRAY['soybean', 'soya', 'soya bean'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1202', 'Groundnuts', 0, ARRAY[0]::numeric[], NULL, 'food_agri', ARRAY['groundnut', 'peanut', 'moongfali'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1507', 'Soya-bean oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['soybean oil', 'soya oil', 'cooking oil', 'edible oil'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1508', 'Groundnut oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['groundnut oil', 'peanut oil', 'cooking oil'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1509', 'Olive oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['olive oil', 'extra virgin'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1510', 'Other oils - Mustard, Sesame', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['mustard oil', 'sesame oil', 'til oil', 'sarso'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1511', 'Palm oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['palm oil', 'palmolein', 'cooking oil'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1512', 'Sunflower-seed or safflower oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['sunflower oil', 'safflower oil'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('1515', 'Other fixed vegetable fats and oils', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['coconut oil', 'linseed oil', 'castor oil'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('1604', 'Prepared or preserved fish', 12, ARRAY[12]::numeric[], NULL, 'perishables', ARRAY['canned fish', 'tuna', 'sardine', 'preserved fish'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1701', 'Cane or beet sugar', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['sugar', 'cheeni', 'cane sugar', 'beet sugar', 'jaggery'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('1704', 'Sugar confectionery', 18, ARRAY[18]::numeric[], NULL, 'food_agri', ARRAY['chocolate', 'candy', 'confectionery', 'toffee', 'sweet', 'cadbury', 'dairy milk', 'kit kat', 'gummy'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1901', 'Food preparations of flour, groats, meal, starch or malt extract', 18, ARRAY[18]::numeric[], NULL, 'food_agri', ARRAY['biscuit', 'cookie', 'cake', 'pastry', 'bread', 'rusk', 'noodles', 'pasta', 'instant noodles', 'maggi'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1905', 'Bread, pastry, cakes, biscuits', 18, ARRAY[18]::numeric[], NULL, 'food_agri', ARRAY['bread', 'pastry', 'cake', 'biscuits', 'cookies', 'rusk', 'parle', 'britannia'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('2005', 'Other vegetables prepared or preserved', 12, ARRAY[12]::numeric[], NULL, 'food_agri', ARRAY['pickles', 'achar', 'preserved vegetables', 'frozen vegetables'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('2103', 'Sauces and preparations; mixed condiments', 12, ARRAY[12]::numeric[], NULL, 'fmcg', ARRAY['sauce', 'ketchup', 'mustard', 'chutney', 'masala', 'maggi sauce', 'soy sauce'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('2104', 'Soups, broths and preparations thereof', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['soup', 'broth', 'knorr', 'maggi soup'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('2106', 'Food preparations not elsewhere specified', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['protein powder', 'health drink', 'supplement', 'bournvita', 'horlicks', 'complan'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('2201', 'Mineral waters and aerated waters', 18, ARRAY[18]::numeric[], NULL, 'food_agri', ARRAY['water', 'mineral water', 'packaged water', 'bisleri', 'aquafina', 'kinley'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('2202', 'Waters with added sugar or sweetened', 28, ARRAY[28]::numeric[], '28% plus compensation cess; high GST, common freight', 'food_agri', ARRAY['soft drink', 'cola', 'pepsi', 'coca cola', 'sprite', 'soda', 'energy drink', 'redbull', 'fanta', 'limca', 'thumbs up', 'aerated'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('2401', 'Unmanufactured tobacco', 28, ARRAY[28]::numeric[], NULL, 'food_agri', ARRAY['tobacco', 'tambaku', 'beedi leaves'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('2501', 'Salt (including table salt and denatured salt)', 0, ARRAY[0]::numeric[], NULL, 'food_agri', ARRAY['salt', 'namak', 'rock salt'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('2505', 'Natural sands', 5, ARRAY[5]::numeric[], NULL, 'construction', ARRAY['sand', 'river sand', 'm sand', 'construction sand', 'silica sand'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('2517', 'Pebbles, gravel, broken or crushed stone', 5, ARRAY[5]::numeric[], NULL, 'construction', ARRAY['gravel', 'aggregate', 'stone chips', 'crusher', 'gitti', 'jelly'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('2523', 'Portland cement, aluminous cement', 12, ARRAY[12, 28]::numeric[], '28% for bags over 25 kg', 'construction', ARRAY['cement', 'portland cement', 'ultratech', 'acc', 'ambuja', 'ppc', 'opc', 'white cement'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('2701', 'Coal; briquettes, ovoids and similar fuels made from coal', 5, ARRAY[5]::numeric[], NULL, 'chemicals', ARRAY['coal', 'coke', 'koyla', 'anthracite'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('2710', 'Petroleum oils (diesel, petrol, kerosene, lubricants)', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['diesel', 'petrol', 'lubricant', 'engine oil', 'fuel', 'kerosene', 'petroleum', 'motor oil'], '{}'::text[], true, false, true, 'frontend-hsn-v1', true),
  ('2711', 'Petroleum gases (LPG, CNG)', 5, ARRAY[5]::numeric[], 'Domestic use; commercial may differ', 'chemicals', ARRAY['lpg', 'cng', 'gas cylinder', 'cooking gas', 'propane', 'butane'], '{}'::text[], true, false, true, 'prd-v1', true),
  ('2801', 'Industrial chemicals (inorganic and organic), headings 2801 to 2942', 18, ARRAY[18]::numeric[], 'Some items 12%', 'chemicals', ARRAY['chemical', 'chemicals', 'industrial chemical', 'acid', 'solvent'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('2804', 'Hydrogen, rare gases and other non-metals', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['hydrogen', 'nitrogen', 'oxygen', 'industrial gas', 'argon', 'helium'], '{}'::text[], true, false, true, 'frontend-hsn-v1', true),
  ('2806', 'Hydrogen chloride; hydrochloric acid', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['hcl', 'hydrochloric acid', 'acid'], '{}'::text[], true, false, true, 'frontend-hsn-v1', true),
  ('2815', 'Sodium hydroxide; potassium hydroxide', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['caustic soda', 'naoh', 'sodium hydroxide', 'potassium hydroxide', 'lye'], '{}'::text[], true, false, true, 'frontend-hsn-v1', true),
  ('3004', 'Medicaments for therapeutic or prophylactic uses', 5, ARRAY[5, 12]::numeric[], 'Rate depends on the medicine; select the applicable one', 'pharma', ARRAY['medicine', 'tablet', 'capsule', 'syrup', 'pharmaceutical', 'drug', 'paracetamol', 'antibiotic'], ARRAY['medicine', 'medicines', 'medical', 'medication', 'pharma', 'generic medicine'], false, false, false, 'prd-v1', true),
  ('3005', 'Wadding, gauze, bandages and similar articles', 12, ARRAY[12]::numeric[], NULL, 'pharma', ARRAY['bandage', 'gauze', 'plaster', 'surgical dressing', 'first aid'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('3102', 'Mineral or chemical fertilisers, headings 3102 to 3105', 0, ARRAY[0, 5]::numeric[], 'Many exempt', 'food_agri', ARRAY['fertilizer', 'fertiliser', 'urea', 'dap', 'khad', 'npk'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('3105', 'Mineral or chemical fertilisers containing NPK', 0, ARRAY[0, 5]::numeric[], 'Many exempt', 'food_agri', ARRAY['fertilizer', 'npk', 'urea', 'dap', 'potash', 'manure', 'compost'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('3208', 'Paints and varnishes based on synthetic polymers (paints, headings 3208 to 3210)', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['paint', 'varnish', 'enamel', 'asian paints', 'berger', 'nerolac', 'wall paint', 'emulsion'], '{}'::text[], true, false, true, 'prd-v1', true),
  ('3209', 'Paints and varnishes (aqueous)', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['water based paint', 'distemper', 'primer', 'putty'], '{}'::text[], true, false, true, 'frontend-hsn-v1', true),
  ('3214', 'Glaziers putty and similar mastics', 28, ARRAY[28]::numeric[], NULL, 'chemicals', ARRAY['putty', 'sealant', 'adhesive putty', 'wall putty', 'birla white'], '{}'::text[], true, false, true, 'frontend-hsn-v1', true),
  ('3304', 'Beauty, make-up and skin-care preparations', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['cosmetics', 'cream', 'lotion', 'sunscreen', 'lipstick', 'foundation', 'moisturizer', 'face wash'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('3305', 'Preparations for use on the hair', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['shampoo', 'conditioner', 'hair oil', 'hair color', 'hair dye', 'clinic plus', 'head and shoulders'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('3306', 'Preparations for oral or dental hygiene', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['toothpaste', 'mouthwash', 'toothbrush', 'colgate', 'pepsodent', 'closeup', 'dental'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('3401', 'Soap and organic surface-active products', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['soap', 'detergent bar', 'bathing bar', 'lux', 'lifebuoy', 'dove'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('3402', 'Organic surface-active agents; washing preparations', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['detergent', 'washing powder', 'surf', 'ariel', 'tide', 'rin', 'liquid wash', 'fabric wash'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('3506', 'Prepared glues and adhesives', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['glue', 'adhesive', 'fevicol', 'araldite', 'epoxy', 'super glue'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('3602', 'Prepared explosives', 18, ARRAY[18]::numeric[], NULL, 'hazmat', ARRAY['explosive', 'dynamite', 'detonator'], '{}'::text[], true, false, true, 'prd-v1', true),
  ('3604', 'Fireworks, signalling flares and similar pyrotechnic articles', 18, ARRAY[18]::numeric[], NULL, 'hazmat', ARRAY['fireworks', 'crackers', 'firecracker', 'pataka', 'sparkler'], '{}'::text[], true, false, true, 'prd-v1', true),
  ('3808', 'Insecticides, fungicides, herbicides', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['pesticide', 'insecticide', 'herbicide', 'fungicide', 'weedicide', 'crop protection'], '{}'::text[], true, false, true, 'prd-v1', true),
  ('3901', 'Polymers of ethylene, in primary forms', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['polyethylene', 'hdpe', 'ldpe', 'lldpe', 'pe granules', 'plastic raw material'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('3902', 'Polymers of propylene', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['polypropylene', 'pp', 'pp granules'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('3904', 'Polymers of vinyl chloride', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['pvc', 'polyvinyl chloride', 'pvc resin', 'pvc pipe', 'vinyl'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('3917', 'Tubes, pipes and hoses of plastics (PVC pipes)', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['pvc pipe', 'pvc', 'plastic pipe', 'hdpe pipe', 'upvc'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('3923', 'Articles for packaging, of plastics', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['plastic bag', 'bottle', 'container', 'drum', 'jerry can', 'packaging', 'pouch'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('3926', 'Other articles of plastics', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['plastic', 'plastic product', 'tarpaulin', 'raincoat', 'pvc product', 'plastic container'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('4011', 'New pneumatic rubber tyres', 28, ARRAY[28]::numeric[], NULL, 'auto_parts', ARRAY['tyre', 'tire', 'mrf', 'ceat', 'apollo', 'bridgestone', 'jk tyre', 'radial tyre'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('4013', 'Inner tubes, of rubber', 28, ARRAY[28]::numeric[], NULL, 'auto_parts', ARRAY['tube', 'inner tube', 'tyre tube'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('4410', 'Particle board', 18, ARRAY[18]::numeric[], NULL, 'furniture_wood', ARRAY['plywood', 'particle board', 'mdf', 'block board', 'laminate', 'greenply', 'century'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('4412', 'Plywood, veneered panels and similar laminated wood', 12, ARRAY[12, 18]::numeric[], NULL, 'furniture_wood', ARRAY['plywood', 'ply', 'veneer', 'laminate', 'mdf'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('4421', 'Other articles of wood', 18, ARRAY[18]::numeric[], NULL, 'furniture_wood', ARRAY['wooden furniture', 'wood craft', 'wooden box', 'hanger', 'wooden article'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('4802', 'Uncoated paper for writing or printing', 12, ARRAY[12]::numeric[], NULL, 'paper_packaging', ARRAY['paper', 'a4 paper', 'printing paper', 'writing paper', 'copier paper'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('4818', 'Toilet paper, tissues, napkins, diapers', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['tissue', 'napkin', 'diaper', 'sanitary pad', 'toilet paper', 'pampers', 'huggies'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('4819', 'Cartons, boxes, cases, bags of paper', 12, ARRAY[12]::numeric[], NULL, 'paper_packaging', ARRAY['carton', 'cardboard box', 'corrugated box', 'packaging box', 'paper bag'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('4901', 'Printed books, brochures, leaflets', 0, ARRAY[0]::numeric[], 'Nil rated; no GST', 'paper_packaging', ARRAY['book', 'textbook', 'novel', 'magazine', 'brochure', 'leaflet', 'printed material'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('4902', 'Newspapers, journals and periodicals', 0, ARRAY[0]::numeric[], 'Nil rated; no GST', 'paper_packaging', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', true),
  ('5201', 'Cotton, not carded or combed', 5, ARRAY[5]::numeric[], NULL, 'textiles', ARRAY['raw cotton', 'cotton bale', 'kapas', 'ginned cotton', 'unginned'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('5208', 'Woven fabrics of cotton (cotton fabric, headings 5208 to 5212)', 5, ARRAY[5]::numeric[], NULL, 'textiles', ARRAY['cotton fabric', 'cotton cloth', 'woven cotton', 'cotton textile', 'kapda'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('5209', 'Woven fabrics of cotton, 200g/m² or more', 5, ARRAY[5]::numeric[], NULL, 'textiles', ARRAY['heavy cotton', 'denim', 'canvas', 'twill', 'drill fabric'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('5407', 'Woven fabrics of synthetic filament yarn', 5, ARRAY[5, 12]::numeric[], 'Synthetic fabric: 5% or 12% by type', 'textiles', ARRAY['polyester fabric', 'nylon fabric', 'synthetic cloth', 'synthetic fabric'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('5408', 'Woven fabrics of artificial filament yarn', 5, ARRAY[5, 12]::numeric[], 'Synthetic fabric: 5% or 12% by type', 'textiles', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', true),
  ('5601', 'Wadding of textile materials', 12, ARRAY[12]::numeric[], NULL, 'textiles', ARRAY['cotton bale', 'raw cotton', 'ginned cotton', 'cotton wadding'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('61', 'Articles of apparel and clothing accessories, knitted or crocheted (chapter 61)', 5, ARRAY[5, 12]::numeric[], '5% for garments up to 1,000 per piece, 12% above', 'textiles', ARRAY['knitwear', 'tshirt', 't-shirt', 'hosiery', 'innerwear'], ARRAY['clothes', 'clothing', 'garments', 'garment', 'apparel', 'readymade', 'ready made', 'dress', 'shirt', 'trousers', 'kapde', 'kurta', 'saree', 'jeans'], false, false, false, 'prd-v1', true),
  ('6109', 'T-shirts, singlets and other vests, knitted', 5, ARRAY[5]::numeric[], NULL, 'textiles', ARRAY['tshirt', 't-shirt', 'vest', 'tank top', 'singlet', 'innerwear'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('6110', 'Jerseys, pullovers, cardigans, waistcoats', 12, ARRAY[12]::numeric[], NULL, 'textiles', ARRAY['sweater', 'pullover', 'cardigan', 'hoodie', 'jacket', 'jersey', 'sweatshirt'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('62', 'Articles of apparel and clothing accessories, not knitted or crocheted (chapter 62)', 5, ARRAY[5, 12]::numeric[], '5% for garments up to 1,000 per piece, 12% above', 'textiles', ARRAY['woven garments', 'shirt', 'trouser', 'suit', 'formal wear'], ARRAY['clothes', 'clothing', 'garments', 'garment', 'apparel', 'readymade', 'ready made', 'dress', 'shirt', 'trousers', 'kapde', 'kurta', 'saree', 'jeans'], false, false, false, 'prd-v1', true),
  ('6203', 'Men''s suits, trousers, shorts', 12, ARRAY[12]::numeric[], NULL, 'textiles', ARRAY['suit', 'trouser', 'pant', 'shorts', 'formal wear', 'blazer', 'men clothing'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('6204', 'Women''s suits, dresses, skirts', 12, ARRAY[12]::numeric[], NULL, 'textiles', ARRAY['dress', 'skirt', 'kurti', 'saree', 'salwar', 'women clothing', 'lehnga', 'dupatta'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('6205', 'Men''s shirts', 12, ARRAY[12]::numeric[], NULL, 'textiles', ARRAY['shirt', 'formal shirt', 'casual shirt', 'polo', 'men shirt'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('6301', 'Blankets and travelling rugs', 12, ARRAY[12]::numeric[], NULL, 'textiles', ARRAY['blanket', 'bedsheet', 'bed linen', 'comforter', 'duvet', 'quilt'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('6302', 'Bed linen, table linen, toilet linen', 12, ARRAY[12]::numeric[], NULL, 'textiles', ARRAY['bedsheet', 'pillowcase', 'towel', 'table cloth', 'napkin', 'curtain'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('6401', 'Waterproof footwear', 5, ARRAY[5, 18]::numeric[], 'Footwear: 5% up to 1,000 per pair, 18% above; headings 6401 to 6405', 'textiles', ARRAY['shoes', 'boots', 'sandals', 'footwear', 'sneakers', 'slippers', 'chappal'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('6802', 'Worked stone and articles thereof', 28, ARRAY[28]::numeric[], NULL, 'construction', ARRAY['granite', 'marble', 'stone slab', 'counter top', 'natural stone'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('6808', 'Panels, boards of vegetable fibre with cement', 18, ARRAY[18]::numeric[], NULL, 'construction', ARRAY['fibre board', 'cement board', 'particle board', 'gypsum board', 'drywall'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('6810', 'Articles of cement, concrete or artificial stone', 28, ARRAY[28]::numeric[], NULL, 'construction', ARRAY['concrete block', 'cement block', 'precast', 'paver', 'rcc', 'concrete', 'tile'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('6901', 'Bricks', 12, ARRAY[12]::numeric[], NULL, 'construction', ARRAY['brick', 'bricks', 'eent', 'clay brick', 'fly ash brick'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('6907', 'Ceramic flags and paving; ceramic tiles', 28, ARRAY[28]::numeric[], NULL, 'construction', ARRAY['tile', 'ceramic tile', 'floor tile', 'wall tile', 'porcelain tile', 'vitrified tile', 'kajaria', 'somany'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('6911', 'Tableware, kitchenware of porcelain or china', 12, ARRAY[12]::numeric[], NULL, 'furniture_wood', ARRAY['crockery', 'plate', 'cup', 'saucer', 'dinner set', 'porcelain', 'ceramic'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7009', 'Glass mirrors', 18, ARRAY[18]::numeric[], NULL, 'auto_parts', ARRAY['mirror', 'side mirror', 'rear view mirror', 'glass mirror'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7013', 'Glassware for table, kitchen, toilet, office', 18, ARRAY[18]::numeric[], NULL, 'furniture_wood', ARRAY['glass', 'glassware', 'bottle', 'jar', 'tumbler', 'glass container'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7208', 'Flat-rolled products of iron or non-alloy steel (steel sheets), headings 7208 to 7212', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel sheet', 'sheet', 'coil', 'hr coil', 'cr coil', 'plate'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('7210', 'Flat-rolled products of iron or steel, coated', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel sheet', 'galvanized sheet', 'tin plate', 'coated steel', 'gi sheet', 'cr coil'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7213', 'Bars and rods, hot-rolled, in irregularly wound coils', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', true),
  ('7214', 'Bars and rods of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel bar', 'rebar', 'rod', 'tmt bar', 'iron rod', 'saria', 'reinforcement bar'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('7216', 'Angles, shapes and sections of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['angle', 'channel', 'beam', 'i beam', 'h beam', 'steel section', 'ms angle'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7304', 'Tubes, pipes and profiles, seamless, of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel pipe', 'seamless pipe', 'steel tube', 'ms pipe', 'gi pipe'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7306', 'Other tubes, pipes — welded', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['welded pipe', 'erw pipe', 'steel tube welded'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7308', 'Structures of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel structure', 'fabrication', 'steel frame', 'tower', 'bridge', 'gate', 'railing'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7318', 'Screws, bolts, nuts, washers of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['bolt', 'nut', 'screw', 'washer', 'fastener', 'rivet'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7323', 'Table, kitchen articles of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['utensil', 'steel utensil', 'pot', 'pan', 'pressure cooker', 'kadhai', 'tawa', 'stainless steel'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7403', 'Refined copper and alloys', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['copper', 'copper wire', 'copper rod', 'copper cathode'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('7408', 'Copper wire', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['copper wire', 'copper', 'tamba'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('7601', 'Unwrought aluminium (aluminium, headings 7601 to 7616)', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['aluminium', 'aluminum', 'ingot', 'billet', 'aluminium ingot'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('7606', 'Aluminium plates, sheets', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['aluminium sheet', 'aluminum plate', 'aluminium foil', 'al sheet'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8407', 'Spark-ignition reciprocating engines', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['engine', 'petrol engine', 'motor', 'combustion engine'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8408', 'Compression-ignition internal combustion piston engines', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['diesel engine', 'engine block'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8409', 'Parts for engines', 28, ARRAY[28]::numeric[], NULL, 'auto_parts', ARRAY['piston', 'cylinder', 'valve', 'gasket', 'crankshaft', 'camshaft', 'engine parts'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8413', 'Pumps; liquid elevators', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['pump', 'water pump', 'submersible pump', 'centrifugal pump', 'hydraulic pump'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8414', 'Air or vacuum pumps; compressors', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['compressor', 'air compressor', 'blower', 'fan', 'exhaust fan', 'industrial fan'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8415', 'Air conditioning machines', 28, ARRAY[28]::numeric[], NULL, 'electronics', ARRAY['ac', 'air conditioner', 'split ac', 'window ac', 'inverter ac', 'daikin', 'voltas', 'carrier'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8418', 'Refrigerators, freezers', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['refrigerator', 'fridge', 'freezer', 'deep freezer', 'godrej', 'lg fridge', 'samsung fridge', 'whirlpool'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8422', 'Dish washing machines; filling, sealing, labelling machinery', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['packaging machine', 'filling machine', 'sealing machine', 'labelling machine', 'bottling'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8424', 'Mechanical appliances for projecting, dispersing liquids or powders', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['sprayer', 'fire extinguisher', 'spray gun', 'agricultural sprayer'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8428', 'Other lifting, handling, loading or unloading machinery', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['crane', 'hoist', 'conveyor', 'lift', 'forklift', 'elevator', 'escalator'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8429', 'Self-propelled bulldozers, graders, scrapers', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['bulldozer', 'excavator', 'jcb', 'backhoe', 'grader', 'earth mover', 'construction equipment'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8430', 'Other moving, grading, levelling machinery', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['boring machine', 'drilling machine', 'pile driver'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8431', 'Parts for machinery of heading 8425 to 8430', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['crane parts', 'excavator parts', 'heavy equipment parts'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8432', 'Agricultural, horticultural or forestry machinery (agricultural machinery, headings 8432 to 8436)', 12, ARRAY[12]::numeric[], NULL, 'machinery', ARRAY['tractor', 'plough', 'harvester', 'seeder', 'cultivator', 'farm equipment', 'thresher'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8433', 'Harvesting or threshing machinery', 12, ARRAY[12]::numeric[], NULL, 'machinery', ARRAY['combine harvester', 'reaper', 'mower', 'hay baler'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8438', 'Machinery for food or drink preparation', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['food processing', 'flour mill', 'oil mill', 'mixer', 'grinder', 'juicer', 'food machine'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8441', 'Machinery for making up paper pulp, paper or paperboard', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['paper machine', 'cutting machine', 'die cutting'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8443', 'Printing machinery; printers', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['printer', 'scanner', 'photocopier', 'laser printer', 'inkjet', 'hp printer', 'canon', 'epson'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8450', 'Household or laundry-type washing machines', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['washing machine', 'washer', 'dryer', 'front load', 'top load', 'ifb', 'bosch'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8462', 'Machine-tools for working metal, forging, bending', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['press', 'hydraulic press', 'forging machine', 'bending machine', 'power press'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8471', 'Automatic data processing machines (computers)', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['computer', 'laptop', 'desktop', 'pc', 'server', 'dell', 'hp', 'lenovo', 'macbook', 'tablet', 'ipad'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8473', 'Computer parts and accessories', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['keyboard', 'mouse', 'ram', 'processor', 'motherboard', 'gpu', 'graphics card', 'cpu', 'cabinet'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8479', 'Machines and mechanical appliances having individual functions', 18, ARRAY[18]::numeric[], NULL, 'machinery', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8501', 'Electric motors and generators', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['motor', 'electric motor', 'generator', 'dynamo', 'dg set', 'diesel generator'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8504', 'Electrical transformers, converters', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['transformer', 'inverter', 'ups', 'power supply', 'stabilizer', 'voltage regulator', 'converter', 'charger'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8506', 'Primary cells and batteries', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['battery', 'cell', 'duracell', 'eveready', 'lithium battery', 'alkaline'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8507', 'Electric accumulators', 28, ARRAY[28]::numeric[], NULL, 'electronics', ARRAY['lithium ion', 'lead acid', 'battery pack', 'ev battery', 'power bank', 'rechargeable battery'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8511', 'Electrical ignition or starting equipment', 18, ARRAY[18]::numeric[], NULL, 'auto_parts', ARRAY['spark plug', 'ignition', 'starter motor', 'alternator', 'distributor'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8512', 'Electrical lighting or signalling equipment', 18, ARRAY[18]::numeric[], NULL, 'auto_parts', ARRAY['headlight', 'tail light', 'indicator', 'horn', 'wiper', 'car light'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8516', 'Electric water heaters, hair dryers, irons', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['iron', 'water heater', 'geyser', 'hair dryer', 'heater', 'microwave', 'oven', 'toaster'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8517', 'Telephone sets, smartphones', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['phone', 'smartphone', 'mobile', 'iphone', 'samsung', 'oneplus', 'vivo', 'oppo', 'realme', 'xiaomi', 'redmi', 'telephone'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8518', 'Microphones, loudspeakers, headphones', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['speaker', 'headphone', 'earphone', 'microphone', 'bluetooth speaker', 'jbl', 'bose', 'airpods', 'earbuds'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8521', 'Video recording or reproducing apparatus', 18, ARRAY[18, 28]::numeric[], NULL, 'electronics', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8523', 'Discs, tapes, storage devices', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['pendrive', 'usb', 'sd card', 'memory card', 'hard drive', 'ssd', 'external drive'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8525', 'Transmission apparatus, cameras', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['camera', 'dslr', 'cctv', 'webcam', 'gopro', 'video camera', 'security camera', 'surveillance'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8528', 'Monitors and projectors; television receivers', 18, ARRAY[18, 28]::numeric[], NULL, 'electronics', ARRAY['tv', 'television', 'monitor', 'led tv', 'lcd', 'oled', 'projector', 'smart tv', 'samsung tv', 'lg tv', 'sony'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8539', 'Electric filament or discharge lamps', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['bulb', 'led bulb', 'tube light', 'cfl', 'lamp', 'led light', 'philips', 'syska', 'havells'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8544', 'Insulated wire, cable', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['wire', 'cable', 'electric wire', 'copper wire', 'data cable', 'polycab', 'havells wire', 'finolex'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8701', 'Tractors', 12, ARRAY[12]::numeric[], NULL, 'machinery', ARRAY['tractor', 'farm tractor'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('8703', 'Motor cars and other motor vehicles', 28, ARRAY[28]::numeric[], NULL, 'auto_parts', ARRAY['car', 'suv', 'sedan', 'hatchback', 'vehicle', 'maruti', 'hyundai', 'tata', 'mahindra'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('8708', 'Parts and accessories for motor vehicles', 28, ARRAY[28]::numeric[], NULL, 'auto_parts', ARRAY['auto parts', 'car parts', 'vehicle parts', 'bumper', 'fender', 'bonnet', 'mudguard', 'brake pad', 'clutch', 'axle'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('9018', 'Instruments used in medical or surgical sciences', 12, ARRAY[12]::numeric[], NULL, 'pharma', ARRAY['syringe', 'stethoscope', 'medical device', 'surgical instrument', 'blood pressure monitor'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('9401', 'Seats and chairs', 18, ARRAY[18]::numeric[], NULL, 'furniture_wood', ARRAY['chair', 'office chair', 'sofa', 'couch', 'seat', 'stool', 'bench', 'recliner', 'revolving chair'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('9403', 'Other furniture', 18, ARRAY[18]::numeric[], NULL, 'furniture_wood', ARRAY['table', 'desk', 'wardrobe', 'cabinet', 'shelf', 'bookshelf', 'cupboard', 'almirah', 'rack', 'bed', 'cot', 'dressing table'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('9404', 'Mattress supports; mattresses', 18, ARRAY[18]::numeric[], NULL, 'furniture_wood', ARRAY['mattress', 'bed mattress', 'foam mattress', 'spring mattress', 'pillow', 'cushion', 'sleepwell', 'wakefit'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('9405', 'Luminaires and lighting fittings (LED lights)', 12, ARRAY[12]::numeric[], NULL, 'electronics', ARRAY['led', 'led light', 'light', 'lamp', 'tube light', 'lighting'], '{}'::text[], false, false, false, 'prd-v1', true),
  ('9503', 'Tricycles, scooters and similar toys; puzzles', 12, ARRAY[12]::numeric[], NULL, 'fmcg', ARRAY['toy', 'toys', 'game', 'puzzle', 'doll', 'lego', 'board game', 'action figure'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('9506', 'Articles for gymnastics, athletics, sports', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['sports', 'cricket bat', 'football', 'basketball', 'gym equipment', 'dumbbell', 'badminton', 'racket'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('9608', 'Ball point pens', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['pen', 'ball pen', 'stationery', 'pencil', 'marker', 'highlighter'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true)

ON CONFLICT (hsn_code) DO NOTHING;

-- Rows that were already there (an earlier import) get their rate list from the default rate
UPDATE public.hsn_codes SET gst_rates = ARRAY[gst_rate] WHERE gst_rates IS NULL;
