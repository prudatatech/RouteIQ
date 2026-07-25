import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: 'd:/routeiq-main/backend-ts/.env' })

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function updatePendingVendors() {
  console.log('Fetching users to match emails with vendor_profiles...')
  
  const { data: users, error: usersErr } = await supabase.auth.admin.listUsers()
  if (usersErr) {
    console.error('Error fetching users', usersErr)
    return
  }

  const { data: profiles, error: profErr } = await supabase.from('vendor_profiles').select('*')
  if (profErr) {
    console.error('Error fetching profiles', profErr)
    return
  }

  for (const profile of profiles) {
    if (profile.company_name === 'New Vendor (Pending Setup)' || profile.company_name.includes(' Enterprise')) {
      const user = users.users.find(u => u.id === profile.id)
      if (user && user.email) {
        console.log(`Updating vendor ${profile.id} company_name to ${user.email}`)
        await supabase.from('vendor_profiles').update({ company_name: user.email }).eq('id', profile.id)
      }
    }
  }
  console.log('Done!')
}

updatePendingVendors()
