# Module: Audio Bus Layout Audit
# Provides function audio_bus_layout_audit(params: Dictionary) -> void
# Extracted from monolithic godot_operations.gd for modularity.

func audio_bus_layout_audit(params: Dictionary) -> void:
    var start = Time.get_ticks_msec()
    var layout_path := ProjectSettings.globalize_path("res://default_bus_layout.tres")
    if not FileAccess.file_exists(layout_path):
        var missing = {
            "buses": [],
            "global": {"issues": ["default_bus_layout.tres not found"], "warnings": []},
            "summary": {"has_layout": false, "issues_total": 1, "warnings_total": 0, "duration_ms": Time.get_ticks_msec() - start},
            "engine_version": Engine.get_version_info()
        }
        print(JSON.stringify(missing))
        return

    var text = FileAccess.get_file_as_string(layout_path)
    if text.strip_edges() == "":
        var empty = {
            "buses": [],
            "global": {"issues": ["default_bus_layout.tres is empty"], "warnings": []},
            "summary": {"has_layout": true, "issues_total": 1, "warnings_total": 0, "duration_ms": Time.get_ticks_msec() - start},
            "engine_version": Engine.get_version_info()
        }
        print(JSON.stringify(empty))
        return

    var lines = text.split("\n")
    var bus_data := {} # index -> { name, volume_db, send, bypass_fx, effects: [], issues:[], warnings:[] }
    var name_to_index := {}
    var effect_re = RegEx.new(); effect_re.compile("^bus\\/(\\d+)\\/effects\\/(\\d+)\\/effect=")
    var effect_enabled_re = RegEx.new(); effect_enabled_re.compile("^bus\\/(\\d+)\\/effects\\/(\\d+)\\/enabled=(.*)")
    var name_re = RegEx.new(); name_re.compile("^bus\\/(\\d+)\\/name=\"(.*)\"")
    var vol_re = RegEx.new(); vol_re.compile("^bus\\/(\\d+)\\/volume_db=([-0-9\\.]+)")
    var send_re = RegEx.new(); send_re.compile("^bus\\/(\\d+)\\/send=\"(.*)\"")
    var bypass_re = RegEx.new(); bypass_re.compile("^bus\\/(\\d+)\\/bypass_fx=(.*)")

    for l in lines:
        l = l.strip_edges()
        if l == "": continue
        var m = name_re.search(l)
        if m:
            var idx = int(m.get_string(1))
            var nm = m.get_string(2)
            if not bus_data.has(idx):
                bus_data[idx] = {"name": nm, "volume_db": 0.0, "send": "", "bypass_fx": false, "effects": [], "issues": [], "warnings": []}
            else:
                bus_data[idx].name = nm
            name_to_index[nm] = idx
            continue
        m = vol_re.search(l)
        if m:
            var idx2 = int(m.get_string(1))
            if not bus_data.has(idx2):
                bus_data[idx2] = {"name": "", "volume_db": 0.0, "send": "", "bypass_fx": false, "effects": [], "issues": [], "warnings": []}
            bus_data[idx2].volume_db = float(m.get_string(2))
            continue
        m = send_re.search(l)
        if m:
            var idx3 = int(m.get_string(1))
            if not bus_data.has(idx3):
                bus_data[idx3] = {"name": "", "volume_db": 0.0, "send": "", "bypass_fx": false, "effects": [], "issues": [], "warnings": []}
            bus_data[idx3].send = m.get_string(2)
            continue
        m = bypass_re.search(l)
        if m:
            var idx4 = int(m.get_string(1))
            if not bus_data.has(idx4):
                bus_data[idx4] = {"name": "", "volume_db": 0.0, "send": "", "bypass_fx": false, "effects": [], "issues": [], "warnings": []}
            bus_data[idx4].bypass_fx = (m.get_string(2).to_lower() == "true")
            continue
        m = effect_re.search(l)
        if m:
            var idx5 = int(m.get_string(1))
            var eidx = int(m.get_string(2))
            if not bus_data.has(idx5):
                bus_data[idx5] = {"name": "", "volume_db": 0.0, "send": "", "bypass_fx": false, "effects": [], "issues": [], "warnings": []}
            bus_data[idx5].effects.append({"index": eidx, "path": l.substr(l.find("=") + 1).strip_edges().trim_prefix("\"").trim_suffix("\""), "enabled": true})
            continue
        m = effect_enabled_re.search(l)
        if m:
            var idx6 = int(m.get_string(1))
            var eidx2 = int(m.get_string(2))
            var enabled_val = m.get_string(3).strip_edges().to_lower() == "true"
            if bus_data.has(idx6):
                for eff in bus_data[idx6].effects:
                    if eff.index == eidx2:
                        eff.enabled = enabled_val
                        break

    var indices: Array = []
    for k in bus_data.keys(): indices.append(k)
    indices.sort()
    var buses: Array = []
    for i in indices:
        buses.append(bus_data[i])

    var referenced := {}
    for b in buses:
        if b.send != "":
            referenced[b.send] = referenced.get(b.send, 0) + 1

    var recommended = ["Music", "SFX", "UI"]
    var global_issues: Array = []
    var global_warnings: Array = []

    if buses.size() == 0:
        global_issues.append("No buses parsed from layout (unexpected format)")
    elif buses.size() == 1 and buses[0].name == "Master":
        global_warnings.append("Only Master bus present; consider adding category buses (Music, SFX, UI)")

    var existing_names := []
    for b in buses: existing_names.append(b.name)
    for rec in recommended:
        if rec not in existing_names:
            global_warnings.append("Recommended bus missing: " + rec)

    for b in buses:
        if b.volume_db > 0.0:
            b.warnings.append("Positive gain (" + str(b.volume_db) + " dB) may cause clipping")
        if b.send != "" and b.send not in existing_names:
            b.issues.append("Send target not found: " + b.send)
        if b.send == b.name and b.name != "":
            b.issues.append("Bus sends to itself")
        if b.name != "Master" and referenced.get(b.name, 0) == 0 and b.effects.size() == 0:
            b.warnings.append("Orphan bus (never referenced, no effects)")
        var disabled_effects = 0
        for eff in b.effects:
            if not eff.enabled:
                disabled_effects += 1
        if disabled_effects > 0:
            b.warnings.append(str(disabled_effects) + " disabled effect(s) present")
        if b.bypass_fx and b.effects.size() > 0:
            b.warnings.append("bypass_fx=true disables all effects")

    var issues_total = 0
    var warnings_total = 0
    for b in buses:
        issues_total += b.issues.size()
        warnings_total += b.warnings.size()
    issues_total += global_issues.size()
    warnings_total += global_warnings.size()

    var report = {
        "buses": buses,
        "global": {"issues": global_issues, "warnings": global_warnings},
        "summary": {
            "has_layout": true,
            "bus_count": buses.size(),
            "issues_total": issues_total,
            "warnings_total": warnings_total,
            "duration_ms": Time.get_ticks_msec() - start
        },
        "engine_version": Engine.get_version_info()
    }
    print(JSON.stringify(report))
