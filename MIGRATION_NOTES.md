# Godot 4.4 → 4.5 Migration Notes (Project Coverage)

This project (Godot MCP server) has been reviewed against the official Godot 4.5 migration guide.
Below is a concise matrix of what is implemented, what is intentionally out of scope, and how to adapt runtime behavior.

## ✅ Implemented / Accounted For

| Area | Change in 4.5 | Project Handling | User Action Needed? |
|------|---------------|------------------|---------------------|
| Resource deep duplication | `duplicate(true)` no longer copies external resources; must use `duplicate_deep(RESOURCE_DEEP_DUPLICATE_ALL)` | Tool `duplicate_resource_advanced` auto-selects native method or enhanced 4.4 fallback | No |
| TileMapLayer physics chunking | Enabled by default; affects coordinate precision | `configure_tilemap_layer` lets you set `physicsQuadrantSize`; doc now recommends `1` for 4.4‑style precision | Optional if you need exact coords |
| Navigation async updates | Regions update asynchronously (may delay availability) | `configure_navigation_async` exposes async enabling + cell scale tuning | Tune if timing-sensitive |
| FoldableContainer UI | New control | Native creation with 4.4 fallback (Container+Button) | No |
| Android C# export requirement | .NET 9 required (Android only) | Documented in README | Only if exporting C# to Android |

## 🟡 Behavior Adjustments You Can Control

| Behavior | 4.5 Default | How to Emulate 4.4 | Tool / Setting |
|----------|-------------|--------------------|----------------|
| TileMapLayer body coord precision | Chunked; may be less precise | Set `physicsQuadrantSize = 1` | `configure_tilemap_layer` |
| Navigation map update timing | Async; slight sync delay | Disable async OR reduce `max_async_time` | `configure_navigation_async` |
| External resource duplication | Not automatic unless deep flag used | Force all external resources duplication | `duplicate_resource_advanced` with `useDeepDuplication=true & duplicateExternalResources=true` |

## ❌ Out-of-Scope (Not Used by This Project)
These migration items apply to engine subsystems we do not call:
- JSONRPC / RPC config name changes
- RenderingServer / DisplayServer optional parameter additions
- GLTF accessor/int64 type widenings
- Text drawing oversampling parameters
- XR OpenXR wrapper type migrations
- Editor plugin API surface changes

No action is required inside this repository unless future tools begin invoking those APIs.

## 🧪 Version Detection Strategy
- TypeScript: `isGodot44OrLater()` and `isGodot45OrLater()` gate tool behaviors.
- GDScript: Runtime checks with `Engine.get_version_info()` plus method existence guards.
- Fallback pathways always return an explicit `compatibility_note` for transparency.

## 🔍 Quick Reference: When to Change Settings
| Goal | Recommendation |
|------|---------------|
| Maximum duplication fidelity | Enable deep duplication + external resources flags |
| Reproduce 4.4 TileMap physics queries | Set quadrant size to `1` |
| Highest nav throughput (4.5+) | Keep async enabled, fine-tune `maxAsyncTime` |
| Deterministic nav timing (tests) | Disable async or set very low `maxAsyncTime` |

## 📌 Summary
All materially relevant 4.5 breaking or behavior changes that intersect with the responsibilities of this MCP server are handled. Remaining items are peripheral to current functionality and safely ignored. Documentation has been updated to guide users on matching legacy behavior where appropriate.

If new Godot 4.5+ subsystems are added later (e.g., GLTF schema manipulation, advanced text shaping, XR integration), this file should be extended with additional handling notes.

## 🧮 Automated Migration Audit (New)
Tool: `audit_migration_45`

This tool scans a Godot project source tree and reports patterns that may need attention when moving from 4.4 → 4.5.

Currently detected patterns:
- `duplicate(true)` usages → Suggest switch to `duplicate_deep(…, RESOURCE_DEEP_DUPLICATE_ALL)` when external sub-resources must be copied.
- `get_rpc_config` → Renamed to `get_node_rpc_config` in 4.5.
- RichTextLabel `add_image(... size_in_percent=...)` → Replaced by independent `width_in_percent` / `height_in_percent` parameters.
- Missing explicit navigation async region settings (`navigation/2d/region_use_async_iterations`, `navigation/3d/region_use_async_iterations`).
- TileMapLayer scenes missing `physics_quadrant_size` (advises setting to 1 for legacy precision or larger for performance).
- Legacy `TileMap` scenes lacking explicit `quadrant_size` (nudges migration to `TileMapLayer`).

Output JSON structure:
```
{
	"duplication": [ { file, snippet, recommendation } ],
	"rpc": [ { file, snippet, recommendation } ],
	"richtext": [ { file, snippet, recommendation } ],
	"navigation": [ { issue, details[], recommendation } ],
	"tilemap": [ { file, issue, recommendation } ],
	"summary": { counts..., duration_ms },
	"engine_version": { major, minor, patch, status }
}
```

Planned future detections (not yet implemented):
- Deprecated physics material parameter name shifts (if any emerge post‑4.5).
- Additional RPC API renames if extended in minor patches.
- Advanced NavigationServer tuning properties once stabilized.

This keeps migration hygiene actionable and prevents silent legacy patterns persisting across versions.
