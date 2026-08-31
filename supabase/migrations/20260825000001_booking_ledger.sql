CREATE TYPE escrow_status_enum AS ENUM ('pending_escrow', 'escrow_held', 'escrow_failed', 'released');

CREATE TABLE booking_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID NOT NULL,
    client_rate NUMERIC(10,2) NOT NULL,
    fulfiller_rate NUMERIC(10,2) NOT NULL,
    platform_margin NUMERIC(10,2) NOT NULL,
    tier_resolved INTEGER NOT NULL CHECK (tier_resolved IN (0, 1, 2)),
    fulfiller_org_id UUID REFERENCES organizations(id),
    tpl_org_id UUID REFERENCES organizations(id),
    escrow_status escrow_status_enum DEFAULT 'pending_escrow',
    assigned_driver_id UUID,
    assigned_vehicle_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE booking_ledger_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_id UUID REFERENCES booking_ledger(id) ON DELETE CASCADE,
    adjustment_amount NUMERIC(10,2) NOT NULL,
    reason TEXT NOT NULL,
    adjusted_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trigger_booking_ledger_updated_at
BEFORE UPDATE ON booking_ledger
FOR EACH ROW EXECUTE PROCEDURE set_updated_at_timestamp();
