ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE third_party_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_ledger_adjustments ENABLE ROW LEVEL SECURITY;

-- Super admins can see everything
CREATE POLICY super_admin_all ON organizations
    FOR ALL
    TO authenticated
    USING ( (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'superadmin' );

CREATE POLICY super_admin_all_nr ON network_relationships
    FOR ALL
    TO authenticated
    USING ( (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'superadmin' );

CREATE POLICY super_admin_all_tpa ON third_party_agreements
    FOR ALL
    TO authenticated
    USING ( (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'superadmin' );

CREATE POLICY super_admin_all_bl ON booking_ledger
    FOR ALL
    TO authenticated
    USING ( (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'superadmin' );
