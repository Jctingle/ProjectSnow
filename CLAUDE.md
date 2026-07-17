# ProjectSnow — Claude Code Context

Browser-based tactical survival RTS. Rust/WASM simulation core, Three.js/WebGL
isometric frontend, TypeScript, Vite. Solo project (Jefferson). Design
inspirations: Lost Planet, XCOM, Unicorn Overlord.

See DESIGN.txt for full narrative/architecture context. This file covers
engineering invariants, locked decisions, correctness-critical constants,
current state, and working conventions.

## Locked architectural decisions — do not revisit without explicit request

- Terrain parameters (`CRAG_STRENGTH`, `CRAG_FREQ`, `SWEEP_SCALE`,
  `SWEEP_AMP`, `TIER_HEIGHT_SCALE`) are exposed through `config.ts` and
  passed through `Sim::new` → `Terrain::new`. Never hardcode these in Rust.
- Terrain default values are locked as ideal — do not "improve" them
  without being asked.
- **Hex grid adjacency: permanently cancelled.** Do not reintroduce or
  suggest it.

## Engineering tenets

- Compute-heavy work belongs in Rust/WASM, called as one batched tick per
  frame with a thin JS layer on top — not per-entity JS↔WASM calls.
- `GROUND_SIZE` is the single source of truth. All dependent constants are
  derived from it, never independently defined.
- Constants are never duplicated across the JS/WASM boundary — use getters
  exposed from WASM instead of mirroring values in TypeScript.
- Ground mesh and heightmap must share source and extent via `config.ts`.
- Movement execution is decoupled from behavioral intent (e.g. a unit's
  "go here" decision is separate from the code that actually steps it
  along a path).
- Destination validity is split into two concerns: `isStandable`
  (slope/cliff check — permanent, independent of pathfinding, currently
  the only check in place) and `isReachable` (path-existence check —
  deferred until real A* pathfinding lands). Both gate the same
  right-click destination-denial pathway; do not conflate them.
- For each new entity type, explicitly frame the choice as Pattern A
  (bespoke struct) vs Pattern B (SoA swarm) rather than defaulting to one.
- Prefer mathematical solutions over library workarounds when a library's
  behavior fights the use case (e.g. manual line/plane intersection +
  WASM heightmap sampler was chosen over Three.js mesh-intersection
  raycasting to avoid orthographic dead-zone `t≥0` rejection).
- Zero-copy WASM patterns: TypedArray views over WASM-owned memory, not
  per-frame buffer copying.

## Verification culture — important

- Run `cargo test` and write targeted probe tests to root-cause failures
  independently. A green test suite alone is not sufficient evidence of
  correctness — this project has been burned by false positives from
  clamping effects (e.g. SEA_LEVEL clamp masking a real continuity bug).
- When a spec turns out to be wrong or ambiguous, say so directly rather
  than silently reinterpreting it or deflecting.
- Don't work from memory of prior code — pull from GitHub and verify the
  actual committed state before proceeding, especially after a push.

## Current state (most recent milestone)

Terrain streaming / shard continuity system, multi-stage:

- **Slope detection**: `gradient_at` / `slope_degrees_at` in `terrain.rs`,
  slopemap grid, Gradient B red-green-blue debug overlay in TS.
- **Stage A**: deterministic `cell_seed` hash, neighbor-aware
  `assemble_seeds` with 8-cell ring, `canonical_x/z` fix for crag
  distortion frame-dependence, `MIN_CRAG_MULT` bound on influence radius.
- **Stage B**: per-shard `seed_x/seed_y` translation for continuous noise
  tiling.
- **Stage C**: two-shard `Sim` structure, edge trigger, crossing with
  coordinate rebase, dual mesh lifecycle.
- **Ring-1 (R1/R2)**: Rust neighbor slots with cardinals-first backfill
  and TS mesh map generalization — implemented and verified complete.

Known bugs already caught and resolved (don't reintroduce):
- False-positive continuity test masked by SEA_LEVEL clamp.
- `clone_params_for` heightmap-before-regenerate ordering bug.
- 60Hz crossing ping-pong from CROSS_BAND threshold symmetry.
- Single-frame flicker from teardown-instead-of-swap crossing logic.
- R2 re-key ordering bug causing orphaned mesh overlay.

## Next up (designed, not yet implemented)

- Destination-validity gate: `isValidDestination(point) -> { valid, reason? }`
  as single source of truth for move-target validity, called before any
  order is issued. Design: try mesh raycast first, classify as cliff if
  hit normal.y is below a threshold, fall back to the existing line/plane
  + heightmap sampler on raycast dead-zone. Written so more reasons
  (occupied, out of range, insufficient Heat) can be added later without
  changing call sites. No snap-to-nearest — invalid destinations are
  rejected outright, not redirected. **Nothing here is implemented yet —
  no `isValidDestination` function, no mesh-raycast path, no click-handler
  gating currently exist in the codebase.** Known existing bug this is
  meant to fix: right-clicking a cliff/shear wall doesn't resolve to the
  correct position because the heightmap sampler can't represent vertical
  geometry.
- After ring-1 completion: shard-obscuring treatment (backdrop plane,
  THREE.Fog, blizzard-reveal mechanic, pan clamp).

## Explicitly deferred (don't implement unless asked)

- Heat resource and slope-based movement cost (paired with pathfinding
  design, not yet started).
- Unit spawning re-enablement (recall/crewed scaffolding intact but idle).
- APC speed revert from current 3x testing value.
- SEA_LEVEL implicit-cliff interaction with future connectivity guarantees.
- Proper A* pathfinding with walkability grid.
- Deterministic building placement per shard.
- New entity types: enemies, vehicles (mech/jeep derivatives),
  bio-mutants, cybernetics.
- Two-QR login + save system (lightweight Node/Bun backend, flat binary
  blobs).
- Encounter-based multiplayer via deterministic shard coordinates.
- Tilt-shift / rim-lighting / pixelation visual stylization (see
  DESIGN.txt) — deferred until core loop is structurally sound.
- Snap-to-nearest-valid-destination (explicitly rejected as unneeded;
  cliff-face rejection covers the actual problem).

## Working conventions

- Checkpoint-driven: code is pushed after each task; verify the actual
  committed state on GitHub rather than assuming continuity from a prior
  session.
- Prefer concrete, direct recommendations over open-ended questions.
- Explain architectural rationale ("why"), not just implementation steps.
- Push back firmly and directly on over-engineering or wrong assumptions
  rather than quietly complying.
- Keep explanations scannable — structured, concise, not dense prose.
