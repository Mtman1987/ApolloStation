"""Direct GLB rigging for StreamWeaver.

Input is the existing head/avatar GLB. This script imports that model directly,
preserves its existing meshes, textures, skinning, actions and morphs, then adds
a head/jaw/eye bone structure suitable for subsequent rig refinement. It does
not render views or reconstruct another head from photos.
"""
import bpy, json, os, sys
from mathutils import Vector

def args():
    marker = sys.argv.index("--")
    return sys.argv[marker + 1:]

def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [obj for obj in bpy.data.objects if obj not in before]

def meshes(objects):
    return [obj for obj in objects if obj.type == "MESH"]

def semantic(obj):
    return " ".join([obj.name] + [slot.material.name for slot in obj.material_slots if slot.material]).lower()

def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        raise RuntimeError("Uploaded GLB contains no mesh geometry")
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return low, high

def world_bone_point(rig, point):
    return rig.matrix_world @ point

def find_head_bone(rig):
    names = list(rig.data.bones)
    for bone in names:
        normalized = bone.name.lower().replace("mixamorig:", "").replace("mixamorig_", "")
        if normalized == "head" or normalized.endswith("_head"):
            return bone
    return None

def find_armature(objects):
    candidates = [obj for obj in objects if obj.type == "ARMATURE"]
    if not candidates:
        return None
    return max(candidates, key=lambda obj: len(obj.data.bones))

def create_armature(objects, low, high):
    """Create a minimal armature when the source mesh has no armature at all."""
    center = (low + high) / 2
    height = max(high.z - low.z, 0.01)
    data = bpy.data.armatures.new("StreamWeaverAvatarRig")
    rig = bpy.data.objects.new("StreamWeaverAvatarRig", data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    root = data.edit_bones.new("Root")
    root.head = Vector((center.x, center.y, low.z))
    root.tail = Vector((center.x, center.y, low.z + height * 0.15))
    head = data.edit_bones.new("Head")
    head.head = Vector((center.x, center.y, low.z + height * 0.12))
    head.tail = Vector((center.x, center.y, high.z - height * 0.08))
    head.parent = root
    head.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)
    return rig, head.name, True

def add_face_bones(rig, head_bone):
    """Add a jaw hinge and eye aim bones using the existing head bone as parent."""
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_head = rig.data.edit_bones.get(head_bone.name)
    if edit_head is None:
        raise RuntimeError("Could not access the head bone for facial rigging")
    head_world = world_bone_point(rig, edit_head.head)
    tail_world = world_bone_point(rig, edit_head.tail)
    head_height = max(abs(tail_world.z - head_world.z), edit_head.length, 0.01)
    pivot_world = Vector(((head_world.x + tail_world.x) / 2, (head_world.y + tail_world.y) / 2, min(head_world.z, tail_world.z) + head_height * 0.32))
    inverse = rig.matrix_world.inverted()
    jaw = rig.data.edit_bones.get("Jaw")
    if jaw is None:
        jaw = rig.data.edit_bones.new("Jaw")
        jaw.head = inverse @ pivot_world
        # Blender front is generally -Y. Use a short, visible hinge direction.
        jaw.tail = inverse @ (pivot_world + Vector((0, -head_height * 0.24, -head_height * 0.06)))
        jaw.parent = edit_head
        jaw.use_connect = False
    eye_z = min(head_world.z, tail_world.z) + head_height * 0.69
    for name, dx in (("LeftEye", -0.16), ("RightEye", 0.16)):
        eye = rig.data.edit_bones.get(name)
        if eye is None:
            eye = rig.data.edit_bones.new(name)
            eye.head = inverse @ Vector((pivot_world.x + dx * head_height, pivot_world.y - head_height * 0.12, eye_z))
            eye.tail = inverse @ Vector((pivot_world.x + dx * head_height, pivot_world.y - head_height * 0.22, eye_z))
            eye.parent = edit_head
            eye.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)
    return "Jaw", ["LeftEye", "RightEye"], pivot_world, head_height

def assign_new_rig(mesh_objects, rig, head_bone):
    """Attach previously unrigged meshes while retaining their geometry and materials."""
    for obj in mesh_objects:
        head = obj.vertex_groups.get(head_bone)
        if head is None:
            head = obj.vertex_groups.new(name=head_bone)
        indices = [vertex.index for vertex in obj.data.vertices]
        if indices:
            head.add(indices, 1.0, "REPLACE")
        if not any(mod.type == "ARMATURE" for mod in obj.modifiers):
            modifier = obj.modifiers.new(name="StreamWeaverAvatarRig", type="ARMATURE")
            modifier.object = rig

def head_region_meshes(mesh_objects, rig, head_bone, source_low, source_high, created_armature):
    # Named head/face meshes are the safest region to adjust. For a lone head
    # mesh with generic naming, a newly created single-bone rig makes all meshes
    # facial geometry. For a full humanoid rig, limit changes to geometry around
    # the head bone rather than reweighting the torso or legs.
    named = [obj for obj in mesh_objects if any(k in semantic(obj) for k in ("head", "face", "skull", "jaw"))]
    if named:
        return named
    if created_armature:
        return mesh_objects
    bone = rig.data.bones.get(head_bone)
    if bone is None:
        return []
    center = rig.matrix_world @ bone.head_local
    top = rig.matrix_world @ bone.tail_local
    low_z, high_z = sorted((center.z, top.z))
    height = max(high_z - low_z, (source_high.z - source_low.z) * 0.12, 0.01)
    result = []
    for obj in mesh_objects:
        obj_low, obj_high = bounds([obj])
        if obj_high.z >= low_z - height * 0.18 and obj_low.z <= high_z + height * 0.15:
            result.append(obj)
    return result

def weight_jaw(mesh_objects, rig, head_bone, pivot_world, head_height):
    jaw_group_count = 0
    for obj in mesh_objects:
        group = obj.vertex_groups.get("Jaw") or obj.vertex_groups.new(name="Jaw")
        head_group = obj.vertex_groups.get(head_bone)
        if head_group is None:
            head_group = obj.vertex_groups.new(name=head_bone)
            head_group.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")
        inverse = obj.matrix_world
        low, high = bounds([obj])
        # Split lower-face vertices progressively: the jaw rotates as a unit,
        # while a narrow transition helps avoid a hard seam at its upper edge.
        lower_jaw_z = pivot_world.z - head_height * 0.38
        upper_jaw_z = pivot_world.z + head_height * 0.05
        for vertex in obj.data.vertices:
            world = inverse @ vertex.co
            # The face mesh can be a whole-character mesh. Bound the weights
            # to the jaw-height band so torso/legs are never assigned to Jaw.
            if world.z < lower_jaw_z or world.z > upper_jaw_z:
                continue
            relative = (pivot_world.z - world.z) / max(head_height * 0.23, 0.001)
            weight = max(0.0, min(1.0, relative))
            if weight <= 0:
                continue
            # Existing head weight may be less than one on a skinned character.
            existing_head = 1.0
            try:
                for assignment in vertex.groups:
                    if assignment.group == head_group.index:
                        existing_head = assignment.weight
                        break
            except Exception:
                pass
            jaw_weight = max(0.0, min(1.0, existing_head * weight))
            if jaw_weight <= 0:
                continue
            group.add([vertex.index], jaw_weight, "REPLACE")
            head_group.add([vertex.index], max(0.0, existing_head - jaw_weight), "REPLACE")
            jaw_group_count += 1
    return jaw_group_count

def shape_key_count(mesh_objects):
    return len({key.name for obj in mesh_objects if obj.data.shape_keys for key in obj.data.shape_keys.key_blocks if key.name != "Basis"})

def action_count():
    return len(bpy.data.actions)

def export_glb(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_animations=True, export_morph=True, export_skins=True, export_apply=False)

def rig(source_path, output_path, report_path):
    clear()
    imported = import_glb(source_path)
    mesh_objects = meshes(imported)
    if not mesh_objects:
        raise RuntimeError("Uploaded GLB has no mesh objects to rig")
    source_low, source_high = bounds(mesh_objects)
    original_actions = action_count()
    rig = find_armature(imported)
    created_armature = False
    if rig is None:
        spans = source_high - source_low
        horizontal_span = max(spans.x, spans.y, 0.001)
        if spans.z > horizontal_span * 1.85:
            raise RuntimeError("This appears to be an unrigged full-body character. Upload a head-only GLB, or use the original rigged full-character GLB so body skinning and animations can be preserved.")
        rig, head_name, created_armature = create_armature(mesh_objects, source_low, source_high)
        assign_new_rig(mesh_objects, rig, head_name)
        head_bone = rig.data.bones.get(head_name)
    else:
        head_bone = find_head_bone(rig)
        if head_bone is None:
            # Re-use the existing skeleton instead of replacing it. Anchor a
            # head bone near the uppermost mesh region if no standard head name
            # exists; the original bones/animations remain untouched.
            low, high = bounds(mesh_objects)
            center = (low + high) / 2
            inverse = rig.matrix_world.inverted()
            bpy.context.view_layer.objects.active = rig
            rig.select_set(True)
            bpy.ops.object.mode_set(mode="EDIT")
            head = rig.data.edit_bones.new("Head")
            head.head = inverse @ Vector((center.x, center.y, low.z + (high.z-low.z)*0.72))
            head.tail = inverse @ Vector((center.x, center.y, high.z - (high.z-low.z)*0.08))
            existing = [bone for bone in rig.data.edit_bones if bone is not head]
            if existing:
                def distance_to_head(bone):
                    return min((bone.tail - head.head).length, (bone.head - head.head).length)
                head.parent = min(existing, key=distance_to_head)
            bpy.ops.object.mode_set(mode="OBJECT")
            rig.select_set(False)
            head_bone = rig.data.bones.get("Head")
    if head_bone is None:
        raise RuntimeError("Could not create or locate a head bone")
    jaw_name, eye_names, pivot_world, head_height = add_face_bones(rig, head_bone)
    target_meshes = head_region_meshes(mesh_objects, rig, head_bone.name, source_low, source_high, created_armature)
    if not target_meshes:
        raise RuntimeError("Could not identify head geometry to weight to the jaw")
    jaw_vertices = weight_jaw(target_meshes, rig, head_bone.name, pivot_world, head_height)
    if jaw_vertices < 1:
        raise RuntimeError("No vertices were weighted to the jaw; model scale or head-bone placement may be invalid")
    export_glb(output_path)
    # Verify that the GLB was actually exported and still contains geometry.
    if not os.path.isfile(output_path) or os.path.getsize(output_path) < 20:
        raise RuntimeError("Blender did not produce a valid rigged GLB")
    with open(report_path, "w", encoding="utf8") as file:
        json.dump({
            "headBone": head_bone.name,
            "jawBone": jaw_name,
            "eyeBones": eye_names,
            "jawWeightedVertices": jaw_vertices,
            "existingAnimationCount": original_actions,
            "blendshapeCount": shape_key_count(mesh_objects),
            "createdArmature": bool(created_armature),
            "skinPreserved": not created_armature,
        }, file)

if __name__ == "__main__":
    values = args()
    if values[0] == "rig" and len(values) == 3:
        rig(*values[1:])
    else:
        raise RuntimeError("Use rig <source.glb> <rigged.glb> <report.json>")
