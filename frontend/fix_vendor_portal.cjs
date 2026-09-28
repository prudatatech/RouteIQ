const fs = require('fs');
const file = 'd:/routeiq-main/frontend/src/pages/VendorPortalPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const target = `onClick={() => {
                      navigate(\`/vendor/request?query=\${encodeURIComponent(s.place_name)}&lat=\${s.center[1]}&lng=\${s.center[0]}\`)
                    }}`;

const repl = `onClick={async () => {
                      try {
                        let url = \`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?magicKey=\${s.magicKey}&f=json\`;
                        let res = await fetch(url);
                        let data = await res.json();
                        
                        if (!data.candidates || data.candidates.length === 0) {
                          url = \`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=\${encodeURIComponent(s.place_name)}&f=json\`;
                          res = await fetch(url);
                          data = await res.json();
                        }
                        
                        if (data.candidates && data.candidates.length > 0) {
                          const loc = data.candidates[0].location;
                          navigate(\`/vendor/request?query=\${encodeURIComponent(s.place_name)}&lat=\${loc.y}&lng=\${loc.x}\`);
                        } else {
                          navigate(\`/vendor/request?query=\${encodeURIComponent(s.place_name)}\`);
                        }
                      } catch (e) {
                        navigate(\`/vendor/request?query=\${encodeURIComponent(s.place_name)}\`);
                      }
                    }}`;

if (content.includes(target)) {
    content = content.replace(target, repl);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Replaced by exact match');
} else {
    // try regex ignoring spaces
    const re = /onClick=\{\(\)\s*=>\s*\{\s*navigate\(`\/vendor\/request\?query=\$\{encodeURIComponent\(s\.place_name\)\}&lat=\$\{s\.center\[1\]\}&lng=\$\{s\.center\[0\]\}`\)\s*\}\}/g;
    if (re.test(content)) {
        content = content.replace(re, repl);
        fs.writeFileSync(file, content, 'utf8');
        console.log('Replaced by regex');
    } else {
        console.log('Could not find target');
    }
}
