import { describe, expect, it } from 'vitest'
import { activeNav, menuFor, navBadgeCounts, navSections } from './navigation'

const labels = (role: string) => menuFor(role).map(s => s.label)

describe('the staff menu', () => {
  it('has the eleven sections in the order the work happens', () => {
    expect(labels('superadmin')).toEqual([
      'Today', 'Requests', 'Shipments', 'Dispatch', 'On the road', 'Fleet', 'People', 'Return trips & 3PL', 'Money', 'Reports', 'Settings',
    ])
  })

  it('gives a manager the operations sections only', () => {
    expect(labels('manager')).toEqual(['Today', 'Requests', 'Shipments', 'Dispatch', 'On the road', 'Fleet', 'People'])
    const links = menuFor('manager').flatMap(s => [s.to, ...s.children.map(c => c.to)])
    for (const forbidden of ['/money', '/admin/settings', '/admin/audit', '/admin/kyc', '/return-trips', '/3pl-partners']) {
      expect(links).not.toContain(forbidden)
    }
  })

  it('shows admin the return trips and 3PL partners (to view), and KYC, but not the audit log', () => {
    const links = menuFor('admin').flatMap(s => s.children.map(c => c.to))
    expect(links).toContain('/admin/kyc')
    expect(links).toEqual(expect.arrayContaining(['/return-trips', '/return-trips?tab=bids', '/return-trips?tab=pool', '/return-trips?tab=partners']))
    expect(links).not.toContain('/admin/audit')
    expect(menuFor('superadmin').flatMap(s => s.children.map(c => c.to))).toEqual(expect.arrayContaining(['/return-trips?tab=partners', '/admin/audit']))
  })

  it('shows nothing to anyone who is not staff', () => {
    expect(menuFor('driver')).toEqual([])
    expect(menuFor(null)).toEqual([])
  })

  it('keeps every console page reachable from the menu', () => {
    const links = new Set(navSections.flatMap(s => [s.to, ...s.children.map(c => c.to.split('?')[0])]))
    for (const page of [
      '/today', '/requests', '/bookings', '/vendor-requests', '/shipments', '/dispatch', '/routes', '/route-planner', '/optimize', '/live-map',
      '/cargo', '/emergency', '/fleet', '/vehicle-requests', '/admin/users', '/admin/kyc', '/return-trips', '/money',
      '/analytics', '/insights', '/admin/settings', '/admin/audit',
    ]) expect(links).toContain(page)
  })
})

describe('finding the open section', () => {
  const sections = menuFor('superadmin')
  const at = (pathname: string, search = '') => {
    const { section, child } = activeNav(sections, pathname, search)
    return [section?.label ?? null, child?.label ?? null]
  }

  it('follows the landing page and its sub-links', () => {
    expect(at('/today')).toEqual(['Today', null])
    expect(at('/vendor-requests')).toEqual(['Requests', 'Vendor loads'])
    expect(at('/vehicle-requests')).toEqual(['Fleet', 'Vehicle requests'])
    expect(at('/admin/kyc')).toEqual(['People', 'KYC review'])
  })

  it('keeps detail pages inside their section', () => {
    expect(at('/fleet/abc')).toEqual(['Fleet', 'Vehicles'])
    expect(at('/cargo/exceptions/xyz')).toEqual(['On the road', 'Problems'])
    expect(at('/admin/users/u1')).toEqual(['People', 'People'])
  })

  it('tells trips to send from active trips by the filter in the address', () => {
    expect(at('/routes', '?status=pending')).toEqual(['Dispatch', 'Trips to send'])
    expect(at('/routes', '?status=active')).toEqual(['On the road', 'Active trips'])
    expect(at('/routes')).toEqual(['Dispatch', 'All trips'])
  })

  it('puts claims under Money and the other cargo tabs under On the road', () => {
    expect(at('/money', '?tab=claims')).toEqual(['Money', 'Claims'])
    expect(at('/money')).toEqual(['Money', 'To price'])
    expect(at('/money', '?tab=driver-pay')).toEqual(['Money', 'Driver pay'])
    expect(at('/money/invoices/i1')).toEqual(['Money', 'Invoices'])
    expect(at('/cargo', '?tab=claims')[0]).toBe('Money')
    expect(at('/cargo', '?tab=transfers')).toEqual(['On the road', 'Problems'])
  })

  it('opens the right Return trips link for each tab, and keeps a partner page in the section', () => {
    expect(at('/return-trips')).toEqual(['Return trips & 3PL', 'Open return trips'])
    expect(at('/return-trips', '?tab=bids')).toEqual(['Return trips & 3PL', 'Bids to decide'])
    expect(at('/return-trips', '?tab=pool&view=match')).toEqual(['Return trips & 3PL', 'Combine loads'])
    expect(at('/return-trips', '?tab=partners&status=active')).toEqual(['Return trips & 3PL', '3PL partners'])
    expect(at('/3pl-partners/p1')).toEqual(['Return trips & 3PL', null])
  })

  it('matches nothing for an unknown page', () => {
    expect(at('/nowhere')).toEqual([null, null])
  })
})

describe('menu badge counts', () => {
  const queues = {
    sos: { count: 2 },
    problems: { count: 3, overdue: 1 },
    requests: { count: 5, bookings: 4, vendor_loads: 1 },
    needs_vehicle: { count: 6 },
    trips_to_send: { count: 2 },
    vehicle_requests: { count: 1 },
    documents: { count: 7 },
    kyc: { count: 3 },
    bids: { count: 2 },
    unpriced: { count: 9 },
  }

  it('turns the Today queues into counts for sections and links', () => {
    expect(navBadgeCounts(queues, 4)).toEqual({
      today: 3, requests: 5, bookings: 4, vendorLoads: 1,
      dispatch: 8, needsVehicle: 6, tripsToSend: 2,
      onTheRoad: 5, problems: 3, sos: 2,
      fleet: 1, vehicleRequests: 1,
      people: 10, documents: 7, kyc: 3,
      returnTrips: 6, bids: 2, pendingPartners: 4,
      money: 9,
    })
  })

  it('counts zero before the queues load and for queues a role does not get', () => {
    const counts = navBadgeCounts(undefined, 0)
    expect(Object.values(counts).every(n => n === 0)).toBe(true)
    expect(navBadgeCounts({ sos: { count: 1 } }, 0).money).toBe(0)
  })
})
