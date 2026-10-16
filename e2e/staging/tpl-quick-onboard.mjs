// Quick 3PL onboarding (fleetSize given, no PAN/GST required): confirms the account the applicant can log
// into actually resolves as a vendor, not a driver, and has a real email auth identity — the exact gap that
// was breaking "emailed 3PL credentials land on /driver" before the ensure_tpl_partner_auth migration fix.
//
//   node e2e/staging/tpl-quick-onboard.mjs
import { api, check, db, env, DATA, results, tag } from './actors.mjs'

const svc = { apikey: env.SERVICE, Authorization: `Bearer ${env.SERVICE}`, 'content-type': 'application/json' }
const one = async (table, query) => (await db('GET', table, { query })).body?.[0]

async function run() {
  console.log('=== Quick 3PL onboarding: role and auth identity after submission ===')
  const T = tag()
  const email = `tpl-quick-${T}@margix.test`
  const payload = {
    companyName: `Quick Haulers ${T}`, email, phone: '9876543211',
    fleetSize: '1-5', truckType: 'Open Body Truck', operatingFrom: 'Mumbai',
  }
  const posted = await api(null, 'POST', '/tpl/onboard', payload)
  check('1.1 the quick application is accepted', posted.status === 200, `${posted.status} ${JSON.stringify(posted.body).slice(0, 200)}`)
  const partnerId = posted.body?.data?.id ?? posted.body?.id
  check('1.2 a partner row id came back', !!partnerId, JSON.stringify(posted.body).slice(0, 200))

  const partner = await one('tpl_partners', `id=eq.${partnerId}&select=id,status,user_id,email`)
  check('2.1 the partner starts pending (needs platform review)', partner?.status === 'pending', JSON.stringify(partner))
  check('2.2 a user_id got linked during onboarding', !!partner?.user_id, JSON.stringify(partner))

  if (partner?.user_id) {
    const user = await one('users', `id=eq.${partner.user_id}&select=id,role,is_active`)
    check('3.1 the linked account resolves as vendor, not driver or null', user?.role === 'vendor', JSON.stringify(user))
    check('3.2 the linked account is active', user?.is_active === true, JSON.stringify(user))

    const authRes = await fetch(`${DATA}/auth/v1/admin/users/${partner.user_id}`, { headers: svc })
    const authUser = await authRes.json()
    const hasEmailIdentity = Array.isArray(authUser?.identities) && authUser.identities.some(i => i.provider === 'email')
    check('4.1 the auth user has an email provider identity (password sign-in will work)', hasEmailIdentity, JSON.stringify(authUser?.identities))
    check('4.2 the auth user email matches and is confirmed', authUser?.email?.toLowerCase() === email && !!authUser?.email_confirmed_at, JSON.stringify({ email: authUser?.email, confirmed: authUser?.email_confirmed_at }))
  }

  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1 })
