-- Vendor review: the platform can ask a vendor for more information before deciding on its KYC.
--
--  1. vendor_profiles.kyc_status also allows 'info_requested' (the vendor owes an answer). It is not 'approved', so the
--     organisation trigger (app.sync_vendor_org) keeps the organisation pending, and the guard on client updates still
--     only lets a vendor move to 'submitted'.
--  2. kyc_info_requests: what the platform asked (items) and what the vendor answered. API only (service_role): RLS is
--     on and no policy exists for authenticated.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.vendor_profiles DROP CONSTRAINT IF EXISTS vendor_profiles_kyc_status_check;
ALTER TABLE public.vendor_profiles ADD CONSTRAINT vendor_profiles_kyc_status_check
  CHECK (kyc_status IN ('pending', 'submitted', 'info_requested', 'approved', 'rejected'));

CREATE TABLE IF NOT EXISTS public.kyc_info_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     uuid NOT NULL REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
  message       text,
  -- [{ key, label, kind: 'text' | 'document', hint }]
  items         jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'withdrawn')),
  requested_by  uuid,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  answered_at   timestamptz,
  -- [{ key, text?, document_path? }]
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_kyc_info_requests_vendor ON public.kyc_info_requests (vendor_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_info_requests_open ON public.kyc_info_requests (vendor_id) WHERE status = 'open';

ALTER TABLE public.kyc_info_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kyc_info_requests FROM anon, authenticated;
GRANT ALL ON public.kyc_info_requests TO service_role;

RESET ROLE;
NOTIFY pgrst, 'reload schema';
