# GST rates on goods (the HSN master)

The HSN master (`public.hsn_codes`) holds every code of the official HSN list with the GST rate that applies
today. It is loaded by migration `supabase/migrations/20261005010000_hsn_master_gst2.sql`. The same rows are in
`supabase/seed/hsn_master.csv` so they can be reviewed. The scripts that build them are in `scripts/gst-rates/`.

Rates are as at **2 October 2026**. The GST 2.0 rates came into force on **22 September 2025**.

## Sources

All official copies come from the CBIC tax portal.

| Document | Date | In force | What it does | Official copy |
| --- | --- | --- | --- | --- |
| Notification 9/2025-Central Tax (Rate), G.S.R. 641(E) | 17 Sep 2025 | 22 Sep 2025 | Schedules I to VII of goods rates (CGST 2.5 / 9 / 20 / 1.5 / 0.125 / 0.75 / 14, so GST 5 / 18 / 40 / 3 / 0.25 / 1.5 / 28). It supersedes 1/2017. | [download id 1010436](https://taxinformation.cbic.gov.in/api/cbic-notification-msts/download/1010436/ENG) (`09-2025-CTR-eng.pdf`) |
| Notification 10/2025-Central Tax (Rate) | 17 Sep 2025 | 22 Sep 2025 | Nil-rated (exempt) goods. It supersedes 2/2017. | [1010437](https://taxinformation.cbic.gov.in/api/cbic-notification-msts/download/1010437/ENG) |
| Notification 14/2025-Central Tax (Rate) | 17 Sep 2025 | 22 Sep 2025 | Bricks and roofing tiles at CGST 6% (GST 12%). | [1010441](https://taxinformation.cbic.gov.in/api/cbic-notification-msts/download/1010441/ENG) |
| Notification 19/2025-Central Tax (Rate), G.S.R. 946(E) | 31 Dec 2025 | 1 Feb 2026 | Amends 9/2025. Pan masala, tobacco and cigarettes go to Schedule III (40%). Biris go to Schedule II (18%). Schedule VII (28%) is omitted. | [1010534](https://taxinformation.cbic.gov.in/api/cbic-notification-msts/download/1010534/ENG) |
| Notification 01/2026-Central Tax (Rate), G.S.R. 328(E), and its corrigendum G.S.R. 339(E) | 30 Apr 2026 (corrigendum 6 May 2026) | 1 May 2026 | Amends 9/2025 to follow the Finance Act 2026 tariff. The 2202 tariff items are renumbered in Schedule I (S. No. 150, 151) and Schedule III (S. No. 2, 3). The corrigendum reads "2202 91 00" for "2202 99 90". | [1010645](https://taxinformation.cbic.gov.in/api/cbic-notification-msts/download/1010645/ENG) (`CTR-E-updated.pdf`, with the correction) |
| HSN list `HSN_SAC.xlsx`, sheet `HSN_MSTR` | — | — | 21,935 codes with descriptions (2, 4, 6 and 8 digits). | GST portal, tutorial.gst.gov.in |

**Checked and not used:**

- **11/2025-CT(Rate).** It amends 3/2017, petroleum operations.
- **12/2025, 13/2025, 15/2025 to 18/2025-CT(Rate).** These amend other notifications (8/2018, 21/2018, 11/2017,
  12/2017, 17/2017 and 26/2018), not the goods schedules.

**Cross-check:** the ICAI compilation of 9/2025-Integrated Tax (Rate), hosted on courier.cbic.gov.in.

**Completeness:** the CBIC list of Central Tax (Rate) notifications was read on 2 Oct 2026. It is
[fetchNotificationByCategory/1000001/Central Tax (Rate)](https://taxinformation.cbic.gov.in/api/cbic-notification-msts/fetchNotificationByCategory/1000001/Central%20Tax%20(Rate)).
After 19/2025 it has only one goods-rate notification, 01/2026. The **57th GST Council meeting is set for 7 Oct 2026**:
recheck after it.

## Method

1. **Rule table.** `pdftotext -layout` turns each notification into text. `parse_rules.py` reads every entry into a
   rule: schedule, S. No., the codes in column 2, the codes it excludes ("other than", "Except"), the rate (2 × CGST)
   and the description. That makes 1,194 entries of 9/2025, 170 of 10/2025 and 4 of 14/2025. Where the table layout
   defeats the parser, about 20 entries were corrected by hand against the PDF (`OVERRIDES` in `build.py`).
   Ranges such as "5208 to 5212" are expanded.
2. **Amendments** go on top:
   - 19/2025: Schedule VII is removed and the tobacco entries are added.
   - 01/2026: the 2202 items are renumbered. The old items stay mapped too, because the HSN list still has them.
3. **Mapping.** Every code takes the matching entries whose code is a prefix of it, minus the exclusions.
   - **One entry covers the code:** the code gets that one rate. This is the longest prefix with one rate, and an
     entry that restates the heading or says "All goods".
   - **The entries split the code by a condition** (pre-packaged and labelled, sale value up to Rs 2,500, toilet
     soap or other, seed quality…): every rate stays in `gst_rates`. `rate_note` gives the conditions, for example
     "5%: Rice, pre-packaged and labelled; nil: Rice, other than pre-packaged and labelled".
   - **The default rate** (`gst_rate`) is the entry whose words best fit the code's own description. On a tie it is
     the taxable entry over the exemption, then the general entry over a carve-out.
   - **Headings and chapters** (2, 4 and 6 digits) take the rates of their tariff items. The default is the most
     common one. When the items differ, the note reads "Rates differ by tariff item: …; pick the 8-digit code".
   - **No entry at all:** the code falls to Schedule II S. No. 639, "Goods which are not specified in Schedule I, III,
     IV, V, VI or VII". It gets **18%** with `needs_review = false`, because the schedule says so.
   - **Only a narrow entry matches**, and nothing says what the rest of the code is: the rest is 18% under S. No. 639.
     Both rates are kept, with the note "18%: otherwise (goods not elsewhere specified)", and **`needs_review = true`**.
4. **Outside GST:** two kinds of goods are not under GST today. They are marked as rate 0 with a note and
   `needs_review = true`, source `non-gst`:
   - alcoholic liquor for human consumption (2203 to 2206, 2208);
   - the five petroleum products of CGST Act section 9(2): crude, motor spirit, high speed diesel, natural gas and
     aviation turbine fuel.
5. **The migration** upserts all rows in batches of 500. It keeps the hand-curated description, category, keywords,
   synonyms and hazmat, perishable and e-way flags, and it replaces the rates. `effective_from` is 2025-09-22, or
   2026-02-01 / 2026-05-01 for the codes whose rate comes from 19/2025 or 01/2026. `source` names the notification.
   `goods_categories.default_rates` still on 12% or 28% move to the GST 2.0 rates.

## Counts

**Codes:** 21,808 in all.
- By length: 97 chapters, 1,257 headings, 5,749 six-digit and 14,705 eight-digit codes.
- 21,935 rows in the sheet, minus 7 duplicates and 120 rows that are not codes. The duplicates are codes whose
  leading zero was lost, such as `30559` for `030559`. The other rows are listed in [Data fixes](#data-fixes).

**By default rate:**

| Default rate | Codes |
| --- | --- |
| 0% (nil, or outside GST) | 1,407 |
| 0.25% | 94 |
| 3% | 159 |
| 5% | 7,192 |
| 12% (bricks) | 7 |
| 18% | 12,793 |
| 40% | 156 |

Codes allowing each rate (a code can allow several):

| Rate | Codes |
| --- | --- |
| 0% | 3,212 |
| 0.25% | 95 |
| 1.5% | 36 |
| 3% | 160 |
| 5% | 9,293 |
| 12% | 33 |
| 18% | 14,665 |
| 40% | 249 |

**Other counts:**
- **Conditional (more than one rate):** 5,711.
- **No entry, 18% under S. No. 639:** 145.
- **`needs_review = true`:** 507.
  - 171 codes where only a narrow entry matches.
  - 112 headings above them.
  - 109 outside GST.
  - 90 under the menthol entries (Schedule I S. No. 224 and Schedule II S. No. 38). Their column 2 reads
    "2906 11 10, 30, 3301" and is read here as 29061110 and 3301.
  - 25 under bricks (14/2025).
- **By source:**

  | Source | Codes |
  | --- | --- |
  | cbic-9/2025 | 20,328 |
  | cbic-10/2025 | 1,283 |
  | cbic-19/2025 | 69 |
  | cbic-01/2026 | 14 |
  | cbic-14/2025 | 5 |
  | non-gst | 109 |

## Spot check (38 codes)

Each code was checked against the entry text of the notification. "Expected" is what the notification says for
those goods.

| Code | Goods | Notification entry | Expected | Mapped (rates, default) |
| --- | --- | --- | --- | --- |
| 01022110 | Bulls | 10/2025 S. No. 2, live bovine animals | nil | {0}, 0 |
| 04011000 | Milk, fat ≤ 1% | 10/2025 S. No. 15, fresh, pasteurised and UHT milk | nil | {0}, 0 |
| 04021010 | Skimmed milk powder | 9/2025 Sch I S. No. 4, milk concentrated | 5% | {5}, 5 |
| 04061000 | Fresh cheese, curd | Sch I S. No. 8, cheese other than chena or paneer; 10/2025 S. No. 17, chena or paneer | 5% or nil | {0,5}, 5 |
| 07019000 | Potatoes, other | 10/2025 S. No. 27, potatoes fresh or chilled | nil | {0}, 0 |
| 07131000 | Dried peas | Sch I S. No. 20 (pre-packaged and labelled); 10/2025 S. No. 39 (other) | 5% or nil | {0,5}, 5 |
| 09021010 | Green tea | Sch I S. No. 34, tea; 10/2025 S. No. 58, unprocessed green leaves | 5% (nil unprocessed) | {0,5}, 5 |
| 10063010 | Rice, parboiled | Sch I S. No. 48 (pre-packaged and labelled); 10/2025 S. No. 67 (other) | 5% or nil | {0,5}, 5 |
| 17011410 | Cane jaggery | Sch I S. No. 106 (pre-packaged); 10/2025 S. No. 96 (other) | 5% or nil | {0,5}, 5 |
| 19053100 | Sweet biscuits | Sch I S. No. 123, biscuits | 5% | {0,5}, 5 (nil is pappad or bread) |
| 21069020 | Pan masala | 19/2025, Sch III S. No. 14 (from 1 Feb 2026) | 40% | {40}, 40 |
| 22011010 | Mineral water | Sch I S. No. 146 | 5% | {0,5}, 5 |
| 22021010 | Aerated waters | Sch III S. No. 1 | 40% | {40}, 40 |
| 22029990 | Other non-alcoholic beverages | 01/2026, Sch III S. No. 2 and 3 | 40% | {40}, 40 |
| 24022010 | Cigarettes | 19/2025, Sch III S. No. 16 | 40% | {40}, 40 |
| 24031921 | Biris | 19/2025, Sch II S. No. 4A | 18% | {18}, 18 |
| 25232930 | Portland pozzolana cement | Sch II S. No. 9 | 18% | {18}, 18 |
| 27011200 | Bituminous coal | Sch II S. No. 23 | 18% | {18}, 18 |
| 27101930 | High speed diesel | CGST Act section 9(2), not yet notified | outside GST | {0}, 0, review |
| 30049099 | Medicaments, other | Sch I S. No. 226 and 234; 10/2025 S. No. 113 (Annexure I drugs) | 5% (nil if listed) | {0,5}, 5 |
| 34011110 | Medicated toilet soap | Sch I S. No. 251, toilet soap; Sch II S. No. 66, other soap | 5% | {5,18}, 5 |
| 40111010 | Radial car tyres | Sch II S. No. 137; Sch I S. No. 269 and 272 (tractor, cycle) | 18% | {5,18}, 18 |
| 48191010 | Corrugated boxes | Sch I S. No. 322 | 5% | {5}, 5 |
| 52081110 | Cotton fabric (dhoti) | Sch I S. No. 334, 5208 to 5212 | 5% | {5}, 5 |
| 61091000 | Cotton T-shirts | Sch I S. No. 388 (≤ Rs 2,500); Sch II S. No. 197 (above) | 5% or 18% | {5,18}, 5 |
| 64039990 | Leather footwear | Sch II S. No. 204; Sch I S. No. 392 (≤ Rs 2,500 a pair) | 18% or 5% | {5,18}, 18 |
| 69041000 | Building bricks | 14/2025 S. No. 3 | 12% | {12}, 12, review |
| 71081200 | Gold, unwrought | Sch IV S. No. 5 | 3% | {3}, 3 |
| 71023100 | Rough diamonds | Sch V S. No. 1; Sch VI S. No. 1 | 0.25% (1.5% other) | {0.25,1.5}, 0.25 |
| 72142010 | Steel bars | Sch II S. No. 268, 7213 to 7215 | 18% | {18}, 18 |
| 84151010 | Split air conditioner | Sch II S. No. 404 | 18% | {18}, 18 |
| 84713010 | Personal computer | Sch II S. No. 456 | 18% | {18}, 18 |
| 85171300 | Smartphones | Sch II S. No. 490, all goods | 18% | {18}, 18 |
| 87032110 | Small petrol car | Sch II S. No. 534 (≤ 1200 cc, ≤ 4 m); Sch III S. No. 5 (larger) | 18% or 40% | {18,40}, 18 |
| 87038030 | Electric car | Sch I S. No. 441, electrically operated vehicles | 5% | {5}, 5 |
| 87116010 | Electric motorcycle | Sch I S. No. 441 | 5% | {5}, 5 |
| 94036000 | Wooden furniture | Sch II S. No. 612; Sch I S. No. 490 (bamboo, cane, rattan) | 18% | {5,18}, 18 |
| 98071000 | Betting (actionable claim) | Sch III S. No. 13 | 40% | {40}, 40 |

Cement 2523 is 18% (it was 28%). Soap 3401 is 5% for toilet soap in bars and cakes, and 18% for other soap. The
heading defaults to 18%, the most common rate among its tariff items. Aerated drinks 2202 default to 40%.

## Data fixes

The source list needed these changes. `build.py` writes them to `dropped.json`.

- **Lost leading zeros:**
  - 7 rows of 5 or 7 digits (`30559`, `3074330`…) were duplicates of their zero-padded code and are merged.
  - 90 rows of 4 or 6 digits are one-dash subheadings whose zero was lost, such as `2031` "Fresh or chilled"
    (0203 1-) and `8011` "Coconuts" (0801 1-). They are left out, because as codes they would point to the wrong
    chapter.
- **Not codes:** 30 rows are left out. They are the test row `1111` "AKASH test", omitted codes ("OMITTED", "-") and
  the reserved chapter 77.
- **Tariff items 2208 xx xx:** their description in the sheet is "-". They take their sub-heading's text instead.

## Limitations

- **Rates on condition.** The rate of 5,711 codes depends on the goods, not the code: packaging, sale value, use,
  "of seed quality", tractor parts. The master offers all the rates and the note, and the customer picks. The
  default is a best fit, not a ruling.
- **Description-only entries are not tied to codes.** 53 entries name goods by description across chapters, for
  example:
  - renewable energy devices (84, 85, 94);
  - idols, puja samagri and rakhi;
  - biomass briquettes;
  - medical devices of chapter 90 such as coronary stents and glucometers;
  - the drug lists of 10/2025 Annexure I;
  - khadi;
  - the "Any chapter" entries.

  A code under those chapters shows the heading's general rate. The exception is electrically operated vehicles
  (Sch I S. No. 441), mapped to the tariff items "with only electric motor for propulsion": 870240, 870380,
  870460, 871160, 87031010 and 87049012.
- **Concessions in other notifications** are not in the master. They depend on the buyer, the use or the maker:
  notification 3/2017 for petroleum operations, 21/2018 for handicrafts (amended by 13/2025), 8/2018 and 26/2018,
  among others.
- **Compensation cess** ended with 19/2025 for tobacco. The new health and national security cess and the
  central excise on tobacco are outside GST and not in the master.
- **Freight GST is separate.** These are rates on goods. Freight GST follows the GTA rate per company
  (`docs/load-posting-design.md`).
- **Legacy codes.** The HSN list still has some pre-2017 and pre-2026 codes, such as 22029010 and 22029920. They
  are kept and mapped as the notification's wording allows.

## For a CA to review

1. **The 507 codes with `needs_review = true`** (filter the CSV). They are mainly:
   - chapters 33 (essential oils under the menthol entries) and 22 (outside GST);
   - chapters 53, 46 and 59: narrow 5% entries such as plaiting materials and textile fabrics for technical uses;
   - chapters 27 (outside GST) and 84 (sewing machines).
2. **Bricks.** Confirm that 14/2025 (CGST 6%) applies, and how it sits with the brick-kiln scheme: 6815 fly ash
   bricks, 6901 00 10, 6904 10 00 and 6905 10 00.
3. **The menthol entries.** Confirm the reading of "2906 11 10, 30, 3301" (Sch I S. No. 224 and Sch II S. No. 38).
4. **The defaults of the conditional headings** most used in freight. Confirm the defaults for rice and pulses
   (5% pre-packaged and labelled), soap 3401 (18% at heading level) and furniture 9403 (18%), or set them in the
   admin console.
5. **The outside-GST tariff items.** The motor spirit items (2710 12 11 to 2710 12 19) and the HSD, ATF and natural
   gas items should be confirmed.
6. **The GTA freight option "12% GTA (With ITC) - Forward Charge"** in the 3PL settings (`schemas/tpl.ts`,
   frontend tpl constants). Under the GST 2.0 services notification 15/2025-CT(Rate), forward charge GTA is 18% with
   ITC. This is outside the goods master, so it was flagged and not changed here.

## Rebuilding

```bash
export GST_WORK=/path/outside/the/repo    # the PDFs and HSN_SAC.xlsx live here; never commit them
nice -n 19 python3 scripts/gst-rates/dl.py && nice -n 19 python3 scripts/gst-rates/totext.py
nice -n 19 python3 scripts/gst-rates/read_hsn.py          # needs HSN_SAC.xlsx in $GST_WORK
nice -n 19 python3 scripts/gst-rates/parse_rules.py
nice -n 19 python3 scripts/gst-rates/build.py
cp "$GST_WORK/hsn_master.csv" supabase/seed/hsn_master.csv
nice -n 19 python3 scripts/gst-rates/gen_sql.py supabase/migrations/<new version>_hsn_master_<label>.sql
```

For a new amendment, add its entries to `build.py`, next to the 19/2025 and 01/2026 blocks. Rebuild, then ship it
as a new migration. The upsert is idempotent and keeps the curated fields.
