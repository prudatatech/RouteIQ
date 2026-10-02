"""1. Download the CBIC rate notifications (official copies) from taxinformation.cbic.gov.in into $GST_WORK.

The site serves each notification as base64 JSON at /api/cbic-notification-msts/download/<id>/ENG; the ids come from
/api/cbic-notification-msts/fetchNotificationByCategory/1000001/Central%20Tax%20(Rate). docs/gst-rates.md lists them.
"""
import base64, json, subprocess, sys, os
WORK = os.environ.get('GST_WORK') or sys.exit('Set GST_WORK to the folder that holds the downloads (never commit them)')
os.chdir(WORK)
items = [(1010436, 'ctr09-2025'), (1010437, 'ctr10-2025'), (1010441, 'ctr14-2025'), (1010438, 'ctr11-2025'),
         (1010534, 'ctr19-2025'), (1010645, 'ctr01-2026')]
for nid, name in items:
    if os.path.exists(name + '.pdf'):
        continue
    url = f'https://taxinformation.cbic.gov.in/api/cbic-notification-msts/download/{nid}/ENG'
    out = subprocess.run(['curl', '-s', '-m', '180', '--http1.1', '-A', 'Mozilla/5.0', url], capture_output=True).stdout
    d = json.loads(out)
    open(name + '.pdf', 'wb').write(base64.b64decode(d['data']))
    print(name, d.get('fileName'))
