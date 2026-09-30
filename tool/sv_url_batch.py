#!/usr/bin/env python3
"""browser_batch actions for tool/sv_url.py shots (fov from the wall length),
then file the screenshots like tool/sv_batch.py.

    SV_TODO=todo.json python3 tool/sv_url_batch.py emit TAB D idx [idx...]
    SV_TODO=todo.json python3 tool/sv_url_batch.py file idx [idx...]

The urls are also stored in the todo entry (`shot.url`) so a shot can be
repeated.
"""
import glob, json, math, os, shutil, subprocess, sys

TODO = os.environ["SV_TODO"]
PITCH = os.environ.get("SV_PITCH", "20")
todo = json.load(open(TODO))
if sys.argv[1] == "emit":
    tab, d = int(sys.argv[2]), float(sys.argv[3])
    actions = []
    for i in map(int, sys.argv[4:]):
        f = todo[i]
        fov = max(40, min(100, round(math.degrees(2 * math.atan(0.62 * f["length"] / d)))))
        url = subprocess.check_output(
            ["python3", "tool/sv_url.py", TODO, str(i), str(d), str(fov), str(PITCH)], text=True).strip()
        f["shot"] = {"url": url, "fov": fov, "d": d}
        actions += [
            {"name": "navigate", "input": {"url": url, "tabId": tab}},
            {"name": "computer", "input": {"action": "wait", "duration": 10, "tabId": tab}},
            {"name": "computer", "input": {"action": "wait", "duration": 6, "tabId": tab}},
            {"name": "computer", "input": {"action": "screenshot", "tabId": tab,
                                           "save_to_disk": True, "scale": 1}},
        ]
    json.dump(todo, open(TODO, "w"), indent=1)
    print(json.dumps(actions))
else:
    ids = list(map(int, sys.argv[2:]))
    dirs = glob.glob("/var/folders/*/*/T/claude-chrome-screenshots-*")
    files = sorted((f for d in dirs for f in glob.glob(d + "/*.jpg")), key=os.path.getmtime)[-len(ids):]
    os.makedirs(".art/streetview/shots", exist_ok=True)
    for i, f in zip(ids, files):
        dst = f".art/streetview/shots/{todo[i]['id']}.jpg"
        shutil.copy(f, dst)
        todo[i].setdefault("shot", {})["file"] = dst
        print(i, "->", dst)
    json.dump(todo, open(TODO, "w"), indent=1)
