"""4. Parse the official CBIC rate notifications (pdftotext -layout output) into a rule table.

Output: rules.json, a list of
  {src, schedule, sno, rate, col2, prefixes, excludes, any_chapter, desc}
"""
import sys
import json, os, re

WORK = os.environ.get('GST_WORK') or sys.exit('Set GST_WORK to the folder that holds the downloads (never commit them)')
os.chdir(WORK)

SCHED_RATE = {'I': 5, 'II': 18, 'III': 40, 'IV': 3, 'V': 0.25, 'VI': 1.5, 'VII': 28}
CODE = r'\d{2,8}(?:\s\d{2}(?!\d)){0,3}'
ENTRY = re.compile(r'^\s{0,12}(\d{1,3}[A-Z]?)\.\s+(.*)$')
SCHED = re.compile(r'^\s*Schedule\s*[-–]?\s*(I|II|III|IV|V|VI|VII)\s*[–-]\s*[\d.]+\s*%')
# What col2 can hold: codes, separators and the exclusion phrases
COL2_HEAD = re.compile(
    r'^((?:Any\s+[Cc]hapter|' + CODE + r')'
    r'(?:\s*(?:,|or|and|to)?\s*(?:or any [Cc]hapter|' + CODE + r'(?![\d])|\((?:Except|except|other than)[^)]*\)?|\[other than[^\]]*\]?))*\s*,?)'
)
CONT2 = re.compile(r'^(?:' + CODE + r'|\(?Except|\[?other than|\(other than|\d{2}\s?\d{2}\))')


def norm_code(s):
    return re.sub(r'\s+', '', s)


def split_col2(col2):
    """prefixes and exclusions from the code column."""
    any_ch = bool(re.search(r'any\s+chapter', col2, re.I))
    ex = []
    m = re.search(r'[\[(]\s*(?:Except|except|other than)(.*?)(?:[\])]|$)', col2)
    main = col2
    if m:
        ex = [norm_code(c) for c in re.findall(CODE, m.group(1))]
        main = col2[:m.start()] + col2[m.end():]
    pref = [norm_code(c) for c in re.findall(CODE, main)]
    for a, b in re.findall(r'(\d{4})\s+to\s+(\d{4})', main):
        pref += [f'{h:04d}' for h in range(int(a), int(b) + 1)]
    pref = list(dict.fromkeys(pref))
    return pref, ex, any_ch


def parse(path, src, default_sched=None, default_rate=None):
    lines = open(path, encoding='utf-8', errors='ignore').read().replace('\f', '\n').split('\n')
    rules = []
    sched = default_sched
    cur = None
    in_body = default_sched is not None
    for raw in lines:
        if re.match(r'^\s*Explanation\.?\s*[—–-]+\s*For the purposes of this (notification|Schedule)', raw):
            break
        if re.match(r'^\s*List 1 \[See', raw):
            # The list of assistive devices (Schedule I S. No. 478) sits between Schedules I and II
            in_body = False
            cur = None
            continue
        ms = SCHED.match(raw)
        if ms:
            sched = ms.group(1)
            in_body = True
            cur = None
            continue
        if not in_body or not raw.strip():
            continue
        if re.match(r'^\s*(S\.\s*No|\(1\)|No\.|heading|Heading|Sub-heading|item\b|Tariff item|Chapter)', raw.strip()) and (cur is None or 'Description' in raw or raw.strip().startswith('(1)')):
            # table header lines
            if 'Description' in raw or raw.strip().startswith('(1)') or raw.strip() in ('item', 'heading/Tariff item', 'Heading/Tariff item'):
                continue
        me = ENTRY.match(raw)
        if me and (COL2_HEAD.match(me.group(2).strip()) or me.group(2).strip().lower().startswith('any')):
            body = me.group(2).rstrip()
            mc = COL2_HEAD.match(body.strip())
            col2 = mc.group(1).strip() if mc else ''
            desc = body.strip()[len(mc.group(1)):].strip() if mc else body.strip()
            cur = {'src': src, 'schedule': sched, 'sno': me.group(1), 'rate': default_rate if default_rate is not None else SCHED_RATE[sched],
                   'col2': col2, 'desc': desc, 'desc_col': raw.find(desc[:12]) if desc else 40}
            rules.append(cur)
            continue
        if cur is None:
            continue
        indent = len(raw) - len(raw.lstrip())
        s = raw.strip()
        # A code-column continuation: starts with a code fragment and sits left of the description column
        if indent < min(cur['desc_col'] - 4, 30) and CONT2.match(s):
            m2 = COL2_HEAD.match(s) or re.match(r'^([^A-Za-z]*?(?:\)|\]|$))', s)
            # exclusion continuation like "19 21, 2403 19 29)"
            mm = re.match(r'^([\d\s,]+[\])]?)(\s{2,}|$)(.*)$', s)
            if mm:
                cur['col2'] += ' ' + mm.group(1).strip()
                rest = mm.group(3).strip()
            elif m2:
                cur['col2'] += ' ' + m2.group(1).strip()
                rest = s[len(m2.group(1)):].strip()
            else:
                rest = s
            if rest:
                cur['desc'] += ' ' + rest
            continue
        cur['desc'] += ' ' + s
    for r in rules:
        r['desc'] = re.sub(r'\s+', ' ', r['desc']).strip()
        r['col2'] = re.sub(r'\s+', ' ', r['col2']).strip()
        r['prefixes'], r['excludes'], r['any_chapter'] = split_col2(r['col2'])
        r.pop('desc_col', None)
    return rules


def main():
    rules = parse('ctr09-2025.txt', '9/2025')
    # Exemption notification 10/2025 (nil)
    ex = parse('ctr10-2025.txt', '10/2025', default_sched='NIL', default_rate=0)
    # Bricks, 14/2025 (CGST 6% => GST 12%)
    br = parse('ctr14-2025.txt', '14/2025', default_sched='BRICKS', default_rate=12)
    json.dump({'n9': rules, 'n10': ex, 'n14': br}, open('rules_raw.json', 'w'), indent=1)
    from collections import Counter
    print('9/2025 by schedule', Counter(r['schedule'] for r in rules))
    print('10/2025', len(ex), '14/2025', len(br))


if __name__ == '__main__':
    main()
