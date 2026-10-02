-- Shipment documents for a vendor load (docs/load-posting-design.md section 3, PRD Appendix A).
--
--  1. public.load_documents: one row per document of a load (invoice, challan, e-way bill, LR, freight sheet, POD,
--     loading/unloading report, damage report, trip closure). `fields` holds the Appendix A2 fields for that kind
--     (validated by the API per kind); `file_path` is an upload in the private bucket `load_documents`. Generated
--     documents (LR, freight sheet, reports) are rendered to PDF from `fields` on request.
--  2. public.load_document_events: the history of each document (who created or changed it, when, what changed).
--  3. public.lr_counters + public.next_lr_number(): one atomic sequence per (company, prefix, year) for LR and
--     freight sheet numbers, LR-2026-00001 (the API formats the number; this returns the sequence).
--  4. public.trip_settlements: agreed freight, advance, approved extra charges and deductions of a load, and the
--     balance the server computes. Amounts are integer paise.
--  5. Row-level security: the vendor organisation reads its load's documents and writes its own uploads; the carrier
--     organisation reads and writes; platform admins read. The backend (service role) is how the apps write.
--  6. The private storage bucket `load_documents` and its read policy (only where the storage schema exists).
--
-- Idempotent; safe to run again.

-- ── 1. Documents ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.load_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id        uuid REFERENCES public.vendor_shipment_requests(id) ON DELETE CASCADE,
  shipment_id    uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  -- the owner: the vendor org for its uploads, the carrier org for documents it generates
  org_id         uuid NOT NULL REFERENCES public.organizations(id),
  -- both sides of the load, stamped when the document is written, so each side's policy needs no join
  vendor_org_id  uuid REFERENCES public.organizations(id),
  carrier_org_id uuid REFERENCES public.organizations(id),
  kind           text NOT NULL CHECK (kind IN ('tax_invoice', 'bill_of_supply', 'delivery_challan', 'eway_bill', 'lr',
                   'freight_sheet', 'pod', 'loading_report', 'unloading_report', 'damage_report', 'trip_closure')),
  number         text,
  doc_date       date,
  fields         jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_path      text,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'expired', 'cancelled', 'superseded')),
  valid_until    timestamptz,
  version        integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes     uuid REFERENCES public.load_documents(id) ON DELETE SET NULL,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_load_documents_load ON public.load_documents (load_id, kind);
CREATE INDEX IF NOT EXISTS idx_load_documents_shipment ON public.load_documents (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_load_documents_vendor_org ON public.load_documents (vendor_org_id);
CREATE INDEX IF NOT EXISTS idx_load_documents_carrier_org ON public.load_documents (carrier_org_id);
-- an LR or freight sheet number is unique within the company that issued it
CREATE UNIQUE INDEX IF NOT EXISTS uq_load_documents_issued_number
  ON public.load_documents (org_id, kind, number)
  WHERE kind IN ('lr', 'freight_sheet') AND number IS NOT NULL AND status <> 'cancelled';

-- ── 2. History ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.load_document_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.load_documents(id) ON DELETE CASCADE,
  load_id     uuid REFERENCES public.vendor_shipment_requests(id) ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN ('created', 'updated', 'uploaded', 'generated', 'status')),
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { field: { from, to } }
  version     integer NOT NULL DEFAULT 1,
  by          uuid,
  by_role     text,                                  -- vendor, carrier or platform
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_load_document_events_doc ON public.load_document_events (document_id, at);
CREATE INDEX IF NOT EXISTS idx_load_document_events_load ON public.load_document_events (load_id, at);

-- ── 3. LR and freight sheet numbers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lr_counters (
  org_id   uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  prefix   text    NOT NULL DEFAULT 'LR' CHECK (prefix ~ '^[A-Z0-9]{1,8}$'),
  year     integer NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (org_id, prefix, year)
);

-- The next number of a company's sequence. Atomic: the upsert takes the row lock, so concurrent callers queue up.
-- The year is the Indian calendar year unless given.
CREATE OR REPLACE FUNCTION public.next_lr_number(p_org uuid, p_prefix text, p_year integer DEFAULT NULL) RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.lr_counters AS c (org_id, prefix, year, last_seq)
  VALUES (p_org, p_prefix, coalesce(p_year, extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::integer), 1)
  ON CONFLICT (org_id, prefix, year) DO UPDATE SET last_seq = c.last_seq + 1
  RETURNING c.last_seq $$;
REVOKE ALL ON FUNCTION public.next_lr_number(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_lr_number(uuid, text, integer) TO service_role;

-- ── 4. Trip settlement ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trip_settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id          uuid NOT NULL UNIQUE REFERENCES public.vendor_shipment_requests(id) ON DELETE CASCADE,
  shipment_id      uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  carrier_org_id   uuid NOT NULL REFERENCES public.organizations(id),
  vendor_org_id    uuid REFERENCES public.organizations(id),
  -- integer paise throughout
  agreed_freight   bigint NOT NULL DEFAULT 0 CHECK (agreed_freight >= 0),
  advance_paid     bigint NOT NULL DEFAULT 0 CHECK (advance_paid >= 0),
  extra_charges    jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- [{ label, amount, added_by, added_at, approved_by, approved_at }]
  deductions       jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- [{ label, amount, reason, added_by, added_at }]
  balance          bigint NOT NULL DEFAULT 0,             -- computed by the server: freight + approved extras - deductions - advance
  payment_terms    text   NOT NULL DEFAULT 'to_be_billed' CHECK (payment_terms IN ('paid', 'to_pay', 'to_be_billed')),
  payment_status   text   NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid')),
  pod_document_id  uuid REFERENCES public.load_documents(id) ON DELETE SET NULL,
  status           text   NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at        timestamptz,
  closed_by        uuid,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trip_settlements_carrier ON public.trip_settlements (carrier_org_id);
CREATE INDEX IF NOT EXISTS idx_trip_settlements_vendor ON public.trip_settlements (vendor_org_id);

-- ── 5. Row-level security ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.load_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.load_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_counters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_settlements     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.load_documents, public.load_document_events, public.lr_counters, public.trip_settlements FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.load_documents, public.trip_settlements TO authenticated;
GRANT SELECT ON public.load_document_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.load_documents, public.load_document_events, public.trip_settlements, public.lr_counters TO service_role;

-- Read: either side of the load, the owner, and platform admins
DROP POLICY IF EXISTS load_documents_select ON public.load_documents;
CREATE POLICY load_documents_select ON public.load_documents FOR SELECT TO authenticated
  USING (org_id = ANY ((SELECT app.user_org_ids())::uuid[])
      OR vendor_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
      OR carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
      OR (SELECT app.is_platform_admin()));

-- Write: the carrier organisation, and the vendor organisation for its own uploads
DROP POLICY IF EXISTS load_documents_insert ON public.load_documents;
CREATE POLICY load_documents_insert ON public.load_documents FOR INSERT TO authenticated
  WITH CHECK (carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
      OR (org_id = vendor_org_id AND org_id = ANY ((SELECT app.user_org_ids())::uuid[])
          AND kind IN ('tax_invoice', 'bill_of_supply', 'delivery_challan', 'eway_bill')));

DROP POLICY IF EXISTS load_documents_update ON public.load_documents;
CREATE POLICY load_documents_update ON public.load_documents FOR UPDATE TO authenticated
  USING (carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
      OR (org_id = vendor_org_id AND org_id = ANY ((SELECT app.user_org_ids())::uuid[])
          AND kind IN ('tax_invoice', 'bill_of_supply', 'delivery_challan', 'eway_bill')))
  WITH CHECK (carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
      OR (org_id = vendor_org_id AND org_id = ANY ((SELECT app.user_org_ids())::uuid[])
          AND kind IN ('tax_invoice', 'bill_of_supply', 'delivery_challan', 'eway_bill')));

-- History: readable with the document; written only by the backend
DROP POLICY IF EXISTS load_document_events_select ON public.load_document_events;
CREATE POLICY load_document_events_select ON public.load_document_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.load_documents d WHERE d.id = document_id));

-- Settlement: the carrier reads and writes; the vendor and platform admins read
DROP POLICY IF EXISTS trip_settlements_select ON public.trip_settlements;
CREATE POLICY trip_settlements_select ON public.trip_settlements FOR SELECT TO authenticated
  USING (carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
      OR vendor_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
      OR (SELECT app.is_platform_admin()));

DROP POLICY IF EXISTS trip_settlements_write ON public.trip_settlements;
CREATE POLICY trip_settlements_write ON public.trip_settlements FOR ALL TO authenticated
  USING (carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[]))
  WITH CHECK (carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[]));

-- ── 6. The private bucket and who may read it ───────────────────────────────────────────────────────
-- Objects live under loads/<load id>/..., so access follows the load: its vendor organisation, the organisation
-- carrying it, and platform admins.
CREATE OR REPLACE FUNCTION public.can_read_load_object(object_name text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (SELECT app.is_platform_admin())
    OR EXISTS (
      SELECT 1 FROM public.vendor_shipment_requests r
      WHERE r.id::text = split_part(object_name, '/', 2)
        AND (r.vendor_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
             OR EXISTS (SELECT 1 FROM public.cargo_manifest m
                        WHERE m.vendor_request_id = r.id AND m.carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[]))
             OR EXISTS (SELECT 1 FROM public.load_documents d
                        WHERE d.load_id = r.id AND d.carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])))) $$;
REVOKE ALL ON FUNCTION public.can_read_load_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_load_object(text) TO authenticated, service_role;

-- The storage schema is created by Supabase (or by infra/platform-db.sh on Azure); skip quietly where it is not there
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public) VALUES ('load_documents', 'load_documents', false) ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'load_documents bucket not created: insufficient privilege';
    END;
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    BEGIN
      -- storage.objects is owned by the storage admin role where that role exists (Azure)
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
        BEGIN
          EXECUTE 'SET LOCAL ROLE supabase_storage_admin';
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
      END IF;
      DROP POLICY IF EXISTS load_documents_read ON storage.objects;
      CREATE POLICY load_documents_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
        USING (bucket_id = 'load_documents' AND public.can_read_load_object(name));
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'load_documents_read policy not created: insufficient privilege';
    END;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
