# Bajs Cargo (formerly Zagreb Drive)

A free-roam driving game in a recognisable 3D model of central Zagreb:
three.js and Rapier in the browser, the city baked from OpenStreetMap,
Copernicus terrain and Google Street View facades.

```sh
cd web3d && npm install && npm run dev   # http://localhost:5180/
```

W/↑ gas · S/↓ brake and reverse · A/D steer · Space handbrake · R reset ·
0 back to the start · O ambient occlusion.

See `AGENTS.md` for the layout, the city pipeline and how buildings are
recreated. The original Flutter app is in the git history (commit `6d27cdb`).

Licence: MIT for the code and hand-written data; map data (ODbL), terrain, facade
images, models and sounds keep their own terms, see `NOTICE`.
