-- UAT-004: every invoice stores who it is billed to.
--
-- A GST tax invoice names its recipient. The backend writes the billed party (kind, name, GSTIN,
-- address, state, phone) here when it issues the invoice, so the page and the PDF show the party as
-- it was at issue. Invoices issued before this column existed stay null; they are shown with the
-- recipient looked up from their shipment, load or booking (no history is rewritten).
--
-- Additive and safe to re-run.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS bill_to jsonb;

NOTIFY pgrst, 'reload schema';
