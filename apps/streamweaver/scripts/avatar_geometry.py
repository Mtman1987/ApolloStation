"""Deterministic Meshy hair separation, KeenTools view rendering, and body assembly.

Run only through Blender: blender --background --factory-startup --python avatar_geometry.py -- ...
"""
import bpy, json, math, os, sys
from mathutils import Vector

def args():
    marker=sys.argv.index("--")
    return sys.argv[marker+1:]

def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

def import_glb(path):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [obj for obj in bpy.data.objects if obj not in before]

def meshes(objects): return [obj for obj in objects if obj.type=="MESH"]
def semantic(obj): return " ".join([obj.name]+[slot.material.name for slot in obj.material_slots if slot.material]).lower()

def bounds(objects):
    points=[obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points: raise RuntimeError("No mesh bounds were available")
    low=Vector((min(p.x for p in points),min(p.y for p in points),min(p.z for p in points)))
    high=Vector((max(p.x for p in points),max(p.y for p in points),max(p.z for p in points)))
    return low,high

def vector(value): return [round(float(item),7) for item in value]

def export_selected(path,objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.export_scene.gltf(filepath=path,export_format="GLB",use_selection=True,export_apply=False)

def separate_mesh_parts(objects):
    # Meshy may encode detachable printing parts as materials or loose islands inside one object.
    for obj in list(objects):
        if obj.type!="MESH": continue
        bpy.ops.object.select_all(action="DESELECT");obj.select_set(True);bpy.context.view_layer.objects.active=obj
        bpy.ops.object.mode_set(mode="EDIT")
        if len(obj.material_slots)>1:bpy.ops.mesh.separate(type="MATERIAL")
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.context.scene.objects):
        if obj.type!="MESH": continue
        bpy.ops.object.select_all(action="DESELECT");obj.select_set(True);bpy.context.view_layer.objects.active=obj
        bpy.ops.object.mode_set(mode="EDIT");bpy.ops.mesh.separate(type="LOOSE");bpy.ops.object.mode_set(mode="OBJECT")
    return list(bpy.context.scene.objects)

def prepare(source,hair_path,views_dir,report_path):
    clear(); imported=separate_mesh_parts(import_glb(source));all_meshes=meshes(imported)
    hair=[obj for obj in all_meshes if any(word in semantic(obj) for word in ("hair","bang","braid","ponytail","fringe"))]
    if not hair: raise RuntimeError("Meshy model did not expose a separately named hair object or material")
    head=[obj for obj in all_meshes if obj not in hair]
    if not head: raise RuntimeError("Meshy model did not expose a hairless head mesh")
    hair_low,hair_high=bounds(hair);head_low,head_high=bounds(head)
    export_selected(hair_path,hair)
    for obj in hair: obj.hide_render=True
    os.makedirs(views_dir,exist_ok=True)
    scene=bpy.context.scene
    scene.render.engine="BLENDER_EEVEE_NEXT"
    scene.render.resolution_x=1024;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG";scene.render.film_transparent=True
    world=bpy.data.worlds.new("AvatarWorld") if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world=world;world.color=(0.04,0.04,0.04)
    center=(head_low+head_high)/2;extent=max((head_high-head_low).length,0.1)
    camera_data=bpy.data.cameras.new("AvatarCamera");camera=bpy.data.objects.new("AvatarCamera",camera_data);scene.collection.objects.link(camera);scene.camera=camera;camera_data.lens=70
    for location,energy,size in [((4,-4,5),1300,5),((-4,-1,3),800,4),((0,3,1),600,3)]:
        data=bpy.data.lights.new("AvatarLight","AREA");data.energy=energy;data.shape="DISK";data.size=size;light=bpy.data.objects.new("AvatarLight",data);scene.collection.objects.link(light);light.location=center+Vector(location)*extent/5
    elevations=[0.0,0.08,-0.08,0.04,-0.04,0.0,0.08,-0.08,0.04,-0.04]
    for index,angle in enumerate([0,36,72,108,144,180,216,252,288,324]):
        radians=math.radians(angle);camera.location=center+Vector((math.sin(radians)*extent*1.45,-math.cos(radians)*extent*1.45,elevations[index]*extent))
        camera.rotation_euler=(center-camera.location).to_track_quat("-Z","Y").to_euler()
        scene.render.filepath=os.path.join(views_dir,f"view-{index:02d}.png");bpy.ops.render.render(write_still=True)
    with open(report_path,"w",encoding="utf8") as file: json.dump({"schemaVersion":1,"sourceHeadBounds":{"min":vector(head_low),"max":vector(head_high)},"sourceHairBounds":{"min":vector(hair_low),"max":vector(hair_high)},"viewAngles":[0,36,72,108,144,180,216,252,288,324]},file)

def transform_to_bounds(objects,source_low,source_high,target_low,target_high):
    source_size=source_high-source_low;target_size=target_high-target_low
    scale=min(target_size[i]/max(source_size[i],1e-6) for i in range(3))
    source_center=(source_low+source_high)/2;target_center=(target_low+target_high)/2
    for obj in objects:
        obj.scale*=scale
        obj.location=target_center+(obj.location-source_center)*scale
    bpy.context.view_layer.update()
    return scale

def armature(objects):
    result=next((obj for obj in objects if obj.type=="ARMATURE"),None)
    if not result: raise RuntimeError("Reusable body has no armature")
    return result

def body_head_bounds(body_meshes):
    points=[]
    for obj in body_meshes:
        group=obj.vertex_groups.get("Head")
        if not group: continue
        for vertex in obj.data.vertices:
            if any(item.group==group.index and item.weight>=0.35 for item in vertex.groups):points.append(obj.matrix_world@vertex.co)
    if not points: raise RuntimeError("Reusable body has no Head-weighted geometry")
    return Vector(tuple(min(p[i] for p in points) for i in range(3))),Vector(tuple(max(p[i] for p in points) for i in range(3)))

def remove_generic_head(body_meshes):
    for obj in body_meshes:
        group=obj.vertex_groups.get("Head")
        if not group: continue
        bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.mode_set(mode="EDIT");bpy.ops.mesh.select_all(action="DESELECT");bpy.ops.object.mode_set(mode="OBJECT")
        for vertex in obj.data.vertices: vertex.select=any(item.group==group.index and item.weight>=0.35 for item in vertex.groups)
        bpy.ops.object.mode_set(mode="EDIT");bpy.ops.mesh.delete(type="VERT");bpy.ops.object.mode_set(mode="OBJECT");obj.select_set(False)

def bind_to_head(objects,rig):
    for obj in objects:
        if obj.type!="MESH": continue
        group=obj.vertex_groups.get("Head") or obj.vertex_groups.new(name="Head")
        group.add([vertex.index for vertex in obj.data.vertices],1.0,"REPLACE")
        modifier=obj.modifiers.new(name="AvatarArmature",type="ARMATURE");modifier.object=rig

def add_hair_bones_and_weights(hair_objects,rig):
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode="EDIT")
    head=rig.data.edit_bones.get("Head")
    if not head: raise RuntimeError("Reusable body armature has no Head bone")
    root=rig.data.edit_bones.new("HairRoot");root.parent=head;root.head=head.head;root.tail=head.tail+Vector((0,0,max(head.length*.35,0.01)))
    children=[]
    for name,offset in [("HairFront",(0,-1,1)),("HairBack",(0,1,1)),("HairLeft",(-1,0,1)),("HairRight",(1,0,1))]:
        bone=rig.data.edit_bones.new(name);bone.parent=root;bone.use_connect=False;bone.head=root.tail;bone.tail=root.tail+Vector(offset).normalized()*max(head.length*.45,0.02);children.append(name)
    bpy.ops.object.mode_set(mode="OBJECT");rig.select_set(False)
    low,high=bounds(hair_objects);center=(low+high)/2
    for obj in hair_objects:
        groups={name:obj.vertex_groups.new(name=name) for name in ["HairRoot"]+children}
        for vertex in obj.data.vertices:
            world=obj.matrix_world@vertex.co;dx=(world.x-center.x)/max(high.x-low.x,1e-6);dy=(world.y-center.y)/max(high.y-low.y,1e-6);dz=(world.z-low.z)/max(high.z-low.z,1e-6)
            weights={"HairRoot":max(0.2,1-dz),"HairFront":max(0,-dy)*dz,"HairBack":max(0,dy)*dz,"HairLeft":max(0,-dx)*dz,"HairRight":max(0,dx)*dz};total=sum(weights.values()) or 1
            for name,weight in weights.items(): groups[name].add([vertex.index],weight/total,"REPLACE")
        modifier=obj.modifiers.new(name="HairArmature",type="ARMATURE");modifier.object=rig
    return ["HairRoot"]+children

def assemble(body_path,head_path,hair_path,alignment_path,output_path,report_path):
    clear();body_objects=import_glb(body_path);rig=armature(body_objects);body_meshes=meshes(body_objects);target_low,target_high=body_head_bounds(body_meshes);remove_generic_head(body_meshes)
    head_objects=import_glb(head_path);head_meshes=meshes(head_objects);hair_objects=meshes(import_glb(hair_path))
    with open(alignment_path,encoding="utf8") as file: alignment=json.load(file)
    source_low=Vector(alignment["sourceHeadBounds"]["min"]);source_high=Vector(alignment["sourceHeadBounds"]["max"]);keen_low,keen_high=bounds(head_meshes)
    transform_to_bounds(head_meshes,keen_low,keen_high,source_low,source_high)
    combined_low,combined_high=bounds(head_meshes+hair_objects);transform_to_bounds(head_meshes+hair_objects,combined_low,combined_high,target_low,target_high)
    bind_to_head(head_meshes,rig);hair_bones=add_hair_bones_and_weights(hair_objects,rig)
    blendshapes=len({block.name for obj in head_meshes if obj.data.shape_keys for block in obj.data.shape_keys.key_blocks if block.name!="Basis"})
    if blendshapes<51: raise RuntimeError(f"KeenTools head exposed only {blendshapes} blendshapes; 51 ARKit shapes are required")
    bpy.ops.object.select_all(action="SELECT");bpy.ops.export_scene.gltf(filepath=output_path,export_format="GLB",export_animations=True,export_morph=True,export_skins=True,export_apply=False)
    with open(report_path,"w",encoding="utf8") as file:json.dump({"headBone":"Head","hairBones":hair_bones,"blendshapeCount":blendshapes,"bodySkinPreserved":bool(rig and body_meshes)},file)

if __name__=="__main__":
    values=args()
    if values[0]=="prepare" and len(values)==5:prepare(*values[1:])
    elif values[0]=="assemble" and len(values)==7:assemble(*values[1:])
    else:raise RuntimeError("Use prepare <meshy.glb> <hair.glb> <views> <report> or assemble <body.glb> <head.glb> <hair.glb> <alignment> <output.glb> <report>")
