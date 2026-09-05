# World Generation Plan

Purpose: capture the current plan for deterministic exterior world content, its relationship to structures and machines, and the decisions that should be locked before implementation starts.

This document is not a final design spec. It is the working architecture and rollout guide for the next major simulation layer.

## Goal

The next major component after the APC interior cleanup is a deterministic world-content layer that sits between terrain generation and later machine gameplay.

The recommended construction order is:

1. Exterior resource and structure generation.
2. Exterior rendering and interaction.
3. Structure entry and interior access.
4. Machine integration and resource processing.

The important sequencing rule is that machines should not be expanded first. They need typed inputs, and typed inputs need a world resource system first.

## Current State

What already exists:

- Deterministic terrain generation per shard in Rust/WASM.
- Stable shard streaming and neighbor rekeying.
- APC interior lattice, machine grid, and unit lifecycle systems.
- Zero-copy TypedArray patterns between WASM and TypeScript.
- Dormant building-selection state in the frontend.

What does not exist yet:

- No exterior structure registry.
- No exterior resource-node registry.
- No world-object zero-copy views.
- No building hit detection.
- No structure rendering layer.
- No structure-interior bridge.

## Existing Anchors In Code

These are the main code seams the future system should build on.

### Terrain and shard determinism

- [wasm-sim/src/terrain/mod.rs](/workspaces/ProjectSnow/wasm-sim/src/terrain/mod.rs) already owns deterministic terrain seeds and terrain classification.
- [wasm-sim/src/lib.rs](/workspaces/ProjectSnow/wasm-sim/src/lib.rs) already owns shard-local simulation state and shard crossing.
- [wasm-sim/src/shard_ring.rs](/workspaces/ProjectSnow/wasm-sim/src/shard_ring.rs) already owns neighbor generation, promotion, and rekeying.

Two existing terrain hooks matter immediately:

- `zone_at(x, z)`: current coarse terrain zone split.
- `is_structure_viable(x, z)`: current viability probe for structures.

These should become input signals for world generation, not the whole generation system.

### APC interior and machine model

- [wasm-sim/src/apc_interior.rs](/workspaces/ProjectSnow/wasm-sim/src/apc_interior.rs) already proves a deterministic lattice-backed interior simulation model.
- [wasm-sim/src/machines/mod.rs](/workspaces/ProjectSnow/wasm-sim/src/machines/mod.rs) already provides a deterministic machine-transfer substrate.
- [src/world/apcInterior.ts](/workspaces/ProjectSnow/src/world/apcInterior.ts) and the extracted helpers already provide a reusable frontend interior-view pattern.

This means building interiors should reuse the APC interior architecture where possible, rather than inventing a separate building simulation model.

### Frontend interaction stubs

- [src/input/selection.ts](/workspaces/ProjectSnow/src/input/selection.ts) already has `selectedBuildingId` and `selectBuilding()`.
- [src/input/clickSelect.ts](/workspaces/ProjectSnow/src/input/clickSelect.ts) still has building hit detection as a TODO.
- [src/features/terrain/terrainRingController.ts](/workspaces/ProjectSnow/src/features/terrain/terrainRingController.ts) already manages per-shard world visuals and is the most natural near-term home for structure-mesh lifecycle work.
- [src/entityStore.ts](/workspaces/ProjectSnow/src/entityStore.ts) already provides the zero-copy bridge patterns that the new world layer should copy.

## Core Architectural Recommendation

Add a deterministic world-content layer to the Rust `Sim` that owns per-shard exterior objects.

That layer should generate and expose a registry of world nodes for the current shard and its neighbors. TypeScript should render those nodes and allow selection, but the authoritative data should stay in WASM.

The world-content layer should be distinct from:

- terrain generation,
- APC interior simulation,
- machine processing,
- frontend-only debug meshes.

## The Five External Generation Families

The current recommendation is to reserve five top-level exterior content families.

### 1. Structures, workshops, and NPC camps

Purpose:

- meaningful world destinations,
- future structure entry,
- machine and crafting adjacency,
- social or encounter anchors.

Likely properties:

- deterministic structure id,
- structure subtype,
- position,
- footprint,
- approach point,
- interior seed,
- danger or loot tier.

This family should eventually support entering a structure and opening a lattice-based interior view.

### 2. Metal scrap fields

Purpose:

- early salvage gameplay,
- low-complexity harvesting,
- first test case for depleted runtime state.

Likely properties:

- cluster center,
- density,
- total salvage amount,
- subtype or quality tier.

This is a strong first implementation target because it does not require building interiors.

### 3. Buildings and dungeons

Purpose:

- high-value exploration targets,
- multi-floor or deeper tactical interiors,
- eventual APC crew deployment loop.

Likely properties:

- structure id,
- size tier,
- entrance point,
- interior seed,
- floor count,
- reward and risk profile.

This category overlaps visually with structures/workshops, but it deserves separate design treatment because the interior loop is heavier.

### 4. Raw resources and natural spawns

Purpose:

- non-manmade gatherables,
- machine feedstock,
- biome/zone expression.

Examples:

- ore-like deposits,
- chemical vents,
- fuel-bearing crystals,
- biomass or frozen organics.

Likely properties:

- resource type,
- richness,
- harvest difficulty,
- depletion state,
- hazard tag.

### 5. Reserved fifth category

Purpose:

- keep the schema flexible now instead of forcing a breaking enum extension later.

Possible future uses:

- anomalies,
- distress beacons,
- crash sites,
- dynamic events,
- faction markers.

This slot should exist now in the high-level plan even if it does nothing initially.

## Deterministic Placement Versus Runtime State

This is the most important preparation step.

The system should explicitly separate:

### Deterministic placement data

Generated from world seed plus shard coordinates and category-specific generation rules.

Examples:

- id,
- category,
- subtype,
- local shard position,
- footprint,
- visual seed,
- interior seed,
- base resource richness,
- base threat tier.

This data should be reproducible whenever the same shard is generated from the same world state.

### Runtime mutable state

Changes through player interaction and later persistence.

Examples:

- discovered or undiscovered,
- depleted amount,
- destroyed or damaged,
- looted flags,
- cleared state,
- explored floors,
- unlocked doors,
- spawned NPC state.

This data should be the part that is saved.

## Recommended Data Model Direction

Do not start with ad hoc structure objects on the TypeScript side.

Instead, add a shard-local SoA registry in Rust/WASM, parallel to the current heightmap and APC interior arrays.

Recommended conceptual shape:

- `world_node_ids`
- `world_node_categories`
- `world_node_subtypes`
- `world_node_x`
- `world_node_z`
- `world_node_radius_or_w`
- `world_node_depth_or_h`
- `world_node_seed`
- `world_node_flags`

This does not mean the exact final fields are fixed now. The important preparation point is to use a stable SoA bridge shape from day one.

## What Needs To Exist Before This Is Comfortable To Build

### In WASM

1. A world-node registry owned by `Sim`.
2. Deterministic per-shard generation for world nodes.
3. Category-layer seeds separate from terrain seeds.
4. Structure placement rules that honor terrain viability.
5. Zero-copy getters for world-node arrays.

### In TypeScript

1. A world-node bridge in [src/entityStore.ts](/workspaces/ProjectSnow/src/entityStore.ts).
2. A render/controller layer for shard world objects.
3. Selection and hit detection for exterior structures and resource nodes.
4. A clear sync story when the active shard changes.

## Recommended Phased Rollout

### Phase A: deterministic world-node foundation

Goal:

Create the authoritative shard content layer without yet caring about polished visuals or full interaction.

Work:

- add a world-node registry to `Sim`,
- generate nodes deterministically per shard,
- expose zero-copy views to TypeScript,
- verify nodes survive shard promotion and regeneration predictably.

This is the actual next core component.

### Phase B: exterior rendering and selection

Goal:

Make the generated content visible and selectable in the current world view.

Work:

- render proxy meshes per world-node category,
- lifecycle-manage them with shard streaming,
- add click selection,
- show selection feedback and debug labeling.

This proves the registry is usable before deeper gameplay exists.

### Phase C: first simple harvestable family

Goal:

Pick one shallow category and make it function end-to-end.

Strong candidates:

- metal scrap fields,
- raw resource nodes.

Why:

- they validate placement,
- they validate depletion state,
- they do not require building entry,
- they can feed future machine inputs.

### Phase D: structure entry and reusable interiors

Goal:

Bridge exterior buildings to interior access using the existing APC interior model as the starting point.

Work:

- generalize the interior model for non-APC structures,
- generate deterministic structure interiors from an interior seed,
- hook building selection into focus-mode entry.

### Phase E: machine integration

Goal:

Only after typed exterior resources exist, expand machine logic to process them.

Work:

- typed inputs and outputs,
- machine specializations,
- workshop and camp behavior,
- interior production loops.

## Recommended First Real Category

Metal scrap fields or raw natural nodes should go first.

Reasons:

- lower surface area than enterable structures,
- easier to visualize with simple meshes,
- easier to persist with one depletion field,
- still useful later as machine feedstock.

Do not start with buildings or dungeons unless the goal is explicitly to prototype interior entry first.

## The Main Technical Decisions To Lock Early

### 1. Maximum objects per shard

Choose a cap early.

Reason:

- it stabilizes memory layout,
- it prevents accidental unbounded reallocation,
- it helps define rendering expectations.

### 2. Edge policy for placement

Decide now whether world structures are allowed near shard borders.

Recommended short-term answer:

- forbid structure footprints near shard edges.

Reason:

- avoids cross-shard structure ownership,
- avoids seam ambiguity,
- keeps ids and interiors easier to reason about.

### 3. Resource taxonomy

Decide whether category and resource type are separate.

Recommended answer:

- yes, keep them separate.

Example:

- category: `raw_resource`
- resource type: `metal_ore`, `volatile_fuel`, `organic_mass`

That separation will keep the machine system cleaner later.

### 4. Depletion model

Decide whether external resources:

- deplete permanently,
- partially replenish,
- or regenerate on a long timer.

This affects both save shape and multiplayer assumptions later.

### 5. Interior persistence policy

For building interiors, decide whether they:

- regenerate every entry,
- or freeze once first discovered.

Recommended answer:

- freeze once interacted with, store runtime state against deterministic structure id.

### 6. Machine product typing

The current machine model effectively assumes a very small product model.

Before machine expansion begins, decide how future resource and product typing should work so the system does not need a disruptive redesign.

## Main Risks And How To Prepare For Them

### Risk: terrain tuning moves structure placement later

If placement logic depends too directly on terrain details that keep changing, structures can silently move between versions.

Preparation:

- isolate content placement rules,
- keep category-layer seed logic separate,
- store enough save metadata to replay the old world deterministically.

### Risk: TypeScript owns too much world state

If the frontend starts inventing ids or placement data, it will diverge from persistence and shard streaming.

Preparation:

- WASM owns authoritative placement,
- TypeScript only mirrors and renders it.

### Risk: building interactions start before structure selection is solid

If the team jumps directly to building entry, the app can accumulate one-off focus transitions and selection paths.

Preparation:

- make exterior selection real first,
- keep building ids stable,
- then connect them into focus mode.

### Risk: machine expansion starts before resource typing is real

If machine inputs are added before external resource categories exist, the machine API will likely need to be broken later.

Preparation:

- define resource/product taxonomy first,
- then expand machine kinds and machine behavior.

### Risk: shard streaming and world content drift apart

If terrain streams by shard but world objects do not follow the same lifecycle, you get ghost content or stale meshes.

Preparation:

- tie world-node loading to shard lifecycle,
- mirror the terrain-ring lifecycle patterns.

## Best Insertion Points

### Rust and WASM

- [wasm-sim/src/lib.rs](/workspaces/ProjectSnow/wasm-sim/src/lib.rs): add the world-node registry and exported getters.
- [wasm-sim/src/terrain/mod.rs](/workspaces/ProjectSnow/wasm-sim/src/terrain/mod.rs): add category-layer placement helpers and richer viability checks.
- [wasm-sim/src/shard_ring.rs](/workspaces/ProjectSnow/wasm-sim/src/shard_ring.rs): keep shard lifecycle authoritative for world-node loading and promotion.
- [wasm-sim/src/apc_interior.rs](/workspaces/ProjectSnow/wasm-sim/src/apc_interior.rs): later generalize for structure interiors.
- [wasm-sim/src/machines/mod.rs](/workspaces/ProjectSnow/wasm-sim/src/machines/mod.rs): later expand after resource typing decisions are locked.

### TypeScript

- [src/entityStore.ts](/workspaces/ProjectSnow/src/entityStore.ts): add zero-copy world-node accessors.
- [src/features/terrain/terrainRingController.ts](/workspaces/ProjectSnow/src/features/terrain/terrainRingController.ts): host the first exterior world-object lifecycle controller or neighbor-aware wiring for it.
- [src/input/clickSelect.ts](/workspaces/ProjectSnow/src/input/clickSelect.ts): add structure and resource-node hit detection.
- [src/input/selection.ts](/workspaces/ProjectSnow/src/input/selection.ts): reuse existing building selection state.
- [src/focusMode.ts](/workspaces/ProjectSnow/src/focusMode.ts): later bridge building selection to interior access.

## Practical Recommended Order

If the goal is to make this go as smoothly as possible, the best practical order is:

1. Define the world-node schema and object cap.
2. Define the five category families and reserve subtype space.
3. Implement deterministic Rust-side generation for one shard.
4. Expose zero-copy views to TypeScript.
5. Render simple debug proxies in the world.
6. Implement click selection.
7. Make one shallow category actually harvestable.
8. Only then begin structure-entry and machine-expansion work.

## Recommended Near-Term Deliverable

The next concrete milestone should be:

"Deterministic exterior world-node registry rendered as debug proxies and selectable in the current shard view."

That milestone is small enough to validate architecture, but big enough to unblock every later system in the chain.

## Open Questions To Resolve Before Coding Begins

1. What is the maximum desired object count per shard?
2. Are structures forbidden near shard edges for now?
3. Which external category is the first playable one: scrap or raw resources?
4. Do depleted external nodes stay empty forever?
5. Do structure interiors freeze after first contact?
6. How many machine/resource product types should be reserved now, even if only one is initially used?

## Summary

The next stable step is not "machines," but "deterministic shard world content."

Build the world-object registry first, render and select it second, make one shallow resource family real third, and only then let that work flow into building interiors and machine processing.