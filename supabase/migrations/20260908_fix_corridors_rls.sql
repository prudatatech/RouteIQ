ALTER TABLE tpl_corridors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "3PL can view their own corridors" ON tpl_corridors;
CREATE POLICY "3PL can view their own corridors" ON tpl_corridors
    FOR SELECT USING (partner_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

ALTER TABLE tpl_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "3PL can view their own documents" ON tpl_documents;
CREATE POLICY "3PL can view their own documents" ON tpl_documents
    FOR SELECT USING (partner_id::text = current_setting('request.jwt.claims', true)::json->>'sub');
