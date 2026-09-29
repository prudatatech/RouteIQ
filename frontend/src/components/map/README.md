# Maps

`MapView` is the only component that draws a map. Pages give it data as props
and it handles the camera, markers, loading and errors. Do not create
`maplibregl.Map` / `mapboxgl.Map` instances or use `react-map-gl` directly in pages.

```ts
import { MapView, type MapVehicle, type MapPoint, type MapRoute } from '@/components/map'
```

## Library and base map

- **MapLibre GL** (`maplibre-gl` 4) through `react-map-gl/maplibre`.
- Base map: `/map-style.json` (Carto Positron vector tiles, OpenMapTiles fonts). **No token needed.**
- `VITE_MAPBOX_TOKEN` is optional. It is only used for driving directions
  (`fetchDrivingRoute`). Without it, routes are drawn as dashed straight lines.
- Place search uses `services/geocoding.ts` (ArcGIS, no token).

### Base maps and layers

`MapView` takes `baseStyle` (`streets` | `satellite` | `terrain` | `dark`, see `BASE_STYLES` in `config/mapConfig.ts`),
`trails` (`{ id, coordinates: [lng, lat][] }[]`, drawn under the vehicles) and `clusters` (default true).
No token is needed: streets and dark are Carto, satellite and terrain are Esri's public tiles.
`LayerSwitcher` is the Layers menu; `LiveMap` uses it with `layerPrefs.ts` (choices kept in this browser)
for traffic incidents, route lines, the selected vehicle's trail (from `gps_points`) and clustering.
A `flyTo` asked for before the style has loaded runs once the map is ready.

## Files

| File | What |
|------|------|
| `MapView.tsx` | The map component |
| `types.ts` | Prop and data types |
| `markers.tsx` | Vehicle, point and stop markers |
| `layers.ts` | Route line, geofence circles, bounds helpers |
| `overlays.tsx` | Recenter control, status legend, loading and error states |
| `directions.ts` | `fetchDrivingRoute()` (Mapbox Directions, optional) |
| `useLiveVehiclePositions.ts` | Realtime GPS positions from Supabase with a 5 s poll fallback |
| `LiveMap.tsx`, `DriverMap.tsx`, `InlineTrackingMap.tsx` | Existing components, now thin wrappers over `MapView` |
| `config/mapConfig.ts` | Base map, default view, token, and the **only** status → colour/label maps |

## MapView props

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `mode` | `'fleet' \| 'route' \| 'incident' \| 'tracking' \| 'picker'` | `'fleet'` | Only picks defaults (below) |
| `vehicles` | `MapVehicle[]` | `[]` | `{ id, position: {lat,lng}, status, label, heading? }`. Moves animate smoothly |
| `route` | `MapRoute \| null` | `null` | `{ coordinates: [lng,lat][], stops?: MapRouteStop[], planned? }`. With no coordinates the stops are joined by a dashed line |
| `points` | `MapPoint[]` | `[]` | `{ id, kind, position, label, active?, radiusKm?, draggable? }`. Kinds: `pickup`, `drop`, `incident`, `hub`, `load`, `location` |
| `selectedId` / `onSelect` | `string \| null` / `(id) => void` | | Ids of vehicles and points |
| `fitTo` | `'initial' \| 'content' \| 'none'` | by mode | `initial`: fit once. `content`: refit when things are added/removed (not when a vehicle just moves) |
| `fitPadding` | `number \| {top,bottom,left,right}` | `48` | Use the object form to keep content clear of an overlay card |
| `flyToSelected` | `boolean` | by mode | Fly to a vehicle/point when it becomes selected |
| `follow` | `boolean \| string` | by mode | Keep a vehicle centred. `true` = selected vehicle, or the only one. Dragging pauses; recenter resumes |
| `interactive` | `boolean` | `true` | `false` for static previews (no pan/zoom/controls) |
| `controls` | `{ zoom?, fullscreen?, recenter? }` | by mode | Recenter refits the content, or goes back to the followed vehicle |
| `showLegend` | `boolean` | by mode | Status legend with counts (colour is never the only cue) |
| `showLabels` | `boolean` | `false` | Always show plate + status under vehicles (otherwise only when selected) |
| `onPick` | `(pos) => void` | | Click to pick a location; crosshair cursor |
| `onPointMove` | `(id, pos) => void` | | Called when a `draggable` point is dropped |
| `initialCenter` / `initialZoom` | | India (`VITE_MAP_CENTER_*`, `VITE_MAP_ZOOM`) | Only used before there is content to fit |
| `pitch` | `number` | `0` | Driver navigation uses 60 |
| `height` | `number \| string` | | Without it the map fills its parent, **at least 320 px** |
| `className`, `ariaLabel`, `children` | | | `children` are overlays positioned by the page (`absolute ... z-10`) |

Imperative handle (`ref`): `flyTo(position, zoom?)` and `fitToContent()`, for search results or "zoom to" buttons.

### Mode defaults

| Mode | fitTo | flyToSelected | follow | Controls | Legend |
|------|-------|---------------|--------|----------|--------|
| `fleet` | initial | yes | no | zoom, fullscreen, recenter | yes |
| `route` | content | no | no | zoom, fullscreen, recenter | no |
| `incident` | content | yes | no | zoom, fullscreen, recenter | no |
| `tracking` | initial | no | yes | zoom, recenter | no |
| `picker` | content | no | no | zoom | no |

### Built-in behaviour

- **Always visible.** The map canvas is absolutely positioned inside a box that fills its parent with a 320 px minimum, so a parent without a height can never produce a blank 0 px map.
- **Loading**: "Loading map…" until the style has loaded.
- **Errors**: if the base map fails to load, takes over 20 s, or WebGL is unavailable, a plain message is shown (with "Try again" where retrying can help). Missing tiles are not treated as errors.
- **No invented data**: vehicles/points with missing coordinates (or 0,0) are left off the map. Nothing is placed at a guessed position.
- **Empty state is the page's job**: with nothing to show, the map stays on India. Show your own empty message next to or over it.
- **Colours** come from theme tokens via `config/mapConfig.ts`: `VEHICLE_STATUS`, `STOP_STATUS`, `MAP_TONES`, `MAP_COLORS`. Add new statuses there, not in pages. Only an active SOS incident pulses.
- **Accessibility**: every marker is a button (or labelled image for stops) with an `aria-label` such as "KA01AB1234, On route" or "Stop 2, Andheri, Pending". Map controls are labelled.

## Wrappers kept for existing pages

- `LiveMap` — same props as before (`vehicles`, `selectedVehicleId`, `zoomFocusEvent`, `onVehicleSelect`, `customPendingStops`), plus optional `mode`, `compact`, `className`. Adds realtime positions, the selected vehicle's active route, open marketplace loads and place search.
- `DriverMap` — same props. Driver position, next stop, road route (refreshed every 10 s), and an ETA/distance/speed card.
- `InlineTrackingMap` — same props. One shipment's vehicle and its next stop.

## Migration, page by page

Each snippet shows what to delete and what to render instead. Page state
(queries, realtime subscriptions for page data) stays in the page; only the
map code goes.

### LiveMapPage (`/live-map`) — currently blank

Why it is blank: it starts at `[0, 0]` zoom 2 (the Gulf of Guinea), never loads
the vehicle list, and only adds markers for `gps_update` WebSocket messages that
the backend never sends (it sends `TELEMETRY_UPDATE`). It also never removes
old markers and uses `h-screen` inside the padded layout. Replace the whole page body:

```tsx
const { data: vehicles = [], isLoading, isError } = useQuery({ queryKey: ['vehicles'], queryFn: () => vehiclesAPI.list() })
const active = vehicles.filter(v => v.status !== 'archived')

<PageHeader title="Live map" />
<div className="h-[calc(100vh-12rem)] overflow-hidden rounded-card border border-border">
  <LiveMap vehicles={active} />
</div>
{!isLoading && active.length === 0 && <EmptyState title="No vehicles yet" ... />}
```

Delete the `maplibregl` import, the `telemetryWS` markers and the `useMobileLocation` marker
(the browser's own position is not a fleet vehicle). `AIHubPage` embeds this page; it gets the fix for free.

### DashboardPage

Keep `<LiveMap vehicles={activeVehicles} selectedVehicleId={selectedVehicleId} zoomFocusEvent={zoomFocusEvent} />`.
Delete the hand-made legend under the map (`Reporting` / `Offline` dots): `LiveMap` shows a legend with counts.
Pass `onVehicleSelect={setSelectedVehicleId}` so clicking a marker selects the row too. Keep a fixed-height parent (`h-[440px]`, or taller for 3.2).

### FleetPage (vehicle detail)

Replace the Google Maps `<iframe>` preview:

```tsx
<MapView
  mode="tracking"
  height={160}
  interactive={false}
  vehicles={[{ id: vehicle.id, label: vehicle.plate_number, status: vehicle.status,
               position: { lat: vehicle.latitude, lng: vehicle.longitude } }]}
/>
```

Keep the "Open in Google Maps" link.

### EmergencyPage

Delete the `maplibregl` map, the `markersRef` innerHTML markers, `focusAlert`'s `flyTo` and the map `useEffect`s. Keep the realtime alert and live-vehicle subscriptions.

```tsx
const points: MapPoint[] = latestAlertPerVehicle.map(a => ({
  id: a.id,
  kind: 'incident',
  active: a.status === 'active',
  label: `${formatType(a.alert_type)}: ${a.vehicle?.plate_number ?? 'Unknown vehicle'}`,
  position: a.id === selectedAlert?.id && liveVehicle ? liveVehicle : { lat: a.latitude, lng: a.longitude },
}))

<MapView mode="incident" points={points} selectedId={selectedAlert?.id}
         onSelect={id => setSelectedAlert(alerts.find(a => a.id === id) ?? null)}>
  {selectedAlert && <div className="absolute left-3 top-3 z-10 ...">{/* detail card */}</div>}
</MapView>
```

### RouteDetailsPage

Delete `react-map-gl` `Map/Source/Layer/Marker`, the `mapbox-gl` import and the inline directions fetch.

```tsx
const stops: MapRouteStop[] = sortedStops.flatMap((s, i) => s.delivery_points?.latitude
  ? [{ id: s.id, sequence: i + 1, status: s.status, label: s.delivery_points.name,
       position: { lat: s.delivery_points.latitude, lng: s.delivery_points.longitude } }] : [])
const [road, setRoad] = useState<DrivingRoute | null>(null)
useEffect(() => { fetchDrivingRoute([vehiclePos, ...stops.map(s => s.position)].filter(Boolean)).then(setRoad) }, [route?.id])

<MapView mode="route"
  route={{ coordinates: road?.coordinates ?? [], stops }}
  vehicles={vehiclePos ? [{ id: route.vehicle_id, label: vehicleName, status: route.vehicles.status, position: vehiclePos }] : []} />
```

Remove the `|| 77.2090` / `|| 28.6139` fallbacks and the `'YOUR_MAPBOX_TOKEN_HERE'` token fallback.

### CustomerTrackingPage (`TrackingMap`)

Delete the module-level `_customerMapInstance`, manual markers, bearing CSS, route layer and "locate" button.
Keep the 5 s polling, ETA and city lookup. The map no longer depends on a Mapbox token, so remove the
"Telemetry Offline" branch.

```tsx
<MapView mode="tracking" height={300}
  vehicles={liveVehicle?.lat ? [{ id: liveVehicle.id, label: liveVehicle.plate_number ?? 'Your delivery',
                                  status: 'on_route', heading: bearing, position: liveVehicle }] : []}
  points={destination?.lat ? [{ id: 'drop', kind: 'drop', label: 'Delivery address', position: destination }] : []}
  route={activeRouteCoords ? { coordinates: activeRouteCoords } : null}>
  {/* location / ETA / speed card */}
</MapView>
```

Following, the recenter button and smooth movement along the road are built in.

### VendorShipmentRequestPage (picker)

Delete `react-map-gl`, `viewState`, `updateMapBounds`, the fence `Source`s and the curve layer.

```tsx
const points: MapPoint[] = [
  pickupLocation && { id: 'pickup', kind: 'pickup', label: `Pickup: ${pickupLocation.address}`,
                      position: pickupLocation, radiusKm: 5, draggable: true },
  dropLocation && { id: 'drop', kind: 'drop', label: `Drop: ${dropLocation.address}`,
                    position: dropLocation, radiusKm: 5, draggable: true },
].filter(Boolean) as MapPoint[]

<MapView mode="picker" points={points}
  route={pickupLocation && dropLocation ? { coordinates: [[pickupLocation.lng, pickupLocation.lat], [dropLocation.lng, dropLocation.lat]], planned: true } : null}
  onPointMove={(id, pos) => handleMarkerDrag(pos, id as 'pickup' | 'drop')} />
```

`handleMarkerDrag` should take a `LatLng` instead of the drag event. The map is `hidden lg:block` today; step 5.3 wants it visible on phones (give it `height={240}` there).

### VendorOnboardingPage (picker)

Delete the `maplibregl` map, marker, `createGeoJSONCircle` and the `[lat, lng]` effect.

```tsx
const pos = lat && lng ? { lat: Number(lat), lng: Number(lng) } : null
<MapView mode="picker"
  points={pos ? [{ id: 'base', kind: 'hub', label: `Operating base: ${city}`, position: pos, radiusKm: 50, draggable: true }] : []}
  onPick={p => { setLat(String(p.lat)); setLng(String(p.lng)) }}
  onPointMove={(_, p) => { setLat(String(p.lat)); setLng(String(p.lng)) }} />
```

### MobileTrackPage

Today it shows raw coordinates only. Optional: show the phone's position.

```tsx
{coords && <MapView mode="tracking" height={200} interactive={false}
  vehicles={[{ id: 'me', label: 'This phone', status: 'on_route', position: coords }]} />}
```

### VendorTrackingPage

Today it links to `/track/:id` ("Open Map"). Optional: an inline map with the same data as the customer tracker,
using the `CustomerTrackingPage` snippet (`mode="tracking"`, vehicle + drop point).

### TplDashboardPage

Has no map today (corridors are a list). If a corridor map is added, use `mode="route"` with one planned route per
corridor, or `points` of kind `hub` for origins/destinations. Nothing to migrate.

### Other users of the wrappers (no change needed)

- `ShipmentsPage`, `CargoNetworkPage`, `OptimizePage`, `AddShipmentModal`: `LiveMap` works as before, and two maps on one page now both render (see bugs fixed).
- `DriverPage`: `DriverMap` unchanged API.
