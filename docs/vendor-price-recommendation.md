# Vendor price recommendation

The owner supplied five provisional rate bands. Configuration lives in
`backend-ts/src/data/vendor-freight-rates.json`; these are owner reference values, not a verified live market feed.
The guest load assistant and server-side load creation share the same estimator.

Base freight = driving distance in km × the selected truck's per-km band. Low and high are rounded to whole
rupees; the suggested amount uses the midpoint rate (including fractional rates such as ₹32.50/km).
No demand, goods-value or invented specialised premiums are added. Freight GST and operational extras are separate.

Containers use ₹50–80/km independently of their weight; 20–40 ft denotes size. The actual vehicle master supplies
payload capacity. For other trucks, use the smallest reference band that supports the selected vehicle's maximum
payload capacity; gaps between the supplied capacities are covered by that next band. A larger manually selected
truck retains its larger price band even with light cargo. Unknown capacity, overload, refrigerated/tanker vehicles,
missing coordinates or zero distance yield no recommendation. Part loads show a whole-vehicle reference explicitly;
the owner has not supplied a per-tonne or shared-space rate.

The modal in Truck & price and Review shows the vehicle, cargo weight, capacity, distance source, rate band,
low/midpoint/high arithmetic and all five reference bands. Distance fallback is marked as estimated. An input change
hides the previous recommendation during debounce, request and failure so an old price cannot represent a new trip.
The posted price range is recomputed by the server; client-supplied prices are never trusted.
