# Module: physics_layer_audit.gd
# Audits physics body/area collision layers & masks across .tscn files.

func physics_layer_audit(params: Dictionary) -> void:
    var start = Time.get_ticks_msec()
    var root_dir = ProjectSettings.globalize_path("res://")
    var include_exts: Array = ["tscn"]
    var files: Array[String] = []
    _gather_files_recursive(root_dir, files, include_exts)

    var bodies: Array = []
    var layer_usage := {}
    var mask_usage := {}

    func bits_of(val: int) -> Array[int]:
        var out: Array[int] = []
        for i in range(32): if val & (1 << i): out.append(i)
        return out

    for f in files:
        if not f.ends_with(".tscn"): continue
        var text = FileAccess.get_file_as_string(f)
        if text.is_empty(): continue
        var rel = f.replace(root_dir, "res://")
        var lines = text.split("\n")
        var current_type = ""
        var in_node = false
        var collision_layer_val = null
        var collision_mask_val = null
        for l in lines:
            var line = l.strip_edges()
            if line.begins_with("[node"):
                if in_node and current_type != "" and (collision_layer_val != null or collision_mask_val != null):
                    var layer_i = collision_layer_val if collision_layer_val != null else 1
                    var mask_i = collision_mask_val if collision_mask_val != null else 1
                    bodies.append({"scene": rel, "type": current_type, "layer": layer_i, "mask": mask_i, "issues": []})
                in_node = true
                collision_layer_val = null
                collision_mask_val = null
                current_type = ""
                var t_idx = line.find("type=")
                if t_idx != -1:
                    var start_q = line.find("\"", t_idx)
                    if start_q != -1:
                        var end_q = line.find("\"", start_q+1)
                        if end_q != -1: current_type = line.substr(start_q+1, end_q - start_q -1)
                continue
            elif in_node:
                if line.begins_with("collision_layer") and line.find("=") != -1:
                    collision_layer_val = int(line.substr(line.find("=")+1).strip_edges())
                elif line.begins_with("collision_mask") and line.find("=") != -1:
                    collision_mask_val = int(line.substr(line.find("=")+1).strip_edges())
        if in_node and current_type != "" and (collision_layer_val != null or collision_mask_val != null):
            var layer_i2 = collision_layer_val if collision_layer_val != null else 1
            var mask_i2 = collision_mask_val if collision_mask_val != null else 1
            bodies.append({"scene": rel, "type": current_type, "layer": layer_i2, "mask": mask_i2, "issues": []})

    for b in bodies:
        var layer_bits = bits_of(b.layer)
        var mask_bits = bits_of(b.mask)
        if b.layer == 0: b.issues.append("collision_layer is 0 (will not be detected)")
        if b.mask == 0: b.issues.append("collision_mask is 0 (will detect nothing)")
        if b.layer == b.mask and layer_bits.size() == 1: b.issues.append("Layer == Mask single-bit; may be redundant if self-collision unwanted")
        if layer_bits.size() > 8: b.issues.append("More than 8 layer bits set; consider simplifying")
        for bit in layer_bits: layer_usage[bit] = layer_usage.get(bit, 0) + 1
        for bit in mask_bits: mask_usage[bit] = mask_usage.get(bit, 0) + 1

    for b in bodies:
        var layer_bits2 = bits_of(b.layer)
        for bit in layer_bits2:
            var used = layer_usage.get(bit, 0)
            var masked = mask_usage.get(bit, 0)
            if used <= 1 and masked <= 1: b.issues.append("Layer bit " + str(bit) + " appears orphan (no other bodies reference it)")

    var issues_total = 0
    var bodies_with_issues = 0
    for b in bodies:
        if b.issues.size() > 0:
            bodies_with_issues += 1
            issues_total += b.issues.size()

    var report = {"bodies": bodies, "summary": {"scenes_scanned": files.size(), "bodies_found": bodies.size(), "bodies_with_issues": bodies_with_issues, "issues_total": issues_total, "duration_ms": Time.get_ticks_msec() - start}, "engine_version": Engine.get_version_info()}
    print(JSON.stringify(report))
