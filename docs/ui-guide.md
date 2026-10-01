# UI guide

How to build a screen in MargixIndia. The theme itself is described in [ui-plan.md](ui-plan.md), section 2. Colours, sizes and fonts are defined once in `design/tokens.json`; run `node design/generate-tokens.mjs` after changing it.

## Building a console page

```tsx
import { Page, PageHeader, Button, DataTable, StatusPill, SearchInput, Tabs, useTabParam } from '@/components/ui'

export default function ShipmentsPage() {
  return (
    <Page>
      <PageHeader
        title="Shipments"
        description="Every shipment and where it is now."
        actions={<Button icon={<Plus size={16} />} onClick={openCreate}>Create shipment</Button>}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Search by tracking ID or city" className="max-w-sm" />
      </PageHeader>
      <DataTable caption="Shipments" columns={columns} rows={rows} rowKey={r => r.id} loading={isLoading}
        error={error ? 'We could not load shipments.' : undefined} onRetry={refetch}
        empty={{ title: 'No shipments yet', action: <Button onClick={openCreate}>Create shipment</Button> }}
        onRowClick={openDetails} />
    </Page>
  )
}
```

The app shell (`AppLayout`, `VendorLayout`) already provides the page width and padding. Do not add your own `max-w-*`, `mx-auto` or page padding. Map pages that need to fill the screen are listed in `fullBleedPaths` in `src/config/navigation.ts`.

## Components (`@/components/ui`)

| Need | Use |
|------|-----|
| Page title, description, actions, filters | `Page`, `PageHeader`, `SectionHeader` |
| Any button | `Button` (`primary`, `secondary`, `ghost`, `danger`; `loading`), `IconButton` (needs `label`) |
| A link that looks like a button | `buttonClasses({ variant, size })` on `<Link>` |
| Text, number, select, textarea, checkbox | `Input`, `Select`, `Textarea`, `Checkbox`; they include label, hint, error and required mark |
| Address with coordinates | `PlaceSearch` |
| Filter a list | `SearchInput` |
| Status of anything | `StatusPill status={row.status}`; colours and labels live in `components/ui/status.ts`. Pass `kind` (`route`, `booking`, `request`, `bid`, `kyc`, `window`) when the same value means something different on that record |
| Money, weight, distance, time, dates | `formatRupees`, `formatKg`, `formatKm`, `formatMinutes`, `formatDate`, `formatDateTime`, `formatTime` from `@/utils/display` (India time, whole rupees); never a local formatter |
| Lists of records | `DataTable` (sorting, paging, loading, empty, error, phone layout) |
| Record details | `Drawer` + `DetailList` (see "Page or drawer" below) |
| The Vehicle column | `VehicleCell`: plate first, driver or model under it |
| Export button on a list | `ExportCsvButton`, right of the filters |
| One main action and a few more | `MoreMenu` for the rest, never a row of equal buttons |
| Counts, trip numbers, pieces | `pluralize`, `formatPieces`, `tripNumber` from `@/utils/display` |
| Dialogs | `Modal`; `useConfirm()` for confirm and prompt; never `alert`, `confirm` or `prompt` |
| Tabs | `Tabs` + `useTabParam` so the tab is in the URL |
| Boxes | `Card` (`padded`), `CardHeader`, `CardBody` |
| Numbers at the top of a page | `Stat` (real values only; show `loading` while fetching) |
| Loading, empty, error | `LoadingState`, `Skeleton`, `EmptyState`, `ErrorState`, `Alert` |
| Maps | `MapView` from `@/components/map` (see its README) |

## Page or drawer

When a row is clicked:

- **A record with its own address opens that page.** Trips, Fleet vehicles, People, Problems cases, Transfers, Invoices and 3PL partners each have a route (`/routes/:id`, `/fleet/:id` and so on), so their rows navigate to it. Keep the link in the identifier cell too, so it opens in a new tab.
- **A record with no page of its own opens a drawer** (Claims, KYC reviews, Alerts, Bids, Audit entries). The drawer is a quick look with the actions; do not add a route only to avoid one.
- **A working queue opens a drawer that ends in "Open full page"** (Shipments, Requests). Staff triage many rows in a row there, and the drawer keeps the list in place.

## Columns

Identifier first, then status, then from and to, vehicle (`VehicleCell`), amount, date and the actions last. Status is the second column on every list.

## Rules the linter enforces

The design rules apply to every file under `frontend/src/**/*.{ts,tsx}` (see `frontend/eslint.config.js`):

- **Colours:** theme colours only (`text`, `muted`, `placeholder`, `disabled`, `brand`, `brand-fill`, `brand-soft`, `success`, `warning`, `danger`, `info`, `neutral`, `border`, `surface`, `surface-subtle`, `bg`). No palette colours (`slate-500`) and no hex values.
- **Type:** `text-xs`, `sm`, `base`, `lg`, `2xl`, `3xl` (and `5xl` on the landing page only). Weights are `font-normal`, `font-medium` or `font-semibold`. No custom letter spacing.
- **Shapes:** `rounded-control` (8px), `rounded-card` (16px) or `rounded-full`. Shadows are `shadow-raised` or `shadow-dialog` only. No blur and no gradients.
- **Inline style:** no inline colour, font, radius or shadow. Runtime layout values such as a progress width are fine.

## Writing

- Sentence case everywhere: "Create shipment", not "Create Shipment" or "CREATE SHIPMENT".
- Use the names a dispatcher uses: Shipments, Fleet, Routes, Route optimization, Bids, Vendor loads, 3PL partners, Backhaul pooling.
- Buttons say what they do: "Approve bid", "Assign vehicle", "Sign in".
- Never use internal code names or marketing words in the product: no "neural", "nexus", "AI grid", "command", "vector" or "synchronizing".
- Empty states say what is missing and give one next step.
- Error messages say what happened and what to do: "We could not load routes. Check your connection and try again."
- One term per concept: vendor (never shipper), route for the plan, receiver on screen (consignee only on the printed manifest), alert for fleet events, SOS for emergencies, minimum bid, Vendor loads.
- Confirm buttons say verb and object ("Resolve alert", "Delete route"); one-clause toasts have no trailing period.
- Numbers use the Indian format: `toLocaleString('en-IN')`, and ₹ for money.
- Never show a number, name or status that does not come from real data. If there is no data, show an empty state.

## Text contrast

Placeholders use `placeholder:text-placeholder` (`textPlaceholder` on mobile), never `disabled`; hints such as "10-digit mobile number" must stay readable outdoors. `text-disabled` is only for controls that are actually disabled. After changing colours in `design/tokens.json`, run `node design/check-contrast.mjs`: it prints every text and surface pair and fails below 4.5:1 (3:1 for disabled text).
