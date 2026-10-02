// A vendor who already has a company profile changes the name and address: the save must work (it answered 500).
import { api, makeVendor, check } from './actors.mjs'

const v = await makeVendor({ approved: false })
const first = await api(v.token, 'GET', '/vendor/business-profile')
check('profile exists and is complete', first.status === 200 && first.body.complete === true, JSON.stringify(first.body).slice(0, 160))

const body = {
  full_name: 'Renamed Owner', business_name: 'Renamed Traders', account_type: 'business_partner', gstin: '27AAPFU0939F1ZV',
  address: 'Plot 77, Bhiwandi Logistics Park', pincode: '421302', email: v.email, business_type: 'trader', monthly_loads: '21-50',
}
const second = await api(v.token, 'PUT', '/vendor/business-profile', body)
check('renaming and moving an existing profile saves', second.status === 200 && second.body.business_name === 'Renamed Traders', `${second.status} ${JSON.stringify(second.body).slice(0, 160)}`)
check('the state follows the new pin code', second.body.state_code === '27', JSON.stringify(second.body).slice(0, 160))

const noGstin = await api(v.token, 'PUT', '/vendor/business-profile', { ...body, account_type: 'customer', gstin: '', pincode: '110020' })
check('a vendor without a GSTIN gets the state from the pin code', noGstin.status === 200 && noGstin.body.state_code === '07', `${noGstin.status} ${JSON.stringify(noGstin.body).slice(0, 160)}`)
