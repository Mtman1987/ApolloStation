import bpy, math, os, sys
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
if len(args) != 2:
    raise SystemExit("Usage: blender --background --python script.py -- input.glb output_dir")
source, out_dir = args
os.makedirs(out_dir, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("GLB imported but contains no mesh objects")

# Calculate world-space bounds while preserving imported materials/textures.
points = []
for obj in meshes:
    for corner in obj.bound_box:
        points.append(obj.matrix_world @ Vector(corner))
mins = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
maxs = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
height = maxs.z - mins.z
if height <= 0:
    raise SystemExit("Could not determine avatar dimensions")

# Focus on the upper/head region of the actual avatar; enough torso is retained
# to provide context while keeping the head large in frame.
target = Vector(((mins.x+maxs.x)/2, (mins.y+maxs.y)/2, maxs.z - height*0.115))
radius = max(maxs.x-mins.x, maxs.y-mins.y, height*0.24) * 1.65

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "BLENDER_EEVEE_NEXT") else "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.image_settings.color_mode = "RGBA"
scene.world.color = (0.08, 0.08, 0.08)
scene.view_settings.view_transform = "Standard"
scene.render.image_settings.color_depth = "8"

# Neutral studio lighting; original avatar materials remain untouched.
def area_light(name, location, energy, size):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj

area_light("Key", (target.x+3, target.y-4, target.z+4), 900, 4)
area_light("Fill", (target.x-4, target.y-2, target.z+1), 650, 4)
area_light("Rim", (target.x, target.y+4, target.z+3), 1000, 3)

cam_data = bpy.data.cameras.new("ReferenceCamera")
cam = bpy.data.objects.new("ReferenceCamera", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.lens = 55
cam_data.sensor_width = 36

# Ten actual model renders, orbiting around the avatar's head.
# Blender glTF avatars generally face -Y; orbit angle zero looks toward the front.
for i in range(10):
    angle = 2*math.pi*i/10
    cam.location = Vector((target.x + radius*math.sin(angle), target.y - radius*math.cos(angle), target.z + height*0.035))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out_dir, f"{i+1:02d}-head-view-{i*36:03d}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath)

print("Completed 10 renders from source GLB:", source)
