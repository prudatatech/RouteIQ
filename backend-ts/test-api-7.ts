import { supabase } from './src/core/supabase';
const axios = require('axios');

async function run() {
  const vLng = 86.4460945;
  const vLat = 23.7842768;
  const lng = 86.417065;
  const lat = 23.737735;
  
  try {
    console.log(`Fetching OSRM: https://router.project-osrm.org/route/v1/driving/${vLng},${vLat};${lng},${lat}?overview=false`);
    const osrmRes = await axios.get(`https://router.project-osrm.org/route/v1/driving/${vLng},${vLat};${lng},${lat}?overview=false`);
    console.log('OSRM Res:', osrmRes.data);
  } catch (e: any) {
    console.error('Error:', e.response?.data || e.message);
  }
}
run();
