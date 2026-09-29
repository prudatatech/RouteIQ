# Telematics webhook and alarm rules

Device events and server rules raise alarms in the Fleet > Alerts view. Staff get an in-app notification for each new alarm.

## Webhook

`POST /api/v1/telematics/webhook`

Set `FLEET_TELEMATICS_WEBHOOK_SECRET` on the backend and give the same value to the device provider. With no secret set the endpoint answers `503`. Authenticate in one of two ways:

- `Authorization: Bearer <secret>`
- `X-Signature: sha256=<hex>`, where the hex is the HMAC-SHA256 of the raw request body keyed with the secret

Body: one event, or `{ "events": [ ... ] }` with up to 100.

| Field | Notes |
|-------|-------|
| `event` | Required. `overspeed`, `harsh_braking`, `harsh_acceleration`, `tamper`, `low_fuel`, `ignition`, `geofence` |
| `device_id` / `vehicle_id` / `plate_number` | At least one. `device_id` matches the vehicle's GPS device id (`spark_id`) |
| `timestamp` | ISO 8601 with offset |
| `latitude`, `longitude`, `speed_kmph` | Optional, kept with the alarm |
| `fuel_level_pct` | Optional, 0 to 100. A real device level is also kept on the vehicle for its health score |
| `state` | Ignition: `on` or `off` |
| `direction`, `geofence` | Geofence: `enter` or `exit`, and the fence name |
| `message` | Optional text shown instead of the generated one |
| `test` | `true` marks a test alarm: kept out of stats and health scores |

Response: `201` when at least one event was recorded, `202` when none were, `400` when every event is invalid. Body `{ "results": [ { "index", "status", "alert_id" } ] }` where status is `created`, `repeat` (an open alarm of that type already exists for the vehicle, so its count went up), `unknown_vehicle` or `invalid`.

## Rules on our own data

Thresholds live in `system_settings` and are edited in Admin > Settings:

| Rule | Setting | Default |
|------|---------|---------|
| Overspeed on any ping | `alert_overspeed_kmph` | 80 |
| Vehicle on an active route has not moved | `alert_idle_minutes` | 30 |
| Vehicle on an active route sent no location | `alert_gps_lost_minutes` | 15 |
| Device fuel level below | `alert_low_fuel_pct` | 15 |

GPS lost and long idle are checked every minute. GPS lost, long idle and low fuel close themselves when the condition clears. There is one open alarm per vehicle and type.

## Test alarm

Admin > Settings > Send test alarm (superadmin) sends an event through the same code as the webhook with `test: true`.
