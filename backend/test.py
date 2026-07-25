import urllib.request
import urllib.error
try:
    print(urllib.request.urlopen('http://localhost:8000/api/v1/routes/?status=active').getcode())
except urllib.error.HTTPError as e:
    print(e.code)
except Exception as e:
    print(e)
