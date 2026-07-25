const fs = require('fs');
let code = fs.readFileSync('src/pages/CustomerTrackingPage.tsx', 'utf8');

const start = code.indexOf('if (dLat && dLng && !routeFetchedRef.current) {');
const end = code.indexOf('  }, [liveVehicle?.lat, liveVehicle?.lng');

const replacement = `if (dLat && dLng && !routeFetchedRef.current) {
      routeFetchedRef.current = true
      if (trackingId) {
        fetch(\`https://api.mapbox.com/directions/v5/mapbox/driving/\${lng},\${lat};\${dLng},\${dLat}?geometries=geojson&access_token=\${MAPBOX_TOKEN}\`)
          .then(r => r.json())
          .then(data => {
            if (data.routes?.[0]) {
              const c = data.routes[0].geometry.coordinates
              setFullRouteCoords(c); setActiveRouteCoords(c)
              const calcEta = formatEta(data.routes[0].duration / 60)
              setEta(calcEta); if (onEtaUpdate) onEtaUpdate(calcEta)
            }
          }).catch(console.error)
      }
    }
`;

code = code.slice(0, start) + replacement + code.slice(end);
fs.writeFileSync('src/pages/CustomerTrackingPage.tsx', code);
console.log('Fixed CustomerTrackingPage.tsx');
