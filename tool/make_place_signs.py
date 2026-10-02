#!/usr/bin/env python3
"""Sign images for the delivery places (data/deliveries.json) that carry 3D signs in data/buildings.json:
blade signs, canopy fascias and lettering for awning valances, drawn flat with system fonts so every
name is spelled exactly. Colours and layouts follow the real signs (Google Maps / web photos, 2026-10-02,
references in .art/deliveries/ref/).

    .venv/bin/python tool/make_place_signs.py      # -> web3d/public/features/place_*.png
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web3d" / "public" / "features"
SYS = Path("/System/Library/Fonts")
SUP = SYS / "Supplemental"


def font(path: Path, size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size, index=index)


def fit(d: ImageDraw.ImageDraw, text: str, path: Path, width: float, size: int, index: int = 0):
    """The largest font up to [size] whose [text] is at most [width] px wide."""
    while size > 6:
        f = font(path, size, index)
        if d.textlength(text, font=f) <= width:
            return f
        size -= 1
    return font(path, size, index)


def board(w: int, h: int, fill, border=None, bw: int = 0, radius: int = 0) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=fill, outline=border, width=bw)
    return im, d


def save(im: Image.Image, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    im.save(OUT / name)
    print("wrote", name, im.size)


def submarine() -> None:
    # The round blade sign: a yellow disc in a black ring, SUBMARINE across it.
    s = 512
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([4, 4, s - 5, s - 5], fill=(24, 24, 24, 255))
    d.ellipse([34, 34, s - 35, s - 35], fill=(250, 204, 21, 255))
    f = fit(d, "SUBMARINE", SUP / "Arial Rounded Bold.ttf", s - 110, 120)
    d.text((s / 2, s / 2 - 18), "SUBMARINE", font=f, fill=(22, 22, 22, 255), anchor="mm")
    f2 = font(SUP / "Arial Rounded Bold.ttf", 34)
    d.text((s / 2, s / 2 + 52), "burger", font=f2, fill=(22, 22, 22, 255), anchor="mm")
    save(im, "place_submarine_round.png")


def lastruk() -> None:
    # Black hanging board, "La Štruk" in golden yellow, the strapline in white.
    im, d = board(660, 330, (20, 20, 20, 255), (60, 60, 60, 255), 6, 10)
    f = fit(d, "La Štruk", SYS / "Futura.ttc", 560, 150, 0)
    d.text((330, 140), "La Štruk", font=f, fill=(236, 190, 40, 255), anchor="mm")
    f2 = fit(d, "domaći štrukli | traditional croatian specialty", SYS / "Avenir Next.ttc", 560, 30, 0)
    d.text((330, 252), "domaći štrukli | traditional croatian specialty", font=f2, fill=(235, 235, 235, 255), anchor="mm")
    save(im, "place_lastruk_blade.png")


def vinodol() -> None:
    # The dark board over the gateway ("restoran" small, "vinodol" big, white) and the vertical blade.
    im, d = board(1000, 230, (46, 48, 50, 255), (150, 150, 150, 255), 5)
    d.text((500, 60), "restoran", font=font(SYS / "Avenir Next.ttc", 44, 1), fill=(240, 240, 240, 255), anchor="mm")
    d.text((500, 148), "vinodol", font=font(SYS / "Avenir Next.ttc", 120, 0), fill=(250, 250, 250, 255), anchor="mm")
    save(im, "place_vinodol_board.png")
    w, h = 260, 900
    im, d = board(w, h, (52, 54, 56, 255), (150, 150, 150, 255), 5)
    d.rectangle([0, 0, w - 1, 170], fill=(205, 32, 40, 255))
    txt = Image.new("RGBA", (700, 200), (0, 0, 0, 0))
    td = ImageDraw.Draw(txt)
    td.text((350, 100), "vinodol", font=font(SYS / "Avenir Next.ttc", 130, 0), fill=(250, 250, 250, 255), anchor="mm")
    txt = txt.rotate(90, expand=True)
    im.alpha_composite(txt, ((w - txt.width) // 2, 190))
    save(im, "place_vinodol_blade.png")


def dubrovnik() -> None:
    # The tall bronze blade on the corner of the old hotel building: HOTEL stacked upright, then
    # "dubrovnik" turned on its side, white.
    w, h = 240, 2160
    im, d = board(w, h, (122, 92, 58, 255), (70, 52, 34, 255), 8)
    f = font(SUP / "Georgia Bold.ttf", 150)
    for k, ch in enumerate("HOTEL"):
        d.text((w / 2, 110 + k * 168), ch, font=f, fill=(250, 248, 240, 255), anchor="mm")
    txt = Image.new("RGBA", (1300, 220), (0, 0, 0, 0))
    td = ImageDraw.Draw(txt)
    td.text((650, 110), "dubrovnik", font=fit(td, "dubrovnik", SUP / "Georgia.ttf", 1240, 190), fill=(250, 248, 240, 255), anchor="mm")
    txt = txt.rotate(-90, expand=True)
    im.alpha_composite(txt, ((w - txt.width) // 2, 900))
    save(im, "place_dubrovnik_blade.png")


def lettering(name: str, text: str, path: Path, size: int, color, index: int = 0, pad: int = 12) -> None:
    """Bare letters on transparency: printed on an awning valance."""
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    f = font(path, size, index)
    l, t, r, b = probe.textbbox((0, 0), text, font=f)
    im = Image.new("RGBA", (r - l + 2 * pad, b - t + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((pad - l, pad - t), text, font=f, fill=color)
    save(im, name)


def franck() -> None:
    # The black canopy fascia with copper script.
    im, d = board(1400, 200, (22, 22, 24, 255))
    d.rectangle([380, 30, 1020, 170], outline=(120, 74, 40, 255), width=3)
    f = fit(d, "Johann Franck", SUP / "Georgia Bold Italic.ttf", 600, 110)
    d.text((700, 100), "Johann Franck", font=f, fill=(200, 122, 62, 255), anchor="mm")
    save(im, "place_franck_fascia.png")


def capuciner() -> None:
    # The red hanging sign: PIZZA SPAGHETTERIA, CAPUCINER under it.
    im, d = board(520, 300, (176, 32, 30, 255), (40, 30, 26, 255), 8, 6)
    d.text((260, 92), "PIZZA", font=font(SUP / "Georgia Bold.ttf", 104), fill=(250, 236, 200, 255), anchor="mm")
    d.text((260, 182), "SPAGHETTERIA", font=fit(d, "SPAGHETTERIA", SUP / "Georgia Bold.ttf", 440, 54), fill=(250, 236, 200, 255), anchor="mm")
    d.text((260, 250), "CAPUCINER", font=font(SUP / "Georgia.ttf", 36), fill=(250, 236, 200, 255), anchor="mm")
    save(im, "place_capuciner_blade.png")


def main() -> None:
    submarine()
    lastruk()
    vinodol()
    dubrovnik()
    franck()
    capuciner()
    lettering("place_kozel_valance.png", "Kozel", SUP / "Georgia Bold.ttf", 120, (92, 62, 40, 255))
    lettering("place_nokturno_valance.png", "NOKTURNO", SUP / "AmericanTypewriter.ttc", 120, (44, 36, 30, 255))
    lettering("place_malimedo_valance.png", "Pivnica Mali Medo", SUP / "Georgia.ttf", 110, (70, 48, 32, 255))
    lettering("place_vincek_valance.png", "VINCEK", SUP / "Georgia Bold.ttf", 110, (150, 120, 70, 255))


if __name__ == "__main__":
    main()
