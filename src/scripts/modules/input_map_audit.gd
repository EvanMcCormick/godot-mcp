# Module: input_map_audit.gd
# Audits Input Map configuration inside project.godot

func input_map_audit(params: Dictionary) -> void:
    var start = Time.get_ticks_msec()
    var project_file := ProjectSettings.globalize_path("res://project.godot")
    if not FileAccess.file_exists(project_file):
        var missing = {"actions": [], "summary": {"project_file_found": false, "issues_total": 1, "duration_ms": Time.get_ticks_msec() - start}, "issues": ["project.godot not found"], "engine_version": Engine.get_version_info()}
        print(JSON.stringify(missing)); return

    var text = FileAccess.get_file_as_string(project_file)
    var lines = text.split("\n")
    var actions: Array = []
    var current_action := ""
    var current_events: Array = []
    var in_input_section := false

    for raw_line in lines:
        var line = raw_line.strip_edges()
        if line.begins_with("[") and line.ends_with("]"):
            in_input_section = (line == "[input]"); continue
        if not in_input_section: continue
        if line == "": continue
        if line.find("=") != -1 and line.find("=") < line.find("{"):
            if current_action != "": actions.append({"name": current_action, "events": current_events.duplicate(), "issues": []})
            current_action = line.substr(0, line.find("=")).strip_edges()
            current_events = []
            var brace_idx = line.find("{")
            if brace_idx != -1:
                var inline_obj = line.substr(brace_idx)
                if inline_obj.find("events=") != -1:
                    var ev_start = inline_obj.find("events=") + 7
                    var slice = inline_obj.substr(ev_start)
                    var open_brackets = 0
                    var collecting = false
                    var buf = ""
                    for c in slice:
                        if c == '[':
                            open_brackets += 1; collecting = true
                        if collecting: buf += c
                        if c == ']':
                            open_brackets -= 1
                            if open_brackets == 0: break
                    buf = buf.strip_edges()
                    if buf.begins_with("[") and buf.ends_with("]"):
                        var inner = buf.substr(1, buf.length()-2)
                        var parts = inner.split("},")
                        for p in parts:
                            var frag = p
                            if not frag.ends_with("}"): frag += "}"
                            current_events.append(frag)
            continue
        else:
            if current_action != "" and line.find("deadzone") != -1:
                current_events.append(line)

    if current_action != "": actions.append({"name": current_action, "events": current_events.duplicate(), "issues": []})

    var name_counts := {}
    for a in actions: name_counts[a.name] = name_counts.get(a.name, 0) + 1
    for a in actions:
        if name_counts[a.name] > 1: a.issues.append("Duplicate action declaration")
        if a.events.size() == 0: a.issues.append("Action has no events bound")
        var seen := {}
        for ev in a.events:
            var key = ev
            if seen.has(key): a.issues.append("Duplicate input event: " + key)
            else: seen[key] = true
            if ev.find("device=0") != -1 and ev.find("physical_scancode") != -1: a.issues.append("Potential legacy keyboard scancode usage")
            if ev.find("hat") != -1: a.issues.append("Joystick 'hat' field present; verify mapping in 4.x")

    var issues_total = 0
    for a in actions: issues_total += a.issues.size()

    var report = {"actions": actions, "summary": {"action_count": actions.size(), "issues_total": issues_total, "duration_ms": Time.get_ticks_msec() - start}, "engine_version": Engine.get_version_info()}
    print(JSON.stringify(report))
