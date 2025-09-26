# Module: audit_scripts_cs.gd
# C# static audit for Godot-specific pitfalls (namespaces, partial, filename/class match, autoload misconfig)

func audit_scripts_cs(params: Dictionary) -> void:
    var start = Time.get_ticks_msec()
    var include_exts: Array = params.get("includePatterns", ["cs"]) 
    var max_per_file: int = params.get("maxFindingsPerFile", 10)
    var root_dir = ProjectSettings.globalize_path("res://")

    var report := {
        "namespaces": [],
        "partials": [],
        "filenames": [],
        "autoloads": [],
        "summary": {},
        "engine_version": Engine.get_version_info()
    }

    var files: Array[String] = []
    _gather_files_recursive(root_dir, files, include_exts)

    # Build quick autoload map from project.godot
    var autoload_lines: Array[String] = []
    var project_file = root_dir.path_join("project.godot")
    if FileAccess.file_exists(project_file):
        var ptxt = FileAccess.get_file_as_string(project_file)
        autoload_lines = ptxt.split("\n")
    var autoload_cs_refs: Array[String] = []
    for l in autoload_lines:
        if l.find("=") != -1 and l.find(".cs") != -1:
            autoload_cs_refs.append(l.strip_edges())

    for f in files:
        if not f.ends_with(".cs"): continue
        var text = FileAccess.get_file_as_string(f)
        if text.is_empty():
            continue
        var rel = f.replace(root_dir, "res://")
        var lines = text.split("\n")
        var findings = 0

        # 1. Namespace usage (discouraged per project rules)
        for i in range(lines.size()):
            if findings >= max_per_file: break
            var l = lines[i]
            if l.begins_with("namespace "):
                report["namespaces"].append({
                    "file": rel,
                    "line": i+1,
                    "issue": "Namespace declaration",
                    "recommendation": "Remove namespace; Godot looks up scripts by global class name"
                })
                findings += 1
                break

        # 2. Class partial & base type detection
        var class_re = RegEx.new(); class_re.compile("class\s+([A-Za-z0-9_]+)")
        var class_name = ""
        var partial_found = false
        var base_found = false
        for i in range(lines.size()):
            var l2 = lines[i]
            if l2.find(" partial class ") != -1 or l2.find(" public partial class ") != -1:
                partial_found = true
            var m = class_re.search(l2)
            if m and class_name == "":
                class_name = m.get_string(1)
                if l2.find(":") != -1:
                    base_found = true
        if not partial_found:
            report["partials"].append({
                "file": rel,
                "issue": "Missing partial keyword",
                "recommendation": "Use 'public partial class ClassName : NodeType' per Godot C# conventions"
            })
        if class_name != "":
            var expected = rel.get_file().replace(".cs", "")
            if class_name != expected:
                report["filenames"].append({
                    "file": rel,
                    "declared": class_name,
                    "expected": expected,
                    "issue": "Filename/class mismatch",
                    "recommendation": "Rename file or class for accurate Godot lookup"
                })

        # 3. Autoload misconfiguration referencing .cs directly
        for ref_line in autoload_cs_refs:
            if ref_line.find(rel.get_file()) != -1:
                report["autoloads"].append({
                    "file": rel,
                    "issue": "Autoload points to .cs",
                    "recommendation": "Create a .tscn wrapper and reference that in autoload settings"
                })
                break

    report["summary"] = {
        "files_scanned": files.size(),
        "namespace_findings": report["namespaces"].size(),
        "partial_findings": report["partials"].size(),
        "filename_findings": report["filenames"].size(),
        "autoload_findings": report["autoloads"].size(),
        "duration_ms": Time.get_ticks_msec() - start
    }

    print(JSON.stringify(report))
