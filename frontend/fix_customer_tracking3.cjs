const fs = require('fs');
let code = fs.readFileSync('src/pages/CustomerTrackingPage.tsx', 'utf8');

// 1. Remove telemetryWS
const wsRegex = /const ws = telemetryWS\.connect.*?\n\s+wsAlive = false; return \} \/\/ WS delivered data, skip poll\n/s;
code = code.replace(wsRegex, `// WebSocket removed for public page, rely purely on HTTP polling
`);

// 2. Remove ws.close()
code = code.replace(/ws\.close\(\)\n/g, '');

// 3. Fix the routing logic to use OSRM
const routeRegex = /fetch\(\`\/api\/v1\/shipments\/track\/\$\{trackingId\}\/route\?lat=\$\{lat\}\&lng=\$\{lng\}\&dLat=\$\{dLat\}\&dLng=\$\{dLng\}\`\).*?\}\)\.catch\(console\.error\)\n\s+\}\)/s;

const newRouteCode = `fetch(\`https://router.project-osrm.org/route/v1/driving/\${lng},\${lat};\${dLng},\${dLat}?overview=full&geometries=geojson\`)
        .then(r => r.json())
        .then(data => {
          if (data.routes?.[0]) {
            const c = data.routes[0].geometry.coordinates;
            setFullRouteCoords(c);
            setActiveRouteCoords(c);
            const calcEta = formatEta(data.routes[0].duration / 60);
            setEta(calcEta);
            if (onEtaUpdate) onEtaUpdate(calcEta);
          }
        }).catch(console.error)`;

code = code.replace(routeRegex, newRouteCode);

fs.writeFileSync('src/pages/CustomerTrackingPage.tsx', code);
console.log('Fixed tracking page');
