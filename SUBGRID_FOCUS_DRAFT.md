# Subgrid Focus Draft (Initial)

Date: 2026-08-28
Status: Draft for implementation planning only

## Goal

Add a secondary cube-focus mode that gates subcell targeting behind APC interior focus mode.

This keeps current floor-level cube picking as stage one and enables a separate, stricter stage two picker for 2x2x2 subcells.

## Core Decision

Use a two-stage interaction pipeline:

1. Interior focus mode selects a cube on the current floor.
2. Cube focus mode handles subcell and face-slot interaction for that one selected cube.

Do not run both pickers at the same time.

## Interaction State Model

Proposed TypeScript interaction ladder:

- normal
- focusInterior
- focusCube

State data:

- focusTarget: existing APC/building focus target
- focusLevel: existing focused floor index
- selectedCubeCell: number | null
- cubeCameraSnapshot: optional camera restore point while in focusCube

Rules:

- normal: world inputs active, no interior picks
- focusInterior: floor-scoped cube pick active, subcell picker disabled
- focusCube: subcell/face picker active, floor picker disabled

## ESC Behavior (One Transition Per Press)

ESC pops one level per key press, no repeats.

Transition order:

1. focusCube -> focusInterior
2. focusInterior -> normal
3. normal -> no-op (do not intercept)

Input handling constraints:

- Handle on keydown
- Ignore repeat events
- Call preventDefault + stopPropagation only when current state is focusInterior or focusCube
- Do not globally block browser ESC behavior while in normal

## Camera Behavior

focusInterior:

- Keep existing floor-centered camera behavior

focusCube:

- Optional but recommended: center camera on selected cube center
- Keep APC local transform alignment
- Save and restore interior camera context when entering/leaving focusCube

If camera recentering is deferred, mode gating still applies and remains valid.

## Picker Gating Contract

Stage 1 picker (existing floor-plane picker):

- Active only in focusInterior
- Output: selected cube cell index
- Side effect: enter focusCube with selectedCubeCell set

Stage 2 picker (new subcell/face picker):

- Active only in focusCube
- Input: selectedCubeCell, camera ray
- Output: local subcell index (0..7) and/or local face endpoint slot (0..3 per side)

While in focusCube:

- Ignore floor scroll level changes for picking decisions
- Keep hover/selection visuals scoped to selected cube

## Visual Gating

focusInterior:

- Current subfocus floor visibility behavior remains

focusCube:

- Selected cube: remains opaque and interactive
- Non-selected cubes on same floor: transparent/de-emphasized
- Floors above: hidden (existing behavior)
- Floors below: dimmed context (existing behavior)

## Data Model Draft (Rust/WASM)

Keep lattice as topology source.

ApcInterior should own:

- lattice
- machines
- subgrid

Subgrid responsibilities:

- 8 subcells per cube occupancy
- occupant kind and ID storage
- footprint reservation and release
- face-local quarter mapping helpers

Machine model evolution target:

- Stable machine ID per machine
- Parent cube index
- 8-bit footprint mask inside parent cube
- Endpoint config belongs to cube side, not shared lattice face

Important: two adjacent cubes share geometry but have independent endpoint attachments/configuration.

## Transfer Routing Migration (Planned)

Current:

- Sender machine has one output direction
- Transfer to neighbor cube machine by adjacency

Target:

- Route through cube-side endpoints
- Match quarter-slot endpoint pairs across shared face
- Keep deterministic stepping and current backpressure semantics

Migration strategy:

1. Introduce endpoint data model without changing runtime routing
2. Mirror existing output direction into endpoint defaults
3. Switch routing to endpoint matching
4. Remove legacy direction-only dependency

## Bottom-Layer Subcell Movement Rule

Units move only on local floor subcells 0..3 (no vertical movement).

Blockers:

- Any occupied machine subcell in candidate location blocks
- Occupied unit subcell blocks

Constraints:

- No movement into upper 4 subcells
- No climb/drop transitions

## TS Integration Sequence (Draft)

1. Extend focus mode state with focusCube + selectedCubeCell
2. Update keyboard handler for ESC pop semantics and repeat guard
3. Gate existing interior cube picker to focusInterior only
4. Add focusCube entry/exit orchestration in main loop and camera update
5. Add subcell pick/render hooks that activate only in focusCube
6. Keep floor picker dormant while focusCube is active

## WASM View Exposure Sequence (Draft)

Expose zero-copy arrays for:

- subgrid occupant kinds
- subgrid occupant IDs
- machine footprints
- machine parent cubes
- endpoint occupancy/config arrays per cube side

TypeScript entity store mirrors these with pointer + length caching, matching existing patterns.

## WASM Contract Draft (Exact Surface)

This section defines the minimum stable boundary before TypeScript integration.

### ApcInterior methods to add

- subgrid_occupant_kinds_ptr() -> *const u8
- subgrid_occupant_kinds_len() -> usize
- subgrid_occupant_ids_ptr() -> *const u32
- subgrid_occupant_ids_len() -> usize
- machine_ids_ptr() -> *const u32
- machine_parent_cells_ptr() -> *const u32
- machine_footprints_ptr() -> *const u8
- endpoint_owner_machine_ids_ptr() -> *const u32
- endpoint_owner_machine_ids_len() -> usize
- endpoint_modes_ptr() -> *const u8
- endpoint_modes_len() -> usize

Recommended helpers (non-view):

- selected_cube_get() -> usize (returns usize::MAX when none)
- selected_cube_set(cell: usize) -> bool
- selected_cube_clear()

### Array semantics and lengths

All lengths below are deterministic and derivable from existing envelope values.

- subgrid_occupant_kinds: u8 array
	- Length: cell_count * 8
	- Values: 0 none, 1 machine, 2 unit

- subgrid_occupant_ids: u32 array
	- Length: cell_count * 8
	- Sentinel empty value: u32::MAX

- machine_ids: u32 array
	- Length: machine_count
	- Stable ID per machine, never index-derived

- machine_parent_cells: u32 array
	- Length: machine_count
	- Envelope cell index of machine owner cube

- machine_footprints: u8 array
	- Length: machine_count
	- Bitmask over local subcells 0..7 inside parent cube

- endpoint_owner_machine_ids: u32 array
	- Length: cell_count * 6 * 4
	- Layout index: ((cell * 6 + dir_index) * 4 + slot)
	- Sentinel empty value: u32::MAX

- endpoint_modes: u8 array
	- Length: cell_count * 6 * 4
	- Mode encoding draft:
		- 0 disabled
		- 1 input
		- 2 output
		- 3 bidirectional

### Pointer lifetime and invalidation rules

The TypeScript side must assume pointers can move on any reallocation event.

Required invalidation triggers:

- machine add/remove
- hull reset that drops machines
- explicit clear/rebuild paths

Not required as invalidation trigger when storage is fixed-size and unchanged:

- per-tick occupancy changes that only mutate contents

Compatibility with current JS cache pattern:

- cache key remains (pointer, length, memory.buffer identity)

### Determinism and ordering guarantees

- machine array order must not depend on insertion order
- when sorting is required, sort by parent cell then stable machine id
- endpoint arrays must use fixed dir order matching existing Dir enum indices

## TypeScript Event Ownership Table (Draft)

This table is the final arbiter for input dispatch once implementation starts.

### Keydown events

- Escape
	- normal: ignore in app layer
	- focusInterior: preventDefault + stopPropagation, transition to normal
	- focusCube: preventDefault + stopPropagation, transition to focusInterior
	- repeat=true: no-op in all states

- Space
	- normal: no-op
	- focusInterior: no-op
	- focusCube: preventDefault + stopPropagation, transition to focusInterior
	- repeat=true: no-op

### Mouse left click

- normal
	- Owner: world selection
	- Interior handlers inactive

- focusInterior
	- Owner: floor cube picker
	- On hit cube: set selectedCubeCell and enter focusCube
	- On miss: no state change

- focusCube
	- Owner: subcell/endpoint picker
	- floor cube picker must not run

### Mouse move

- focusInterior: update cube hover only
- focusCube: update subcell/endpoint hover only
- normal: world hover only

### Wheel

- normal: existing camera zoom behavior
- focusInterior: existing floor scroll behavior
- focusCube: floor scroll disabled for targeting consistency (initial policy)

## TypeScript State Machine Contract (Draft)

State variables:

- focusMode: normal | focusInterior | focusCube
- focusTarget: existing APC/building focus target
- focusLevel: existing floor index
- selectedCubeCell: number (usize::MAX or -1 sentinel in TS)

Transitions:

- enter APC focus button: normal -> focusInterior
- cube click in focusInterior: focusInterior -> focusCube
- Escape in focusCube: focusCube -> focusInterior
- Escape in focusInterior: focusInterior -> normal
- focus exit button: focusInterior|focusCube -> normal

Invariants:

- selectedCubeCell is valid only while focusMode == focusCube
- subcell hover/selection is valid only while focusMode == focusCube
- floor cube hover/selection is valid only while focusMode == focusInterior

## Stage Gates For Multi-Phase Commencement

This is the minimum gate set to start coding safely in phases.

### Stage A: ApcInterior owns Subgrid

Entry:

- subgrid module exists and tests pass

Exit:

- ApcInterior has subgrid field
- hull reset keeps subgrid storage coherent
- no change to transfer behavior
- cargo test still green

### Stage B: Stable machine identity and footprints

Entry:

- Stage A complete

Exit:

- machine_ids, parent_cells, footprints present
- old one-machine-per-cell assumptions removed internally
- transfer behavior unchanged from player perspective

### Stage C: WASM zero-copy views exposed

Entry:

- Stage B complete

Exit:

- new ptr/len APIs available in wasm_sim.d.ts
- entityStore exposes cached typed views for all new arrays
- no per-frame buffer copies added

### Stage D: FocusCube mode and ESC stack behavior

Entry:

- Stage C complete

Exit:

- focusMode ladder active
- ESC transitions one level per press, repeat ignored
- browser ESC interception only while in focus states

### Stage E: Subcell render/pick in FocusCube only

Entry:

- Stage D complete

Exit:

- selected cube isolation visuals active
- subcell picker only active in focusCube
- floor picker dormant in focusCube

### Stage F: Bottom-layer movement with blockers

Entry:

- Stage E complete

Exit:

- unit movement restricted to local floor subcells 0..3
- occupied machine slots block movement
- no vertical movement paths

## Test Matrix Draft (Per Stage)

Rust checks:

- cargo test after each Rust-touching stage (A, B, C, F)
- add targeted tests for reset behavior, stable ID retention, endpoint matching invariants

TypeScript checks:

- npm run build after TS-touching stages (C, D, E)
- manual interaction tests for ESC transitions, picker gating, and wheel behavior in each mode

Regression must-holds:

- existing interior focus mode works unchanged when focusCube is never entered
- existing demo loop still runs even before endpoint-routing migration completes

## Acceptance Criteria for Initial Delivery

Interaction:

- Clicking a cube in focusInterior enters focusCube
- ESC exits focusCube to focusInterior on first press
- ESC exits focusInterior to normal on second press
- ESC in normal does not prevent browser defaults

Gating:

- Floor picker does not run in focusCube
- Subcell picker does not run outside focusCube

Visual:

- Selected cube can be isolated visually in focusCube

Data:

- ApcInterior owns Subgrid and remains valid after hull reset/expand

Safety:

- No regressions to current interior focus behavior when focusCube is not entered

## Open Questions (For Next Draft)

- Should wheel floor-scroll be temporarily ignored or buffered while in focusCube?
- Should entering focusCube lock focusLevel until exit?
- Should subcell hover priority prefer visible face over nearest geometric candidate on grazing angles?
- Which endpoint config fields are required in v1 (direction, mode, filter, machine-local port)?

Default decisions for commencement:

- Wheel in focusCube: ignored (not buffered)
- focusLevel while in focusCube: locked
- hover priority: visible face first, then nearest fallback

## Non-Goals for This Initial Draft

- Final endpoint UI design
- Vertical unit movement
- Multi-cube machine footprints
- Network/path transport simulation beyond current deterministic per-step transfer semantics
