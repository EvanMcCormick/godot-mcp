# Module: scene_smoke_test.gd
# Provides scene_smoke_test audit previously embedded in godot_operations.gd

func scene_smoke_test(params: Dictionary) -> void:
    var start = Time.get_ticks_msec()
    var root_dir = ProjectSettings.globalize_path("res://")
    var include_exts: Array = params.get("includePatterns", ["tscn"]) 
    var instantiate: bool = params.get("instantiate", false)
    var max_scenes: int = params.get("maxScenes", 500)

    var report := {
        "passed": [],
        "load_errors": [],
        "instantiation_errors": [],
        "missing_dependencies": [],
        "summary": {},
        "engine_version": Engine.get_version_info()
    }

    var all_files: Array[String] = []
    _gather_files_recursive(root_dir, all_files, include_exts)

    var scene_count = 0
    for f in all_files:
        if not f.ends_with(".tscn"): continue
        if scene_count >= max_scenes: break
        scene_count += 1
        var rel = f.replace(root_dir, "res://")
        var packed: PackedScene = load(rel)
        if packed == null:
            report["load_errors"].append({
                "scene": rel,
                "error": "Failed to load PackedScene"
            })
            # Try to detect missing ext_resource entries
            var text = FileAccess.get_file_as_string(f)
            if text.find("ext_resource") != -1 and text.find("path=\"res://") != -1:
                # naive scan for missing referenced files
                var lines = text.split("\n")
                for l in lines:
                    if l.find("ext_resource") != -1 and l.find("path=") != -1:
                        var start_idx = l.find("path=\"")
                        if start_idx != -1:
                            start_idx += 6
                            var end_idx = l.find("\"", start_idx)
                            if end_idx != -1:
                                var dep_path = l.substr(start_idx, end_idx - start_idx)
                                if not FileAccess.file_exists(ProjectSettings.globalize_path(dep_path)):
                                    report["missing_dependencies"].append({
                                        "scene": rel,
                                        "missing": dep_path
                                    })
            continue

        if instantiate:
            var inst = packed.instantiate()
            if inst == null:
                report["instantiation_errors"].append({
                    "scene": rel,
                    "error": "Instantiation returned null"
                })
                continue
            # Quick optional free
            inst.queue_free()
        report["passed"].append(rel)

    report["summary"] = {
        "scenes_considered": all_files.size(),
        "scenes_tested": scene_count,
        "passed": report["passed"].size(),
        "load_errors": report["load_errors"].size(),
        "instantiation_errors": report["instantiation_errors"].size(),
        "missing_dependencies": report["missing_dependencies"].size(),
        "duration_ms": Time.get_ticks_msec() - start
    }

    print(JSON.stringify(report))
