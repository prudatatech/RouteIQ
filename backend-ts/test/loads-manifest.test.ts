/**
 * What a posted load leaves behind when it moves on: its items copied to shipment_hsn against the manifest (with the
 * tax split), and the loads held for business verification going to the companies once the vendor is verified.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from './support/mock-supabase';
import { ORG, orgWorld, uid } from './support/org-world';
import { copyItemsToManifest, releaseHeldLoads } from '../src/services/loads/loads.service';
import { vendorService } from '../src/services/vendor.service';

const LOAD = 'bb000000-0000-4000-8000-000000000010';
const HELD = 'bb000000-0000-4000-8000-000000000011';
const MANIFEST = 'cc000000-0000-4000-8000-000000000010';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  supabaseMock.reset(orgWorld({
    vendor_shipment_requests: [
      { id: LOAD, vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, status: 'pending', tax_basis: 'inter', metadata: {}, created_at: '2026-10-01T00:00:00Z' },
      { id: HELD, vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, status: 'pending', load_number: 'MRX-2026-00007', total_weight_kg: 500, pickup_city: 'Pune', delivery_city: 'Goa', metadata: { hold: 'vendor_unverified', cargo: { name: 'x' } }, created_at: '2026-10-01T00:00:00Z' },
    ],
    load_items: [
      { id: 'i1', load_id: LOAD, line_no: 1, product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 400, unit: 'bags', weight_kg: 20000, declared_value: 700000 },
      { id: 'i2', load_id: LOAD, line_no: 2, product_name: 'Tiles', hsn_code: '6907', gst_rate: 5, quantity: 10, unit: 'boxes', weight_kg: 300, declared_value: 10000 },
    ],
    shipment_hsn: [],
    vendor_profiles: [],
  }));
});

describe('copyItemsToManifest', () => {
  it('writes one shipment_hsn row per item with the taxable value and the IGST for an interstate load', async () => {
    await copyItemsToManifest({ id: LOAD, tax_basis: 'inter' }, MANIFEST);
    const rows = supabaseMock.rows('shipment_hsn');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ manifest_id: MANIFEST, load_id: LOAD, hsn_code: '2523', description: 'Cement bags', gst_rate: 18, declared_value: 700000, taxable_amount: 700000, igst: 126000, cgst: 0, sgst: 0 });
    expect(rows[1]).toMatchObject({ hsn_code: '6907', gst_rate: 5, igst: 500 });
  });

  it('splits CGST and SGST for a load within one state, and copies nothing for a load without items', async () => {
    await copyItemsToManifest({ id: LOAD, tax_basis: 'intra' }, MANIFEST);
    expect(supabaseMock.rows('shipment_hsn')[1]).toMatchObject({ cgst: 250, sgst: 250, igst: 0 });
    supabaseMock.rows('shipment_hsn').length = 0;
    await copyItemsToManifest({ id: HELD, tax_basis: null }, MANIFEST);
    expect(supabaseMock.rows('shipment_hsn')).toHaveLength(0);
  });

  it('never throws when the write fails', async () => {
    supabaseMock.fail('shipment_hsn', 'disk full');
    await expect(copyItemsToManifest({ id: LOAD, tax_basis: 'inter' }, MANIFEST)).resolves.toBeUndefined();
  });
});

describe('loads held for business verification', () => {
  it('stay out of the companies\' pending list', async () => {
    const pending = await vendorService.getPendingRequests();
    expect(pending.map((r: any) => r.id)).toEqual([LOAD]);
  });

  it('are released, and the staff told, when the vendor is verified', async () => {
    expect(await releaseHeldLoads(uid('vendor-1'))).toBe(1);
    expect(supabaseMock.rows('vendor_shipment_requests').find(r => r.id === HELD)!.metadata).toEqual({ cargo: { name: 'x' } });
    expect(supabaseMock.rows('notifications').filter(n => n.type === 'vendor_request' && n.data?.request_id === HELD).length).toBeGreaterThan(0);
    expect((await vendorService.getPendingRequests()).map((r: any) => r.id).sort()).toEqual([HELD, LOAD].sort());
  });
});
