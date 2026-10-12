# 3PL Quick Onboarding Flow

**Status:** Planning
**Goal:** A minimal, frictionless onboarding step so 3PL Partners can join the platform and see relevant loads in under a minute. Full KYC and operational details can be added later.

## Current vs. Proposed

**The Problem Today:** 
Becoming a 3PL partner previously required completing a massive form upfront (Company details, PAN, GSTIN, MSME, Bank Accounts, Corridors, SLA, Tax Treatment, and 4 different document uploads) before they could even access the platform. This high friction causes drop-offs.

**The Solution:**
Inspired by the "Quick Truck Onboarding" pattern, we split the 3PL onboarding into **One Mandatory Quick Step (Auth)** and **One Optional Profile Step**.

---

## 1. Quick Join (Required — ~15 Seconds)

The only goal here is to establish identity and get them into the platform so they can see the value of MargixIndia immediately.

*   **Google Authentication:** The user clicks **"Sign up with Google"**.
*   **Minimal Details Screen (Post-Google):**
    *   **Company Name** (Text field)
    *   **Mobile Number** (For quick communication)
    *   *Nothing else is asked.* Submitting this creates the `tpl_partner` record instantly.

**Visibility & Status:**
*   **Status:** `Quick Added` (Amber badge).
*   **Access:** They are immediately taken to the **Loads Dashboard** where they can see open market loads and lanes.
*   **Restriction:** They can *see* and *browse* loads, but cannot officially quote or accept a load until their KYC is verified.

---

## 2. Complete Profile (Prompted, Never Forced)

Once inside the platform, the partner will see a persistent, non-blocking prompt to "Complete your KYC Profile to start booking loads". They can finish this in any order, whenever they have the documents ready.

*   **Business Identity:** PAN, GSTIN, MSME Status
*   **Bank Details:** Account Number, IFSC
*   **Operational Terms:** Corridors served, SLA commitment, Tax treatment
*   **Documents:** Upload PAN, GST, Cancelled Cheque, etc.

**Compliance Gate:**
A 3PL partner cannot be awarded a load or receive payments until their profile status reaches `Fully Verified` (Green badge). However, by letting them in first, they are motivated to upload their documents because they can already see the loads they want to book!

---

## Technical Integration Notes

*   **Frontend:**
    *   The `TplOnboardingPage.tsx` handles the Google Auth.
    *   A new post-auth screen captures `company_name` and `phone`.
    *   The existing KYC form is moved to a "Settings / Complete Profile" page inside the logged-in dashboard.
*   **Backend / Database:**
    *   Relax `tpl_partners` table constraints. Make fields like `pan_number`, `gstin`, `bank_account_no`, and `bank_ifsc` nullable initially.
    *   Add a `profile_status` column (`quick_added` | `pending_documents` | `fully_verified`).
*   **API:**
    *   The initial onboard endpoint accepts just the Google Identity + Company Name + Phone.
    *   Existing update endpoints handle the piecemeal saving of the rest of the profile.
