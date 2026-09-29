-- 3PL partner records and documents are written only by backend-ts.
--
-- Before: 20260928000200 let a partner UPDATE its own tpl_partners row (status
-- and pending_updates) and tpl_documents rows (file_url) from the browser. A
-- partner could therefore send itself to "pending", write any pending_updates
-- JSON that staff would later apply to the live corridors and rates, and point
-- a document at any storage path, without staff being told or anything being
-- audited. A paused partner could also un-pause itself by "changing settings".
--
-- After: the partner dashboard calls backend-ts
--   POST /tpl/:id/documents/:docId/replace   swap one document (path checked)
--   POST /tpl/:id/settings                   request SLA / tax / corridor changes
-- which validate the request, refuse paused and rejected partners, put an
-- active partner back in review, notify staff and write an audit entry.
-- Staff decisions (approve, reject, pause, resume) already go through the
-- backend and now only apply from the expected status.
--
-- Clients keep SELECT (own record / staff) and realtime.
--
-- Rollout: deploy backend-ts and the web app from the same branch first (the
-- previous partner dashboard writes these tables directly and would fail with
-- "permission denied" once this is applied), then apply this migration.
-- Safe to re-run.

DROP POLICY IF EXISTS tpl_partners_update_own ON public.tpl_partners;
DROP POLICY IF EXISTS tpl_documents_update_own ON public.tpl_documents;
REVOKE INSERT, UPDATE, DELETE ON public.tpl_partners, public.tpl_documents, public.tpl_corridors FROM anon, authenticated;
