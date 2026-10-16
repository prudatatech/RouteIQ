// The finance org role, on the TEST stage: Money, driver pay and reports open for it, the operations
// screens stay refused. Checks the real staging deployment, not a mock.
//
//   node e2e/staging/finance-role.mjs
import { api, check, results, makeCompany, makeCompanyAdmin } from './actors.mjs'

const get = (token, path, opts) => api(token, 'GET', path, undefined, opts)
const msg = r => (r.body && (r.body.detail || r.body.error || r.body.message)) || JSON.stringify(r.body)?.slice(0, 160)

async function run() {
  console.log('=== The finance org role: Money and reports open, operations stays refused ===')
  const co = await makeCompany()
  const finance = await makeCompanyAdmin(co.id, 'finance')
  const manager = await makeCompanyAdmin(co.id, 'manager')

  const money = await get(finance.token, '/finance/unpriced', { org: co.id })
  check('1.1 the finance role reads Money', money.status === 200, `${money.status} ${msg(money)}`)
  const rates = await get(finance.token, '/driver-pay/rates', { org: co.id })
  check('1.2 the finance role reads driver pay rates', rates.status === 200, `${rates.status} ${msg(rates)}`)
  const analytics = await get(finance.token, '/analytics/metrics', { org: co.id })
  check('1.3 the finance role opens reports/analytics', analytics.status === 200, `${analytics.status} ${msg(analytics)}`)

  const today = await get(finance.token, '/ops/today', { org: co.id })
  check('2.1 the finance role is refused the operations screen (403)', today.status === 403, `${today.status} ${msg(today)}`)
  const vehicleAction = await api(finance.token, 'POST', '/vehicles/00000000-0000-4000-8000-000000000001/status', { status: 'available' }, { org: co.id })
  check('2.2 the finance role cannot act on fleet vehicles (403)', vehicleAction.status === 403, `${vehicleAction.status} ${msg(vehicleAction)}`)

  // A manager, the mirror image: operations yes, Money still refused
  const managerToday = await get(manager.token, '/ops/today', { org: co.id })
  check('3.1 setup: a manager still opens operations', managerToday.status === 200, `${managerToday.status} ${msg(managerToday)}`)
  const managerMoney = await get(manager.token, '/finance/unpriced', { org: co.id })
  check('3.2 a manager is still refused Money (403)', managerMoney.status === 403, `${managerMoney.status} ${msg(managerMoney)}`)

  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1 })
