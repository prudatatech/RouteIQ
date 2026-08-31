-- Organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- shipper, forwarder, fleet_owner, broker, 3pl, super_admin
    participation_type VARCHAR(50), 
    gstin VARCHAR(15),
    status VARCHAR(50) DEFAULT 'active', -- active, suspended, verification_pending
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- NetworkRelationships (Tier 0 supply links)
CREATE TABLE network_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forwarder_org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    partner_org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50), -- private_fleet, private_broker
    rate_formula_jsonb JSONB, 
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(forwarder_org_id, partner_org_id)
);

-- ThirdPartyAgreements (Tier 2 3PL configurations)
CREATE TABLE third_party_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tpl_org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    corridor_structure JSONB NOT NULL, -- e.g., { "from_state": "MH", "to_state": "GJ" } or pincode clusters
    vehicle_types_supported TEXT[],
    wholesale_rate_formula JSONB NOT NULL,
    sla_hours INTEGER NOT NULL DEFAULT 4,
    platform_markup_percent NUMERIC(5,2) DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'active', -- active, paused, suspended
    effective_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expiry_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE PROCEDURE set_updated_at_timestamp();

CREATE TRIGGER trigger_network_relationships_updated_at
BEFORE UPDATE ON network_relationships
FOR EACH ROW EXECUTE PROCEDURE set_updated_at_timestamp();

CREATE TRIGGER trigger_third_party_agreements_updated_at
BEFORE UPDATE ON third_party_agreements
FOR EACH ROW EXECUTE PROCEDURE set_updated_at_timestamp();
