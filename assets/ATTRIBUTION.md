# Asset attribution

The car model is listed in `web3d/ATTRIBUTION.md`.

## Map data

City geometry is derived from OpenStreetMap data, © OpenStreetMap
contributors, available under the Open Database License (ODbL 1.0):
https://www.openstreetmap.org/copyright

## Hero facades

`textures/hero_atlas.png`: the real facades around Trg bana Jelačića,
redrawn as straight-on elevations by an image model (gen-image, OpenAI
gpt-image) from Google Street View screenshots taken in a browser
(imagery © Google, panoramas listed per facade in `data/hero/square.json`).
The screenshots themselves are not distributed. Check Google's Maps/Street
View terms before publishing this atlas beyond personal use.

## Terrain

`data/terrain/`: derived from Copernicus GLO-30 (© DLR e.V. 2010-2014 and
© Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the
European Union and ESA; all rights reserved), filtered to ground by
`tool/prepare_terrain.py`.

## Roof set

`textures/roof_atlas.png`: generated with gen-image (OpenAI gpt-image);
prompts in `tool/gen_textures.sh`.
