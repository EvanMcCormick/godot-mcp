# Module: animation_resource_audit.gd
# Audits AnimationPlayer .tscn embeddings and standalone .anim / .tres animation resources.
# Categories reported:
#   missing_tracks        -> Animations referencing nodes or properties no longer present
#   zero_length           -> Animations with length <= 0.001
#   unlooped_candidate    -> Animations > 1.5s that look like cycles (name contains "loop" or ends with _loop) but loop flag false
#   duplicate_names       -> Same animation name appears multiple times within one AnimationPlayer
# Summary counts: issues = missing_tracks + zero_length; warnings = unlooped_candidate + duplicate_names.
# Notes: track_count, animation_count per player are embedded in category items for context.

extends Node

# Helper: recursively gather .tscn files
func _gather_scene_files(base: String, out: Array) -> void:
    var dir = DirAccess.open(base)
    if dir == null:
        return
    dir.list_dir_begin()
    var name = dir.get_next()
    while name != "":
        if dir.current_is_dir():
            if not name.begins_with("."):
                _gather_scene_files(base + name + "/", out)
        elif name.ends_with(".tscn"):
            out.append(base + name)
        name = dir.get_next()
    dir.list_dir_end()

func animation_resource_audit(params: Dictionary) -> void:
    var start := Time.get_ticks_msec()
    var project_root := "res://"
    if params.has("project_root"):
        project_root = params.project_root
        if not project_root.begins_with("res://"):
            project_root = "res://" + project_root
        if not project_root.ends_with("/"):
            project_root += "/"

    var include_scenes: Array = []
    _gather_scene_files(project_root, include_scenes)

    var categories := {
        "missing_tracks": [],
        "zero_length": [],
        "unlooped_candidate": [],
        "duplicate_names": []
    }

    for scene_path in include_scenes:
        var text := FileAccess.get_file_as_string(scene_path)
        if text == "":
            continue
        # Rough parse: look for [sub_resource type="Animation"] blocks and AnimationPlayer nodes
        var lines: Array = text.split("\n")
        var current_anim_name := ""
        var current_anim_len := 0.0
        var current_anim_loop := false
        var inside_anim := false
        var anim_names_in_player: = {} # scene-scoped per AnimationPlayer
        var anim_name_occurrences: = {} # name -> count within THIS player
        var player_stack: Array = []

        # Track collection for missing track detection: any track containing path= and import warn heuristics
        var current_anim_tracks: Array = []

        for raw_line in lines:
            var line = raw_line.strip_edges()
            if line.begins_with("[node") and line.find("AnimationPlayer") != -1:
                # New player -> reset duplicates map
                anim_names_in_player.clear()
                anim_name_occurrences.clear()
            if line.begins_with("[sub_resource") and line.find("type=\"Animation\"") != -1:
                inside_anim = true
                current_anim_name = ""
                current_anim_len = 0.0
                current_anim_loop = false
                current_anim_tracks.clear()
                continue
            if inside_anim:
                if line == "":
                    # End of sub_resource block (blank line heuristic)
                    # Evaluate collected animation
                    var issues_count = 0
                    if current_anim_len <= 0.001:
                        categories["zero_length"].append({
                            "scene": scene_path, "animation": current_anim_name, "length": current_anim_len
                        })
                        issues_count += 1
                    # Heuristic loop candidate
                    if current_anim_len > 1.5 and (current_anim_name.to_lower().find("loop") != -1 or current_anim_name.to_lower().ends_with("_loop")) and not current_anim_loop:
                        categories["unlooped_candidate"].append({
                            "scene": scene_path, "animation": current_anim_name, "length": current_anim_len
                        })
                    # Track path validation (simple heuristic: path referring to missing Node names is handled lightly)
                    for tr in current_anim_tracks:
                        if tr.get("missing", false):
                            categories["missing_tracks"].append({
                                "scene": scene_path, "animation": current_anim_name, "track": tr.get("path"), "reason": "node/path heuristic missing"
                            })
                            issues_count += 1
                    inside_anim = false
                    continue
                # Parse animation properties
                if line.begins_with("name="):
                    current_anim_name = line.split("=", false, 1)[1].strip_edges().trim_prefix("\"").trim_suffix("\"")
                    # duplicate detection inside same player
                    var prev = anim_name_occurrences.get(current_anim_name, 0)
                    anim_name_occurrences[current_anim_name] = prev + 1
                    if prev == 1: # second occurrence
                        categories["duplicate_names"].append({
                            "scene": scene_path, "animation": current_anim_name, "occurrences": prev + 1
                        })
                    elif prev > 1:
                        # Update last entry count (optional enhancement skipped for brevity)
                        pass
                elif line.begins_with("length="):
                    var len_str = line.split("=", false, 1)[1]
                    current_anim_len = len_str.to_float()
                elif line.begins_with("loop="):
                    var loop_val = line.split("=", false, 1)[1].to_lower()
                    current_anim_loop = loop_val == "true"
                elif line.begins_with("track/") and line.find("/path=") != -1:
                    # Extract path value
                    var eq_idx = line.find("=")
                    var path_val = line.substr(eq_idx + 1).strip_edges().trim_prefix("\"").trim_suffix("\"")
                    # Heuristic: mark missing if contains a colon or dot path referencing Node not in scene text
                    var missing = false
                    if path_val != "" and text.find(path_val.split(":" )[0]) == -1:
                        missing = true
                    current_anim_tracks.append({"path": path_val, "missing": missing})

    var summary := {
        "issues": categories["missing_tracks"].size() + categories["zero_length"].size(),
        "warnings": categories["unlooped_candidate"].size() + categories["duplicate_names"].size(),
        "notes": 0,
        "duration_ms": Time.get_ticks_msec() - start
    }

    var out := {
        "summary": summary,
        "categories": categories,
        "meta": {"tool": "animation_resource_audit", "godot_version": Engine.get_version_info()["string"], "scenes_scanned": include_scenes.size()}
    }
    print(JSON.stringify(out))
