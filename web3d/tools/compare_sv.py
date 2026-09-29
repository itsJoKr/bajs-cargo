#!/usr/bin/env python3
"""Renders the web city from each Street View shot's camera and puts the
render under the photo, so wrong building shapes stand out.

    ../.venv/bin/python tools/compare_sv.py [--todo .art/streetview/X_todo.json] [wall id ...]

Reads the work list (default .art/streetview/square_todo.json; shot = pano,
heading, pitch, fov)
and panos.json, drives headless Chrome through tools/shot.mjs (the dev
server must be running on :5180) and writes
../artifacts/web/compare/<wall>.jpg.
"""
import json, math, os, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SV = os.path.join(ROOT, '.art', 'streetview')
OUT = os.path.join(ROOT, 'artifacts', 'web', 'compare')
TMP = os.path.join(OUT, 'renders')
os.makedirs(TMP, exist_ok=True)

lat0, lon0 = 45.81303, 15.97713
phi = math.radians(lat0)
mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)

argv = sys.argv[1:]
todo_path = os.path.join(SV, 'square_todo.json')
if '--todo' in argv:
    i = argv.index('--todo')
    todo_path = os.path.join(ROOT, argv[i + 1])
    argv = argv[:i] + argv[i + 2:]
todo = json.load(open(todo_path))
panos = {p['id']: p for p in json.load(open(os.path.join(SV, 'panos.json')))}
only = set(argv)

W, H = 1568, 718
steps = ['--eval', "document.getElementById('hud').style.display='none';"
         "zg.vehicle.body.setBodyType(2, true);"
         "zg.vehicle.body.setNextKinematicTranslation({x:0,y:-40,z:0});"
         "zg.vehicle.body.setTranslation({x:0,y:-40,z:0}, true); 'ok'",
         '--sleep', '500']
jobs = []
for f in todo:
    shot = f.get('shot')
    if not shot or (only and f['id'] not in only):
        continue
    photo = os.path.join(SV, 'shots', f['id'] + '.jpg')
    if not os.path.exists(photo):
        continue
    p = panos[shot['pano']]
    x = (p['lng'] - lon0) * mlon
    z = -(p['lat'] - lat0) * mlat
    # Official car cameras sit about 2.5 m up; photospheres are hand held.
    y = 1.7 if p.get('type') == 10 else 2.5
    h, t = math.radians(shot['heading']), math.radians(shot['pitch'])
    d = (math.sin(h) * math.cos(t), math.sin(t), -math.cos(h) * math.cos(t))
    focal = 450 / math.tan(math.radians(shot['fov']) / 2)
    vfov = math.degrees(2 * math.atan((H / 2) / focal))
    eye = [round(x, 2), y, round(z, 2)]
    target = [round(x + d[0] * 50, 2), round(y + d[1] * 50, 2), round(z + d[2] * 50, 2)]
    render = os.path.join(TMP, f['id'] + '.png')
    steps += ['--eval', f'zg.look({eye}, {target}, {vfov:.2f}); "{f["id"]}"', '--sleep', '700', '--shot', render]
    jobs.append((f, photo, render))

cmd = ['node', os.path.join(HERE, 'shot.mjs'), '--size', f'{W}x{H}', '--url', 'http://localhost:5180/'] + steps
subprocess.run(cmd, check=True, cwd=os.path.join(HERE, '..'))

for f, photo, render in jobs:
    a = Image.open(photo).convert('RGB')
    b = Image.open(render).convert('RGB').resize((W, H))
    out = Image.new('RGB', (W, H * 2))
    out.paste(a, (0, 0))
    out.paste(b, (0, H))
    path = os.path.join(OUT, f['id'] + '.jpg')
    out.resize((W // 2, H)).save(path, quality=85)
    print(f"{f['id']:16s} {f.get('name') or '':20s} {path}")
