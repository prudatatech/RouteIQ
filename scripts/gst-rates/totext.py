"""2. Turn the downloaded PDFs into layout text with pdftotext (poppler)."""
import sys
import os, subprocess
WORK = os.environ.get('GST_WORK') or sys.exit('Set GST_WORK to the folder that holds the downloads (never commit them)')
os.chdir(WORK)
for f in ['ctr09-2025', 'ctr10-2025', 'ctr11-2025', 'ctr14-2025', 'ctr19-2025', 'ctr01-2026']:
    subprocess.run(['/opt/homebrew/bin/pdftotext', '-layout', f + '.pdf', f + '.txt'])
    pages = subprocess.run(['pdfinfo', f + '.pdf'], capture_output=True, text=True).stdout
    pg = [l for l in pages.splitlines() if l.startswith('Pages')]
    print(f, sum(1 for _ in open(f + '.txt', errors='ignore')), pg)
