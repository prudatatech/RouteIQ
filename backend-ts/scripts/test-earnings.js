const axios = require('axios');

async function main() {
  try {
    // 1. Get OTP
    const res1 = await axios.post('http://localhost:8000/api/v1/auth/driver/send-otp', {
      phone: '+917360095009'
    });
    console.log('OTP res:', res1.data);
    
    // 2. Verify OTP (assuming OTP is written to console or default 123456)
    // Looking at the codebase, OTP might be printed to the backend console.
    // I'll just use a mock or check how to bypass. Let's see if 123456 works.
    
    // actually, let's just use the Supabase anon key and login? No, it's handled by backend.
  } catch (e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
main();
