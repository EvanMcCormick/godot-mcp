# Module: validate_export_presets.gd
# Parses export_presets.cfg and project.godot for configuration issues.

func validate_export_presets(params: Dictionary) -> void:
    var start = Time.get_ticks_msec()
    var export_file := ProjectSettings.globalize_path("res://export_presets.cfg")
    var project_file := ProjectSettings.globalize_path("res://project.godot")
    var exists := FileAccess.file_exists(export_file)
    var proj_exists := FileAccess.file_exists(project_file)

    var project_features: Array = []
    if proj_exists:
        var ptxt = FileAccess.get_file_as_string(project_file)
        var feature_line_idx = ptxt.find("config/features=")
        if feature_line_idx != -1:
            var line_end = ptxt.find("\n", feature_line_idx)
            if line_end == -1: line_end = ptxt.length()
            var line = ptxt.substr(feature_line_idx, line_end - feature_line_idx)
            var start_q = line.find("PackedStringArray(")
            if start_q != -1:
                var inner = line.substr(start_q + 18)
                var close = inner.find(")")
                if close != -1:
                    inner = inner.substr(0, close)
                    var parts = inner.split(",")
                    for p in parts:
                        var cleaned = p.strip_edges().trim_prefix("\"").trim_suffix("\"")
                        if cleaned != "":
                            project_features.append(cleaned)

    if not exists:
        var missing_report = {"presets": [], "summary": {"has_export_presets": false, "issues_total": 1, "warnings_total": 0, "duration_ms": Time.get_ticks_msec() - start}, "project_features": project_features, "issues": ["export_presets.cfg not found at project root"], "engine_version": Engine.get_version_info()}
        print(JSON.stringify(missing_report)); return

    var text = FileAccess.get_file_as_string(export_file)
    if text.is_empty():
        var empty_report = {"presets": [], "summary": {"has_export_presets": true, "issues_total": 1, "warnings_total": 0, "duration_ms": Time.get_ticks_msec() - start}, "project_features": project_features, "issues": ["export_presets.cfg is empty"], "engine_version": Engine.get_version_info()}
        print(JSON.stringify(empty_report)); return

    var lines = text.split("\n")
    var current := {"index": -1, "name": "", "platform": "", "export_path": "", "options": {}, "issues": [], "warnings": []}
    var presets: Array = []

    func flush_current():
        if current.index != -1:
            if current.export_path == "": current.issues.append("Missing export_path")
            if current.options.has("application/icon"):
                var icon_path = str(current.options["application/icon"])
                if icon_path != "" and not icon_path.begins_with("res://"): icon_path = "res://" + icon_path
                if icon_path != "" and not FileAccess.file_exists(icon_path): current.issues.append("Icon path missing: " + icon_path)
            var plat = current.platform.to_lower()
            if plat == "android":
                var key_fields = ["keystore/release", "keystore/release_user", "keystore/release_password"]
                for k in key_fields:
                    if not current.options.has(k) or str(current.options[k]).strip_edges() == "": current.warnings.append("Android signing field missing or empty: " + k)
                if "C#" in project_features and not current.options.has("dotnet/include_scripts"): current.warnings.append("C# project: consider enabling dotnet/include_scripts for Android preset")
            elif plat.find("windows") != -1:
                if not current.export_path.ends_with(".exe"): current.warnings.append("Windows export_path should usually end with .exe")
            elif plat.find("mac") != -1 or plat.find("osx") != -1:
                if not current.export_path.ends_with(".zip") and not current.export_path.ends_with(".dmg") and current.export_path.find(".app") == -1: current.warnings.append("macOS export usually produces .zip/.dmg or .app bundle")
            elif plat.find("linux") != -1:
                if current.export_path == "" or current.export_path.get_file().find(".") != -1: current.warnings.append("Linux export typically has no extension (binary)")
            if "C#" not in project_features:
                for key in current.options.keys():
                    if str(key).begins_with("dotnet/"): current.issues.append("Preset has dotnet options but project lacks 'C#' feature flag"); break
            presets.append(current.duplicate(true))

    var section_re = RegEx.new(); section_re.compile("^\\[preset\\.(\\d+)\\]")
    var option_re = RegEx.new(); option_re.compile("^([A-Za-z0-9_\\./]+)=\"?(.*)\"?")

    for l in lines:
        l = l.strip_edges(); if l == "" or l.begins_with("#"): continue
        var sm = section_re.search(l)
        if sm:
            flush_current()
            current = {"index": int(sm.get_string(1)), "name": "", "platform": "", "export_path": "", "options": {}, "issues": [], "warnings": []}
            continue
        if l.begins_with("[preset."): continue
        var om = option_re.search(l)
        if om:
            var key = om.get_string(1)
            var raw_val = om.get_string(2)
            if raw_val.begins_with("\"") and raw_val.ends_with("\""): raw_val = raw_val.substr(1, raw_val.length()-2)
            match key:
                "name": current.name = raw_val
                "platform": current.platform = raw_val
                "export_path": current.export_path = raw_val
                _:
                    current.options[key] = raw_val

    flush_current()

    var issues_total = 0
    var warnings_total = 0
    for p in presets:
        issues_total += p.issues.size(); warnings_total += p.warnings.size()

    var report = {"presets": presets, "project_features": project_features, "summary": {"has_export_presets": true, "preset_count": presets.size(), "issues_total": issues_total, "warnings_total": warnings_total, "duration_ms": Time.get_ticks_msec() - start}, "engine_version": Engine.get_version_info()}
    print(JSON.stringify(report))
