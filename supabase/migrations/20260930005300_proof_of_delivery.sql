-- Driver app stream, part 3: proof of delivery photo and signature.
--
-- The driver photographs the delivery and the receiver signs on the phone. Both
-- images are uploaded through backend-issued signed upload URLs to the private
-- storage bucket (folder `pod/<stop id>/`), and the object paths are stored here
-- when the stop is completed. `photo_url` and `signature_url` hold storage paths,
-- not public links: staff get a short-lived signed URL from the backend
-- (GET /shipments/:id/proof), and nobody can read the bucket directly.
--
-- Stored on the shipment (what staff see), on the route stop (so a stop with no
-- shipment keeps its proof), and on the cargo manifest (vendor loads, which also
-- gain `received_by`). The older `shipments.signature_data` column stays for
-- signatures captured before this release.
--
-- No storage policy is added: signed uploads bypass policies, and the bucket
-- already accepts only PDF, JPG and PNG (20260929000200_tpl_signed_uploads.sql).
--
-- Additive and safe to re-run. NOT YET APPLIED to the live project.

ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS signature_url text;

ALTER TABLE public.route_stops ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.route_stops ADD COLUMN IF NOT EXISTS signature_url text;

ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS received_by text;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS signature_url text;

NOTIFY pgrst, 'reload schema';
