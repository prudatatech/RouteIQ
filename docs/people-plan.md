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

## Real-world cases (decisions)

Real people data is messy. Each case below has a decision so the build handles it instead of breaking.

### Identity and duplicates

| Case | Decision |
|---|---|
| The same person added twice (same phone, Aadhaar, PAN or licence number) | Create and edit check for duplicates (`GET /people/duplicates?phone=&doc_type=&doc_number=`) and refuse with a link to the existing person. Numbers are compared by a normalised hash, so spacing and case don't matter. |
| A driver changes their SIM or phone number | Staff change the phone on the profile. The old number is kept in `user_phone_history` and can't be used by anyone else for 90 days (recycled numbers). The driver signs in with OTP on the new number and lands on the same record. |
| A phone number that belonged to someone who left | Refused while the old owner is active or within 90 days of leaving. After that it's allowed and noted in the activity log. |
| No Aadhaar (e.g. a Nepali driver) or no PAN | Identity proof is a group: one of Aadhaar, voter ID, passport. Tax ID: PAN, or "No PAN" with a reason. "Required" is checked per group, not per document. |
| Name spelled differently on each document | Each document keeps `name_on_document`. When it doesn't match the profile name (after normalising case and spaces), it shows a warning. Staff can still verify it with a note. |
| Under-age person, or wrong date of birth | Date of birth must make them 18+ (20+ for a transport licence class). Future dates are refused. |
| Someone leaves and is rehired | Reactivate the same record: status goes from inactive to onboarding. History, documents and employee code are kept. A new employee code is never issued for the same person. |
| A driver who works for a 3PL partner or vendor, not for us | `employer_type` is `company` or `partner`, with `employer_partner_id`. Partner drivers show the partner's name, and their bank and payout tab is hidden because the partner pays them. |
| The sign-in account was deleted directly in Supabase | The profile shows "No sign-in account" with "Send invite" (staff) or "Driver signs in with OTP" (driver). The new account links to the same record by email or phone. |
| Staff member never accepted the invite | Stays onboarding with "Invite sent on …" and a "Resend invite" action. Invites can't be resent more often than every 10 minutes. |
| Email change for staff | Updates the sign-in email through the Auth admin API. The person confirms it on the new address. Logged. |

### Status and availability

| Case | Decision |
|---|---|
| Suspending or deactivating someone who is on an active route | Refused, naming the route. Staff finish or reassign the route first. A pending route or an unanswered stop prompt is released, and the vehicle's driver is cleared, with confirmation. |
| Temporary suspension | `suspended_until` is optional. A daily job reactivates the person when it passes, and notifies staff. |
| Leave (sick, holiday) | New status `on_leave` with `leave_from` and `leave_until`. They can still sign in but aren't dispatchable. A daily job returns them to active after `leave_until`. |
| Deactivating the last active superadmin, or yourself | Refused. |
| Role change (e.g. manager to admin) | Only a superadmin. Logged. A driver can't be turned into staff or the reverse on the same record; create a new person instead, because the sign-in methods differ. |
| Suspended or inactive person still signed in | Status change revokes their sessions (Auth admin sign-out) and clears their push token, so the app stops receiving work. |

### Documents

| Case | Decision |
|---|---|
| Front and back pages (licence, Aadhaar) | A document has one main file plus `extra_file_paths` (up to 4). The upload flow lets you add a back page. |
| Blurry or wrong upload | Reject with a reason. The person is notified to re-upload, and `resubmission_count` is kept. |
| Expired licence but renewal in progress | A setting, `licence_grace_days` (default 0), treats a licence as usable for that many days after expiry. The status reads "Expired, in grace period". |
| Documents with no expiry that still need re-checking (police verification) | `review_by` date. It's treated like an expiry for reminders, but shows "Review due". |
| Licence class doesn't cover the vehicle | Licence `metadata.licence_classes` (array: LMV, HMV, HGMV, HPMV, TRANS). Dispatch warns when the vehicle's type or capacity needs a class the driver doesn't have (light vehicles under 7,500 kg need LMV; heavier need HMV, HGMV or TRANS). |
| Number formats | Aadhaar: 12 digits with a Verhoeff check. PAN: AAAAA9999A. Driving licence: state code plus digits, loosely checked (warn, don't refuse). Voter ID: 3 letters and 7 digits. Passport: letter and 7 digits. IFSC: 4 letters, 0, and 6 characters. |
| Aadhaar privacy | Never store the full Aadhaar number. Keep `number_last4` and a salted `number_hash` for duplicate checks. Staff see "XXXX XXXX 1234". The file itself stays private. |
| Consent | Record `consent_at`, `consent_by` and `consent_method` (e.g. "signed form", "in app") on the profile before documents are stored. The upload screens show a one-line consent notice. |
| Retention after someone leaves | A setting, `document_retention_days` (default 365). A daily job archives and deletes files for people inactive longer than that, but keeps the record, dates and verification history. |
| iPhone photos (HEIC) and huge files | The driver app converts to JPEG and compresses. The web accepts PDF, JPG and PNG up to 10 MB with a clear message. |
| Upload with no signal (driver app) | Uses the existing offline queue. The document shows "Waiting to upload". |
| Verification source | `verification_method`: `manual` now. DigiLocker and Parivahan are future options and stay disabled in the UI until they're configured. |

### Bank and payout

| Case | Decision |
|---|---|
| Account holder name differs from the person | Warning. Needs a note to verify. |
| Proof of account | Optional `proof_document_id` (cancelled cheque or passbook, uploaded as a document of type `bank_proof`). |
| Bank details changed (fraud risk) | The person and all superadmins are notified. The new account is only used for payouts after `effective_from` (a setting, `bank_change_cooldown_hours`, default 24). |
| Partner-employed drivers | No bank tab (see identity). |

### Dispatch and history

| Case | Decision |
|---|---|
| How strict dispatch is about driver documents | A setting, `driver_document_enforcement`: `off`, `warn` (default) or `block`. `block` refuses assignment when the licence is expired (after grace), missing, the wrong class, or the driver isn't active. |
| A driver moves between vehicles | New `driver_vehicle_assignments` (driver_id, vehicle_id, assigned_at, unassigned_at, assigned_by), written whenever `vehicles.driver_id` changes. Earnings and performance use it, so trips on an archived or reassigned vehicle still count for the right driver. |
| Two staff editing the same profile | Edits send `updated_at`. A stale edit gets a 409 "Someone else changed this profile. Reload to see their changes." |
| Too many reminder notifications | Staff get one daily digest ("3 licences expire this week") instead of one notification per document. The person still gets their own reminders. |

### Bulk and reporting

| Case | Decision |
|---|---|
| Moving existing people in | `POST /people/import` takes a CSV (name, role, phone, email, employee code, designation, department, joining date). A dry run by default returns row-by-row errors and duplicates; `?commit=true` creates them. |
| Reports | `GET /people/export.csv` (people and document status) and `GET /people/documents/expiring.csv?days=30`. |
| Deletion request from a person | Never hard delete someone with history. "Anonymise" (superadmin, after they're inactive): clears personal fields, contacts, bank data and files, and keeps the record ID so routes and invoices stay intact. Logged. |

### Extra schema for these cases (same migration file)

- `users.status` adds `on_leave`.
- `user_profiles` adds: `employer_type`, `employer_partner_id` (references tpl_partners), `suspended_until`, `leave_from`, `leave_until`, `consent_at`, `consent_by`, `consent_method`, `invite_sent_at`, `anonymised_at`.
- `user_documents` adds: `name_on_document`, `extra_file_paths text[]`, `review_by`, `number_last4`, `number_hash`, `verification_method`, `resubmission_count`. `doc_type` adds `voter_id`, `passport` and `bank_proof`.
- `user_bank_accounts` adds: `effective_from`, `proof_document_id`.
- New: `user_phone_history` (user_id, phone, from_at, to_at), `driver_vehicle_assignments` (above).
- New settings, stored in `system_settings` and editable on Settings: `licence_grace_days`, `document_retention_days`, `bank_change_cooldown_hours`, `driver_document_enforcement`.

## Backend notes

Deviations and choices in `backend-ts` (branch `worktree-agent-a0be52c117f730188`). The migration is written, not applied.

- **List shape**: `GET /people` returns `{items, total, limit, offset}` (limit up to 500). `role=staff` means all non-drivers. Row has `employer_partner_name` and `doc_summary` (groups, see below).
- **Detail** adds `photo_url, employer, doc_summary, missing_documents, complete, bank_access ('full'|'none'|'partner'), phone_history, vehicle_assignments, auth {has_sign_in_account, invite_pending, invite_sent_at}`. `bank_accounts` is `null` for managers, for partner drivers and on a person's own view; notes, activity and status history are empty on a person's own view.
- **Driver email**: a driver's sign-in email is the OTP placeholder (`driver_<digits>@driver.margixindia.local`), returned as `user.email: null`. An email sent for a driver is stored as `profile.personal_email`.
- **Staff invite**: Auth invite cannot set `app_metadata`, so the role is set right after with `updateUserById`; the existing `handle_new_user` trigger creates the row as `driver` for a moment and the backend immediately upserts the right role.
- **Required groups**: driver = driving licence, identity (Aadhaar, voter ID or passport), tax (PAN), photo; staff = identity, tax, photo. "No PAN" is `profile.no_pan_reason` (column added). Dashboard `missing` uses `aadhaar` for the identity group and `pan` for tax.
- **Aadhaar** is never stored: `number_last4` and an HMAC `number_hash` (key `PEOPLE_HASH_SALT`, required in production). Also hashed for duplicate checks: PAN, licence, voter ID, passport. Documents need the person's consent first (`consent_method` in profile PATCH, or `POST /people/:id/consent`); else 409 `consent_required`.
- **`file?index=n`**: without `index` the main file; `index=n` is `extra_file_paths[n]` counting from 0. This follows the web code (`DocumentsTab`), which differs from "0 is the main file" in the coordinator message.
- **Verify rules**: nobody verifies their own documents; a name mismatch needs `verification_note`; editing number or dates of a verified document sends it back to `pending`.
- **`driver_licence_status`** is `valid | expiring | expired | missing | null` (null = vehicle has no driver), plus `driver_licence_in_grace` and `driver_dispatch_issues` on `GET /vehicles` and assign-options. `driver_document_enforcement=block` makes `assertVehicleCanTake` (assign and create-with-vehicle) answer 409 with `dispatch_issues`.
- **Status**: `on_leave` needs `leave_until` (leave must start today). Suspend or deactivate is refused on an active route, and asks for `confirm_release: true` before clearing the driver from their vehicles (pending routes are reported, not changed; unanswered stop prompts are not touched). Sessions are revoked by banning the Auth user (no admin sign-out by user id exists) and clearing the push token. `PATCH /users/:id` now also requires a superadmin for role changes, refuses driver/staff swaps and keeps `status` in step with `is_active`.
- **Backend tokens** (drivers) now check `users.is_active` (cached 60 s) in `authenticateToken`; before, a suspended driver kept a valid access token until it expired.
- **Email change** for staff goes through `auth.admin.updateUserById`; GoTrue applies it at once (no confirmation mail), so the person gets an in-app notice instead.
- **Emergency contacts**: writes are staff only; the person can read their own.
- **Daily job** (`people-jobs.service`, called once per IST day by the scheduler): expiry with one staff digest (`document_expiring`, `data.items`, and `data.user_id/doc_id` when there is one), driver reminders, `review_by` reminders, return from leave and `suspended_until`, retention purge. Not tested separately: leave/suspension return and retention.
- **Assignments**: `driver_vehicle_assignments` is written by a trigger on `vehicles.driver_id` (in the migration, with backfill). `buildEarnings` and the person's performance use it; `GET /analytics/driver-performance` stays per vehicle.
- **Extras**: `POST /people/:id/consent`, `GET /people/:id/documents`, CSV import accepts multipart `file`, `text/csv` or JSON `{csv}`.
- **Not done**: DL number is a warning only (`licence_number_format`); the "unanswered stop prompt" release; tests for CSV import/export and retention/leave jobs; the bank `effective_from` is stored and announced but no payout code reads it yet.
