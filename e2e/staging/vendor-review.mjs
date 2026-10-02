// Platform vendor review on the test stage: registry, detail, ask for more details, answer, approve.
import { api, makePlatformAdmin, makeVendor, putSigned, check } from './actors.mjs'

const pa = await makePlatformAdmin()
const P = (m, p, b) => api(pa.token, m, p, b, { org: pa.orgId })

// a vendor with a business profile but no KYC yet must be listed
const fresh = await makeVendor({ approved: false })
const list = await P('GET', `/vendor/registry?q=${encodeURIComponent(fresh.email.split('@')[0])}`)
check('registry lists a vendor who has not submitted KYC', list.status === 200 && list.body.items?.some(v => v.id === fresh.id && v.kyc_status === 'pending'), JSON.stringify(list.body).slice(0, 200))
const d0 = await P('GET', `/vendor/registry/${fresh.id}`)
check('detail shows the business profile and account', d0.status === 200 && d0.body.business?.gstin && d0.body.account?.email === fresh.email, JSON.stringify(d0.body).slice(0, 240))

// a company admin cannot use it
const co = await api(fresh.token, 'GET', '/vendor/registry')
check('a vendor cannot read the registry', co.status === 403, `${co.status}`)

// submit KYC, then ask for more
const k = await api(fresh.token, 'POST', '/vendor/kyc/submit', { companyName: 'Flow Traders', gstNumber: '27AAPFU0939F1ZV', city: 'Mumbai', address: 'Plot 9', lat: 19.1, lng: 72.8, kycData: { data: { panNumber: 'AAPFU0939F', contactPerson: 'UAT', mobileNumber: '9876501234' } } })
check('vendor submits KYC', k.status < 300, JSON.stringify(k.body).slice(0, 160))
const ask = await P('POST', `/vendor/kyc/${fresh.id}/request-info`, { message: 'Please add these', items: [{ label: 'Latest GST return', kind: 'document' }, { label: 'Years in business', kind: 'text', hint: 'Number of years' }] })
check('platform asks for more details', ask.status === 201 || ask.status === 200, `${ask.status} ${JSON.stringify(ask.body).slice(0, 200)}`)
const approveEarly = await P('PUT', `/vendor/kyc/${fresh.id}/approve`, {})
check('cannot approve while details are asked for', approveEarly.status === 409, `${approveEarly.status}`)

const reqs = await api(fresh.token, 'GET', '/vendor/kyc/requests')
const open = Array.isArray(reqs.body) ? reqs.body[0] : reqs.body?.items?.[0]
check('vendor sees the open request', reqs.status === 200 && open?.items?.length === 2, JSON.stringify(reqs.body).slice(0, 200))

const link = await api(fresh.token, 'POST', '/vendor/kyc/upload-url', { key: 'other', content_type: 'image/png', size: 70 })
const path = await putSigned(link.body)
const doc = open.items.find(i => i.kind === 'document'), txt = open.items.find(i => i.kind === 'text')
const resp = await api(fresh.token, 'POST', '/vendor/kyc/respond', { request_id: open.id, answers: [{ key: doc.key, document_path: path }, { key: txt.key, text: '7' }] })
check('vendor answers', resp.status === 200 && resp.body.kyc_status === 'submitted', `${resp.status} ${JSON.stringify(resp.body).slice(0, 160)}`)

const d1 = await P('GET', `/vendor/registry/${fresh.id}`)
check('detail shows the answered request and the documents', d1.body.info_requests?.[0]?.status === 'answered' && d1.body.kyc?.documents?.length >= 1, JSON.stringify(d1.body.kyc).slice(0, 240))
const ok = await P('PUT', `/vendor/kyc/${fresh.id}/approve`, {})
check('platform approves', ok.status === 200, `${ok.status}`)
const d2 = await P('GET', `/vendor/registry/${fresh.id}`)
check('history records the steps', (d2.body.history?.length ?? 0) >= 3 && d2.body.kyc?.status === 'approved', JSON.stringify(d2.body.history).slice(0, 300))
console.log(`${(await import('./actors.mjs')).results.filter(r => r.ok).length} PASS`)
