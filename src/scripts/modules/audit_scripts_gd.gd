# Module: audit_scripts_gd.gd
# Provides GDScript static audit (naming, signals, preload usage, TODO/FIXME, deprecated patterns, classdefs)

func audit_scripts_gd(params: Dictionary) -> void:
    var start = Time.get_ticks_msec()
    var include_exts: Array = params.get("includePatterns", ["gd"]) 
    var max_per_file: int = params.get("maxFindingsPerFile", 10)
    var root_dir = ProjectSettings.globalize_path("res://")

    var report := {
        "naming": [],
        "signals": [],
        "preload": [],
        "todo": [],
        "deprecated": [],
        "classdefs": [],
        "summary": {},
        "engine_version": Engine.get_version_info()
    }

    var files: Array[String] = []
    _gather_files_recursive(root_dir, files, include_exts)

    for f in files:
        if not f.ends_with(".gd"): continue
        var text = FileAccess.get_file_as_string(f)
        if text.is_empty():
            continue
        var rel = f.replace(root_dir, "res://")
        var lines = text.split("\n")
        var findings_for_file = 0
        
        # 1. Naming: check class_name vs filename mismatch
        var class_match = RegEx.new()
        class_match.compile("^\t?\s*class_name\s+([A-Za-z0-9_]+)")
        for l in lines:
            var m = class_match.search(l)
            if m:
                var cname = m.get_string(1)
                var expected = rel.get_file().replace(".gd", "")
                if cname != expected:
                    report["classdefs"].append({
                        "file": rel,
                        "issue": "class_name mismatch",
                        "declared": cname,
                        "expected": expected,
                        "recommendation": "Rename class or file for consistency"
                    })
                break
        
        # 2. Signals: find custom signal declarations without doc comments
        var signal_re = RegEx.new()
        signal_re.compile("^\t?\s*signal\s+([A-Za-z0-9_]+)")
        for i in range(lines.size()):
            if findings_for_file >= max_per_file: break
            var l2 = lines[i]
            var sm = signal_re.search(l2)
            if sm:
                var prev = i > 0 ? lines[i-1].strip_edges() : ""
                if not prev.begins_with("#"):
                    report["signals"].append({
                        "file": rel,
                        "line": i+1,
                        "signal": sm.get_string(1),
                        "issue": "Undocumented signal",
                        "recommendation": "Add preceding comment explaining when emitted"
                    })
                    findings_for_file += 1
        
        # 3. preload vs load: encourage preload for top-level constants
        var preload_re = RegEx.new()
        preload_re.compile("^\t?\s*const\s+([A-Z0-9_]+)\s*=\s*load\(\")
        for i in range(lines.size()):
            if findings_for_file >= max_per_file: break
            var l3 = lines[i]
            var pm = preload_re.search(l3)
            if pm:
                report["preload"].append({
                    "file": rel,
                    "line": i+1,
                    "const": pm.get_string(1),
                    "issue": "Use preload instead of load at top-level for performance",
                    "recommendation": "Change load(…) to preload(…) for compile-time caching"
                })
                findings_for_file += 1
        
        # 4. TODO / FIXME markers
        for i in range(lines.size()):
            if findings_for_file >= max_per_file: break
            var l4 = lines[i]
            if l4.find("TODO") != -1 or l4.find("FIXME") != -1:
                report["todo"].append({
                    "file": rel,
                    "line": i+1,
                    "text": l4.strip_edges(),
                    "issue": "Pending work marker",
                    "recommendation": "Resolve or track in issue tracker"
                })
                findings_for_file += 1
        
        # 5. Deprecated API quick pattern checks (basic heuristics)
        var deprecated_patterns = [
            {"pat": ".rpc_config(", "note": "Check migration: use node-specific RPC config in 4.5"},
            {"pat": "yield(", "note": "Use await (await signal) in Godot 4+ (if still in legacy code)"},
            {"pat": "setget ", "note": "If migrating from <4, ensure new setter/getter syntax is valid"}
        ]
        for i in range(lines.size()):
            if findings_for_file >= max_per_file: break
            var low = lines[i]
            for d in deprecated_patterns:
                if low.find(d.pat) != -1:
                    report["deprecated"].append({
                        "file": rel,
                        "line": i+1,
                        "pattern": d.pat,
                        "issue": "Potential deprecated/legacy pattern",
                        "note": d.note
                    })
                    findings_for_file += 1
                    break

    report["summary"] = {
        "files_scanned": files.size(),
        "naming_findings": report["classdefs"].size(),
        "signal_findings": report["signals"].size(),
        "preload_findings": report["preload"].size(),
        "todo_findings": report["todo"].size(),
        "deprecated_findings": report["deprecated"].size(),
        "duration_ms": Time.get_ticks_msec() - start
    }

    print(JSON.stringify(report))
