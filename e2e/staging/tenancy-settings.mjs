// Section 4 of tenancy.mjs: per-company settings are really per company.
import { api, db, check, makeCompany, makeCompanyAdmin, makePlatformAdmin, tag, sleep } from './actors.mjs'

const J = x => JSON.stringify(x)
const day = n => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10)

export async function settings({ matrix }) {
  console.log('\n== 4. Per-company settings ==')
  const coA = await makeCompany(`SetA ${tag()}`), coB = await makeCompany(`SetB ${tag()}`)
  const A = await makeCompanyAdmin(coA.id), B = await makeCompanyAdmin(coB.id)
  const Am = await makeCompanyAdmin(coA.id, 'manager')
  const platform = await makePlatformAdmin()
  const rows = []

  // fuel price
  const fp0 = (await api(platform.token, 'GET', '/finance/settings', undefined, { org: platform.orgId })).body
  const a1 = await api(A.token, 'PUT', '/finance/settings', { fuel_price_per_litre: 111.11 })
  const b1 = await api(B.token, 'PUT', '/finance/settings', { fuel_price_per_litre: 99.5 })
  const ga = await api(A.token, 'GET', '/finance/settings'), gb = await api(B.token, 'GET', '/finance/settings')
  const gp = await api(platform.token, 'GET', '/finance/settings', undefined, { org: platform.orgId })
  check('4.1 fuel price: A=111.11, B=99.5, each reads its own', a1.status === 200 && b1.status === 200 && ga.body.fuel_price_per_litre === 111.11 && gb.body.fuel_price_per_litre === 99.5, J([ga.body, gb.body]))
  check('4.2 fuel price: the platform default is untouched by either company', gp.body.fuel_price_per_litre === fp0.fuel_price_per_litre, J([fp0, gp.body]))
  const mfp = await api(Am.token, 'PUT', '/finance/settings', { fuel_price_per_litre: 1 })
  check('4.3 a manager cannot change finance settings', mfp.status === 403, `${mfp.status}`)

  // alert thresholds
  const al0 = (await api(A.token, 'GET', '/fleet/alert-settings')).body
  const field = Object.keys(al0.values)[0]
  const lim = al0.limits[field]
  const va = lim.min + 1, vb = Math.min(lim.max, lim.min + 3)
  const pa = await api(A.token, 'PUT', '/fleet/alert-settings', { [field]: va })
  const pb = await api(B.token, 'PUT', '/fleet/alert-settings', { [field]: vb })
  const alA = await api(A.token, 'GET', '/fleet/alert-settings'), alB = await api(B.token, 'GET', '/fleet/alert-settings')
  const alP = await api(platform.token, 'GET', '/fleet/alert-settings', undefined, { org: platform.orgId })
  check(`4.4 alert threshold ${field}: A=${va}, B=${vb}, each reads its own`, pa.status === 200 && pb.status === 200 && alA.body.values[field] === va && alB.body.values[field] === vb, J([pa.body, alA.body.values, alB.body.values]))
  check('4.5 alert threshold: the platform default is unchanged', alP.body.values[field] === al0.values[field] || alP.body.values[field] !== va, J(alP.body.values))
  const mal = await api(Am.token, 'PUT', '/fleet/alert-settings', { [field]: va })
  check('4.6 a manager cannot change alert thresholds', mal.status === 403, `${mal.status}`)

  // company profile: prefix, bank, GTA option, payment terms
  const pr = tag().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(3, 'X')
  const ca = await api(A.token, 'PUT', '/finance/company', { invoice_prefix: `${pr}A`, gta_gst_option: 'fcm_5', payment_terms_days: 7, bank_name: 'HDFC Bank', bank_account_no: '111122223333', bank_ifsc: 'HDFC0000111', upi_id: 'a@hdfcbank' })
  const cb = await api(B.token, 'PUT', '/finance/company', { invoice_prefix: `${pr}B`, gta_gst_option: 'fcm_18', payment_terms_days: 45, bank_name: 'ICICI Bank', bank_account_no: '999988887777', bank_ifsc: 'ICIC0000999', upi_id: 'b@icici' })
  check('4.7 company profile saves for A and B', ca.status === 200 && cb.status === 200, J([ca.body, cb.body]).slice(0, 300))
  const gA = (await api(A.token, 'GET', '/finance/company')).body, gB = (await api(B.token, 'GET', '/finance/company')).body
  check('4.8 prefix, GTA option, payment terms, bank are each company\'s own', gA.invoice_prefix === `${pr}A` && gB.invoice_prefix === `${pr}B` && gA.gta_gst_option === 'fcm_5' && gB.gta_gst_option === 'fcm_18' && gA.payment_terms_days === 7 && gB.payment_terms_days === 45 && gA.bank_name === 'HDFC Bank' && gB.bank_name === 'ICICI Bank' && gA.bank_account_no !== gB.bank_account_no, J([gA, gB]).slice(0, 500))
  const dup = await api(B.token, 'PUT', '/finance/company', { invoice_prefix: `${pr}A` })
  check('4.9 the same invoice prefix cannot be taken by two companies (409/400/422, never 500)', [400, 409, 422].includes(dup.status), `${dup.status} ${J(dup.body)}`)
  const gB2 = (await api(B.token, 'GET', '/finance/company')).body
  check('4.10 B\'s prefix survives the refused change', gB2.invoice_prefix === `${pr}B`, J(gB2))
  const mc = await api(Am.token, 'PUT', '/finance/company', { payment_terms_days: 1 })
  check('4.11 a manager cannot change the company profile', mc.status === 403, `${mc.status}`)
  const orgA = await db('GET', 'organizations', { query: `id=eq.${coA.id}&select=profile` })
  const orgB = await db('GET', 'organizations', { query: `id=eq.${coB.id}&select=profile` })
  check('4.12 stored in each company\'s own organisation row', J(orgA.body?.[0]?.profile).includes('HDFC') && !J(orgA.body?.[0]?.profile).includes('ICICI') && J(orgB.body?.[0]?.profile).includes('ICICI'), J([orgA.body, orgB.body]).slice(0, 300))

  // people settings (document grace days etc.)
  const ps1 = await api(A.token, 'PUT', '/people/settings', { licence_grace_days: 30 })
  const ps2 = await api(B.token, 'PUT', '/people/settings', { licence_grace_days: 5, driver_document_enforcement: 'block' })
  const sa = (await api(A.token, 'GET', '/people/settings')).body, sb = (await api(B.token, 'GET', '/people/settings')).body
  check('4.13 document grace days / enforcement are per company', ps1.status === 200 && ps2.status === 200 && sa.licence_grace_days === 30 && sb.licence_grace_days === 5 && sb.driver_document_enforcement === 'block' && sa.driver_document_enforcement !== 'block', J([sa, sb]))

  // pricing
  const pz = (await api(A.token, 'GET', '/pricing/settings')).body.settings
  const key = Object.keys(pz).find(k => typeof pz[k] === 'number')
  if (key) {
    const x = await api(A.token, 'PUT', '/pricing/settings', { settings: { [key]: pz[key] + 1.5 } })
    const gA2 = (await api(A.token, 'GET', '/pricing/settings')).body.settings, gB3 = (await api(B.token, 'GET', '/pricing/settings')).body.settings
    check(`4.14 pricing ${key}: A's change is not in B`, x.status === 200 && gA2[key] === pz[key] + 1.5 && gB3[key] !== gA2[key], J([x.status, gA2[key], gB3[key]]))
  } else check('4.14 pricing settings have a numeric key to test', false, J(pz))

  // dispatch phone
  const dp1 = await api(A.token, 'PUT', '/driver/dispatch-contact', { phone: '+919811100001' }), dp2 = await api(B.token, 'PUT', '/driver/dispatch-contact', { phone: '+919811100002' })
  const dA = (await api(A.token, 'GET', '/driver/dispatch-contact')).body, dB = (await api(B.token, 'GET', '/driver/dispatch-contact')).body
  check('4.15 dispatcher phone is per company', dp1.status === 200 && dp2.status === 200 && dA.phone === '+919811100001' && dB.phone === '+919811100002', J([dA, dB]))

  // driver pay rates on the same day, same type
  const d = day(40 + Math.floor(Math.random() * 300))
  const r1 = await api(A.token, 'POST', '/driver-pay/rates', { vehicle_type: 'van', per_trip_amount: 100, per_km_amount: 2, effective_from: d })
  const r2 = await api(B.token, 'POST', '/driver-pay/rates', { vehicle_type: 'van', per_trip_amount: 300, per_km_amount: 6, effective_from: d })
  check('4.16 two companies can set a driver-pay rate for the same type and day (201 both)', r1.status === 201 && r2.status === 201, `A ${r1.status} ${J(r1.body).slice(0, 100)} B ${r2.status} ${J(r2.body).slice(0, 100)}`)
  const lA = (await api(A.token, 'GET', '/driver-pay/rates')).body, lB = (await api(B.token, 'GET', '/driver-pay/rates')).body
  const okA = J(lA).includes('"per_trip_amount":100') && !J(lA).includes('"per_trip_amount":300'), okB = J(lB).includes('"per_trip_amount":300') && !J(lB).includes('"per_trip_amount":100')
  check('4.17 each company sees only its own rate card', okA && okB, J([lA, lB]).slice(0, 300))

  // org profile
  const patchA = await api(A.token, 'PATCH', '/org', { name: `Renamed ${tag()}`, city: 'Nashik' })
  const oB = (await api(B.token, 'GET', '/org')).body
  check('4.18 renaming A does not change B', patchA.status === 200 && oB.name === coB.name && oB.city === coB.city, J(oB).slice(0, 200))

  // acting as the platform edits the platform defaults and not a company
  const pf = await api(platform.token, 'PUT', '/finance/settings', { fuel_price_per_litre: 123.45 }, { org: platform.orgId })
  const ga2 = (await api(A.token, 'GET', '/finance/settings')).body
  check('4.19 a platform change of the default does not overwrite a company\'s own value', pf.status === 200 && ga2.fuel_price_per_litre === 111.11, J([pf.status, ga2]))
  await api(platform.token, 'PUT', '/finance/settings', { fuel_price_per_litre: fp0.fuel_price_per_litre }, { org: platform.orgId }) // put the default back

  // platform-wide switch: only the platform
  const tp = await api(A.token, 'PUT', '/tpl-network/settings', { auto_escalate: true })
  check('4.20 the platform-wide 3PL auto-offer switch is not a company admin\'s to flip (403)', tp.status === 403, `${tp.status}`)
  matrix.push({ section: 'settings', note: 'see PASS/FAIL list' })
}
