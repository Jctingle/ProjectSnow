# ProjectSnow Engineering Process

## Rule 1

- Update and reference [DEAD_ENDS.md](DEAD_ENDS.md) whenever scope changes, systems are deferred, or dormant foundations are touched.

## Core Standards

- Build modularly: isolate rendering, input, simulation, and persistence boundaries so systems can evolve independently.
- Design for future-proofing: avoid one-off shortcuts that block save compatibility, deterministic replay, or scale.
- Prefer deterministic structures: stable ids, explicit state transitions, repeatable seeds, and predictable update order.
- Keep performance intentional: compute-heavy logic belongs in Rust/WASM; JavaScript should orchestrate, not micro-simulate.
- Preserve single sources of truth: avoid duplicated constants and duplicated state across JS and WASM.
- Keep architecture organized: clear ownership per module, explicit interfaces, and minimal cross-layer leakage.
- Follow programming standards: readable naming, small focused functions, explicit invariants, and test-backed behavior changes.
- Retire dead scaffolding when it stops earning its keep: remove inactive toggles, dormant demo paths, and fake fixtures once they no longer provide real verification value.

## Working Workflow

1. Clarify intent and constraints before changing code.
2. Identify touched boundaries (simulation, bridge, renderer, input, save impact).
3. Implement smallest coherent vertical slice.
4. Validate determinism and correctness first, then tune visuals/perf.
5. Document resulting status in [DEAD_ENDS.md](DEAD_ENDS.md) when scope or readiness changed.

## Refactor Workflow

- Prefer extraction in narrow slices that preserve the existing public facade while moving one internal responsibility at a time.
- After each substantive extraction, run the narrowest available executable validation immediately; for this repo that is usually `npm run build`.
- Treat patch corruption, stale imports, and duplicated glue code as first-order refactor risks; fix the owning slice before expanding scope.
- If a debug/demo surface no longer exercises real behavior, remove it instead of carrying it through the next architectural phase.

## Determinism And Scale Checklist

- No hidden randomness without explicit seed control.
- No order-dependent behavior from unordered containers.
- No per-entity JS to WASM chat loops when batched stepping is possible.
- No implicit schema drift: state changes should preserve save migration paths.

## Documentation Discipline

- Keep this file high-level and durable.
- Keep [DEAD_ENDS.md](DEAD_ENDS.md) operational and current.
- Remove stale notes instead of accumulating conflicting guidance.
