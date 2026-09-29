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
| Status of anything | `StatusPill status={row.status}`; colours and labels live in `components/ui/status.ts` |
| Lists of records | `DataTable` (sorting, paging, loading, empty, error, phone layout) |
| Record details | `Drawer` + `DetailList` |
| Dialogs | `Modal`; `useConfirm()` for confirm and prompt; never `alert`, `confirm` or `prompt` |
| Tabs | `Tabs` + `useTabParam` so the tab is in the URL |
| Boxes | `Card` (`padded`), `CardHeader`, `CardBody` |
| Numbers at the top of a page | `Stat` (real values only; show `loading` while fetching) |
| Loading, empty, error | `LoadingState`, `Skeleton`, `EmptyState`, `ErrorState`, `Alert` |
| Maps | `MapView` from `@/components/map` (see its README) |

## Rules the linter enforces

Files listed in the last block of `frontend/eslint.config.js` must pass the design rules:

- **Colours:** theme colours only (`text`, `muted`, `brand`, `brand-fill`, `brand-soft`, `success`, `warning`, `danger`, `info`, `neutral`, `border`, `surface`, `surface-subtle`, `bg`). No palette colours (`slate-500`) and no hex values.
- **Type:** `text-xs`, `sm`, `base`, `lg`, `2xl`, `3xl` (and `5xl` on the landing page only). Weights are `font-normal`, `font-medium` or `font-semibold`. No custom letter spacing.
- **Shapes:** `rounded-control` (8px), `rounded-card` (16px) or `rounded-full`. Shadows are `shadow-raised` or `shadow-dialog` only. No blur and no gradients.
- **Inline style:** no inline colour, font, radius or shadow. Runtime layout values such as a progress width are fine.

When a page moves onto the shared components, add it to that list.

## Writing

- Sentence case everywhere: "Create shipment", not "Create Shipment" or "CREATE SHIPMENT".
- Use the names a dispatcher uses: Shipments, Fleet, Routes, Route optimization, Bids, Vendor requests, 3PL partners, Backhaul pooling.
- Buttons say what they do: "Approve bid", "Assign vehicle", "Sign in".
- Never use internal code names or marketing words in the product: no "neural", "nexus", "AI grid", "command", "vector" or "synchronizing".
- Empty states say what is missing and give one next step.
- Error messages say what happened and what to do: "We could not load routes. Check your connection and try again."
- Numbers use the Indian format: `toLocaleString('en-IN')`, and ₹ for money.
- Never show a number, name or status that does not come from real data. If there is no data, show an empty state.
