const axios = require('axios');

async function main() {
  try {
    const res = await axios.get('http://localhost:8000/api/v1/auth/driver/earnings-test');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error(e.message);
  }
}
main();
