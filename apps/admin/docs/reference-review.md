# Thunder Go — reference review and redesign brief

Review of **Thunder Go / Xiaoantek** (`thunder.xiaoantek.com`), a production
shared-mobility back office, conducted 2026-08-02 as input to the `apps/admin`
UX pass.

Screenshots: [`docs/reference/`](reference/). Section 1 is what the reference
does. Section 2 is what we take from it. Section 3 records each screen we change.

---

## 0. Method and caveats

Walked with Chrome DevTools MCP at 1600×1000. (No Playwright MCP is configured
in this repo; DevTools MCP covers the same ground for a review — navigation,
a11y snapshots, screenshots, computed styles.)

Three caveats that shape how much weight to put on what follows:

1. **The login is a "Customer Service Team Leader" role.** Fleet, geofence and
   billing screens render their full chrome but return zero rows, and eight of
   the twelve Quick Access shortcuts are permission-disabled. So this review
   reads *layout, vocabulary and information architecture* accurately, and
   cannot judge how any of it behaves under real data volume. The one populated
   table found (Operator Log, 29 551 pages) is the basis for the density claims.
2. **The geofence editor was not reachable.** "Service area fence", "Site
   Fence" and "No-parking zone fence" exist as disabled shortcuts and have no
   nav entry under this role. What we know about their zone model is inferred
   from the Operation Map's layer legend, not from the editor itself.
3. **This is a live account with real personal data** — 177 named staff,
   customer phone numbers, real Tashkent operations. No names, numbers or
   customer records are reproduced in this document or in the committed
   screenshots beyond what is incidental to a layout screenshot.

---

## 1. What the reference does

### 1.1 Global chrome

Every page carries the same three-band header before any content:

| Band | Height | Content |
|---|---|---|
| App header | ~88px | collapse toggle, an eye icon, **service-area scope selector**, refresh, language, user |
| Breadcrumb | ~56px | `Homepage / Section / Page` |
| Service-area banner | ~90px | *"Expand the selected service area (No Service Area(0))"* — collapsed, on every page, always |

That is **~230px of identical chrome on every screen** before the first pixel of
content. The third band is the worst of it: a collapsed accordion that repeats
the same string the header already shows two rows above, on all 24 pages.

The one genuinely good idea here is the **service-area scope selector**. Thunder
Go is multi-tenant across cities and partner sites (Tashkent, a couriers zone,
several named venues), and scope is a persistent global filter rather than a
per-page dropdown. Choosing scope once and having every screen respect it is
correct — it just should not cost a whole band of chrome to say so.

### 1.2 Navigation

Ten top-level groups, 24 leaf pages, **uniformly two levels deep** — no group
nests further:

```
workbench                    (leaf)
Vehicle monitoring           Heat map · Operation Map · Vehicle search · Equipment monitoring
User Management              User List · Car rental users · Support Ticket · Reported repair ·
                             User orders · Car return review · Professional Cert · blacklist
Operation & maintenance      Maintenance statistics · Application Site Mgmt · Vehicle Label
Operation Log                Device logs · Vehicle Log · Operator Log
Access Management            User table
Marketing campaign           User Rewards Inquiry
Operational configuration    Message Template
Report Statistics            Transaction lookup · Cycling Card Report
Product Services             Usage Inquiry
```

Depth is fine; **distribution is not**. Four groups hold a single page each,
while User Management holds eight. The accordion means reaching a vehicle from
a user order is: expand group → click page → filter. Everything is two clicks
plus an expand, including things an operator opens hourly.

Sidebar is dark navy with a full-bleed blue active row. Breadcrumbs are present
but non-functional as navigation — the last crumb duplicates the page title, and
the middle crumb links to a group index that does not exist as a page.

### 1.3 Workbench (dashboard) — [`01-workbench.png`](reference/01-workbench.png)

Above the fold, in reading order: **To do today** (4 icon tiles), **Quick
Access** (12 shortcut buttons, 8 disabled), **Business data analysis** (a
5-stage funnel), **Employee Status** (a paginated staff table).

- **"To do today" is the best thing on the page** and it is placed first: four
  actionable queues — support tickets, penalty-exemption applications, site
  applications, refund applications — each an icon with a count badge (`99+` on
  one). This is attention-first framing done right: it opens with *work waiting
  for you*, not *totals*.
- **The funnel is decoration.** Potential usage 20 000 (100%) → scan to rent
  16 000 (80%) → QR health check 15 000 (75%) → rode successfully 13 000 (66%)
  → effective cycling 12 000 (60%). Perfectly round numbers with perfectly
  even drop-offs; this is sample data, or an aggregate so smoothed it cannot
  move day to day. It occupies the entire top-right quadrant. Nobody
  mid-shift acts on it.
- **Employee Status is misplaced, not useless.** Knowing who is on shift is
  real ops information. Rendering it as a name/role/last-login table paginated
  **10 at a time across 18 pages** on the home screen is not. It answers "who
  logged in ever", not "who is working now".
- **Quick Access is an admission of failure.** A user-editable shortcut grid
  exists because the nav cannot get people where they go often. Two-thirds of
  it is greyed out for this role, so the default state is mostly dead buttons.
- No fleet number appears anywhere on the workbench. The home screen of a
  scooter platform never says how many scooters are out.

### 1.4 Operation Map — [`02-operation-map.png`](reference/02-operation-map.png)

The most valuable screen in the product, and the one worth studying closely.

Map fills the viewport with a bottom-left layer legend (service area / parking
area / parking prohibited / no-stopping zone, each with a toggle switch) and
top-right view controls (Night mode, Satellite, fullscreen).

Below the map sits a status strip grouped into **four named families** — and the
grouping, not the numbers, is the insight:

| Family | Members |
|---|---|
| **Operational status** | In operation · Removed from shelves · Usable · While cycling · During temporary stop |
| **Maintenance status** | Repair reported · Low battery · Scheduling · Battery swapping · Dragging back |
| **Alarm status** | Abnormal offline · Battery removal · Exit service area · Abnormal movement · Vehicle loss report · Orders without trips · Extra long order · Short-term orders · Unlocking error · Outside the site · No-stopping zone · Helmet lost · Helmet malfunction |
| **Battery status** | ≤10% · ≤20% · ≤30% · ≤35% · ≤40% · ≤ *custom* % |

Two things stand out:

**The alarm vocabulary is the real product.** Thirteen named anomaly classes,
each a specific operational failure — a scooter that left the service area, a
ride that started but never moved ("orders without trips"), a battery physically
removed from the frame, a ride running past a threshold. This taxonomy is what
separates a fleet tool from a CRUD table, and it is the single most
transferable thing in the reference.

**The thresholds are operator-tunable inline.** "Extremely long, no single
`___` Hour" and "Extra long orders ≥ `___` Hour" are text inputs sitting in the
filter row, not buried in a settings page. The operator decides what counts as
an anomaly, at the point of use.

The presentation, however, is the failure mode the brief warns about: **28
separate counters rendered at identical weight**, every one of them reading `0`.
A wall of zeroes is exactly as unreadable as a wall of stat cards. Nothing
tells you which of the 13 alarms is the one that fired.

### 1.5 Vehicle search — [`03-vehicle-search.png`](reference/03-vehicle-search.png)

Their fleet list, and a clean example of filters eating the screen.

The filter panel is **always expanded and ~700px tall**: a search field, then
four rows of inline chip filters (riding status ×6, operational status ×7, alarm
status ×13 plus two numeric threshold inputs, battery ×7), then a tag
multi-select. On a 1000px viewport, **zero vehicle rows are above the fold.**
The screen opens as a form, not as data.

The chips themselves are good interaction — one click, no dropdown, state
visible — but roughly 35 of them at once, with selected state shown only as a
blue fill on otherwise unstyled text, is far past legibility.

Table columns (14): Serial Number · Device number · Vehicle number · Battery
number · Battery · state · Vehicle Label · Alarm status · Central control
status · Last position · Final positioning time · **No order time** · **No user
order time** · operate.

`No order time` is the quietly clever one: time since the vehicle last earned
anything. Sort by it and the table becomes a ranked list of dead inventory. It
is a derived anomaly column doing real work.

`Serial Number` — a 1,2,3 row index — is the first column of **every table in
the product**. It is pure waste repeated 24 times.

### 1.6 User orders — [`04-user-orders.png`](reference/04-user-orders.png)

Their ride list. Collapsed filter bar (Order number / Mail / Vehicle number,
plus `Reset` `Query` `Expand`) — the standard AntD advanced-search pattern, and
a much better default than Vehicle search's permanent wall.

Columns: Serial Number · Order Number · Mail · Start time · End time · Vehicle
number · Name · Phone · operate.

Striking omission: **no status, no duration, no distance, no cost.** Their order
list is a lookup tool keyed by identifiers, not an operational view of rides in
progress. Ours is already richer.

Visual defect worth noting because we should not reproduce it: the sticky right
`operate` column renders over the `Phone` header.

### 1.7 Support tickets — [`05-support-tickets.png`](reference/05-support-tickets.png)

The one screen with genuinely good defaults: **Work order status defaults to
"Unprocessed"** and creation time defaults to the **last 30 days**. It opens on
the actionable subset rather than on everything ever. That is attention-first
defaulting, and it costs nothing.

Filter panel is expandable/collapsible with `Reset` / `Query` / `Collapse`.

### 1.8 Heat map — [`06-heatmap.png`](reference/06-heatmap.png)

Period presets as chips — today / yesterday / this week / last week / this month
/ last month — plus an explicit datetime range. Good pattern, worth copying
verbatim.

Two tabs over the map: rentals ("Car") vs returns ("Return the car"), each with
an info tooltip.

Two flaws: the map **centres on Beijing** for a Tashkent operation — the default
viewport is hardcoded rather than derived from the fleet's own bounds — and the
page threw a red `Failed to obtain service area fence` toast, positioned
top-centre where it covers the header's scope controls.

### 1.9 Operator log — [`07-operator-log.png`](reference/07-operator-log.png)

The only screen with real data, and therefore the only honest read on density.

**Thunder Go is not dense. It is airy to the point of waste.** Row height ~78px,
14px base font, generous cell padding. Combined with ~230px of global chrome and
a ~150px filter panel, **about five data rows are visible** on a 1000px screen.
Three of the five columns render `--`. Pagination is 10 per page across 29 551
pages.

This is worth stating plainly because it inverts the expectation: the reference
*photographs* as a dense enterprise tool — many controls, many counters, many
chips — while delivering very little information per screen. Density of
*controls* is not density of *information*. Our tables at `size="small"` already
show three to four times as many rows.

### 1.10 Billing / plans — [`08-cycling-card-report.png`](reference/08-cycling-card-report.png)

"Cycling Card Report" is subscription-pass purchases: User Name · Phone ·
Purchase time · Card Name · Amount · Transaction Classification · Payment
channel · Service ID. Defaults to the last 7 days. It is a finance export
surface — note the `Download historical reports` button repeated on most list
screens — not a plan editor. The plan editor lives behind a permission this role
lacks.

### 1.11 Motion

Measured from computed styles rather than eyeballed.

**There is essentially none.** `.ant-menu-item` and `.ant-btn` carry stock Ant
Design transitions — `0.3s cubic-bezier(0.645, 0.045, 0.355, 1)`, i.e.
ease-in-out — on colour, background and border. Nothing else animates. No page
transitions, no skeletons (tables flip from empty to full), no counting
numbers, no row-change highlighting, no drawer easing beyond AntD's own.

So the brief's motion requirements are **entirely additive**. There is no
reference behaviour to match or beat; anything functional we add is new. Note
also that stock AntD's 0.3s ease-in-out is both slower and wrong-shaped versus
the brief's 150–250ms ease-out spec — we override, not inherit.

### 1.12 Colour and status conventions

- Sidebar dark navy; active row full-bleed `#1890ff`.
- Primary blue `#1890ff` for buttons, links and selected filter chips.
- Map status families are colour-coded by **pin icon**, not by text: teal =
  operational, amber = maintenance, red = alarm. Three-tier severity, readable
  at a glance, and consistent between the strip headers and the map pins. This
  is the one place the colour system does real work.
- Zone layers: dashed blue = service area, light blue fill = parking, grey =
  parking prohibited, red = no-stopping.
- Errors: red-icon toast, top-centre, overlapping header controls.
- Brand incoherence: the login screen and logo are green (ANGO); the entire
  admin is blue. Two different products visually.
- Filter chip selected-state is a blue fill on otherwise unstyled text — no
  border, no hover affordance. With 35 chips on screen, unselected chips read
  as body copy rather than controls.

### 1.13 Built for the demo, not the shift

Called out explicitly, since this is what we are filtering against:

- The **funnel chart** — round sample numbers, prime real estate, no daily use.
- **Employee Status paginated across 18 pages** on the home screen.
- **Version Notes** on the workbench, last updated 2025-03-15 — 17 months stale
  and still occupying a full-width panel.
- **Night mode / Satellite** toggles on every map. Demos well; ops uses one.
- **28 alarm counters at equal weight** — reads as capability breadth in a
  screenshot, gives an operator nothing.
- The **service-area banner on all 24 pages**, restating the header.

And the inverse — clearly built by people who run fleets:

- The **13-class alarm taxonomy**.
- **Operator-tunable thresholds** inline in the filter row.
- **`No order time` / `No user order time`** as sortable columns.
- **Tickets defaulting to Unprocessed + last 30 days.**
- **Service-area scope as a global, persistent filter.**
- Separating **`state`** (vehicle) from **`Central control status`** (IoT
  module) — the scooter and its telemetry box fail independently.

---

## 2. What we take, and what we build instead

Re-reading the above against the redesign philosophy: most important 2–3 numbers
large and immediate; anomalies before totals; shallow nav; functional motion
only; tables over card grids past ~5 items.

### 2.1 Keep

| Pattern | Why | Where it lands |
|---|---|---|
| **Alarm taxonomy as a first-class concept** | The single best idea in the reference. Turns a fleet table into an ops tool. | Dashboard attention list; vehicle list column |
| **"To do today" as the opening element** | Work waiting for you, before totals. | Dashboard, top-left, largest element |
| **Actionable-subset defaults** (tickets → Unprocessed, last 30d) | Free attention-first framing. | Rides default to Active; vehicles default to "needs attention" |
| **Idle-time as a sortable column** (`No order time`) | Ranks dead inventory with no new UI. | Vehicle list |
| **Period-preset chips** (today / yesterday / this week …) | Cheap, fast, no date-picker fiddling. | Dashboard revenue, rides |
| **Three-tier severity colour** (teal / amber / red) | Consistent across strip, pins, legend. Already half-built in `status.tsx`. | Extend `status.tsx` with a severity axis |
| **Vehicle state vs controller state separated** | Real distinction; a live scooter with a dead modem is a different problem. | Flagged — see §2.4 |

### 2.2 Simplify

| Pattern | Reference version | Ours |
|---|---|---|
| Alarm display | 13 counters at equal weight, all showing `0` | **Only non-zero alarms render**, ranked by severity then count. Zero alarms → one green "all clear" line, not 13 zeroes |
| Filter chips | ~35 always-expanded, ~700px tall | A single row of the 4–5 filters actually used; the rest behind "More filters". Data above the fold on first paint |
| Status families | 4 families × 28 counters below the map | Two numbers large (fleet available, rides active), everything else in the attention list |
| Global scope selector | Its own header band + a repeated banner on 24 pages | We are single-city — **drop entirely**. Revisit only if the demo grows a second city |
| Map view controls | Night mode + Satellite + fullscreen on every map | Fullscreen only |
| Period presets | Chips *and* a datetime range, always both | Chips by default; custom range one click away |

### 2.3 Drop

| Pattern | Why |
|---|---|
| **Funnel chart** | Sample data in prime position. Nothing acts on it. |
| **Quick Access shortcut grid** | A workaround for bad nav. If we need it, the nav is wrong — fix the nav. |
| **Employee Status on the dashboard** | We have no staff model, and paginating it on a home screen is wrong regardless. |
| **Version Notes panel** | 17 months stale in the reference. Chrome, not content. |
| **`Serial Number` row-index column** | Wasted first column in all 24 of their tables. Ours already omits it — keep it that way. |
| **Breadcrumbs** | Two levels deep with a non-navigable middle crumb. Our nav is flat; the sidebar already says where you are. |
| **Repeated service-area banner** | ~90px × every page to restate the header. |
| **Stock 0.3s ease-in-out** | Wrong duration and wrong curve per the brief. Override AntD's motion tokens. |

### 2.4 Fields the reference surfaces that we do not track

Per the brief, flagged rather than faked. **None of these get invented data.**

Our `VehicleStatus` is `available · in_use · reserved · low_battery · offline ·
maintenance`; our zone kinds are `service · parking · forbidden`.

| Reference concept | Our status | Note |
|---|---|---|
| Alarm classes (exit service area, abnormal movement, battery removal, unlocking error, vehicle loss, helmet lost/faulty) | **Not modelled** | Some are *derivable* from what we already have — see below |
| `No order time` / idle time | **Derivable** — we have `lastSeenAt`, but not "last ride ended at" | Needs an API field to be exact |
| "Orders without trips" (ride started, vehicle never moved) | **Derivable** from `distanceM ≈ 0` on an active ride | No new data needed |
| "Extra long order" (ride past threshold) | **Derivable** from `durationS` | No new data needed |
| Vehicle outside service area | **Derivable** — we have PostGIS geofencing and vehicle positions | No new data needed |
| Central control / IoT module status | **Not modelled** | Would need a gateway field |
| Vehicle tags / labels | **Not modelled** | |
| Swappable battery as an entity (battery number, battery removal) | **Not modelled** | Our sim has no battery swap |
| "Removed from shelves" (deactivated) | **Not modelled** | |
| Ops workflow states (scheduling, dragging back, battery swapping) | **Not modelled** | Would need an operator app — explicitly out of scope per root `CLAUDE.md` |
| 4th zone kind: parking-prohibited vs no-stopping as distinct | We collapse both into `forbidden` | Fine for the demo |

**The plan:** build the attention list from the four *derivable* anomalies only
— stuck ride (no distance), overlong ride, vehicle outside a service zone, and
low battery / offline from statuses we already have. That gives a real,
non-fabricated attention feed on demo data. Everything else stays on this list
until someone decides to model it.

### 2.5 Redesign principles for our screens

1. **Two numbers, then a queue.** Every screen opens with at most two large
   figures and an attention list. Totals go in a secondary row or one click away.
2. **Zero-state is a sentence, not a grid of zeroes.** "Nothing needs attention"
   is one green line. Anomalies only render when they exist.
3. **Data above the fold.** Filters are one row. Nothing pushes the first table
   row below 1000px.
4. **Nav stays flat.** Ours is already 8 flat items — the reference's main
   structural failure is one we do not have. Do not add groups.
5. **Motion is a state-change cue.** Count-ups on changing numbers, a ~600ms
   fading row highlight on live update, slide-in drawers. 150–250ms, ease-out
   in / ease-in out, never blocking. Override AntD's 0.3s ease-in-out tokens.
6. **Severity, not just status.** `status.tsx` gains a severity axis (ok /
   watch / alarm) so the dashboard, the table and the map agree on what is bad,
   not merely on what colour each status is.

---

## 3. Screen-by-screen change log

*Filled in as each screen lands.*

### 3.1 Dashboard

**Before:** twelve `Card` + `Statistic` tiles in two rows of six — total,
available, in use, low battery, offline, average battery, active rides, rides
today, subscriptions, users, revenue today, revenue this week — all identical
in size and weight, then a map and two charts. We had built the stat-card wall
ourselves, independently of the reference. Nothing on the screen said which
scooter was stranded or which ride had run long; there was no anomaly concept
at all.

**After:** two figures large (available-of-total, rides in progress), then an
attention queue, then the map. Everything that used to be a card is now one
compact secondary line beneath.

| Change | Why |
|---|---|
| 12 stat cards → 2 hero numbers + 1 secondary line | *"The most important 2–3 numbers large and immediate, everything else one click away."* The other ten still exist; they just stopped competing. |
| New attention queue as the first content | *"What needs my attention right now"* before *"here is all the data."* Ranked by severity, each row links to the screen that fixes it. |
| Severity axis added to `status.tsx` | Status says what a vehicle is; severity says how much it should worry you. Now the dashboard, tables and map rank problems identically instead of each re-deciding. |
| Repeated anomalies collapse into one row | See below — this was the real design problem. |
| Threshold selector inline in the panel | Taken from the reference: the operator decides what "too long" means, at the point of use, not in a settings screen. |
| Two charts → one | The rides line duplicated the revenue bars' shape. One chart, full width. |
| Count-up on the hero numbers, 250 ms ease-out | A KPI that ticks while you look elsewhere still registers peripherally. |
| AntD motion tokens overridden | Stock is `0.3s` ease-in-out; the brief calls for 150–250 ms ease-out. Set once in `App.tsx` so every AntD component inherits it. |

**The thing worth recording:** the first working version rendered *44 separate
alarm rows*, 27 of them reading "outside the service area". The check was
correct — the seed genuinely scatters vehicles beyond the service polygon — but
the result was the reference panel's wall of counters in list form. Naming each
vehicle only helps while there are few; past a handful the useful fact is the
count and that the problem is systemic. Rows of the same kind now collapse
above three (`GROUP_ABOVE` in `lib/anomalies.ts`), so the screen reads:

```
● 27 самокатов за пределами зоны обслуживания
● 7 самокатов не выходят на связь
● 8 самокатов с низким зарядом
● SCOOT-0039  на обслуживании
```

That is legible in about a second, which was the stated bar.

**Implementation notes.** Anomalies are derived on the client in
`lib/anomalies.ts` from data the dashboard already loads — no new endpoints, no
data-layer changes. Out-of-zone needed a point-in-polygon test, added to
`packages/shared/src/geo.ts` next to `haversineDistanceM` and carrying the same
caveat: a client-side approximation for flagging, with PostGIS still
authoritative.

**No Framer Motion.** The brief allowed it, but count-up, row flash and drawer
slide are one rAF hook plus three keyframes (`components/motion.tsx`), which
gives tighter control over the 150–250 ms spec than a new dependency would.
Everything collapses to an instant swap under `prefers-reduced-motion`.
### 3.2 Vehicle list + detail — pending
### 3.3 Ride list — pending
### 3.4 Zone editor — pending
### 3.5 Other — pending
