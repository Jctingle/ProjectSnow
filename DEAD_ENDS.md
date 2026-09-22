# ProjectSnow Dead Ends And Open Foundations

Purpose: this file tracks systems that are partially scaffolded, intentionally deferred, or currently inactive.

Update rule: if a system changes status (revived, replaced, removed, or newly deferred), update this file in the same task.

## Active Foundations Without Full Gameplay

- Interior unit profile data model is in place (ids, stats, specialization, equipment slots, inventory fields), but full gameplay loops for upgrades, inventory use, and equipment effects are not built.
- Interior unit lifecycle states are in place (boarded, deployed, returning, boarding), but world mission behavior is still represented by a timed sortie flow rather than full authoritative per-unit world simulation.
- Interior unit machine-assignment state exists, but assignment-driven behavior and machine-operation gameplay are not fully implemented.
- Machine placement and same-kind joining are playable inside sub-focus (catalogue kinds A and B, 1/2/4/8 subcell footprints), but machines still have no behavior beyond adjacency product transfer: placed machines get no output face, cannot be removed or split, and no kind carries distinct rules.
- APC interior rendering/input internals are now split across focused helper modules, but the remaining facade still reflects a rendering-first debug surface rather than a finalized gameplay-authoritative interior system.

## Save And Persistence Gaps

- Save transport and account flow (server sync, two-QR login, save blob exchange) are designed but not implemented.
- Most save payload fields are available through interior/machine array views, but explicit snapshot import/export APIs are not finalized.
- Deterministic resume-critical internals (id counters, rng progress, transfer counters) are not yet exposed as a formal save contract.

## Navigation And Validation Gaps

- Destination validation still lacks the planned unified gate function with reason codes as a single source of truth.
- Current destination checks handle standability (slope/cliff), but reachability/path-existence checks are still deferred with A* work.
- Cliff-face validation is now shard-aware across the current and loaded neighbor shards, with continuous segment sampling plus downhill travel-grade checks in click validation and APC movement, but the planned mesh-raycast-first validation path is still needed for full click-precision correctness.

## World And Encounter Systems Not Built

- Deterministic shard-owned world-node generation foundation now exists in Rust/WASM with fixed-cap SoA arrays, settlement placeholders that now carry terrain-attachment and float-well profiling, reduced scrap generation, and nickel ice-sheet raw resources, but selection, mutable runtime state, and full building/resource gameplay are still not built.
- Large and small structure nodes now hide the terrain surface inside their footprint via a shard-local fragment cutout field (capped at 8 fields per shard mesh), with roofs anchored to the footprint rim height and a back-face interior shell sealing the opening, but the cavity is still debug geometry rather than real interior content.
- Building exploration loop (focus transitions, explored-floor progression rules, structure risk loops) is not complete.
- Encounter-based multiplayer is deferred.

## Visual And UX Items Deferred

- Final stylization stack (rim-lighting tuning, pixelation policy, tilt-shift policy) is deferred behind core-loop stability.
- Blizzard reveal/obscuring progression around shard boundaries is only partially realized.

## Proposed Production And Harvesting Foundations (2026-09-22 Investigation)

Status: investigation notes only; none of the mechanics below were implemented in this task. Identifiers are tracking labels, not existing APIs. Preserve the existing structure and extend its domains incrementally.

### Intended Gameplay Endpoints

- **RESOURCE-SULFIDES:** Keep the existing raw-resource spawn count, candidate selection, terrain restrictions, spacing, dimensions, and placement method. Split those deposits into polymetallic sulfide and bismuthinite. Working assumption: polymetallic sulfide has probability 2/3 and bismuthinite 1/3; which receives the larger share was not explicitly specified. This is a distribution across deposits, not a guaranteed ratio per shard.
- **MACHINE-PROCESSOR:** Processor/scraper passively produces H2O, H4, or both in balanced mode, with oxygen discarded in the hydrogen-producing mode. Preserve these requested game-resource names pending clarification of H4 versus the forge's H input. Define balanced-mode allocation, output quantities, and whether passive production has an energy cost before implementation.
- **MACHINE-REFINERY:** Polymetallic sulfide produces copper, nickel, cobalt, iron, and sulfur; bismuthinite produces bismuth and sulfur. Exact batch quantities, durations, and operating costs remain open.
- **MACHINE-FORGE:** Bismuth plus hydrogen feeds the fictional HeAt production chain. Track three stages/progress displays: making HE, making At, and combining them. The proposed internal visual partition is 1/4, 1/4, 2/4; it does not yet specify stage duration ratios. Intermediate quantities, input allocation, and sequential versus overlapping stages remain open. Internal stage state can precede introducing intermediate items into general logistics.
- **MACHINE-MANIFOLD:** Accept HeAt into a small local buffer and supply passive energy to the APC frame. Input is rate-limited and becomes faster with machine size. Dedicated reservoir/storage-lattice mechanics are deferred. Define HeAt-to-energy conversion, frame demand, output limits, and shortage behaviour; receiving fuel and consuming it are separate operations.
- **LOGISTICS-CONDUIT:** Reserve a future material-transport conduit type. Initial logistics should support unit carrying and adjacent machine transfer. Earlier heat-only, unlimited-throughput conduit ideas are separate from this new material-conduit proposal; their relationship and material throughput rules remain undecided. The manifold's input limit can apply independently of pipe throughput.
- **MACHINE-SCALING:** Use occupied subcell count n = 1, 2, 4, 8 and the agreed production/operating-cost multiplier n^2 = 1, 4, 16, 64. Keep recipe conversion ratios stable when both input consumption and output scale. Storage-capacity scaling and the manifold's exact intake curve still need explicit decisions; only increasing intake with size is specified for the manifold. Use sufficiently wide quantity/rate arithmetic and fractional tick accounting.

### Verified Existing Foundations And Missing Connections

- **SPAWN-SUBTYPE** (source: `wasm-sim/src/world_nodes.rs`, `src/features/terrain/worldNodeKinds.ts`): current raw deposits are `NICKEL_BAND`, with a target of 1–2 per shard and candidate failures potentially reducing the actual count. Nodes already expose IDs, categories, subtypes, seeds, and geometry. Assign the new subtype from a separately salted deterministic node seed after placement, without consuming the placement RNG stream, to preserve existing locations and dimensions. Update subtype consumers/debug presentation together; do not renumber unrelated subtype IDs. No subtype split exists yet.
- **ITEM-INVENTORY** (source: `wasm-sim/src/apc_interior.rs`, `wasm-sim/src/machines/mod.rs`): unit inventory capacity/load fields exist, but item stacks and quantity transactions do not. Machine `holding: u8` is one product identifier, not a counted inventory; only the default product is defined. Introduce stable item IDs, quantities, capacity rules, machine input/output buffers, and validated transfers. Cargo must stay on the unit until a successful deposit. Derive inventory load from contents under the chosen capacity model.
- **RESOURCE-DEPLETION** (source: `wasm-sim/src/world_nodes.rs`): generation contains no remaining-resource quantity or harvest mutation API. Add mutable amount/depletion state keyed by shard identity and node ID, distinct from deterministic placement. Define behaviour when shards unload/regenerate and when an order's target disappears; rebuilding geometry must not accidentally refill an active depleted deposit.
- **ORDER-HARVEST** (source: `src/input/unitSortieCommand.ts`, `src/input/index.ts`): existing sorties use `performance.now()` and interpolated world positions, then immediately transition from outbound to returning. They provide lifecycle/rendering hooks, not authoritative harvesting, world navigation, or resource targeting. Desired order: select resource -> dispatch unit -> reach a valid work position -> extract over simulation ticks into cargo -> return when full/depleted/cancelled -> board -> deposit at a valid receiver. Need node picking, explicit order/target state, authoritative position/proximity, reachability, progress, cancellation, full-receiver handling, and concurrent-harvester accounting. Preserve current presentation where useful; do not award materials based solely on visual arrival or wall-clock deadlines.
- **MACHINE-RECIPES** (source: `wasm-sim/src/machines/mod.rs`, `src/features/apc/machines/machineCatalog.ts`): kinds are Plain/Alpha/Beta, with A/B in the placement catalogue; no kind-specific processing exists. Extend the registry without renumbering existing discriminants. Add per-machine mode, recipe/stage, progress, buffers, and observable blocked reasons. Reserve inputs and output capacity deterministically so a full byproduct buffer cannot lose items or duplicate a completed batch. The refinery requires multiple output kinds, beyond the current single-product slot.
- **LOGISTICS-PORTS** (source: `wasm-sim/src/machines/mod.rs`, `wasm-sim/src/apc_interior.rs`): transfer already uses pre-step state and backpressure, but resolves a receiver by neighbouring cell rather than explicit compatible subcell ports. Player-placed machines start with `NO_OUTPUT`. Define usable output configuration, touching ports, item acceptance and deterministic contention, including multiple machines within one cell. A conduit graph is additional work, not current behaviour.
- **MACHINE-LIFECYCLE** (source: `wasm-sim/src/apc_interior.rs`): joining removes both machine records and creates a new ID. Before machines contain resources, define how joining preserves inventories, fuel, modes, progress, and unit references, or disallow incompatible/busy joins. Assignment currently stores a machine ID without checking existence/proximity; assigned units cannot use the idle-only movement path. Delivery/refuelling needs reachable service positions and travel/interaction states.
- **FRAME-ENERGY** (source: `src/entityStore.ts`, `src/sim/tick.ts`, `wasm-sim/src/apc.rs`): `Sim` owns APC movement while the separately constructed `ApcInterior` owns units/machines. There is no fuel/energy coupling. Add an explicit authoritative request/transfer interface and deterministic tick ordering so manifold output is accounted once across this boundary. Define what happens when energy is insufficient and whether production itself needs frame energy; avoid an unrecoverable empty-system startup dependency.
- **PRODUCTION-UI-SAVE:** Expose quantities, mode, progress/stages, rates, and blocked reasons through the existing WASM view/command pattern. Forge micro-bars are presentation of simulation progress, not their clock. Manifold display should distinguish production, requested demand, actual supply, and stored fuel. Formal save support remains deferred, but new inventories, orders, depletion, recipe reservations/progress, and fractional counters must be included in the eventual resume contract.

### Suggested First Playable Slice And Validation Targets

1. Add item/quantity transactions and the deterministic deposit subtype split, preserving original spawn geometry.
2. Add one complete harvest/carry/return/deposit order with authoritative depletion and cargo accounting.
3. Add processor modes and refinery recipes with bounded buffers and working adjacent delivery; give all refinery byproducts storage space even before they have downstream uses.
4. Add forge stages and manifold intake/buffer/frame delivery, retaining the existing machine-size ladder and agreed production/cost formula.
5. Add material conduits and larger storage networks later, once direct transfers and demand accounting work.

Acceptance targets: the same seed retains deposit count/positions/dimensions; subtype distribution approaches 2:1 over many deposits; extraction equals cargo gained and node amount lost; transfer never duplicates or destroys cargo; recipes conserve their configured inputs/outputs under blocked buffers; merges preserve state or refuse safely; all sizes obey the declared formula; manifold intake respects rate and capacity; simulation results do not depend on render frame rate. Open balance decisions must remain labelled as such rather than becoming accidental constants.

## Explicitly Retired Or Inactive Paths

- Legacy world-unit swarm/recall runtime path has been removed from active architecture.
- APC cell tracer demo scaffolding has been removed; there is no longer a default fake machine/product loop seeded into the APC interior.
- Terrain helper `height_at_clamped` is currently retained but intentionally unused.
