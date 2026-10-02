"""5. Map every HSN code of HSN_SAC.xlsx (sheet HSN_MSTR) to its current GST rate(s).

Inputs (in $GST_WORK, never committed):
  rules_raw.json  parsed by parse_rules.py from the official CBIC PDFs:
                  9/2025-CT(Rate) (Schedules I-VII), 10/2025-CT(Rate) (nil), 14/2025-CT(Rate) (bricks)
  hsn_rows.json   read_hsn.py from HSN_SAC.xlsx
Amendments applied here: 19/2025-CT(Rate) (from 1 Feb 2026) and 01/2026-CT(Rate) with its corrigendum (from 1 May 2026).

Outputs (in $GST_WORK): hsn_master.csv (copy to supabase/seed/), result.json, extra.json, stats.json, dropped.json,
desc_only.json. Then gen_sql.py writes the migration.
"""
import csv, json, os, re, sys, collections

WORK = os.environ.get('GST_WORK') or sys.exit('Set GST_WORK to the folder that holds the downloads (never commit them)')
os.chdir(WORK)

NOTIF = {
    '9/2025': ('cbic-9/2025', '2025-09-22'),
    '10/2025': ('cbic-10/2025', '2025-09-22'),
    '14/2025': ('cbic-14/2025', '2025-09-22'),
    '19/2025': ('cbic-19/2025', '2026-02-01'),
    '01/2026': ('cbic-01/2026', '2026-05-01'),
}
SCHED_ORDER = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'BRICKS': 8, 'NIL': 9}

raw = json.load(open('rules_raw.json'))
rules = []
for k in ('n9', 'n10', 'n14'):
    rules.extend(raw[k])


def key(r):
    return f"{r['src']}|{r['schedule']}|{r['sno']}"


# ── Manual corrections where the PDF table layout defeats the parser (checked by eye against the PDF text) ──
OVERRIDES = {
    '9/2025|I|42': dict(full=True, prefixes=['0910'], excludes=['09101110', '09103010'],
                       desc='Ginger other than fresh ginger, saffron, turmeric (curcuma) other than fresh turmeric, thyme, bay leaves, curry and other spices'),
    '9/2025|I|142': dict(prefixes=['2106'], desc='Texturised vegetable proteins (soya bari), Bari made of pulses including mungodi and batters; Roasted Gram idli/dosa batter, chutney powder; Sweetmeats'),
    '9/2025|I|145': dict(full=True, prefixes=['2106'], excludes=['21069020'], desc='Food preparations not elsewhere specified or included [other than pan masala]'),
    '9/2025|I|176': dict(full=True, prefixes=['2515', '6802'], excludes=['25151220', '25151290'],
                        desc='Ecaussine and other calcareous monumental or building stone (other than marble and travertine), alabaster, other than mirror polished stone which is ready to use'),
    '9/2025|I|179': dict(full=True, prefixes=['2516'], excludes=['25161100', '25161200'],
                        desc='Porphyry, basalt, sandstone and other monumental or building stone, roughly trimmed or merely cut into blocks or slabs'),
    '9/2025|I|224': dict(prefixes=['29061110', '3301'], uncertain=True),
    '9/2025|II|38': dict(prefixes=['29061190', '3301'], uncertain=True),
    '9/2025|I|333': dict(full=True),
    '9/2025|I|390': dict(desc='Other made up textile articles, sets, of sale value not exceeding Rs. 2500 per piece'),
    '9/2025|I|503': dict(prefixes=['9603'], excludes=['96031000'],
                        desc='Broomsticks (other than brooms consisting of twigs or other vegetable materials bound together, with or without handles)'),
    '9/2025|II|183': dict(prefixes=['4817'], excludes=['481730'],
                         desc='Envelopes, letter cards, plain postcards and correspondence cards, of paper or paperboard [other than boxes, pouches, wallets and writing compendiums containing an assortment of paper stationery]'),
    '9/2025|II|610': dict(prefixes=['9401'], excludes=['94011000'],
                         desc='Seats (other than those of heading 9402), whether or not convertible into beds, and parts thereof, including seats of a kind used for motor vehicles, other than seats of a kind used for aircraft'),
    '9/2025|II|623': dict(prefixes=['9603'], excludes=['96031000', '96032100'],
                         desc='Brushes, hand operated mechanical floor sweepers, mops and feather dusters; paint pads and rollers; squeegees [other than brooms and brushes of twigs or other vegetable materials]'),
    '9/2025|III|2': dict(full=True),
    # Electrically operated vehicles (S. No. 441 names chapter 87): the tariff items "with only electric motor for propulsion"
    '9/2025|I|441': dict(full=True, prefixes=['870240', '870380', '870460', '871160', '87031010', '87049012'],
                        desc='Electrically operated vehicles, including two and three wheeled electric vehicles'),
    '9/2025|I|322': dict(full=True),
    # Specified actionable claims (betting, casinos, gambling, horse racing, lottery, online money gaming): tariff 9807
    '9/2025|III|13': dict(full=True, prefixes=['9807'], desc='Specified actionable claim (betting, casinos, gambling, horse racing, lottery, online money gaming)'),
    '9/2025|II|185': dict(desc='All goods [other than cartons, boxes and cases of corrugated or non-corrugated paper or paper board]'),
    '9/2025|III|3': dict(full=True),
    '9/2025|I|411': dict(prefixes=['7310', '7323', '7612', '7615'], desc='Milk cans made of Iron, Steel, or Aluminium'),
    '10/2025|NIL|127': dict(prefixes=['4802', '4907'], desc='Judicial, Non-judicial stamp papers, Court fee stamps when sold by the Government Treasuries or Vendors authorised by the Government'),
    '10/2025|NIL|129': dict(prefixes=['4817', '4907'], desc='Postal items, like envelope, Post card etc., sold by Government'),
}
for r in rules:
    o = OVERRIDES.get(key(r))
    if o:
        for f in ('prefixes', 'excludes', 'desc'):
            if f in o:
                r[f] = o[f]
        r['uncertain'] = o.get('uncertain', False)
        r['force_full'] = o.get('full', False)
        r['override'] = True
for r in rules:
    r['desc'] = re.sub(r'^\s*(or any other chapter|or any\s+(?=The)|or\s+(?=All goods)|/\s*\d{4}\s+)', '', r['desc'], flags=re.I).strip()
rules.append({'src': '9/2025', 'schedule': 'I', 'sno': '143', 'rate': 5, 'prefixes': ['210690'], 'excludes': [], 'any_chapter': False,
              'col2': '2106 90', 'override': True,
              'desc': 'Namkeens, bhujia, mixture, chabena and similar edible preparations in ready for consumption form, whether or not pre-packaged and labelled'})

# ── 19/2025-CT(Rate), 31 Dec 2025, in force 1 Feb 2026: tobacco moves out of Schedule VII (omitted) ──
rules = [r for r in rules if not (r['src'] == '9/2025' and r['schedule'] == 'VII')]
for sno, pre, ex, desc, sched, rate in [
    ('4A', ['24031921', '24031929'], [], 'Biris', 'II', 18),
    ('14', ['21069020'], [], 'Pan masala', 'III', 40),
    ('15', ['2401'], [], 'Unmanufactured tobacco; tobacco refuse [other than tobacco leaves]', 'III', 40),
    ('16', ['2402'], [], 'Cigars, cheroots, cigarillos and cigarettes, of tobacco or of tobacco substitutes', 'III', 40),
    ('17', ['2403'], ['24031921', '24031929'], 'Other manufactured tobacco and manufactured tobacco substitutes; homogenised or reconstituted tobacco; tobacco extracts and essences [other than biris]', 'III', 40),
    ('18', ['24041100'], [], 'Products containing tobacco or reconstituted tobacco and intended for inhalation without combustion', 'III', 40),
    ('19', ['24041900'], [], 'Products containing tobacco or nicotine substitutes and intended for inhalation without combustion', 'III', 40),
]:
    rules.append({'src': '19/2025', 'schedule': sched, 'sno': sno, 'rate': rate, 'prefixes': pre, 'excludes': ex,
                  'any_chapter': False, 'col2': ' '.join(pre), 'desc': desc})

# ── 01/2026-CT(Rate), 30 Apr 2026 (+ corrigendum 6 May 2026), in force 1 May 2026: 2202 tariff items renumbered ──
# The new tariff items are added; the old ones stay mapped because HSN_SAC.xlsx still lists them.
AMEND_2026 = {'9/2025|I|150': ['22029921', '22029929'], '9/2025|I|151': ['22029931', '22029939'],
              '9/2025|III|2': ['22029100', '22029991', '22029999'], '9/2025|III|3': ['22029991', '22029999']}
for r in rules:
    new = AMEND_2026.get(key(r))
    if new:
        r['legacy_prefixes'] = list(r['prefixes'])
        r['prefixes'] = sorted(set(new) | set(r['prefixes']))
        r['src'] = '01/2026'

for r in rules:
    for p in r['prefixes']:
        if len(p) not in (2, 4, 6, 8):
            print('WARN odd prefix', key(r), p)

# ── Which rules take part in the prefix mapping ──
# Chapter-level (2-digit) rules apply only where the entry really covers the chapter (or a value/quality split of it).
CHAPTER_WIDE = {'9/2025|I|60', '9/2025|I|226', '9/2025|I|387', '9/2025|I|388', '9/2025|I|389', '9/2025|I|390', '9/2025|I|392',
                '9/2025|II|35', '9/2025|II|36', '9/2025|II|197', '9/2025|II|198', '9/2025|II|199',
                '10/2025|NIL|26', '10/2025|NIL|77', '10/2025|NIL|113'}
# Value or quality splits that cut across the headings of a chapter (apparel and footwear by sale value, seeds):
# always an alternative, even where a heading has its own entry
CHAPTER_CONDITION = {'9/2025|I|60', '9/2025|I|388', '9/2025|I|389', '9/2025|I|390', '9/2025|I|392', '9/2025|II|197',
                     '9/2025|II|198', '9/2025|II|199', '10/2025|NIL|77'}
desc_only = []   # entries that name goods by description across chapters; not mapped to codes
mapped = []
for r in rules:
    if r.get('any_chapter') and not r['prefixes']:
        desc_only.append(r)
        continue
    if not r['prefixes']:
        desc_only.append(r)
        continue
    pre = [p for p in r['prefixes'] if len(p) >= 4 or key(r) in CHAPTER_WIDE]
    if not pre:
        desc_only.append(r)
        continue
    r['map_prefixes'] = pre
    mapped.append(r)

# ── HSN master ──
hsn = json.load(open('hsn_rows.json'))
master = {}
fixes = {}
for code, desc in hsn:
    c = code.replace(' ', '')
    if len(c) in (5, 7):           # a leading zero lost in the sheet ('30559' is 030559)
        fixes[code] = '0' + c
        c = '0' + c
    desc = re.sub(r'_x000D_', ' ', desc)
    desc = re.sub(r'\s+', ' ', desc).strip()
    if c in master:
        print('DUP after normalising', code, c)
        continue
    master[c] = desc
print('normalised codes', fixes)

# Rows of the sheet that are not HSN codes: a one-dash subheading whose leading zero was lost ('2031' is 0203 1-,
# 'Fresh or chilled'; '8011' is 0801 1-, 'Coconuts'), a test row, and omitted or reserved codes. Left out, and listed.
codes_all = set(master)
dropped = {}
for c, d in list(master.items()):
    z = '0' + c
    zero_lost = len(c) in (4, 6) and not any(k != c and k.startswith(c) for k in codes_all) and \
        any(k.startswith(z) and len(k) > len(z) for k in codes_all if k.startswith(z[:4]))
    if d.strip() == '-' and len(c) == 8:
        parent = master.get(c[:6]) or master.get(c[:4]) or ''
        if parent and parent.strip() != '-':
            master[c] = parent
            continue
    junk = d.strip() in ('-', 'Omitted', 'OMITTED') or d.strip().lower().startswith('(reserved') or 'test' == d.strip().split()[-1].lower()
    if zero_lost or junk:
        dropped[c] = d
for c in dropped:
    del master[c]
print('dropped', len(dropped))
json.dump(dropped, open('dropped.json', 'w'), indent=1)

# Curated codes from the goods master migration (all present in the sheet; any that is not is added with its seed text)
CURATED = '0401 0402 0406 0701 0702 0703 0713 0802 0803 0804 0805 0901 0902 0904 0910 1001 1005 1006 1101 1201 1202 1507 1508 1509 1510 1511 1512 1515 1604 1701 1704 1901 1905 2005 2103 2104 2106 2201 2202 2401 2501 2505 2517 2523 2701 2710 2711 2801 2804 2806 2815 3004 3005 3102 3105 3208 3209 3214 3304 3305 3306 3401 3402 3506 3602 3604 3808 3901 3902 3904 3917 3923 3926 4011 4013 4410 4412 4421 4802 4818 4819 4901 4902 5201 5208 5209 5407 5408 5601 61 6109 6110 62 6203 6204 6205 6301 6302 6401 6802 6808 6810 6901 6907 6911 7009 7013 7208 7210 7213 7214 7216 7304 7306 7308 7318 7323 7403 7408 7601 7606 8407 8408 8409 8413 8414 8415 8418 8422 8424 8428 8429 8430 8431 8432 8433 8438 8441 8443 8450 8462 8471 8473 8479 8501 8504 8506 8507 8511 8512 8516 8517 8518 8521 8523 8525 8528 8539 8544 8701 8703 8708 9018 9401 9403 9404 9405 9503 9506 9608'.split()
missing_curated = [c for c in CURATED if c not in master]
print('curated codes missing from the sheet', missing_curated)

STOP = set('and or of the a an in for with not whether other than its their such as to by on from be thereof parts including etc'.split())


def words(s):
    import unicodedata
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return [w for w in re.findall(r'[a-z]+', s.lower()) if w not in STOP and len(w) > 2]


SCOPE_PHRASE = re.compile(r'(other than|excluding|except)\s[^,;\]\)]{0,80}?\b(of|under|in)\s+(the\s+)?(sub-?)?(heading|headings|chapter|tariff item)s?\s*[\d ]{2,}[^,;\]\)]*', re.I)
HARD_PARTIAL = re.compile(r'other than|\bexcept|excluding|pre-?packaged|unit container|not exceeding|exceeding|sale value|seed quality|for use|used (in|for|by|solely|principally)|intended for|\bbranded|put up (for|in)|for (the )?manufacture|supplied (to|by)|for supply|cleared as|for tractors?|\bfor\b.*\bonly\b', re.I)


def heading_text(prefix):
    return (master.get(prefix[:4]) or master.get(prefix) or '').split('~')[-1]


def overlap(r, prefix):
    """How much of the entry's wording is the heading's own wording (1 = the entry restates the heading)."""
    head = heading_text(prefix)
    if not head:
        return 1.0
    hw = stem(set(words(head)))
    dw = stem(set(words(positive(r['desc']))))
    if not hw or not dw:
        return 1.0
    return len(hw & dw) / min(len(hw), len(dw))


def restates(r, prefix):
    """The entry is the heading's own text (the general entry), not a carve-out of it."""
    hw = stem(set(words(heading_text(prefix))))
    dw = stem(set(words(positive(r['desc']))))
    if not hw or not dw:
        return False
    inter = len(hw & dw)
    return inter / len(hw) >= 0.8 and inter / len(dw) >= 0.6


def is_full(r, prefix):
    if r.get('force_full'):
        return True
    d = SCOPE_PHRASE.sub('', r['desc'])
    head = heading_text(prefix).lower()
    # A limiting phrase counts only when the heading itself does not say it ("used in medical..." in 9018)
    for mm in HARD_PARTIAL.finditer(d):
        tail = d[mm.start():mm.start() + 40].lower()
        tail_w = ' '.join(tail.split()[:3])
        if tail_w and tail_w in re.sub(r'\s+', ' ', head):
            continue
        return False
    if re.match(r'^\s*All goods', d, re.I):
        return True
    if len(prefix) == 8:
        return True
    return overlap(r, prefix) >= 0.6


BY_PREFIX = collections.defaultdict(list)
for _r in mapped:
    for _p in _r['map_prefixes']:
        BY_PREFIX[_p].append(_r)


def matches(code):
    best = {}
    for L in (2, 4, 6, 8):
        if len(code) < L:
            break
        for r in BY_PREFIX.get(code[:L], []):
            best[id(r)] = (code[:L], r)
    return [(p, r) for p, r in best.values() if not any(code.startswith(x) for x in r['excludes'])]


def rate_txt(x):
    if x == 0:
        return 'nil'
    return (str(int(x)) if float(x).is_integer() else str(x)) + '%'


def short(desc, n=70):
    d = re.sub(r'\s+', ' ', desc).strip().rstrip('.;,')
    d = re.sub(r'\s*Explanation\.?.*$', '', d)
    return d if len(d) <= n else d[:n].rsplit(' ', 1)[0] + '…'


def src_of(r):
    return NOTIF[r['src']]


def positive(desc):
    d = re.sub(r'[\[(]\s*(other than|except|excluding)[^\])]*[\])]?', ' ', desc, flags=re.I)
    return re.sub(r'\b(other than|excluding|except)\b[^,;]*', ' ', d, flags=re.I)


def stem(ws):
    return {w[:-1] if len(w) > 3 and w.endswith('s') else w for w in ws}


GENERIC = set('used use kind goods article articles similar form forms whatever name called known heading headings chapter tariff item'.split())


# Supplies outside GST today: alcoholic liquor for human consumption (Article 366(12A)) and the five petroleum
# products of section 9(2) of the CGST Act (crude, motor spirit, high speed diesel, natural gas, aviation turbine fuel)
NON_GST = [('2203', 'liquor'), ('2204', 'liquor'), ('2205', 'liquor'), ('2206', 'liquor'), ('2208', 'liquor'),
           ('2709', 'petroleum crude'), ('27101211', 'motor spirit'), ('27101212', 'motor spirit'), ('27101213', 'motor spirit'),
           ('27101219', 'motor spirit'), ('27101930', 'high speed diesel'), ('27101944', 'high speed diesel'),
           ('27101949', 'high speed diesel'), ('27102010', 'high speed diesel'), ('27102020', 'high speed diesel'),
           ('27101933', 'aviation turbine fuel'), ('27101939', 'aviation turbine fuel'), ('271111', 'natural gas'), ('271121', 'natural gas')]


def leaf(code):
    for pre, what in NON_GST:
        if code.startswith(pre):
            note = ('Alcoholic liquor for human consumption is outside GST (state excise and VAT apply)' if what == 'liquor'
                    else f'{what[0].upper() + what[1:]} is outside GST for now (CGST Act section 9(2)); central excise and state VAT apply')
            return dict(rates=[0.0], default=0.0, rules=['non-gst'], residual=False, conditional=False, guess=True,
                        note=note, source='non-gst', eff='2017-07-01')
    m = matches(code)
    if not m:
        return dict(rates=[18], default=18, rules=[], residual=True, conditional=False, guess=False,
                    note=None, source='cbic-9/2025', eff='2025-09-22')
    lmax = max(len(p) for p, _ in m)
    top = [(p, r) for p, r in m if len(p) == lmax]
    # A prefix that the notification itself splits by description (several rates) is never decided by one entry
    full_top = [(p, r) for p, r in top if is_full(r, p)] if len({float(r['rate']) for _, r in top}) == 1 else []
    # A full entry for the most specific prefix decides; otherwise every matching entry is a possibility
    use = full_top if full_top else m
    if full_top:
        use = use + [(p, r) for p, r in m if key(r) in CHAPTER_CONDITION and (p, r) not in use]
    rates = sorted({float(r['rate']) for _, r in use})
    guess = False
    if not full_top and len(rates) == 1 and rates[0] != 18:
        rates = sorted(rates + [18.0])        # the rest of the code falls to Schedule II S. No. 639 (18%)
        guess = True
    # The default: the entry whose words best fit this code's own description, then a taxable entry over an
    # exemption, then the general ("Other ... [other than ...]") entry over a narrow one, then the schedule order
    own_t = stem(set(words(master.get(code, ''))) - GENERIC)
    par_t = stem(set(words(master.get(code[:6], '') + ' ' + master.get(code[:4], ''))) - GENERIC) if len(code) > 4 else set()
    def score(r):
        rw = stem(set(words(positive(r['desc']))) - GENERIC)
        return (len(own_t & rw), len(par_t & rw))
    def is_rest(r):
        return 0 if re.search(r'^\s*(Other|All goods)\b|\[\s*other than', r['desc'], re.I) or restates(r, code[:4]) else 1
    cands = full_top or (top if any(score(r) > (0, 0) for _, r in top) else m)
    pick = sorted(cands,
                  key=lambda pr: (tuple(-x for x in score(pr[1])), 1 if pr[1]['src'] == '10/2025' else 0, is_rest(pr[1]),
                                  SCHED_ORDER[pr[1]['schedule']]))
    dflt_rule = pick[0][1]
    default = float(dflt_rule['rate'])
    srcs = {r['src'] for _, r in use}
    later = [s for s in ('01/2026', '19/2025') if s in srcs]
    source, eff = NOTIF[later[0]] if later else src_of(dflt_rule)
    note = None
    if len(rates) > 1:
        parts = []
        seen = set()
        for _, r in sorted(use, key=lambda pr: (SCHED_ORDER[pr[1]['schedule']], -len(pr[0]))):
            t = f"{rate_txt(float(r['rate']))}: {short(r['desc'])}"
            if t not in seen:
                seen.add(t)
                parts.append(t)
        if guess:
            parts.append('18%: otherwise (goods not elsewhere specified)')
        note = '; '.join(parts[:3]) + ('; …' if len(parts) > 3 else '')
    return dict(rates=rates, default=default, rules=[key(r) for _, r in use], residual=False, conditional=len(rates) > 1,
                guess=guess or any(r.get('uncertain') for _, r in use), note=note, source=source, eff=eff)


def mapped_by_key(keys, code):
    m = matches(code)
    lmax = max((len(p) for p, _ in m), default=0)
    return [r for p, r in m if len(p) == lmax]


codes = sorted(set(master) | set(missing_curated), key=lambda c: (len(c), c))
children = collections.defaultdict(list)
all_codes = set(codes)
for c in codes:
    for L in (2, 4, 6):
        if len(c) > L and c[:L] in all_codes:
            children[c[:L]].append(c)

result = {}
for c in sorted(codes, key=lambda c: -len(c)):
    kids = [k for k in children.get(c, []) if not any(k2 != k and k.startswith(k2) and len(k2) > len(c) for k2 in children.get(c, []) if False)]
    leaves = [k for k in children.get(c, []) if not children.get(k)]
    if not leaves:
        result[c] = leaf(c)
        result[c]['kind'] = 'leaf'
        continue
    own = leaf(c)
    lr = [result[k] for k in leaves]
    rates = sorted({x for l in lr for x in l['rates']})
    cnt = collections.Counter(l['default'] for l in lr)
    if own['rules'] and not own['residual'] and own['default'] in cnt and \
            len({float(r['rate']) for r in mapped_by_key(own['rules'], c)}) == 1:
        default = own['default']
    else:
        default = sorted(cnt.items(), key=lambda kv: (-kv[1], -kv[0]))[0][0]
    note = None
    if len(rates) > 1:
        if len(rates) == len(own['rates']) and own['note'] and set(rates) == set(own['rates']):
            note = own['note']
        else:
            by = collections.Counter()
            for l in lr:
                for x in l['rates']:
                    by[x] += 1
            note = 'Rates differ by tariff item: ' + ', '.join(f"{rate_txt(x)} ({by[x]} of {len(lr)})" for x in rates) + '; pick the 8-digit code'
    srcs = {l['source'] for l in lr}
    later = [s for s in ('cbic-01/2026', 'cbic-19/2025') if s in srcs]
    source = later[0] if later else ('non-gst' if srcs == {'non-gst'} else 'cbic-9/2025' if 'cbic-9/2025' in srcs or own['residual'] else own['source'])
    eff = {'cbic-01/2026': '2026-05-01', 'cbic-19/2025': '2026-02-01', 'non-gst': '2017-07-01'}.get(source, '2025-09-22')
    if source == 'non-gst':
        note = lr[0]['note']
    result[c] = dict(rates=rates, default=default, rules=own['rules'], residual=all(l['residual'] for l in lr), conditional=len(rates) > 1,
                     guess=any(l['guess'] for l in lr), note=note, source=source, eff=eff, kind='parent')

# needs_review: the mapping is not certain (a partial entry whose remainder we sent to 18%, a hand-read entry),
# or a heading whose tariff items differ in a way the note can only summarise
for c, v in result.items():
    v['needs_review'] = bool(v['guess'])

# Bricks (14/2025): the 12% rate sits beside the brick-kiln scheme; flag for a CA
for c, v in result.items():
    if any(k.startswith('14/2025') for k in v['rules']):
        v['needs_review'] = True


def chapter_category(c):
    ch = int(c[:2])
    if ch in (2, 3):
        return 'perishables'
    if ch <= 24:
        return 'food_agri'
    if ch == 25:
        return 'construction'
    if ch == 30:
        return 'pharma'
    if ch == 36:
        return 'hazmat'
    if 27 <= ch <= 38:
        return 'chemicals'
    if ch in (39, 40):
        return 'plastics_rubber'
    if ch == 44 or ch == 94:
        return 'furniture_wood'
    if 47 <= ch <= 49:
        return 'paper_packaging'
    if 50 <= ch <= 63:
        return 'textiles'
    if 68 <= ch <= 70:
        return 'construction'
    if 72 <= ch <= 83:
        return 'steel_metal'
    if ch == 84 or ch == 86 or ch == 88 or ch == 89:
        return 'machinery'
    if ch == 85:
        return 'electronics'
    if ch == 87:
        return 'auto_parts'
    if ch in (33, 34, 64, 65, 66, 67, 91, 92, 95, 96):
        return 'fmcg'
    return 'general'


def fmt(x):
    return str(int(x)) if float(x).is_integer() else str(x)


rows_out = []
for c in sorted(result, key=lambda c: (c[:2], c)):
    v = result[c]
    desc = master.get(c) or c
    rows_out.append({
        'hsn_code': c, 'description': desc, 'gst_rates': '{' + ','.join(fmt(x) for x in v['rates']) + '}',
        'gst_rate': fmt(v['default']), 'rate_note': v['note'] or '', 'chapter': c[:2],
        'needs_review': 'true' if v['needs_review'] else 'false', 'source': v['source'],
        '_eff': v['eff'], '_cat': chapter_category(c),
    })

with open('hsn_master.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['hsn_code', 'description', 'gst_rates', 'gst_rate', 'rate_note', 'chapter', 'needs_review', 'source'])
    for r in rows_out:
        w.writerow([r['hsn_code'], r['description'], r['gst_rates'], r['gst_rate'], r['rate_note'], r['chapter'], r['needs_review'], r['source']])

# ── stats ──
st = {
    'total': len(rows_out),
    'by_default_rate': dict(collections.Counter(r['gst_rate'] for r in rows_out)),
    'by_length': dict(collections.Counter(len(r['hsn_code']) for r in rows_out)),
    'conditional': sum(1 for c in result if result[c]['conditional']),
    'needs_review': sum(1 for r in rows_out if r['needs_review'] == 'true'),
    'residual_18': sum(1 for c in result if result[c]['residual']),
    'by_source': dict(collections.Counter(r['source'] for r in rows_out)),
    'rules_total': len(rules), 'rules_mapped': len(mapped), 'rules_desc_only': len(desc_only),
    'leaf_by_rate': dict(collections.Counter(r['gst_rate'] for r in rows_out if result[r['hsn_code']]['kind'] == 'leaf')),
}
json.dump(st, open('stats.json', 'w'), indent=1)
json.dump({r['hsn_code']: {'eff': r['_eff'], 'cat': r['_cat']} for r in rows_out}, open('extra.json', 'w'))
json.dump({c: {k: v for k, v in result[c].items()} for c in result}, open('result.json', 'w'))
json.dump([{'key': key(r), 'rate': r['rate'], 'col2': r['col2'], 'desc': short(r['desc'], 120)} for r in desc_only], open('desc_only.json', 'w'), indent=1)
print(json.dumps(st, indent=1))
