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
-- GST RATES: the seeded rates are the GST 2.0 ones (notification 9/2025-Central Tax (Rate) and its amendments, as in
-- supabase/seed/hsn_master.csv; docs/gst-rates.md). Migration 20261005010000_hsn_master_gst2.sql loads the full official
-- HSN list with those rates and corrects any row this file seeded earlier with the pre-GST 2.0 (12% / 28%) rates.
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
  ('textiles',         'Textiles & Garments',        'Fabric, readymade clothes, yarn',             '50-63',          ARRAY[5, 18]::numeric[],      50000, false, false, 'truck_17_20ft',     10),
  ('food_agri',        'Food & Agriculture',         'Rice, wheat, vegetables, spices',             '01-24',          ARRAY[0, 5]::numeric[],       50000, false, false, 'truck_17_20ft',     20),
  ('fmcg',             'FMCG / Consumer Goods',      'Soaps, toiletries, packaged food',            '33-34, 21',      ARRAY[5, 18]::numeric[],      50000, false, false, 'truck_14ft',        30),
  ('pharma',           'Pharmaceuticals',            'Medicines, medical devices',                  '30, 90',         ARRAY[0, 5]::numeric[],       50000, false, false, 'truck_14ft',        40),
  ('auto_parts',       'Auto Parts & Components',    'Engine parts, tyres, accessories',            '87, 40',         ARRAY[5, 18]::numeric[],      50000, false, false, 'truck_17_20ft',     50),
  ('electronics',      'Electronics & IT Hardware',  'Mobiles, laptops, components',                '84-85',          ARRAY[18]::numeric[],         50000, false, false, 'container_20ft',    60),
  ('steel_metal',      'Steel & Metal Products',     'Bars, sheets, pipes, coils',                  '72-73',          ARRAY[18]::numeric[],         50000, false, false, 'flatbed',           70),
  ('chemicals',        'Chemicals',                  'Industrial chemicals, dyes, paints',          '28-38',          ARRAY[18]::numeric[],         50000, false, false, 'container_20ft',    80),
  ('plastics_rubber',  'Plastics & Rubber',          'PVC pipes, sheets, raw plastic',              '39-40',          ARRAY[5, 18]::numeric[],      50000, false, false, 'truck_17_20ft',     90),
  ('paper_packaging',  'Paper & Packaging',          'Boxes, cartons, paper rolls',                 '48-49',          ARRAY[5, 18]::numeric[],      50000, false, false, 'truck_17_20ft',    100),
  ('furniture_wood',   'Furniture & Wood',           'Wooden furniture, MDF, plywood',              '44, 94',         ARRAY[5, 18]::numeric[],      50000, false, false, 'truck_17_20ft',    110),
  ('machinery',        'Machinery & Equipment',      'Industrial machines, tools',                  '84-85',          ARRAY[18]::numeric[],         50000, false, false, 'flatbed',          120),
  ('construction',     'Construction Materials',     'Cement, bricks, TMT bars',                    '25, 68, 72',     ARRAY[5, 18]::numeric[],      50000, false, false, 'flatbed',          130),
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
-- Rates as in supabase/seed/hsn_master.csv (GST 2.0); needs_review where that mapping is not certain. is_hazmat rows need
-- an e-way bill at any value (eway_always).
INSERT INTO public.hsn_codes
  (hsn_code, description, gst_rate, gst_rates, rate_note, category, keywords, synonyms, is_hazmat, is_perishable, eway_always, source, needs_review) VALUES
  ('0401', 'Milk and cream, not concentrated', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['milk', 'cream', 'dairy', 'amul', 'doodh', 'fresh milk'], '{}'::text[], false, true, false, 'frontend-hsn-v1', false),
  ('0402', 'Milk and cream, concentrated or sweetened', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['condensed milk', 'milk powder', 'skimmed milk', 'evaporated'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('0406', 'Cheese and curd', 5, ARRAY[0, 5]::numeric[], '5%: Cheese, other than chena or paneer; nil: Chena or paneer, whether or not pre-packaged and labelled', 'perishables', ARRAY['cheese', 'paneer', 'curd', 'cottage cheese', 'mozzarella'], '{}'::text[], false, true, false, 'frontend-hsn-v1', false),
  ('0701', 'Potatoes', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['potato', 'aloo', 'potatoes'], '{}'::text[], false, true, false, 'frontend-hsn-v1', false),
  ('0702', 'Tomatoes', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['tomato', 'tamatar', 'tomatoes'], '{}'::text[], false, true, false, 'frontend-hsn-v1', false),
  ('0703', 'Onions, garlic, leeks', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['onion', 'garlic', 'pyaaz', 'lehsun', 'shallot'], '{}'::text[], false, true, false, 'frontend-hsn-v1', false),
  ('0713', 'Dried leguminous vegetables (pulses)', 5, ARRAY[0, 5]::numeric[], '5%: Dried leguminous vegetables, shelled, whether or not skinned or split…; nil: Dried leguminous vegetables, shelled, whether or not skinned or split…', 'food_agri', ARRAY['dal', 'daal', 'lentil', 'pulses', 'moong', 'toor', 'chana', 'masoor', 'urad', 'rajma'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('0802', 'Other nuts', 5, ARRAY[0, 5]::numeric[], '5%: Dried areca nuts, whether or not shelled or peeled; Other nuts,…; 5%: Chestnuts (singhada), dried whether or not shelled or peeled; nil: Other nuts, fresh such as Almonds, Hazelnuts or filberts (Corylus…', 'food_agri', ARRAY['cashew', 'almond', 'walnut', 'pistachio', 'peanut', 'groundnut', 'dry fruit'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('0803', 'Bananas', 0, ARRAY[0]::numeric[], NULL, 'perishables', ARRAY['banana', 'kela', 'plantain'], '{}'::text[], false, true, false, 'frontend-hsn-v1', false),
  ('0804', 'Dates, figs, pineapples, avocados, mangoes', 5, ARRAY[0, 5]::numeric[], '5%: Dates (soft or hard), figs, pineapples, avocados, guavas, mangoes and…; nil: Dates, figs, pineapples, avocados, guavas, mangoes and mangosteens,…', 'perishables', ARRAY['mango', 'pineapple', 'date', 'fig', 'avocado', 'aam', 'papaya', 'guava'], '{}'::text[], false, true, false, 'frontend-hsn-v1', false),
  ('0805', 'Citrus fruit', 5, ARRAY[0, 5]::numeric[], '5%: Citrus fruit, such as Oranges, Mandarins (including tangerines and…; nil: Citrus fruit, such as Oranges, Mandarins (including tangerines and…', 'perishables', ARRAY['orange', 'lemon', 'grapefruit', 'lime', 'nimbu', 'santra', 'citrus'], '{}'::text[], false, true, false, 'frontend-hsn-v1', false),
  ('0901', 'Coffee', 5, ARRAY[0, 5]::numeric[], '5%: Coffee roasted, whether or not decaffeinated; coffee husks and skins;…; nil: Coffee beans, not roasted', 'food_agri', ARRAY['coffee', 'instant coffee', 'nescafe', 'bru', 'coffee beans', 'filter coffee'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('0902', 'Tea', 5, ARRAY[0, 5]::numeric[], '5%: Tea, whether or not flavoured [other than unprocessed green leaves of…; nil: Unprocessed green leaves of tea', 'food_agri', ARRAY['tea', 'chai', 'green tea', 'black tea', 'darjeeling', 'assam', 'brooke bond', 'tata tea', 'wagh bakri'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('0904', 'Pepper and chilli (spices, headings 0904 to 0910)', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['pepper', 'chilli', 'mirch', 'kali mirch', 'black pepper', 'spice'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('0910', 'Ginger, saffron, turmeric', 5, ARRAY[0, 5, 18]::numeric[], 'Rates differ by tariff item: nil (2 of 35), 5% (33 of 35), 18% (2 of 35); pick the 8-digit code', 'food_agri', ARRAY['ginger', 'saffron', 'turmeric', 'haldi', 'adrak', 'kesar', 'spice'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('1001', 'Wheat and meslin', 5, ARRAY[0, 5]::numeric[], '5%: Wheat and meslin, pre-packaged and labelled; nil: Wheat and meslin, other than pre-packaged and labelled', 'food_agri', ARRAY['wheat', 'atta', 'flour', 'meslin', 'gehu'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('1005', 'Maize (corn)', 5, ARRAY[0, 5]::numeric[], '5%: Maize (corn), pre-packaged and labelled; nil: Maize (corn), other than pre-packaged and labelled', 'food_agri', ARRAY['maize', 'corn', 'makka', 'cornmeal'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1006', 'Rice', 5, ARRAY[0, 5]::numeric[], '5%: Rice, pre-packaged and labelled; nil: Rice, other than pre-packaged and labelled', 'food_agri', ARRAY['rice', 'basmati', 'biryani', 'sella', 'raw rice', 'parboiled'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('1101', 'Wheat or meslin flour', 5, ARRAY[0, 5]::numeric[], '5%: Wheat or meslin flour, pre-packaged and labelled; nil: Wheat or meslin flour, other than pre-packaged and labelled', 'food_agri', ARRAY['flour', 'atta', 'maida', 'wheat flour'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('1201', 'Soya beans', 5, ARRAY[0, 5]::numeric[], '5%: Soya beans, whether or not broken other than of seed quality; 5%: All goods other than of seed quality; nil: Soya beans, whether or not broken, of seed quality; …', 'food_agri', ARRAY['soybean', 'soya', 'soya bean'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1202', 'Groundnuts', 5, ARRAY[0, 5]::numeric[], '5%: Ground-nuts, not roasted or otherwise cooked, whether or not shelled…; 5%: All goods other than of seed quality; nil: Ground-nuts, not roasted or otherwise cooked, whether or not shelled…; …', 'food_agri', ARRAY['groundnut', 'peanut', 'moongfali'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1507', 'Soya-bean oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['soybean oil', 'soya oil', 'cooking oil', 'edible oil'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1508', 'Groundnut oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['groundnut oil', 'peanut oil', 'cooking oil'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1509', 'Olive oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['olive oil', 'extra virgin'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1510', 'Other oils - Mustard, Sesame', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['mustard oil', 'sesame oil', 'til oil', 'sarso'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1511', 'Palm oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['palm oil', 'palmolein', 'cooking oil'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1512', 'Sunflower-seed or safflower oil', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['sunflower oil', 'safflower oil'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('1515', 'Other fixed vegetable fats and oils', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['coconut oil', 'linseed oil', 'castor oil'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('1604', 'Prepared or preserved fish', 5, ARRAY[5]::numeric[], NULL, 'perishables', ARRAY['canned fish', 'tuna', 'sardine', 'preserved fish'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1701', 'Cane or beet sugar', 5, ARRAY[0, 5]::numeric[], '5%: Cane or beet sugar and chemically pure sucrose, in solid form…; 5%: Jaggery of all types including Cane Jaggery (gur), Palmyra Jaggery,…; nil: (i) Jaggery of all types including Cane Jaggery (gur), Palmyra…', 'food_agri', ARRAY['sugar', 'cheeni', 'cane sugar', 'beet sugar', 'jaggery'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('1704', 'Sugar confectionery', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['chocolate', 'candy', 'confectionery', 'toffee', 'sweet', 'cadbury', 'dairy milk', 'kit kat', 'gummy'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1901', 'Food preparations of flour, groats, meal, starch or malt extract', 5, ARRAY[0, 5]::numeric[], '5%: Food preparation of millet flour, in powder form, containing at least…; nil: Food preparation of millet flour, in powder form, containing at least…', 'food_agri', ARRAY['biscuit', 'cookie', 'cake', 'pastry', 'bread', 'rusk', 'noodles', 'pasta', 'instant noodles', 'maggi'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('1905', 'Bread, pastry, cakes, biscuits', 5, ARRAY[0, 5]::numeric[], '5%: Pastry, cakes, biscuits and other bakers’ wares, whether or not…; nil: Pappad, by whatever name it is known; nil: Khakhra; Bread (branded or otherwise), Pizza bread, roti, chapathi,…', 'food_agri', ARRAY['bread', 'pastry', 'cake', 'biscuits', 'cookies', 'rusk', 'parle', 'britannia'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('2005', 'Other vegetables prepared or preserved', 5, ARRAY[5]::numeric[], NULL, 'food_agri', ARRAY['pickles', 'achar', 'preserved vegetables', 'frozen vegetables'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('2103', 'Sauces and preparations; mixed condiments', 5, ARRAY[5]::numeric[], NULL, 'fmcg', ARRAY['sauce', 'ketchup', 'mustard', 'chutney', 'masala', 'maggi sauce', 'soy sauce'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('2104', 'Soups, broths and preparations thereof', 5, ARRAY[5]::numeric[], NULL, 'fmcg', ARRAY['soup', 'broth', 'knorr', 'maggi soup'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('2106', 'Food preparations not elsewhere specified', 5, ARRAY[0, 5, 40]::numeric[], 'Rates differ by tariff item: nil (13 of 15), 5% (14 of 15), 40% (1 of 15); pick the 8-digit code', 'fmcg', ARRAY['protein powder', 'health drink', 'supplement', 'bournvita', 'horlicks', 'complan'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('2201', 'Mineral waters and aerated waters', 5, ARRAY[0, 5]::numeric[], '5%: Waters, including natural or artificial mineral waters and aerated…; nil: Water (other than aerated, mineral, distilled, medicinal, ionic,…; nil: Non-alcoholic Toddy, Neera including date and palm neera', 'food_agri', ARRAY['water', 'mineral water', 'packaged water', 'bisleri', 'aquafina', 'kinley'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('2202', 'Waters with added sugar or sweetened', 40, ARRAY[5, 40]::numeric[], 'Rates differ by tariff item: 5% (7 of 18), 40% (14 of 18); pick the 8-digit code', 'food_agri', ARRAY['soft drink', 'cola', 'pepsi', 'coca cola', 'sprite', 'soda', 'energy drink', 'redbull', 'fanta', 'limca', 'thumbs up', 'aerated'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('2401', 'Unmanufactured tobacco', 40, ARRAY[5, 40]::numeric[], '5%: Tobacco leave; 40%: Unmanufactured tobacco; tobacco refuse [other than tobacco leaves]', 'food_agri', ARRAY['tobacco', 'tambaku', 'beedi leaves'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('2501', 'Salt (including table salt and denatured salt)', 0, ARRAY[0]::numeric[], NULL, 'food_agri', ARRAY['salt', 'namak', 'rock salt'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('2505', 'Natural sands', 5, ARRAY[5]::numeric[], NULL, 'construction', ARRAY['sand', 'river sand', 'm sand', 'construction sand', 'silica sand'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('2517', 'Pebbles, gravel, broken or crushed stone', 5, ARRAY[5]::numeric[], NULL, 'construction', ARRAY['gravel', 'aggregate', 'stone chips', 'crusher', 'gitti', 'jelly'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('2523', 'Portland cement, aluminous cement', 18, ARRAY[18]::numeric[], NULL, 'construction', ARRAY['cement', 'portland cement', 'ultratech', 'acc', 'ambuja', 'ppc', 'opc', 'white cement'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('2701', 'Coal; briquettes, ovoids and similar fuels made from coal', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['coal', 'coke', 'koyla', 'anthracite'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('2710', 'Petroleum oils (diesel, petrol, kerosene, lubricants)', 18, ARRAY[0, 5, 18]::numeric[], 'Rates differ by tariff item: nil (11 of 70), 5% (59 of 70), 18% (59 of 70); pick the 8-digit code', 'chemicals', ARRAY['diesel', 'petrol', 'lubricant', 'engine oil', 'fuel', 'kerosene', 'petroleum', 'motor oil'], '{}'::text[], true, false, true, 'frontend-hsn-v1', true),
  ('2711', 'Petroleum gases (LPG, CNG)', 18, ARRAY[0, 5, 18]::numeric[], 'Rates differ by tariff item: nil (2 of 10), 5% (3 of 10), 18% (8 of 10); pick the 8-digit code', 'chemicals', ARRAY['lpg', 'cng', 'gas cylinder', 'cooking gas', 'propane', 'butane'], '{}'::text[], true, false, true, 'prd-v1', true),
  ('2801', 'Industrial chemicals (inorganic and organic), headings 2801 to 2942', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['chemical', 'chemicals', 'industrial chemical', 'acid', 'solvent'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('2804', 'Hydrogen, rare gases and other non-metals', 18, ARRAY[5, 18]::numeric[], 'Rates differ by tariff item: 5% (1 of 16), 18% (15 of 16); pick the 8-digit code', 'chemicals', ARRAY['hydrogen', 'nitrogen', 'oxygen', 'industrial gas', 'argon', 'helium'], '{}'::text[], true, false, true, 'frontend-hsn-v1', false),
  ('2806', 'Hydrogen chloride; hydrochloric acid', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['hcl', 'hydrochloric acid', 'acid'], '{}'::text[], true, false, true, 'frontend-hsn-v1', false),
  ('2815', 'Sodium hydroxide; potassium hydroxide', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['caustic soda', 'naoh', 'sodium hydroxide', 'potassium hydroxide', 'lye'], '{}'::text[], true, false, true, 'frontend-hsn-v1', false),
  ('3004', 'Medicaments for therapeutic or prophylactic uses', 5, ARRAY[0, 5]::numeric[], '5%: Medicaments (excluding goods of heading 3002, 3005 or 3006)…; 5%: All Drugs and medicines including their salts and esters and…; nil: Drugs or medicines listed in Annexure I', 'pharma', ARRAY['medicine', 'tablet', 'capsule', 'syrup', 'pharmaceutical', 'drug', 'paracetamol', 'antibiotic'], ARRAY['medicine', 'medicines', 'medical', 'medication', 'pharma', 'generic medicine'], false, false, false, 'prd-v1', false),
  ('3005', 'Wadding, gauze, bandages and similar articles', 5, ARRAY[5]::numeric[], NULL, 'pharma', ARRAY['bandage', 'gauze', 'plaster', 'surgical dressing', 'first aid'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('3102', 'Mineral or chemical fertilisers, headings 3102 to 3105', 5, ARRAY[5, 18]::numeric[], '5%: Mineral or chemical fertilisers, nitrogenous, other than those which…; 18%: Mineral or chemical fertilisers, nitrogenous, which are clearly not…', 'food_agri', ARRAY['fertilizer', 'fertiliser', 'urea', 'dap', 'khad', 'npk'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('3105', 'Mineral or chemical fertilisers containing NPK', 5, ARRAY[5, 18]::numeric[], '5%: Mineral or chemical fertilisers containing two or three of the…; 18%: Mineral or chemical fertilisers containing two or three of the…', 'food_agri', ARRAY['fertilizer', 'npk', 'urea', 'dap', 'potash', 'manure', 'compost'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('3208', 'Paints and varnishes based on synthetic polymers (paints, headings 3208 to 3210)', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['paint', 'varnish', 'enamel', 'asian paints', 'berger', 'nerolac', 'wall paint', 'emulsion'], '{}'::text[], true, false, true, 'prd-v1', false),
  ('3209', 'Paints and varnishes (aqueous)', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['water based paint', 'distemper', 'primer', 'putty'], '{}'::text[], true, false, true, 'frontend-hsn-v1', false),
  ('3214', 'Glaziers putty and similar mastics', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['putty', 'sealant', 'adhesive putty', 'wall putty', 'birla white'], '{}'::text[], true, false, true, 'frontend-hsn-v1', false),
  ('3304', 'Beauty, make-up and skin-care preparations', 18, ARRAY[0, 5, 18]::numeric[], '5%: Talcum powder, Face powder; 18%: Beauty or make-up preparations and preparations for the care of the…; nil: Kajal (other than kajal pencil sticks), Kumkum, Bindi, Sindur, Alta', 'fmcg', ARRAY['cosmetics', 'cream', 'lotion', 'sunscreen', 'lipstick', 'foundation', 'moisturizer', 'face wash'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('3305', 'Preparations for use on the hair', 18, ARRAY[5, 18]::numeric[], '5%: Mehendi paste in cones; 5%: Hair oil, shampoo; 18%: Preparations for use on the hair [other than mehendi paste in cones,…', 'fmcg', ARRAY['shampoo', 'conditioner', 'hair oil', 'hair color', 'hair dye', 'clinic plus', 'head and shoulders'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('3306', 'Preparations for oral or dental hygiene', 18, ARRAY[5, 18]::numeric[], '5%: Toothpaste; 18%: Preparations for oral or dental hygiene, including denture fixative…', 'fmcg', ARRAY['toothpaste', 'mouthwash', 'toothbrush', 'colgate', 'pepsodent', 'closeup', 'dental'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('3401', 'Soap and organic surface-active products', 18, ARRAY[5, 18]::numeric[], '5%: Toilet Soap (other than industrial soap) in the form of bars, cakes,…; 18%: Soap; organic surface-active products and preparations for use as…', 'fmcg', ARRAY['soap', 'detergent bar', 'bathing bar', 'lux', 'lifebuoy', 'dove'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('3402', 'Organic surface-active agents; washing preparations', 18, ARRAY[5, 18]::numeric[], '5%: Sulphonated castor oil, fish oil or sperm oil; 18%: Organic surface-active agents (other than soap); surface-active…', 'fmcg', ARRAY['detergent', 'washing powder', 'surf', 'ariel', 'tide', 'rin', 'liquid wash', 'fabric wash'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('3506', 'Prepared glues and adhesives', 18, ARRAY[18]::numeric[], NULL, 'chemicals', ARRAY['glue', 'adhesive', 'fevicol', 'araldite', 'epoxy', 'super glue'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('3602', 'Prepared explosives', 18, ARRAY[18]::numeric[], NULL, 'hazmat', ARRAY['explosive', 'dynamite', 'detonator'], '{}'::text[], true, false, true, 'prd-v1', false),
  ('3604', 'Fireworks, signalling flares and similar pyrotechnic articles', 18, ARRAY[18]::numeric[], NULL, 'hazmat', ARRAY['fireworks', 'crackers', 'firecracker', 'pataka', 'sparkler'], '{}'::text[], true, false, true, 'prd-v1', false),
  ('3808', 'Insecticides, fungicides, herbicides', 18, ARRAY[5, 18]::numeric[], '5%: The following Bio-pesticides, namely - 1 Bacillus thuringiensis var.…; 18%: Insecticides, rodenticides, fungicides, herbicides, anti-sprouting…', 'chemicals', ARRAY['pesticide', 'insecticide', 'herbicide', 'fungicide', 'weedicide', 'crop protection'], '{}'::text[], true, false, true, 'prd-v1', false),
  ('3901', 'Polymers of ethylene, in primary forms', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['polyethylene', 'hdpe', 'ldpe', 'lldpe', 'pe granules', 'plastic raw material'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('3902', 'Polymers of propylene', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['polypropylene', 'pp', 'pp granules'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('3904', 'Polymers of vinyl chloride', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['pvc', 'polyvinyl chloride', 'pvc resin', 'pvc pipe', 'vinyl'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('3917', 'Tubes, pipes and hoses of plastics (PVC pipes)', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['pvc pipe', 'pvc', 'plastic pipe', 'hdpe pipe', 'upvc'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('3923', 'Articles for packaging, of plastics', 18, ARRAY[18]::numeric[], NULL, 'plastics_rubber', ARRAY['plastic bag', 'bottle', 'container', 'drum', 'jerry can', 'packaging', 'pouch'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('3926', 'Other articles of plastics', 18, ARRAY[0, 5, 18]::numeric[], '5%: Feeding bottles, Plastic beads; 18%: Other articles of plastics and articles of other materials of…; nil: Plastic bangles', 'plastics_rubber', ARRAY['plastic', 'plastic product', 'tarpaulin', 'raincoat', 'pvc product', 'plastic container'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('4011', 'New pneumatic rubber tyres', 18, ARRAY[5, 18]::numeric[], '5%: Rear Tractor tyres and rear tractor tyre tubes; 5%: Pneumatic tyres or inner tubes, of rubber, of a kind used on/in…; 18%: New pneumatic tyres, of rubber (other than of a kind used on/in…', 'auto_parts', ARRAY['tyre', 'tire', 'mrf', 'ceat', 'apollo', 'bridgestone', 'jk tyre', 'radial tyre'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('4013', 'Inner tubes, of rubber', 18, ARRAY[5, 18]::numeric[], '5%: Pneumatic tyres or inner tubes, of rubber, of a kind used on/in…; 18%: Inner tubes of rubber (other than of a kind used on/in bicycles,…', 'auto_parts', ARRAY['tube', 'inner tube', 'tyre tube'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('4410', 'Particle board', 18, ARRAY[18]::numeric[], NULL, 'furniture_wood', ARRAY['plywood', 'particle board', 'mdf', 'block board', 'laminate', 'greenply', 'century'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('4412', 'Plywood, veneered panels and similar laminated wood', 18, ARRAY[18]::numeric[], NULL, 'furniture_wood', ARRAY['plywood', 'ply', 'veneer', 'laminate', 'mdf'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('4421', 'Other articles of wood', 5, ARRAY[5, 18]::numeric[], '5%: Other articles of wood; such as clothes hangers, Spools, cops,…; 18%: Wood paving blocks, articles of densified wood not elsewhere included…', 'furniture_wood', ARRAY['wooden furniture', 'wood craft', 'wooden box', 'hanger', 'wooden article'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('4802', 'Uncoated paper for writing or printing', 18, ARRAY[0, 18]::numeric[], '18%: Uncoated paper and paperboard, of a kind used for writing, printing…; nil: Judicial, Non-judicial stamp papers, Court fee stamps when sold by…; nil: Uncoated paper and paperboard, of a kind used for writing, printing…', 'paper_packaging', ARRAY['paper', 'a4 paper', 'printing paper', 'writing paper', 'copier paper'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('4818', 'Toilet paper, tissues, napkins, diapers', 18, ARRAY[18]::numeric[], NULL, 'fmcg', ARRAY['tissue', 'napkin', 'diaper', 'sanitary pad', 'toilet paper', 'pampers', 'huggies'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('4819', 'Cartons, boxes, cases, bags of paper', 18, ARRAY[5, 18]::numeric[], 'Rates differ by tariff item: 5% (5 of 10), 18% (5 of 10); pick the 8-digit code', 'paper_packaging', ARRAY['carton', 'cardboard box', 'corrugated box', 'packaging box', 'paper bag'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('4901', 'Printed books, brochures, leaflets', 5, ARRAY[0, 5]::numeric[], '5%: Brochures, leaflets and similar printed matter, whether or not in…; nil: Printed books, including Braille books', 'paper_packaging', ARRAY['book', 'textbook', 'novel', 'magazine', 'brochure', 'leaflet', 'printed material'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('4902', 'Newspapers, journals and periodicals', 0, ARRAY[0]::numeric[], NULL, 'paper_packaging', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', false),
  ('5201', 'Cotton, not carded or combed', 5, ARRAY[5, 18]::numeric[], '5%: Cotton and Cotton waste; 18%: otherwise (goods not elsewhere specified)', 'textiles', ARRAY['raw cotton', 'cotton bale', 'kapas', 'ginned cotton', 'unginned'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('5208', 'Woven fabrics of cotton (cotton fabric, headings 5208 to 5212)', 5, ARRAY[5]::numeric[], NULL, 'textiles', ARRAY['cotton fabric', 'cotton cloth', 'woven cotton', 'cotton textile', 'kapda'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('5209', 'Woven fabrics of cotton, 200g/m² or more', 5, ARRAY[5]::numeric[], NULL, 'textiles', ARRAY['heavy cotton', 'denim', 'canvas', 'twill', 'drill fabric'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('5407', 'Woven fabrics of synthetic filament yarn', 5, ARRAY[5]::numeric[], NULL, 'textiles', ARRAY['polyester fabric', 'nylon fabric', 'synthetic cloth', 'synthetic fabric'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('5408', 'Woven fabrics of artificial filament yarn', 5, ARRAY[5]::numeric[], NULL, 'textiles', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', false),
  ('5601', 'Wadding of textile materials', 5, ARRAY[5, 18]::numeric[], '5%: Wadding of textile materials and articles thereof; such as Absorbent…; 18%: otherwise (goods not elsewhere specified)', 'textiles', ARRAY['cotton bale', 'raw cotton', 'ginned cotton', 'cotton wadding'], '{}'::text[], false, false, false, 'frontend-hsn-v1', true),
  ('61', 'Articles of apparel and clothing accessories, knitted or crocheted (chapter 61)', 5, ARRAY[5, 18]::numeric[], '5%: Article of apparel and clothing accessories, knitted or crocheted, of…; 18%: Articles of apparel and clothing accessories, knitted or crocheted,…', 'textiles', ARRAY['knitwear', 'tshirt', 't-shirt', 'hosiery', 'innerwear'], ARRAY['clothes', 'clothing', 'garments', 'garment', 'apparel', 'readymade', 'ready made', 'dress', 'shirt', 'trousers', 'kapde', 'kurta', 'saree', 'jeans'], false, false, false, 'prd-v1', false),
  ('6109', 'T-shirts, singlets and other vests, knitted', 5, ARRAY[5, 18]::numeric[], '5%: Article of apparel and clothing accessories, knitted or crocheted, of…; 18%: Articles of apparel and clothing accessories, knitted or crocheted,…', 'textiles', ARRAY['tshirt', 't-shirt', 'vest', 'tank top', 'singlet', 'innerwear'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('6110', 'Jerseys, pullovers, cardigans, waistcoats', 5, ARRAY[5, 18]::numeric[], '5%: Article of apparel and clothing accessories, knitted or crocheted, of…; 18%: Articles of apparel and clothing accessories, knitted or crocheted,…', 'textiles', ARRAY['sweater', 'pullover', 'cardigan', 'hoodie', 'jacket', 'jersey', 'sweatshirt'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('62', 'Articles of apparel and clothing accessories, not knitted or crocheted (chapter 62)', 5, ARRAY[5, 18]::numeric[], '5%: Articles of apparel and clothing accessories, not knitted or…; 18%: Articles of apparel and clothing accessories, not knitted or…', 'textiles', ARRAY['woven garments', 'shirt', 'trouser', 'suit', 'formal wear'], ARRAY['clothes', 'clothing', 'garments', 'garment', 'apparel', 'readymade', 'ready made', 'dress', 'shirt', 'trousers', 'kapde', 'kurta', 'saree', 'jeans'], false, false, false, 'prd-v1', false),
  ('6203', 'Men''s suits, trousers, shorts', 5, ARRAY[5, 18]::numeric[], '5%: Articles of apparel and clothing accessories, not knitted or…; 18%: Articles of apparel and clothing accessories, not knitted or…', 'textiles', ARRAY['suit', 'trouser', 'pant', 'shorts', 'formal wear', 'blazer', 'men clothing'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('6204', 'Women''s suits, dresses, skirts', 5, ARRAY[5, 18]::numeric[], '5%: Articles of apparel and clothing accessories, not knitted or…; 18%: Articles of apparel and clothing accessories, not knitted or…', 'textiles', ARRAY['dress', 'skirt', 'kurti', 'saree', 'salwar', 'women clothing', 'lehnga', 'dupatta'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('6205', 'Men''s shirts', 5, ARRAY[5, 18]::numeric[], '5%: Articles of apparel and clothing accessories, not knitted or…; 18%: Articles of apparel and clothing accessories, not knitted or…', 'textiles', ARRAY['shirt', 'formal shirt', 'casual shirt', 'polo', 'men shirt'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('6301', 'Blankets and travelling rugs', 5, ARRAY[5, 18]::numeric[], '5%: Other made up textile articles, sets, of sale value not exceeding Rs.…; 18%: Other made-up textile articles, sets of sale value exceeding Rs. 2500…', 'textiles', ARRAY['blanket', 'bedsheet', 'bed linen', 'comforter', 'duvet', 'quilt'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('6302', 'Bed linen, table linen, toilet linen', 5, ARRAY[5, 18]::numeric[], '5%: Other made up textile articles, sets, of sale value not exceeding Rs.…; 18%: Other made-up textile articles, sets of sale value exceeding Rs. 2500…', 'textiles', ARRAY['bedsheet', 'pillowcase', 'towel', 'table cloth', 'napkin', 'curtain'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('6401', 'Waterproof footwear', 18, ARRAY[5, 18]::numeric[], '5%: Footwear of sale value not exceeding Rs.2500 per pair; 18%: Waterproof footwear with outer soles and uppers of rubber or of…', 'textiles', ARRAY['shoes', 'boots', 'sandals', 'footwear', 'sneakers', 'slippers', 'chappal'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('6802', 'Worked stone and articles thereof', 18, ARRAY[5, 18]::numeric[], '5%: Ecaussine and other calcareous monumental or building stone (other…; 5%: Statues, statuettes, pedestals; high or low reliefs, crosses, figures…; 18%: Worked monumental or building stone (except slate) and articles…', 'construction', ARRAY['granite', 'marble', 'stone slab', 'counter top', 'natural stone'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('6808', 'Panels, boards of vegetable fibre with cement', 18, ARRAY[18]::numeric[], NULL, 'construction', ARRAY['fibre board', 'cement board', 'particle board', 'gypsum board', 'drywall'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('6810', 'Articles of cement, concrete or artificial stone', 18, ARRAY[18]::numeric[], NULL, 'construction', ARRAY['concrete block', 'cement block', 'precast', 'paver', 'rcc', 'concrete', 'tile'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('6901', 'Bricks', 18, ARRAY[12, 18]::numeric[], 'Rates differ by tariff item: 12% (1 of 4), 18% (3 of 4); pick the 8-digit code', 'construction', ARRAY['brick', 'bricks', 'eent', 'clay brick', 'fly ash brick'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('6907', 'Ceramic flags and paving; ceramic tiles', 18, ARRAY[18]::numeric[], NULL, 'construction', ARRAY['tile', 'ceramic tile', 'floor tile', 'wall tile', 'porcelain tile', 'vitrified tile', 'kajaria', 'somany'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('6911', 'Tableware, kitchenware of porcelain or china', 5, ARRAY[5]::numeric[], NULL, 'furniture_wood', ARRAY['crockery', 'plate', 'cup', 'saucer', 'dinner set', 'porcelain', 'ceramic'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7009', 'Glass mirrors', 18, ARRAY[18]::numeric[], NULL, 'auto_parts', ARRAY['mirror', 'side mirror', 'rear view mirror', 'glass mirror'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7013', 'Glassware for table, kitchen, toilet, office', 18, ARRAY[18]::numeric[], NULL, 'furniture_wood', ARRAY['glass', 'glassware', 'bottle', 'jar', 'tumbler', 'glass container'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7208', 'Flat-rolled products of iron or non-alloy steel (steel sheets), headings 7208 to 7212', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel sheet', 'sheet', 'coil', 'hr coil', 'cr coil', 'plate'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('7210', 'Flat-rolled products of iron or steel, coated', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel sheet', 'galvanized sheet', 'tin plate', 'coated steel', 'gi sheet', 'cr coil'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7213', 'Bars and rods, hot-rolled, in irregularly wound coils', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', false),
  ('7214', 'Bars and rods of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel bar', 'rebar', 'rod', 'tmt bar', 'iron rod', 'saria', 'reinforcement bar'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('7216', 'Angles, shapes and sections of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['angle', 'channel', 'beam', 'i beam', 'h beam', 'steel section', 'ms angle'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7304', 'Tubes, pipes and profiles, seamless, of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel pipe', 'seamless pipe', 'steel tube', 'ms pipe', 'gi pipe'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7306', 'Other tubes, pipes — welded', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['welded pipe', 'erw pipe', 'steel tube welded'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7308', 'Structures of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['steel structure', 'fabrication', 'steel frame', 'tower', 'bridge', 'gate', 'railing'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7318', 'Screws, bolts, nuts, washers of iron or steel', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['bolt', 'nut', 'screw', 'washer', 'fastener', 'rivet'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7323', 'Table, kitchen articles of iron or steel', 18, ARRAY[5, 18]::numeric[], '5%: Milk cans made of Iron, Steel, or Aluminium; 5%: Table, kitchen or other household articles of iron & steel; Utensils; 18%: Iron or steel wool; pot scourers and scouring or polishing pads,…; …', 'steel_metal', ARRAY['utensil', 'steel utensil', 'pot', 'pan', 'pressure cooker', 'kadhai', 'tawa', 'stainless steel'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7403', 'Refined copper and alloys', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['copper', 'copper wire', 'copper rod', 'copper cathode'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('7408', 'Copper wire', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['copper wire', 'copper', 'tamba'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('7601', 'Unwrought aluminium (aluminium, headings 7601 to 7616)', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['aluminium', 'aluminum', 'ingot', 'billet', 'aluminium ingot'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('7606', 'Aluminium plates, sheets', 18, ARRAY[18]::numeric[], NULL, 'steel_metal', ARRAY['aluminium sheet', 'aluminum plate', 'aluminium foil', 'al sheet'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8407', 'Spark-ignition reciprocating engines', 18, ARRAY[5, 18]::numeric[], 'Rates differ by tariff item: 5% (1 of 15), 18% (14 of 15); pick the 8-digit code', 'machinery', ARRAY['engine', 'petrol engine', 'motor', 'combustion engine'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8408', 'Compression-ignition internal combustion piston engines', 5, ARRAY[5, 18]::numeric[], '5%: Fixed Speed Diesel Engines of power not exceeding 15HP; 18%: Compression-ignition internal combustion piston engines (diesel or…', 'machinery', ARRAY['diesel engine', 'engine block'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8409', 'Parts for engines', 18, ARRAY[18]::numeric[], NULL, 'auto_parts', ARRAY['piston', 'cylinder', 'valve', 'gasket', 'crankshaft', 'camshaft', 'engine parts'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8413', 'Pumps; liquid elevators', 18, ARRAY[5, 18]::numeric[], '5%: Hand pumps and parts thereof; 18%: (a) Concrete pumps [8413 40 00]; (b) other rotary positive…', 'machinery', ARRAY['pump', 'water pump', 'submersible pump', 'centrifugal pump', 'hydraulic pump'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8414', 'Air or vacuum pumps; compressors', 18, ARRAY[5, 18]::numeric[], 'Rates differ by tariff item: 5% (1 of 35), 18% (34 of 35); pick the 8-digit code', 'machinery', ARRAY['compressor', 'air compressor', 'blower', 'fan', 'exhaust fan', 'industrial fan'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8415', 'Air conditioning machines', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['ac', 'air conditioner', 'split ac', 'window ac', 'inverter ac', 'daikin', 'voltas', 'carrier'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8418', 'Refrigerators, freezers', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['refrigerator', 'fridge', 'freezer', 'deep freezer', 'godrej', 'lg fridge', 'samsung fridge', 'whirlpool'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8422', 'Dish washing machines; filling, sealing, labelling machinery', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['packaging machine', 'filling machine', 'sealing machine', 'labelling machine', 'bottling'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8424', 'Mechanical appliances for projecting, dispersing liquids or powders', 18, ARRAY[5, 18]::numeric[], '5%: Nozzles for drip irrigation equipment or nozzles for sprinklers; 5%: Sprinklers; drip irrigation system including laterals; mechanical…; 18%: Mechanical appliances (whether or not hand-operated) for projecting,…', 'machinery', ARRAY['sprayer', 'fire extinguisher', 'spray gun', 'agricultural sprayer'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8428', 'Other lifting, handling, loading or unloading machinery', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['crane', 'hoist', 'conveyor', 'lift', 'forklift', 'elevator', 'escalator'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8429', 'Self-propelled bulldozers, graders, scrapers', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['bulldozer', 'excavator', 'jcb', 'backhoe', 'grader', 'earth mover', 'construction equipment'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8430', 'Other moving, grading, levelling machinery', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['boring machine', 'drilling machine', 'pile driver'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8431', 'Parts for machinery of heading 8425 to 8430', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['crane parts', 'excavator parts', 'heavy equipment parts'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8432', 'Agricultural, horticultural or forestry machinery (agricultural machinery, headings 8432 to 8436)', 5, ARRAY[5]::numeric[], NULL, 'machinery', ARRAY['tractor', 'plough', 'harvester', 'seeder', 'cultivator', 'farm equipment', 'thresher'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8433', 'Harvesting or threshing machinery', 5, ARRAY[5, 18]::numeric[], '5%: Harvesting or threshing machinery, including straw or fodder balers;…; 18%: Machines for cleaning, sorting or grading eggs, fruit or other…', 'machinery', ARRAY['combine harvester', 'reaper', 'mower', 'hay baler'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8438', 'Machinery for food or drink preparation', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['food processing', 'flour mill', 'oil mill', 'mixer', 'grinder', 'juicer', 'food machine'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8441', 'Machinery for making up paper pulp, paper or paperboard', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['paper machine', 'cutting machine', 'die cutting'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8443', 'Printing machinery; printers', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['printer', 'scanner', 'photocopier', 'laser printer', 'inkjet', 'hp printer', 'canon', 'epson'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8450', 'Household or laundry-type washing machines', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['washing machine', 'washer', 'dryer', 'front load', 'top load', 'ifb', 'bosch'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8462', 'Machine-tools for working metal, forging, bending', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['press', 'hydraulic press', 'forging machine', 'bending machine', 'power press'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8471', 'Automatic data processing machines (computers)', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['computer', 'laptop', 'desktop', 'pc', 'server', 'dell', 'hp', 'lenovo', 'macbook', 'tablet', 'ipad'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8473', 'Computer parts and accessories', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['keyboard', 'mouse', 'ram', 'processor', 'motherboard', 'gpu', 'graphics card', 'cpu', 'cabinet'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8479', 'Machines and mechanical appliances having individual functions', 18, ARRAY[5, 18]::numeric[], '5%: Composting Machines; 18%: Machines and mechanical appliances having individual functions, not…', 'machinery', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8501', 'Electric motors and generators', 18, ARRAY[18]::numeric[], NULL, 'machinery', ARRAY['motor', 'electric motor', 'generator', 'dynamo', 'dg set', 'diesel generator'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8504', 'Electrical transformers, converters', 18, ARRAY[5, 18]::numeric[], '5%: Charger or charging station for Electrically operated vehicles; 18%: Electrical transformers, static converters (for example, rectifiers)…', 'electronics', ARRAY['transformer', 'inverter', 'ups', 'power supply', 'stabilizer', 'voltage regulator', 'converter', 'charger'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8506', 'Primary cells and batteries', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['battery', 'cell', 'duracell', 'eveready', 'lithium battery', 'alkaline'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8507', 'Electric accumulators', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['lithium ion', 'lead acid', 'battery pack', 'ev battery', 'power bank', 'rechargeable battery'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8511', 'Electrical ignition or starting equipment', 18, ARRAY[18]::numeric[], NULL, 'auto_parts', ARRAY['spark plug', 'ignition', 'starter motor', 'alternator', 'distributor'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8512', 'Electrical lighting or signalling equipment', 18, ARRAY[18]::numeric[], NULL, 'auto_parts', ARRAY['headlight', 'tail light', 'indicator', 'horn', 'wiper', 'car light'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8516', 'Electric water heaters, hair dryers, irons', 18, ARRAY[5, 18]::numeric[], '5%: Solar cookers; 18%: Electric instantaneous or storage water heaters and immersion…', 'electronics', ARRAY['iron', 'water heater', 'geyser', 'hair dryer', 'heater', 'microwave', 'oven', 'toaster'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8517', 'Telephone sets, smartphones', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['phone', 'smartphone', 'mobile', 'iphone', 'samsung', 'oneplus', 'vivo', 'oppo', 'realme', 'xiaomi', 'redmi', 'telephone'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8518', 'Microphones, loudspeakers, headphones', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['speaker', 'headphone', 'earphone', 'microphone', 'bluetooth speaker', 'jbl', 'bose', 'airpods', 'earbuds'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8521', 'Video recording or reproducing apparatus', 18, ARRAY[18]::numeric[], NULL, 'electronics', '{}'::text[], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8523', 'Discs, tapes, storage devices', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['pendrive', 'usb', 'sd card', 'memory card', 'hard drive', 'ssd', 'external drive'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8525', 'Transmission apparatus, cameras', 18, ARRAY[5, 18]::numeric[], 'Rates differ by tariff item: 5% (8 of 41), 18% (41 of 41); pick the 8-digit code', 'electronics', ARRAY['camera', 'dslr', 'cctv', 'webcam', 'gopro', 'video camera', 'security camera', 'surveillance'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8528', 'Monitors and projectors; television receivers', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['tv', 'television', 'monitor', 'led tv', 'lcd', 'oled', 'projector', 'smart tv', 'samsung tv', 'lg tv', 'sony'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8539', 'Electric filament or discharge lamps', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['bulb', 'led bulb', 'tube light', 'cfl', 'lamp', 'led light', 'philips', 'syska', 'havells'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8544', 'Insulated wire, cable', 18, ARRAY[18]::numeric[], NULL, 'electronics', ARRAY['wire', 'cable', 'electric wire', 'copper wire', 'data cable', 'polycab', 'havells wire', 'finolex'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8701', 'Tractors', 5, ARRAY[5, 18]::numeric[], '5%: Tractors (except road tractors for semi-trailers of engine capacity…; 18%: Road tractors for semi-trailers of engine capacity more than 1800 cc', 'machinery', ARRAY['tractor', 'farm tractor'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('8703', 'Motor cars and other motor vehicles', 18, ARRAY[5, 18, 40]::numeric[], 'Rates differ by tariff item: 5% (6 of 65), 18% (59 of 65), 40% (59 of 65); pick the 8-digit code', 'auto_parts', ARRAY['car', 'suv', 'sedan', 'hatchback', 'vehicle', 'maruti', 'hyundai', 'tata', 'mahindra'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('8708', 'Parts and accessories for motor vehicles', 18, ARRAY[5, 18]::numeric[], '5%: Following parts of tractors namely: a. Rear Tractor wheel rim, b.…; 18%: Parts and accessories of the motor vehicles of headings 8701 to 8705…', 'auto_parts', ARRAY['auto parts', 'car parts', 'vehicle parts', 'bumper', 'fender', 'bonnet', 'mudguard', 'brake pad', 'clutch', 'axle'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('9018', 'Instruments used in medical or surgical sciences', 5, ARRAY[5]::numeric[], NULL, 'pharma', ARRAY['syringe', 'stethoscope', 'medical device', 'surgical instrument', 'blood pressure monitor'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('9401', 'Seats and chairs', 18, ARRAY[5, 18]::numeric[], 'Rates differ by tariff item: 5% (1 of 21), 18% (20 of 21); pick the 8-digit code', 'furniture_wood', ARRAY['chair', 'office chair', 'sofa', 'couch', 'seat', 'stool', 'bench', 'recliner', 'revolving chair'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('9403', 'Other furniture', 18, ARRAY[5, 18]::numeric[], '5%: Furniture wholly made of bamboo, cane or rattan; 18%: Other furniture [other than furniture wholly made of bamboo, cane or…', 'furniture_wood', ARRAY['table', 'desk', 'wardrobe', 'cabinet', 'shelf', 'bookshelf', 'cupboard', 'almirah', 'rack', 'bed', 'cot', 'dressing table'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('9404', 'Mattress supports; mattresses', 18, ARRAY[5, 18]::numeric[], '5%: Coir products (except coir mattresses); 5%: Products wholly made of quilted textile materials not exceeding Rs…; 5%: Cotton quilts of sale value not exceeding Rs. 2500 per piece; …', 'furniture_wood', ARRAY['mattress', 'bed mattress', 'foam mattress', 'spring mattress', 'pillow', 'cushion', 'sleepwell', 'wakefit'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('9405', 'Luminaires and lighting fittings (LED lights)', 18, ARRAY[5, 18]::numeric[], '5%: Hurricane lanterns, Kerosene lamp / pressure lantern, petromax, glass…; 18%: Luminaires and lighting fittings including searchlights and…', 'electronics', ARRAY['led', 'led light', 'light', 'lamp', 'tube light', 'lighting'], '{}'::text[], false, false, false, 'prd-v1', false),
  ('9503', 'Tricycles, scooters and similar toys; puzzles', 5, ARRAY[5, 18]::numeric[], '5%: Toy balloons made of natural rubber latex; 5%: Toys like tricycles, scooters, pedal cars etc. (including parts and…; 18%: Electronic Toys like tricycles, scooters, pedal cars etc. (including…', 'fmcg', ARRAY['toy', 'toys', 'game', 'puzzle', 'doll', 'lego', 'board game', 'action figure'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('9506', 'Articles for gymnastics, athletics, sports', 18, ARRAY[5, 18]::numeric[], '5%: Sports goods other than articles and equipment for general physical…; 18%: Articles and equipment for general physical exercise, gymnastics,…', 'fmcg', ARRAY['sports', 'cricket bat', 'football', 'basketball', 'gym equipment', 'dumbbell', 'badminton', 'racket'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false),
  ('9608', 'Ball point pens', 18, ARRAY[0, 18]::numeric[], '18%: Ball point pens; felt tipped and other porous-tipped pens and…; nil: Pencils (including propelling or sliding pencils), crayons, pastels,…', 'fmcg', ARRAY['pen', 'ball pen', 'stationery', 'pencil', 'marker', 'highlighter'], '{}'::text[], false, false, false, 'frontend-hsn-v1', false)

ON CONFLICT (hsn_code) DO NOTHING;

-- Rows that were already there (an earlier import) get their rate list from the default rate
UPDATE public.hsn_codes SET gst_rates = ARRAY[gst_rate] WHERE gst_rates IS NULL;
