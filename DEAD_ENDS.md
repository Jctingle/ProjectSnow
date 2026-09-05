# ProjectSnow Dead Ends And Open Foundations

Purpose: this file tracks systems that are partially scaffolded, intentionally deferred, or currently inactive.

Update rule: if a system changes status (revived, replaced, removed, or newly deferred), update this file in the same task.

## Active Foundations Without Full Gameplay

- Interior unit profile data model is in place (ids, stats, specialization, equipment slots, inventory fields), but full gameplay loops for upgrades, inventory use, and equipment effects are not built.
- Interior unit lifecycle states are in place (boarded, deployed, returning, boarding), but world mission behavior is still represented by a timed sortie flow rather than full authoritative per-unit world simulation.
- Interior unit machine-assignment state exists, but assignment-driven behavior and machine-operation gameplay are not fully implemented.
- APC interior rendering/input internals are now split across focused helper modules, but the remaining facade still reflects a rendering-first debug surface rather than a finalized gameplay-authoritative interior system.

## Save And Persistence Gaps

- Save transport and account flow (server sync, two-QR login, save blob exchange) are designed but not implemented.
- Most save payload fields are available through interior/machine array views, but explicit snapshot import/export APIs are not finalized.
- Deterministic resume-critical internals (id counters, rng progress, transfer counters) are not yet exposed as a formal save contract.

## Navigation And Validation Gaps

- Destination validation still lacks the planned unified gate function with reason codes as a single source of truth.
- Current destination checks handle standability (slope/cliff), but reachability/path-existence checks are still deferred with A* work.
- Cliff-face precision handling still needs the planned mesh-raycast-first validation path.

## World And Encounter Systems Not Built

- Deterministic building placement per shard is deferred.
- Building exploration loop (focus transitions, explored-floor progression rules, structure risk loops) is not complete.
- Encounter-based multiplayer is deferred.

## Visual And UX Items Deferred

- Final stylization stack (rim-lighting tuning, pixelation policy, tilt-shift policy) is deferred behind core-loop stability.
- Blizzard reveal/obscuring progression around shard boundaries is only partially realized.

## Explicitly Retired Or Inactive Paths

- Legacy world-unit swarm/recall runtime path has been removed from active architecture.
- APC cell tracer demo scaffolding has been removed; there is no longer a default fake machine/product loop seeded into the APC interior.
- Terrain helper `height_at_clamped` is currently retained but intentionally unused.
