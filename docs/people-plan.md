# People profiles: plan and API contract

Date: 2026-09-29. The Users page only creates an account (name, email or phone, role, active). Real operations need a record for every person: who they are, their documents and when those expire, how they are employed, how they are paid, who to call in an emergency, and what happened to them over time.

This covers staff (superadmin, admin, manager) and drivers. Vendors and 3PL partners keep their existing KYC flows; their profile page links to that KYC instead of duplicating it.

## What a profile holds

| Section | Fields |
|---|---|
| Overview | Name, phone, email, alternate phone, personal email, date of birth, gender, blood group, photo, address (line, city, state, PIN via AddressPicker) |
| Employment | Employee code (unique), designation, department, date of joining, reporting manager (a staff user), base depot, employment type (permanent, contract, on-call) |
| Status | `onboarding`, `active`, `suspended`, `inactive` (left). Every change is kept with a reason and who made it. `users.is_active` follows the status: only `active` and `onboarding` can sign in. |
| Documents | Typed documents with number, issue date, expiry date, file, and verification (pending, verified, rejected with reason, expired). |
| Emergency contacts | Name, relation, phone, primary flag. |
| Bank and payout | Account holder, account number, IFSC, bank name, UPI ID, primary flag, verified flag. Account number is shown masked (last 4); only a superadmin can reveal it, and every reveal is logged. |
| Assignments | Driver: current vehicle (from `vehicles.driver_id`), base depot. |
| Performance | Driver: on-time rate, average staff rating, deliveries, earnings (existing endpoints). |
| Activity | Last sign-in, status history, document events, profile changes (who, what, when). |
| Notes | Staff notes with author and time. |

## Document types

| Type (`doc_type`) | Label | Needs number | Needs expiry | Required for |
|---|---|---|---|---|
| `driving_licence` | Driving licence | yes (plus `metadata.licence_class`, e.g. LMV, HMV, HGMV) | yes | driver |
| `aadhaar` | Aadhaar | yes (stored masked except last 4 in list views) | no | driver, staff |
| `pan` | PAN | yes (format AAAAA9999A) | no | driver, staff |
| `photo` | Photo | no | no | driver, staff |
| `police_verification` | Police verification | no | yes | optional |
| `medical_fitness` | Medical fitness | no | yes | optional |
| `address_proof` | Address proof | no | no | optional |
| `offer_letter` | Offer / appointment letter | no | no | optional |
| `other` | Other (needs a title in `metadata.title`) | no | optional | optional |

A person is "complete" when every required document for their role exists and is verified and not expired.

Rules:
- Files go to the private `kyc_documents` bucket under `people/<user_id>/<doc_type>/...`, uploaded through backend-issued signed upload URLs (same pattern as proof of delivery). Staff view through 10-minute signed links.
- A daily job marks documents past `expires_on` as `expired` and notifies staff (and the driver) at 30 days, 7 days and on the day. The Dashboard "Needs attention" list shows expired/expiring driver licences.
- Dispatch shows a warning (not a block) when the vehicle's driver has an expired or missing driving licence: vehicle pickers and assign screens show "Driver licence expired".

## Database (one migration, `supabase/migrations/20260930010100_people_profiles.sql`)

- `users.status text not null default 'active'` with check (`onboarding`,`active`,`suspended`,`inactive`); backfill from `is_active`.
- `user_profiles` (1:1, `user_id` pk references users on delete cascade): employee_code (unique, nullable), designation, department, employment_type, date_of_joining, date_of_birth, gender, blood_group, alternate_phone, personal_email, address_line, city, state, pincode, latitude, longitude, base_depot_id (references depots, on delete set null), reporting_manager_id (references users, on delete set null), photo_path, created_at, updated_at, updated_by.
- `user_documents`: id, user_id, doc_type (check list above), doc_number, issued_on, expires_on, file_path, status (check `pending`,`verified`,`rejected`,`expired`), rejection_reason, metadata jsonb, uploaded_by, verified_by, verified_at, archived_at, created_at, updated_at. Index on (user_id), (expires_on) where archived_at is null.
- `user_emergency_contacts`: id, user_id, name, relation, phone, is_primary, created_at, updated_at.
- `user_bank_accounts`: id, user_id, account_holder, account_number, ifsc, bank_name, upi_id, is_primary, is_verified, created_at, updated_at.
- `user_status_history`: id, user_id, from_status, to_status, reason, changed_by, created_at.
- `user_notes`: id, user_id, body, author_id, created_at.
- `user_activity`: id, user_id (subject), actor_id, action text, details jsonb, created_at (profile edits, document events, bank reveals, status changes).
- RLS on every table, no client policies except: a user may SELECT their own `user_profiles`, `user_documents`, `user_emergency_contacts` rows. All writes go through backend-ts (service role).

## API (backend-ts, `/api/v1/people`, staff = admin, superadmin, manager unless noted)

| Method and path | Who | Does |
|---|---|---|
| `GET /people?role=&status=&q=&docs=expiring|expired|missing|pending&limit=&offset=` | staff | List people (not vendors/customers) with `status`, `employee_code`, `designation`, `vehicle_plate`, `doc_summary: {required, verified, pending, expiring, expired, missing}`, `last_login`. |
| `POST /people` | admin, superadmin | Create a person: `{role, full_name, phone, email?, profile?}`. Driver: phone required; the driver signs in with OTP on that phone and lands on this record (match the OTP flow in auth.routes.ts; no duplicate user). Staff: email required; account created in Supabase Auth by invite (the person sets their own password). Status starts `onboarding`. Manager can't create admins/superadmins; only superadmin can create superadmin. |
| `GET /people/:id` | staff | `{user, profile, documents, emergency_contacts, bank_accounts (masked), status_history, notes, activity (latest 50), vehicle, performance}` |
| `PATCH /people/:id` | admin, superadmin | Update user basics (name, phone, email) and profile fields. Validates PIN, PAN, phone, dates. Logs activity. |
| `POST /people/:id/status` | admin, superadmin | `{status, reason}`; reason required for suspended/inactive. Updates `users.status` and `is_active`, history, activity. Can't change own status; only superadmin can change another superadmin. |
| `POST /people/:id/documents/upload-url` | staff, or the driver for themselves | `{doc_type, file_name, content_type}` → `{path, signed_url, token}`; PDF/JPG/PNG only, 10 MB. |
| `POST /people/:id/documents` | staff, or the driver for themselves | `{doc_type, doc_number?, issued_on?, expires_on?, file_path, metadata?}`; path must be inside that person's folder; replaces (archives) the previous live document of the same type; status `pending`. |
| `PATCH /people/:id/documents/:docId` | staff | Edit fields, or verify: `{status: 'verified'}` / `{status: 'rejected', rejection_reason}`. |
| `GET /people/:id/documents/:docId/file` | staff, or the owner | `{url}` signed for 10 minutes. |
| `DELETE /people/:id/documents/:docId` | admin, superadmin | Archive (sets `archived_at`), never hard delete. |
| `GET/POST/PATCH/DELETE /people/:id/emergency-contacts[/:contactId]` | staff | CRUD; one primary. |
| `GET/POST/PATCH/DELETE /people/:id/bank-accounts[/:accountId]` | admin, superadmin | CRUD with IFSC check; one primary; responses masked. |
| `POST /people/:id/bank-accounts/:accountId/reveal` | superadmin | Full account number; logs `bank_reveal` activity. |
| `GET/POST /people/:id/notes` | staff | Notes. |
| `GET /people/me` and `/people/me/documents...` | any signed-in driver/staff | Own profile and documents (driver app uses this). |

## Screens

- **Web People** (replaces the Users page at `/admin/users`, nav "People"): tabs All / Drivers / Staff / Needs attention (documents missing, pending, expiring or expired); filters for status and role; columns name, role, employee code, status, documents (e.g. "3/4 verified", red when expired), vehicle (drivers), last sign-in. "Add person" wizard: role → basics → employment (optional) → done (documents after).
- **Web person profile** `/admin/users/:id`: header with photo, name, role, status pill, completeness meter and actions (Edit, Change status). Tabs: Overview, Documents, Bank and payout, Emergency contacts, Activity, Notes; Performance for drivers; KYC link for vendors.
- **Dashboard**: "Needs attention" gets expired or expiring driver licences and people with required documents missing.
- **Driver app, Profile**: "My documents" list with status and expiry, upload or replace a document with the camera or a file (goes to pending), and emergency contacts.
