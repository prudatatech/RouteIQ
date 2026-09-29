-- Bank branch details looked up from the IFSC (Razorpay public IFSC API), and when they were checked.
-- ifsc_verified_at stays null when the lookup service was down at save time.
ALTER TABLE user_bank_accounts
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS bank_address text,
  ADD COLUMN IF NOT EXISTS bank_city text,
  ADD COLUMN IF NOT EXISTS bank_state text,
  ADD COLUMN IF NOT EXISTS micr text,
  ADD COLUMN IF NOT EXISTS ifsc_details jsonb,
  ADD COLUMN IF NOT EXISTS ifsc_verified_at timestamptz;

ALTER TABLE tpl_partners
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_branch text,
  ADD COLUMN IF NOT EXISTS bank_ifsc_details jsonb,
  ADD COLUMN IF NOT EXISTS bank_ifsc_verified_at timestamptz;
