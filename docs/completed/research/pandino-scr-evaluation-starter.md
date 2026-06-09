# Pandino-SCR Adoption — Evaluation Starter

> **Status:** Starting point only. This document is intentionally neutral. It is meant to give an AI agent (or human reader) a fair entry point before they read the actual codebase and form their own opinion.
>
> **Origin:** Proposed in [GitHub Issue #133](https://github.com/Sportinger/MasterSelects/issues/133). The proposer suggests adopting Pandino (an OSGi-style Service Component Registry for JavaScript) as the foundational architecture for MasterSelects.
>
> **What this document is NOT:** A decision, a recommendation, a plan, or a final analysis. It does not advocate for or against adoption.
>
> **How to use this document:** Read it, then read the actual code paths referenced below, then form an independent judgment. The arguments listed are deliberately balanced (equal count) so that no side is favored by the framing.

---

## 1. Core ideas behind Pandino-SCR

Pandino is a JavaScript/TypeScript port of the OSGi Service Component Runtime model. The key concepts:

- **Bundles** — units of code with a lifecycle (install, start, stop, uninstall).
- **Services** — interface-typed objects published into a central registry by bundles.
- **Component decorators** — `@Component`, `@Reference`, `@Activate`, `@Deactivate` declare what a class provides and what it consumes.
- **Service Component Registry (SCR)** — scans decorated classes, resolves dependencies topologically, instantiates and wires them.
- **Dynamic binding** — services can appear and disappear at runtime; dependent components re-bind or deactivate.
- **Fragments** — non-standalone bundles that extend a host bundle's content (resources, types, configuration).

The mental model is **inversion of control via discoverable, lifecycle-managed services**, instead of explicit imports and manual wiring.

Reference: https://github.com/BlackBeltTechnology/pandino

---

## 2. Current state of the MasterSelects codebase

### 2.1 Existing registry patterns

The codebase already uses typed registry patterns in six locations:

| Registry | File | Pattern |
|----------|------|---------|
| Effects | `src/effects/index.ts` | `Map<string, EffectDefinition>`, populated by explicit imports + `registerEffects()` |
| Properties | `src/services/properties/PropertyRegistry.ts` | Class with `register()`, `registerResolver()`, `registerProvider()` methods |
| Media Runtime | `src/services/mediaRuntime/registry.ts` | Class managing `BasicMediaSourceRuntime` instances per descriptor |
| AI Tool Policy | `src/services/aiTools/policy/registry.ts` | `Map<string, ToolPolicyEntry>` |
| AI Tool Handlers | `src/services/aiTools/handlers/index.ts` | Multiple `Record<string, Function>` dispatch maps |
| Node Graph descriptors | `src/types/nodeGraph.ts` | Type-only definitions backing a Zustand slice |

### 2.2 Registration timing

All six registries are populated at **module-load time**. None of them support runtime add/remove of definitions. Instance lifecycles (e.g., per-clip media runtimes) are dynamic, but the set of registered *types* is fixed at build time.

### 2.3 Build configuration

`tsconfig.app.json` currently sets:
- `erasableSyntaxOnly: true`
- `verbatimModuleSyntax: true`
- `strict: true`
- No `experimentalDecorators`
- No `emitDecoratorMetadata`

Pandino-SCR uses legacy TypeScript decorators with metadata emission. Adopting it requires changing the first three of these settings.

### 2.4 Module-discovery mechanism

The codebase does **not** currently use `import.meta.glob` (Vite's native pattern for build-time module discovery). All registry entries are reached through explicit `import` statements.

### 2.5 Runtime architecture

Several characteristics are relevant to any DI/lifecycle discussion:

- **60fps WebGPU render loop** orchestrated from `src/engine/render/RenderLoop.ts` and `RenderDispatcher.ts`.
- **HMR-survival singletons** for the WebGPU engine, FFmpeg bridge, and SAM2 service (pattern documented in `CLAUDE.md` §4).
- **WebGPU device-loss handling** — surfaces and pipelines can become invalid at runtime and need reinitialization.
- **Monitoring infrastructure** — `src/services/monitoring/` contains playback health, frame-phase, and pipeline-event monitors used for debugging.

### 2.6 Coupling observations

- `src/stores/timeline/index.ts` combines ~23 feature slices into a single Zustand store.
- This store is imported by many feature modules (LayerBuilder, EffectsPipeline, PropertyRegistry consumers, NodeGraph runtime, export pipeline, AI tool handlers).
- Effects, panels, and services are organized into clear folders, but their dependency graph routes through the central timeline store.

### 2.7 Cost of adding a new entity (today, baseline)

- **New effect**: create effect folder + shader, add export to category `index.ts`, automatic pickup. ~2–3 file edits.
- **New AI tool**: handler function + handler map entry + tool definition + policy entry. ~4 file edits across `src/services/aiTools/`.
- **New media source runtime**: implement runtime class + register via descriptor. ~2 file edits.

### 2.8 Plugin/extension architecture

There is currently **no third-party plugin loading mechanism**. No dynamic `import()` chains for user-supplied code. The CLAUDE.md §0 vision describes a future where MasterSelects supports all media types via extensible runtimes; the mechanism for that is not yet built.

---

## 3. Arguments **for** adopting Pandino-SCR

1. **Self-registering components** — a class with `@Component` registers itself; no central registry file needs to be edited per addition. This reduces merge-conflict surface when multiple contributors (or AI agents) add features in parallel.

2. **Built-in lifecycle hooks** — `@Activate`, `@Deactivate`, `@Modified` give a standardized place for setup/teardown logic. The HMR-singleton pattern currently spread across services could be expressed uniformly.

3. **Dynamic service binding** — services can be added or removed at runtime, with dependents notified automatically. This is the foundation pattern for plugin/extension ecosystems.

4. **Service ranking and filter expressions** — when multiple implementations exist (e.g., several video decoders), SCR provides a declarative way to choose between them, instead of ad-hoc selection logic.

5. **Fragment Pattern** — allows extending an existing bundle without modifying it (adding resources, properties, configuration), which is a mature solution for theme/locale/plugin contributions.

6. **Established methodology with long track record** — OSGi/SCR concepts have been refined for ~25 years in the JVM world (Eclipse, Equinox, Apache Felix). The semantics are well-understood and documented.

7. **Declarative dependency graph** — `@Reference` annotations make a component's dependencies visible at the declaration site, rather than scattered across constructor calls and imports.

---

## 4. Arguments **against** adopting Pandino-SCR

1. **Build-config incompatibility** — `erasableSyntaxOnly: true` and `verbatimModuleSyntax: true` would have to be removed to support `emitDecoratorMetadata`. These were deliberate choices for fast/strict builds; reversing them affects the whole project, not only the DI-adopting parts.

2. **Implicit wiring reduces grep-ability** — `EFFECT_REGISTRY.set("blur", ...)` is a string-searchable line; `@Component` plus container resolution is not. Stack traces gain framework frames between caller and callee.

3. **Runtime overhead** — `reflect-metadata` adds bundle weight (~50KB) and decorator evaluation runs at startup. Magnitude depends on component count; needs measurement, but is non-zero.

4. **Vite-HMR integration is unproven for this stack** — Pandino targets OSGi-style hosts. Behavior under Vite's module replacement (especially for WebGPU device-loss recovery and HMR-singleton survival) is not documented and would need verification.

5. **Niche in the JavaScript ecosystem** — unlike Angular DI or NestJS, OSGi-style SCR has a small JS user base. Issues hit during adoption may have to be solved without community precedent.

6. **Learning curve for contributors** — anyone touching the project (human or AI agent) would need to understand the SCR lifecycle model (ServiceFactory, ServiceRanking, References cardinality, dynamic vs. static policy) on top of the existing stack.

7. **Solves problems the codebase does not yet have** — runtime plugin loading, multi-vendor extension marketplaces, and dynamic service rebinding are SCR's primary value, but MasterSelects does not currently ship in a context where those are required. Adopting the runtime now is buying capability ahead of demand.

---

## 5. Open questions worth investigating

These are unanswered facts that should inform the decision but are not settled by this document:

- Does Pandino survive Vite-HMR cycles for long-lived services without re-initializing GPU resources?
- What is the bundle-size delta after adding `reflect-metadata` and a working SCR setup?
- How does decorator-based registration interact with tree-shaking in a production build?
- Can existing monitoring services (`playbackHealthMonitor`, etc.) be expressed as `@Component`s without performance regression in the 60fps render path?
- Is there a hybrid approach (e.g., Pandino for the plugin-facing surface, explicit registries for the render core) that captures most upside with less risk?
- What does a 1-effect or 1-media-importer prototype look like in practice, and how does it compare to the current per-feature edit cost?

---

## 6. Suggested next step for an evaluating agent

1. Read the six registry files listed in §2.1 directly.
2. Trace the dependency graph from `src/stores/timeline/index.ts` and `src/services/layerBuilder/LayerBuilderService.ts` to feel the actual coupling shape.
3. Read `CLAUDE.md` §4 (HMR Singleton Pattern) and §5 (Debugging) to understand the runtime constraints.
4. Skim the Pandino README and Fragment Pattern doc linked above.
5. Decide whether the arguments in §3 or §4 weigh more for *this* codebase, or whether one of the open questions in §5 needs to be answered before a position is possible.

This document is a starting point, not a verdict. The agent's own reading of the code is expected to refine, contradict, or extend the points above.
