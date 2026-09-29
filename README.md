# Astrea Drive — interactive demo

Local, browser-only demo of a fleet management app. **All data is fictional sample data** (vehicles, registrations, drivers, clients, bookings). No backend, login, GitHub or Supabase.

## Run it

Option A — local server (recommended):

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:5178/

Option B — double-click `index.html` (also works; everything is plain scripts).

Use the **Computer | iPhone** switch (top left) to preview the phone layout in a 390px frame.

## Internet and third-party services

Everything below is free, needs no account or API key, and loads from public CDNs. Without internet the app still runs; maps show a notice instead.

| What | Source | Notes |
| --- | --- | --- |
| Leaflet 1.9.4 | cdnjs | Map interaction, markers |
| Leaflet.markercluster 1.5.3 | cdnjs | Clusters trucks when zoomed out; fans out trucks at the same site |
| MapLibre GL 4.7.1 + maplibre-gl-leaflet 0.1.3 | cdnjs / jsDelivr | Draws the vector basemap inside Leaflet (needs WebGL) |
| OpenFreeMap vector tiles | tiles.openfreemap.org | OpenMapTiles schema, OpenStreetMap data. Attribution shown on the map |

The basemap is OpenFreeMap's "Positron" style, restyled in `js/core/maps.js` into Astrea light and dark palettes (land, water, roads, labels). No CSS filters are applied to tiles. If WebGL or the style can't load, the map falls back to standard OpenStreetMap tiles and says so.

For production, confirm the tile provider suits your traffic, or self-host OpenFreeMap / OpenMapTiles, or use a keyed provider (MapTiler, Mapbox, Stadia).

## Structure

```
index.html            App shell (sidebar, switch, script tags)
css/styles.css        Theme + layout (tokens at the top; v3 theme and Tracker at the end)
assets/               Logos cropped from the supplied ASTREA DRIVE files, favicon,
                      vac-truck.svg (standalone copy of the marker illustration)
js/core/time.js       Australia/Sydney time handling (DST-safe), DD/MM/YYYY formatting
js/core/logic.js      Business rules: service/rego due, overlaps, scheduled location, attention colours
js/core/ui.js         Modals, confirmations, status labels, headers, toasts, form labelling
js/core/truck.js      Vac truck SVG <symbol> + numbered instances (one drawing, 8 trucks)
js/core/maps.js       Leaflet + MapLibre basemap, Astrea light/dark map styles, fallbacks
js/data/seed.js       Fictional seed data, dates relative to today
js/data/store.js      Data store (localStorage) — the only place to change for Supabase
js/views/*.js         Dashboard, Fleet, Vehicle, Maintenance, Defects, Calendar, Tracker, booking form
js/app.js             Hash router, navigation, reset, Computer/iPhone preview
```

## Design system

- Palette: deep navy `#101D35` (navigation, selected surfaces), Astrea blue `#2463EB` (primary actions, scheduled), mint `#79E2C3` (selected highlights and forecast controls, always with navy text), off-white workspace `#F4F7FA`, dark slate text. The sidebar uses the logo's own navy so the logo sits seamlessly.
- White working surfaces with 12px corners and subtle depth, one per major block. Status labels are a small dot + text. Red and amber only for things that need attention (one shared rule in `AD.logic.attentionTone`).
- System font stack (Segoe UI Variable Display/Text on Windows), tabular numerals throughout.
- Chart colours (validated for colour-blind separation): booking types confirmed `#2463EB`, tentative `#5598E7`, depot `#1BAF7A`, maintenance `#4A3AA7`; vehicle status in use / available / in workshop / out of service = blue / aqua / violet / `#D03B3B`. The same colours are used for status dots, Calendar blocks and Tracker chips. Severity uses a fixed status palette, always with a text label. Charts are plain HTML/CSS (`js/core/viz.js`), each with a legend or direct labels, hover/focus tooltips and a "View as table" twin.

## Tracker

- Map-first layout: compact header, large map, floating map toolbar (zoom, Fit fleet, Australia, light/dark map), collapsible fleet panel on the right, navy forecast timeline along the bottom, persistent "Scheduled positions · Not live GPS" label. On phones the panel moves below the map.
- Truck markers: the vac truck illustration with the fleet number as a live text layer on the tank, a small status chip, and an anchor dot marking the exact site. The selected truck gets a mint halo. Hover or keyboard focus shows ID and job; click opens details in the fleet panel with Open booking / View vehicle.
- Clusters form when trucks would overlap. Trucks at the same site fan out on click, with legs back to a mint dot at the true location.
- Forecast timeline: previous/Today/next day, date and time, a scrubber with hour marks, Now / Forecast / Past schedule labels, and optional playback (15-minute steps; 30-minute steps and no animation when the system asks for reduced motion). Trucks jump between booked sites — no interpolation or routes. The selected truck's bookings show as segments on the scrubber.
- Changing the time never resets the zoom. Map style and panel state are remembered in this browser.

## Connecting Supabase later

Each collection in `store.js` (`vehicles`, `drivers`, `sites`, `bookings`, `services`, `defects`, `documents`, `activity`) maps to one table. The seed objects show the columns. Replace the bodies of `load / insert / update / remove` with Supabase calls and keep the same function names. Times are stored as UTC ISO strings and shown in Australia/Sydney time.

## Scheduling rules (Calendar → Tracker)

- One shared `bookings` dataset drives both screens.
- A booking covers `[start, finish)`: a 07:00–12:00 job covers 11:59 but not 12:00, so back-to-back bookings don't clash.
- Confirmed and tentative bookings show planned locations (tentative is marked on the status chip). Cancelled bookings never set a location.
- No covering booking or depot/maintenance assignment → "Unscheduled — location unknown" (never assumed to be at the depot).
- Overlapping bookings → flagged clash, no position chosen.
- Booking with no coordinates → "Site location required", listed but never placed on the map.
- No travel animation, no routes, no GPS.
