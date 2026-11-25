-- Second-pass HSN keyword cleanup.
--
-- A live audit of public.hsn_codes found 42 keywords that appear on more than one code. Most are legitimate
-- parent/child pairs (chapter 61 and 6109, chapter 62 and 6203) and the specific code already ranks first.
-- The updates below move the remaining cross-category words to the heading that actually covers the goods.
-- Ambiguous words that are valid on both headings (bottle, cream, tablet, motor, washer, plate, lamp, spice,
-- acid, napkin, cabinet) are left alone; they need a product decision, not a data fix.

begin;

-- Groundnut and peanut are oil seeds (1202), not "other nuts" (0802).
update public.hsn_codes
   set keywords = array['cashew', 'almond', 'walnut', 'pistachio', 'dry fruit']
 where hsn_code = '0802';

-- Urea is nitrogenous (3102); DAP, NPK and the generic word are the NPK heading (3105).
update public.hsn_codes
   set keywords = array['urea', 'khad', 'nitrogenous fertilizer', 'ammonium sulphate', 'calcium ammonium nitrate']
 where hsn_code = '3102';
update public.hsn_codes
   set keywords = array['fertilizer', 'fertiliser', 'npk', 'dap', 'potash', 'manure', 'compost', 'complex fertilizer', 'mixed fertilizer']
 where hsn_code = '3105';

-- PVC resin is 3904; a PVC pipe is 3917.
update public.hsn_codes
   set keywords = array['pvc', 'pvc resin', 'polyvinyl chloride']
 where hsn_code = '3904';
update public.hsn_codes
   set keywords = array['pvc pipe', 'plastic pipe', 'hdpe pipe', 'upvc']
 where hsn_code = '3917';

-- Particle board is 4410, MDF is fibre board 4411, plywood and laminates are 4412.
update public.hsn_codes
   set keywords = array['particle board', 'osb', 'oriented strand board']
 where hsn_code = '4410';
update public.hsn_codes
   set keywords = array['mdf', 'fibre board', 'fiberboard', 'hardboard', 'softboard']
 where hsn_code = '4411';
update public.hsn_codes
   set keywords = array['plywood', 'ply', 'veneer', 'laminate', 'block board', 'greenply', 'century']
 where hsn_code = '4412';

-- Raw cotton, ginned cotton and cotton bales are 5201; 5601 is wadding.
update public.hsn_codes
   set keywords = array['cotton wadding', 'wadding']
 where hsn_code = '5601';

-- A bedsheet is bed linen (6302), not a blanket (6301).
update public.hsn_codes
   set keywords = array['blanket', 'comforter', 'duvet', 'quilt']
 where hsn_code = '6301';

-- Copper wire is 7408 (bare) or 8544 (insulated); 7403 is refined copper.
update public.hsn_codes
   set keywords = array['copper', 'copper rod', 'copper cathode']
 where hsn_code = '7403';

-- CR coil is cold-rolled (7209), not hot-rolled (7208) or coated (7210).
update public.hsn_codes
   set keywords = array['steel sheet', 'sheet', 'coil', 'hr coil', 'plate']
 where hsn_code = '7208';
update public.hsn_codes
   set keywords = array['cr coil', 'cold rolled coil', 'cold rolled sheet']
 where hsn_code = '7209';
update public.hsn_codes
   set keywords = array['steel sheet', 'galvanized sheet', 'tin plate', 'coated steel', 'gi sheet']
 where hsn_code = '7210';

-- A tractor is 8701; 8432 is agricultural machinery (ploughs, harvesters, seeders).
update public.hsn_codes
   set keywords = array['plough', 'harvester', 'seeder', 'cultivator', 'farm equipment', 'thresher']
 where hsn_code = '8432';

commit;
