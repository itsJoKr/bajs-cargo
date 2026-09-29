#!/usr/bin/env python3
"""Emits a Claude-in-Chrome browser_batch action list that captures facade
shots, and files the screenshots it saved.

    python3 tool/sv_batch.py emit TAB i j k      # print the batch JSON
    python3 tool/sv_batch.py file i j k          # copy the newest screenshots
                                                 # to .art/streetview/shots/<id>.jpg

The work list is .art/streetview/square_todo.json unless SV_TODO names
another (e.g. SV_TODO=.art/streetview/stedionica_todo.json).
"""
import glob, json, os, shutil, sys

TODO = os.environ.get("SV_TODO", ".art/streetview/square_todo.json")
SHOTS_DIR = glob.glob("/var/folders/*/*/T/claude-chrome-screenshots-*")
todo = json.load(open(TODO))
cmd = sys.argv[1]
if cmd == "emit":
    tab = int(sys.argv[2])
    actions = []
    for i in map(int, sys.argv[3:]):
        actions += [
            {"name": "navigate", "input": {"url": todo[i]["shot"]["url"], "tabId": tab}},
            {"name": "computer", "input": {"action": "wait", "duration": 10, "tabId": tab}},
            {"name": "computer", "input": {"action": "screenshot", "tabId": tab,
                                           "save_to_disk": True, "scale": 1}},
        ]
    print(json.dumps(actions))
else:
    ids = list(map(int, sys.argv[2:]))
    files = sorted(
        (f for d in SHOTS_DIR for f in glob.glob(d + "/*.jpg")),
        key=os.path.getmtime,
    )[-len(ids):]
    os.makedirs(".art/streetview/shots", exist_ok=True)
    for i, f in zip(ids, files):
        dst = f".art/streetview/shots/{todo[i]['id']}.jpg"
        shutil.copy(f, dst)
        todo[i]["shot"]["file"] = dst
        print(i, "->", dst)
    json.dump(todo, open(TODO, "w"), indent=1)
