-- Add document tracking columns to vehicles table

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS rc_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS rc_expiry DATE,
  ADD COLUMN IF NOT EXISTS rc_document_url TEXT,
  
  ADD COLUMN IF NOT EXISTS insurance_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS insurance_expiry DATE,
  ADD COLUMN IF NOT EXISTS insurance_document_url TEXT,
  
  ADD COLUMN IF NOT EXISTS fitness_certificate_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS fitness_expiry DATE,
  ADD COLUMN IF NOT EXISTS fitness_document_url TEXT,
  
  ADD COLUMN IF NOT EXISTS permit_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS permit_expiry DATE,
  ADD COLUMN IF NOT EXISTS permit_document_url TEXT,
  
  ADD COLUMN IF NOT EXISTS puc_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS puc_expiry DATE,
  ADD COLUMN IF NOT EXISTS puc_document_url TEXT;
