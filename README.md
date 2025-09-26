# Godot MCP

[![Github-sponsors](https://img.shields.io/badge/sponsor-30363D?style=for-the-badge&logo=GitHub-Sponsors&logoColor=#EA4AAA)](https://github.com/sponsors/Coding-Solo)

[![](https://badge.mcpx.dev?type=server 'MCP Server')](https://modelcontextprotocol.io/introduction)
[![Made with Godot](https://img.shields.io/badge/Made%20with-Godot-478CBF?style=flat&logo=godot%20engine&logoColor=white)](https://godotengine.org)
[![](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white 'Node.js')](https://nodejs.org/en/download/)
[![](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white 'TypeScript')](https://www.typescriptlang.org/)

[![](https://img.shields.io/github/last-commit/EvanMcCormick/godot-mcp 'Last Commit')](https://github.com/EvanMcCormick/godot-mcp/commits/main)
[![](https://img.shields.io/github/stars/EvanMcCormick/godot-mcp 'Stars')](https://github.com/EvanMcCormick/godot-mcp/stargazers)
[![](https://img.shields.io/github/forks/EvanMcCormick/godot-mcp 'Forks')](https://github.com/EvanMcCormick/godot-mcp/network/members)
[![](https://img.shields.io/badge/License-MIT-red.svg 'MIT License')](https://opensource.org/licenses/MIT)

```text
                           (((((((             (((((((                          
                        (((((((((((           (((((((((((                      
                        (((((((((((((       (((((((((((((                       
                        (((((((((((((((((((((((((((((((((                       
                        (((((((((((((((((((((((((((((((((                       
         (((((      (((((((((((((((((((((((((((((((((((((((((      (((((        
       (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((      
     ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((    
    ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((    
      (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((     
        (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((       
         (((((((((((@@@@@@@(((((((((((((((((((((((((((@@@@@@@(((((((((((        
         (((((((((@@@@,,,,,@@@(((((((((((((((((((((@@@,,,,,@@@@(((((((((        
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((        
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((        
         (((((((((@@@,,,,,,,@@((((((((@@@@@((((((((@@,,,,,,,@@@(((((((((        
         ((((((((((((@@@@@@(((((((((((@@@@@(((((((((((@@@@@@((((((((((((        
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((        
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((        
         @@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@        
         ((((((((( @@@(((((((((((@@(((((((((((@@(((((((((((@@@ (((((((((        
         (((((((((( @@((((((((((@@@(((((((((((@@@((((((((((@@ ((((((((((        
          (((((((((((@@@@@@@@@@@@@@(((((((((((@@@@@@@@@@@@@@(((((((((((         
           (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((          
              (((((((((((((((((((((((((((((((((((((((((((((((((((((             
                 (((((((((((((((((((((((((((((((((((((((((((((((                
                        (((((((((((((((((((((((((((((((((                       
                                                                                

                          /$$      /$$  /$$$$$$  /$$$$$$$ 
                         | $$$    /$$$ /$$__  $$| $$__  $$
                         | $$$$  /$$$$| $$  \__/| $$  \ $$
                         | $$ $$/$$ $$| $$      | $$$$$$$/
                         | $$  $$$| $$| $$      | $$____/ 
                         | $$\  $ | $$| $$    $$| $$      
                         | $$ \/  | $$|  $$$$$$/| $$      
                         |__/     |__/ \______/ |__/       
```

A Model Context Protocol (MCP) server for interacting with the Godot game engine.

## Introduction

Godot MCP enables AI assistants to launch the Godot editor, run projects, capture debug output, and control project execution - all through a standardized interface. Compatible with Godot 4.4+ and fully supports Godot 4.5.

This direct feedback loop helps AI assistants like Claude understand what works and what doesn't in real Godot projects, leading to better code generation and debugging assistance.

## Features

- **Launch Godot Editor**: Open the Godot editor for a specific project
- **Run Godot Projects**: Execute Godot projects in debug mode
- **Capture Debug Output**: Retrieve console output and error messages
- **Control Execution**: Start and stop Godot projects programmatically
- **Get Godot Version**: Retrieve the installed Godot version
- **List Godot Projects**: Find Godot projects in a specified directory
- **Project Analysis**: Get detailed information about project structure
- **Scene Management**:
  - Create new scenes with specified root node types
  - Add nodes to existing scenes with customizable properties
  - Load sprites and textures into Sprite2D nodes
  - Export 3D scenes as MeshLibrary resources for GridMap
  - Save scenes with options for creating variants
- **UID Management** (for Godot 4.4+):
  - Get UID for specific files
  - Update UID references by resaving resources
- **Godot 4.5+ Enhanced Features**:
  - **Advanced Resource Duplication**: Use `RESOURCE_DEEP_DUPLICATE_ALL` for complete external resource duplication (with enhanced 4.4 fallbacks)
  - **TileMapLayer Physics Chunking**: Configure physics optimization with `physics_quadrant_size` settings (4.4 compatible alternatives available)  
  - **FoldableContainer UI**: Create collapsible UI sections with custom titles and fold behavior (4.4 Container+Button fallback provided)
  - **NavigationServer Async Updates**: Configure asynchronous region updates for improved navigation performance (4.4 optimizations included)
  - **Version-Aware Operations**: Automatic feature detection with intelligent compatibility fallbacks for Godot 4.4+ users
  - **Migration Audit Tool**: `audit_migration_45` scans for patterns needing attention (e.g. `duplicate(true)`, `get_rpc_config`, RichText `size_in_percent`, missing nav async settings, missing TileMapLayer quadrant hints)
  - **Scripting Static Analysis**:
    - `audit_scripts_gd`: GDScript checks (class_name/file mismatch, undocumented signals, load() vs preload(), TODO/FIXME markers, basic deprecated patterns)
    - `audit_scripts_cs`: C# checks (namespace use, missing partial, filename/class mismatch, autoload referencing .cs directly)
  - **Scene Integrity**:
    - `scene_smoke_test`: Bulk loads (and optionally instantiates) all scenes; reports load failures & missing external resources
  - **Export Configuration Audit**:
    - `validate_export_presets`: Parses `export_presets.cfg` and flags: missing icons, absent Android keystore / package name, .NET 9 requirement gaps (Android C#), mismatched feature flags, suspicious custom release/debug overrides
  - **Input Map Consistency**:
    - `input_map_audit`: Analyzes `[input]` section of `project.godot` for duplicate physical events, empty/unused actions, legacy/deprecated naming hints, and inconsistent device scoping
  - **Physics Layer & Mask Hygiene**:
    - `physics_layer_audit`: Scans `.tscn` files for nodes with `collision_layer` / `collision_mask` anomalies (zero layers, redundant self-only masks, orphan bits never referenced elsewhere, excessively broad masks)

### Audit Output Format
All audit-style tools return structured JSON with these general fields (tool dependent):
```jsonc
{
  "summary": { "issues": 3, "warnings": 5, "notes": 2 },
  "categories": {
    "missing_icons": [ { "preset": "Windows Desktop", "detail": "icon" } ],
    "duplicate_input_events": [ { "action": "jump", "key": "Space" } ]
  },
  "meta": { "godot_version": "4.5.stable", "tool": "validate_export_presets" }
}
```
You can gate CI or assistant decisions off `summary` counts while still surfacing granular findings inside `categories`.

### Migration Clarifications (4.4 → 4.5)
| Area | What Changed in 4.5 | How This Project Handles It | How to Emulate 4.4 Behavior |
|------|---------------------|-----------------------------|------------------------------|
| Resource Deep Duplication | `duplicate(true)` no longer copies external refs | Uses `duplicate_deep(RESOURCE_DEEP_DUPLICATE_ALL)` or enhanced 4.4 fallback | Enable deep + external flags in tool args |
| TileMapLayer Precision | Physics chunking affects coordinate precision | Exposes `physicsQuadrantSize` | Set to `1` for 4.4-equivalent exact coords |
| Navigation Updates | Regions update asynchronously by default | Tool config toggles async + cell scale | Disable async or lower max async time |
| New UI Control | `FoldableContainer` added | Native + fallback composite implementation | Use fallback automatically on 4.4 |
| Android C# Export | Requires .NET 9 now | Documented in Requirements | Install .NET 9 only for Android exports |

> Tip: All fallbacks return a `compatibility_note` so you always know which path was taken.

## Requirements

- [Godot Engine](https://godotengine.org/download) 4.4+ installed on your system (fully supports Godot 4.5)
- Node.js and npm
- An AI assistant that supports MCP (Cline, Cursor, etc.)

**Note for C# Projects targeting Android**: As of Godot 4.5, .NET 9 is required when exporting C# projects to Android due to new Google Play requirements. Other platforms continue to support .NET 8 as the minimum version.

## Installation and Configuration

### Step 1: Install and Build

First, clone the repository and build the MCP server:

```bash
git clone https://github.com/EvanMcCormick/godot-mcp.git
cd godot-mcp
npm install
npm run build
```

### Step 2: Configure with Your AI Assistant

#### Option A: Configure with Cline

Add to your Cline MCP settings file (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp/build/index.js"],
      "env": {
        "DEBUG": "true"                  // Optional: Enable detailed logging
      },
      "disabled": false,
      "autoApprove": [
        "launch_editor",
        "run_project",
        "get_debug_output",
        "stop_project",
        "get_godot_version",
        "list_projects",
        "get_project_info",
        "create_scene",
        "add_node",
        "load_sprite",
        "export_mesh_library",
        "save_scene",
        "get_uid",
        "update_project_uids",
        "duplicate_resource_advanced",
        "configure_tilemap_layer",
        "create_foldable_container",
        "configure_navigation_async"
      ]
    }
  }
}
```

#### Option B: Configure with Cursor

**Using the Cursor UI:**

1. Go to **Cursor Settings** > **Features** > **MCP**
2. Click on the **+ Add New MCP Server** button
3. Fill out the form:
   - Name: `godot` (or any name you prefer)
   - Type: `command`
   - Command: `node /absolute/path/to/godot-mcp/build/index.js`
4. Click "Add"
5. You may need to press the refresh button in the top right corner of the MCP server card to populate the tool list

**Using Project-Specific Configuration:**

Create a file at `.cursor/mcp.json` in your project directory with the following content:

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp/build/index.js"],
      "env": {
        "DEBUG": "true"                  // Enable detailed logging
      }
    }
  }
}
```

### Step 3: Optional Environment Variables

You can customize the server behavior with these environment variables:

- `GODOT_PATH`: Path to the Godot executable (overrides automatic detection)
- `DEBUG`: Set to "true" to enable detailed server-side debug logging

## Example Prompts

Once configured, your AI assistant will automatically run the MCP server when needed. You can use prompts like:

```text
"Launch the Godot editor for my project at /path/to/project"

"Run my Godot project and show me any errors"

"Get information about my Godot project structure"

"Analyze my Godot project structure and suggest improvements"

"Help me debug this error in my Godot project: [paste error]"

"Write a GDScript for a character controller with double jump and wall sliding"

"Create a new scene with a Player node in my Godot project"

"Add a Sprite2D node to my player scene and load the character texture"

"Export my 3D models as a MeshLibrary for use with GridMap"

"Create a UI scene with buttons and labels for my game's main menu"

"Get the UID for a specific script file in my Godot 4.4+ project"

"Update UID references in my Godot project after upgrading to 4.4+"

"Duplicate my player scene with advanced options using Godot 4.5 features"

"Configure TileMapLayer physics chunking for better collision performance"

"Create a FoldableContainer UI element for my settings menu"

"Optimize my TileMap physics by adjusting quadrant size settings"

"Configure NavigationServer for async updates to improve pathfinding performance"

"Optimize navigation mesh merging with custom rasterizer cell scale"

"Help me migrate my project from Godot 4.4 to 4.5"

"Check if my Godot project is compatible with 4.5 new features"

"Audit my project for 4.4 to 4.5 migration issues"
"Run a GDScript style and migration audit on my project"
"Check my C# scripts for Godot-specific problems (namespaces, partial keyword, autoload misuse)"
"Run a scene smoke test to find broken or missing resources"
"Validate my export presets and show missing icons or signing configs"
"Audit the Input Map for duplicates or empty actions"
"Analyze physics collision layers and masks across my scenes"
```

## Implementation Details

### Architecture

The Godot MCP server uses a bundled GDScript approach for complex operations:

1. **Direct Commands**: Simple operations like launching the editor or getting project info use Godot's built-in CLI commands directly.
2. **Bundled Operations Script**: Complex operations like creating scenes or adding nodes use a single, comprehensive GDScript file (`godot_operations.gd`) that handles all operations.

This architecture provides several benefits:

- **No Temporary Files**: Eliminates the need for temporary script files, keeping your system clean
- **Simplified Codebase**: Centralizes all Godot operations in one (somewhat) organized file
- **Better Maintainability**: Makes it easier to add new operations or modify existing ones
- **Improved Error Handling**: Provides consistent error reporting across all operations
- **Reduced Overhead**: Minimizes file I/O operations for better performance

The bundled script accepts operation type and parameters as JSON, allowing for flexible and dynamic operation execution without generating temporary files for each operation.

### Modular GDScript Architecture (v0.2+)

Originally, every operation and audit lived inside a single large file: `godot_operations.gd`. To make ongoing contributions safer and easier to review we refactored to a **module append** model:

1. The core dispatcher and shared helpers remain in `src/scripts/godot_operations.gd`.
2. Each complex audit now lives in its own file under `src/scripts/modules/` (one function per file):
   - `audio_bus_layout_audit.gd`
   - `scene_smoke_test.gd`
   - `audit_scripts_gd.gd`
   - `audit_scripts_cs.gd`
   - `validate_export_presets.gd`
   - `input_map_audit.gd`
   - `physics_layer_audit.gd`
3. The build script (`npm run build`) does two things:
   - Compiles TypeScript to `build/`
   - Concatenates every `*.gd` file in `src/scripts/modules/` and appends them (with clear boundary comments) to the end of the built `build/scripts/godot_operations.gd`
4. Inside the monolith, each extracted function body was replaced with a **placeholder stub** that returns a tiny JSON object and logs a warning if the appended module implementation is missing. When the module is successfully appended, the real implementation (the version in `modules/`) simply shadows that placeholder (the real definition being later in the same combined file takes precedence at runtime).

Why this matters:
* Safer reviews: Diffs only show the function you touched.
* Faster iteration: Add a file, run build, you are done.
* Fallback safety: If someone forgets to run the build step, operations still "work" (they just warn and return minimal JSON) instead of crashing.

#### Adding a New Audit / Operation

Follow this step-by-step checklist (Windows friendly):

1. Pick a unique function name (example: `animation_resource_audit`). Keep it snake_case.
2. Open `src/scripts/godot_operations.gd` and add a placeholder function near the other placeholders:
   ```gdscript
   func animation_resource_audit(params: Dictionary) -> void:
     _print_warning("animation_resource_audit placeholder used (module not appended)")
     var out: Dictionary = {
       "summary": {"issues": 0, "warnings": 0, "notes": 0},
       "categories": {},
       "meta": {"tool": "animation_resource_audit", "placeholder": true}
     }
     print(JSON.stringify(out))
   ```
3. Add a dispatch branch if this is a brand new operation name. Look for the big `match op:` block and add:
   ```gdscript
     "animation_resource_audit":
       animation_resource_audit(params)
   ```
4. Create the real module file: `src/scripts/modules/animation_resource_audit.gd`
   ```gdscript
   # Module: animation_resource_audit.gd
   # Performs audit of animation resources
   extends Node

   func animation_resource_audit(params: Dictionary) -> void:
     var start_time := Time.get_ticks_msec()
     var categories: Dictionary = {
       "missing_tracks": [],
       "deprecated_formats": [],
       "loop_inconsistencies": []
     }
     # ... gather files & analyze (reuse _gather_files_recursive from core) ...
     # NOTE: helper functions defined in the base file are available after concatenation.

     var summary := {
       "issues": categories["missing_tracks"].size() + categories["deprecated_formats"].size(),
       "warnings": categories["loop_inconsistencies"].size(),
       "notes": 0,
       "duration_ms": Time.get_ticks_msec() - start_time
     }
     var out := {
       "summary": summary,
       "categories": categories,
       "meta": {"tool": "animation_resource_audit", "godot_version": Engine.get_version_info()["string"]}
     }
     print(JSON.stringify(out))
   ```
5. Build the project:
   ```powershell
   npm run build
   ```
   You should see output similar to: `Appended 8 module(s) into godot_operations.gd` (the number increases by one).
6. Test via your MCP client or manually:
   - Ask the assistant: "Run animation_resource_audit on my project" (once wired as a tool in `index.ts` if needed).
   - Or temporarily add a debug call path if experimenting locally.
7. Commit both changes (placeholder + module) so future contributors keep the safety net.

#### Guidelines for Audit Output

Keep the JSON shape consistent so downstream automation can rely on it:
```jsonc
{
  "summary": { "issues": <int>, "warnings": <int>, "notes": <int>, "duration_ms": <int> },
  "categories": { "some_bucket": [ { /* finding */ } ] },
  "meta": { "tool": "exact_function_name", "godot_version": "4.5.stable" }
}
```
Mandatory keys: `summary`, `categories`, `meta.tool`. Always include `godot_version` (use `Engine.get_version_info()["string"]`). Optional: add anything else under `meta` if it provides value (e.g. scanned file counts).

#### Reusing Helpers

Do NOT duplicate helper functions like `_gather_files_recursive`. They live in the base file and are already available after concatenation. Just call them directly. If you truly need a new generic helper, add it to the core `godot_operations.gd` (near existing helpers) not inside a module—this ensures module ordering does not matter.

#### Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Forgot to run build | Placeholder JSON with `"placeholder": true` | Run `npm run build` |
| Function name mismatch | Dispatcher says unknown op | Ensure `match` branch matches function name exactly |
| Missing JSON print | Tool returns empty output | Always `print(JSON.stringify(out))` at end |
| Large scan freezing | Very big projects stall | Add simple throttling or limit recursion early, then iterate |

#### When to Create a Module vs Inline

Create a module when:
* The function exceeds ~40 lines
* It has domain-specific logic (audits, deep analyzers, multi-step transforms)
* You expect future expansion or separate testability

Keep inline (in the core file) when:
* It's a tiny utility wrapper
* It depends on many internal helpers that would all have to move

#### Roadmap (Potential Future Modules)
* `audit_migration_45` (currently still inline)
* `shared_helpers.gd` (centralizing file recursion, JSON printing wrappers)
* `animation_resource_audit`
* Additional shader/material deprecation scanners

If you want to tackle one of these, open an issue first so we can coordinate ordering.

---

If you get stuck, open a discussion or issue with: the operation name, a short description, and (if available) a sample snippet of target content. We'll help shape the categories & summary counts so it stays consistent with the rest of the toolset.

## Troubleshooting

- **Godot Not Found**: Set the GODOT_PATH environment variable to your Godot executable
- **Connection Issues**: Ensure the server is running and restart your AI assistant
- **Invalid Project Path**: Ensure the path points to a directory containing a project.godot file
- **Build Issues**: Make sure all dependencies are installed by running `npm install`
- **For Cursor Specifically**:
-   Ensure the MCP server shows up and is enabled in Cursor settings (Settings > MCP)
-   MCP tools can only be run using the Agent chat profile (Cursor Pro or Business subscription)
-   Use "Yolo Mode" to automatically run MCP tool requests

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Version History

### v0.2.0 (Latest)
- Added full support for Godot 4.5+ with enhanced backward compatibility for Godot 4.4
- Enhanced Resource.duplicate_deep() with comprehensive 4.4 fallback implementation for external resources
- Improved TileMapLayer configuration with intelligent 4.4 TileMap compatibility layer  
- FoldableContainer with functional 4.4 Container+Button fallback alternative
- NavigationServer async optimizations with 4.4 performance enhancement alternatives
- Updated Godot path detection to include Godot 4.5 installation directories
- Added .NET 9 requirement documentation for Android C# projects
- Enhanced version detection with `isGodot45OrLater()` function
- Comprehensive compatibility layer ensuring meaningful functionality across Godot versions
- Updated documentation and examples with cross-version compatibility notes
- Added automated migration audit tool (`audit_migration_45`) producing categorized JSON findings for 4.4 → 4.5 upgrade review
- Added scripting static analysis tools: `audit_scripts_gd` and `audit_scripts_cs`
- Added scene integrity smoke testing (`scene_smoke_test`) to detect broken scenes and missing dependencies
- Added export preset validator (`validate_export_presets`) for multi-platform configuration checks
- Added Input Map auditor (`input_map_audit`) detecting duplicate events, empty actions, and legacy usage
- Added physics layer/mask auditor (`physics_layer_audit`) surfacing collision configuration anomalies

### v0.1.0
- Initial release with Godot 4.4+ support
- Basic MCP server functionality for Godot projects

[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/coding-solo-godot-mcp-badge.png)](https://mseep.ai/app/coding-solo-godot-mcp)
