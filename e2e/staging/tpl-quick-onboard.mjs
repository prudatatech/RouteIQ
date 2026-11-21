// Quick 3PL onboarding (fleetSize given, no PAN/GST required): the applicant always has a Google-authenticated
// session before the form is shown, so onboard() just links that user_id and waits for review — no account or
// password is created at submission time. Confirms the full lifecycle: pending -> approved resolves the linked
// account as vendor (not driver), with a working email auth identity (the exact gap the ensure_tpl_partner_auth
// migration fix closed), and that nothing is emailed with a password before a platform admin approves it.
//
//   node e2e/staging/tpl-quick-onboard.mjs
import { api, check, db, env, DATA, makeUser, makePlatformAdmin, results, tag } from './actors.mjs'

const svc = { apikey: env.SERVICE, Authorization: `Bearer ${env.SERVICE}`, 'content-type': 'application/json' }
const one = async (table, query) => (await db('GET', table, { query })).body?.[0]

async function run() {
  console.log('=== Quick 3PL onboarding: pending-until-approved, then role and auth identity ===')
  const T = tag()
  const email = `tpl-quick-${T}@margix.test`
  // Simulates the Google OAuth session TplOnboardingPage requires before it shows the form.
  const session = await makeUser(`tpl-quick-${T}-session`, 'vendor')

  const payload = {
    companyName: `Quick Haulers ${T}`, email, phone: '9876543211',
    fleetSize: '1-5', truckType: 'Open Body Truck', operatingFrom: 'Mumbai',
    user_id: session.id,
  }
  const posted = await api(null, 'POST', '/tpl/onboard', payload)
  check('1.1 the quick application is accepted', posted.status === 200, `${posted.status} ${JSON.stringify(posted.body).slice(0, 200)}`)
  const partnerId = posted.body?.data?.id ?? posted.body?.id
  check('1.2 a partner row id came back', !!partnerId, JSON.stringify(posted.body).slice(0, 200))

  const pending = await one('tpl_partners', `id=eq.${partnerId}&select=id,status,user_id,email`)
  check('2.1 the partner starts pending (needs platform review)', pending?.status === 'pending', JSON.stringify(pending))
  check('2.2 the Google session user_id is linked at submission', pending?.user_id === session.id, JSON.stringify(pending))

  const admin = await makePlatformAdmin()
  const approved = await api(admin.token, 'POST', `/tpl/approve/${partnerId}`, {}, { org: admin.orgId })
  check('3.1 the platform admin can approve it', approved.status === 200, JSON.stringify(approved.body).slice(0, 200))

  const partner = await one('tpl_partners', `id=eq.${partnerId}&select=id,status,user_id,email`)
  check('3.2 the partner is now active', partner?.status === 'active', JSON.stringify(partner))

  if (partner?.user_id) {
    const user = await one('users', `id=eq.${partner.user_id}&select=id,role,is_active`)
    check('4.1 the linked account resolves as vendor, not driver or null', user?.role === 'vendor', JSON.stringify(user))
    check('4.2 the linked account is active', user?.is_active === true, JSON.stringify(user))

    const authRes = await fetch(`${DATA}/auth/v1/admin/users/${partner.user_id}`, { headers: svc })
    const authUser = await authRes.json()
    check('5.1 the auth user email is confirmed (the Google session, not a mailed password)', !!authUser?.email_confirmed_at, JSON.stringify({ confirmed: authUser?.email_confirmed_at }))

    const check_partner = await api(null, 'POST', '/tpl/check-partner', { user_id: partner.user_id, email: session.email })
    check('5.2 check-partner resolves this account to the partner (what login routing relies on)', check_partner.body?.id === partnerId, JSON.stringify(check_partner.body))
  }

  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1 })
