# Stage F Handoff Draft (For New Development Machine)

Date: 2026-08-28
Branch baseline: `main`
Baseline commit: `4e972a3` (`origin/main`)
Purpose: Resume Stage F implementation on another machine without re-discovery.

## 1) Current Progress Snapshot

Completed:
- Stage A: `ApcInterior` owns `Subgrid` and stays coherent on hull reset.
- Stage B: machine model refactored for stable IDs, parent cells, footprints.
- Stage C: zero-copy views exposed for subgrid occupancy + machine metadata.
- Stage D: focus mode ladder (`normal` -> `focusInterior` -> `focusCube`) and ESC/Space pop behavior.
- Stage E: selected-cube isolation + 8-subcell rendering/picking in cube focus.

Pending:
- Stage F: bottom-layer subcell movement with occupancy blockers and no vertical movement.

## 2) Stage F Objective

Implement interior movement logic where units move only across local floor subcells `0..3` inside cube subgrids.

Rules:
- No vertical movement (`4..7` disallowed).
- Movement blocked by occupied machine subcells.
- Movement blocked by occupied unit subcells.
- Deterministic step behavior.

## 3) What Stage F Is and Is Not

In scope (Stage F0 logic-first):
- Rust movement/query APIs and tests.
- Occupancy-aware move-attempt results.
- Zero-copy data remains unchanged or minimally extended.

Out of scope (later):
- Full interior gameplay UX polish.
- Fancy movement animation.
- Vertical traversal mechanics.
- Endpoint routing migration (separate track).

## 4) Critical Files

Rust core:
- `wasm-sim/src/subgrid.rs`
- `wasm-sim/src/apc_interior.rs`
- `wasm-sim/src/machines/mod.rs`
- `wasm-sim/src/apc_interior/tests.rs`

TS integration:
- `src/entityStore.ts`
- `src/world/apcInterior.ts`
- `src/input/interiorPick.ts`
- `src/focusMode.ts`

Planning reference:
- `SUBGRID_FOCUS_DRAFT.md`

## 5) New Machine Bootstrap

From repository root:

```bash
git fetch --all --prune
git checkout main
git pull --ff-only
npm install
```

Verify toolchain and baseline:

```bash
cd wasm-sim && cargo test -q && cargo check
cd .. && npm run build
```

Expected baseline:
- Rust tests pass.
- TypeScript build passes.

## 6) Stage F Execution Plan

### F1. Define movement result model (Rust)

Add explicit result enum (WASM-safe as integer or enum mapping), for example:
- `Ok`
- `BlockedByMachine`
- `BlockedByUnit`
- `BlockedOutOfBounds`
- `BlockedVertical`
- `BlockedNoUnitAtSource`

Keep this deterministic and side-effect-free on failed moves.

### F2. Add floor-neighbor mapping for local subcells

Inside 2x2 floor layer (`0..3`) support cardinal moves:
- left/right/front/back only
- no diagonal

The mapping must never produce `4..7`.

### F3. Implement unit move-attempt API in `ApcInterior`

Add methods similar to:
- place unit at `(cell, localFloorSubcell)`
- attempt move from source to target (possibly same cell or adjacent cell)
- read current unit occupancy

Movement checks order:
1. source has unit
2. target is floor subcell
3. topological validity (same or adjacent cube according to move rule)
4. target unoccupied by unit/machine
5. commit occupancy swap

### F4. Preserve machine transfer behavior

Do not alter machine transfer pipeline in this stage.

Movement logic should only touch subgrid unit occupancy.

### F5. Add/extend Rust tests

Minimum tests:
- unit can move floor-to-floor within a cube
- unit can move across adjacent cubes on floor layer
- move into machine-occupied slot is blocked
- move into unit-occupied slot is blocked
- move to top-layer slot is blocked
- out-of-bounds is blocked
- failed move does not mutate occupancy
- deterministic repeated run invariant

### F6. TS hook (minimal)

If needed, add thin call paths only:
- keep UI simple
- no redesign required
- optional debug-only command invocation is acceptable in Stage F0

## 7) Acceptance Criteria

Stage F is complete when:
- all movement constraints above are enforced in Rust.
- no vertical movement is possible.
- blocker logic uses subgrid occupancy correctly.
- machine transfer behavior remains unchanged.
- `cargo test` and `npm run build` pass.

## 8) Validation Checklist

Run in this order:

```bash
cd wasm-sim
cargo test -q
cargo check
cd ..
npm run build
```

Optional quick smoke:
- enter focus mode
- select cube
- confirm subcell hover/select still functions
- ensure no regressions in existing APC move input path

## 9) Known Architectural Notes

- The terrain/path destination validator currently lives in TS intentionally because it is input-layer policy and diagnostics-first at this stage, not yet authoritative sim pathfinding.
- Compute-heavy, authoritative simulation logic should still converge toward Rust over time.
- For Stage F, unit subcell movement belongs in Rust.

## 10) Suggested First Commit on New Machine

Commit 1:
- Result enum + floor-neighbor mapping + unit move-attempt skeleton
- tests for bounds/vertical checks

Commit 2:
- blocker handling + occupancy mutation + determinism tests

Commit 3:
- minimal TS wiring (if needed) + final validation pass

This keeps rollback clean and reviewable.
