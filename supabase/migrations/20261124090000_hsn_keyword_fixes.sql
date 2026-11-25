-- Correct curated HSN keywords that made the public search rank the wrong code first.
--
-- The keyword arrays seeded by 20261003010000_goods_master.sql overlap across headings:
-- "biscuit" sat on 1901 (food preparations) as well as 1905 (biscuits), "chocolate" on 1704
-- (sugar confectionery) as well as 1806, "mustard oil" on 1510 as well as 1514, and so on.
-- The search gives a whole-query keyword the strongest weight, so with the same word on two
-- codes the lower code always won. These updates keep each everyday word on the code that
-- actually covers the goods. They are plain UPDATEs, so a fresh install (which runs the seed
-- migration first) and the live database end up with the same arrays.

begin;

-- 1001 is wheat and meslin; flour and atta belong to 1101.
update public.hsn_codes
   set keywords = array['wheat', 'meslin', 'gehu']
 where hsn_code = '1001';
update public.hsn_codes
   set keywords = array['flour', 'atta', 'maida', 'wheat flour', 'chakki atta']
 where hsn_code = '1101';

-- 1901 is food preparations of flour, starch or malt extract. Biscuits, bread, cakes and
-- pasta have their own headings.
update public.hsn_codes
   set keywords = array['malt extract', 'food preparation', 'corn flakes', 'muesli', 'cereal', 'malt']
 where hsn_code = '1901';
update public.hsn_codes
   set keywords = array['pasta', 'noodles', 'macaroni', 'spaghetti', 'instant noodles', 'vermicelli', 'maggi', 'ramen']
 where hsn_code = '1902';
update public.hsn_codes
   set keywords = array['bread', 'pastry', 'cake', 'biscuits', 'biscuit', 'cookies', 'cookie', 'rusk', 'parle', 'britannia']
 where hsn_code = '1905';

-- 1704 is sugar confectionery; chocolate is 1806.
update public.hsn_codes
   set keywords = array['candy', 'confectionery', 'toffee', 'sweet', 'gummy', 'lollipop']
 where hsn_code = '1704';
update public.hsn_codes
   set keywords = array['chocolate', 'chocolates', 'cocoa', 'cadbury', 'dairy milk', 'kit kat', 'chocolate bar', 'cocoa powder']
 where hsn_code = '1806';

-- 0401 is milk and cream; ghee and butter are 0405.
update public.hsn_codes
   set keywords = array['milk', 'cream', 'dairy', 'amul', 'doodh', 'fresh milk']
 where hsn_code = '0401';
update public.hsn_codes
   set keywords = array['ghee', 'desi ghee', 'butter', 'makhan', 'clarified butter', 'dairy spread']
 where hsn_code = '0405';

-- 1510 is other oils; mustard oil is 1514.
update public.hsn_codes
   set keywords = array['sesame oil', 'til oil', 'other oils']
 where hsn_code = '1510';
update public.hsn_codes
   set keywords = array['mustard oil', 'mustard seed oil', 'sarso', 'rape oil', 'rapeseed oil', 'colza oil']
 where hsn_code = '1514';

-- 6401 is waterproof footwear; general shoes are 6403.
update public.hsn_codes
   set keywords = array['waterproof footwear', 'gumboots', 'rain boots', 'rubber boots', 'pvc boots']
 where hsn_code = '6401';
update public.hsn_codes
   set keywords = array['shoes', 'footwear', 'sandals', 'sneakers', 'slippers', 'chappal', 'boots', 'leather shoes', 'sports shoes']
 where hsn_code = '6403';

-- Tiles are ceramic (6907), not cement articles (6810).
update public.hsn_codes
   set keywords = array['concrete block', 'cement block', 'precast', 'paver', 'rcc', 'concrete']
 where hsn_code = '6810';
update public.hsn_codes
   set keywords = array['tile', 'tiles', 'ceramic tile', 'floor tile', 'wall tile', 'porcelain tile', 'vitrified tile', 'kajaria', 'somany']
 where hsn_code = '6907';

-- A plastic chair is a seat (9401); 3926 is other articles of plastics.
update public.hsn_codes
   set keywords = array['chair', 'chairs', 'office chair', 'sofa', 'couch', 'seat', 'stool', 'bench', 'recliner', 'revolving chair', 'plastic chair', 'plastic chairs']
 where hsn_code = '9401';

-- Sawn wood and timber are 4407; 4418 is builders' joinery.
update public.hsn_codes
   set keywords = array['timber', 'wood', 'lumber', 'sawn wood', 'teak', 'pine', 'hardwood', 'softwood']
 where hsn_code = '4407';

-- Putty is 3214; 3209 is paints and varnishes.
update public.hsn_codes
   set keywords = array['water based paint', 'distemper', 'primer']
 where hsn_code = '3209';

commit;
