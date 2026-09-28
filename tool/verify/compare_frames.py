#!/usr/bin/env python3
"""Compares two captured frames, tolerating rasterization noise.

Byte-exact comparison does not work across app restarts. With the scene
settled, successive runs of the same pinned shot still differ by about a dozen
anti-aliased edge pixels at a maximum channel delta of 12 -- sub-pixel coverage
landing differently, not anything anyone could see. A real change moves
thousands of pixels by far more, so the two separate cleanly.

Pixels within NOISE_DELTA are ignored; more than NOISE_PIXELS beyond it means
the frame really moved. Exits 0 when the frames match, 78 when they differ.
"""
import struct
import sys
import zlib

NOISE_DELTA = 16
NOISE_PIXELS = 100


def decode(path):
    """Returns (width, height, RGBA bytes) for an 8-bit RGBA PNG."""
    data = open(path, "rb").read()
    pos, idat, width, height = 8, b"", 0, 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        if kind == b"IHDR":
            width, height = struct.unpack(">II", data[pos + 8:pos + 16])
        elif kind == b"IDAT":
            idat += data[pos + 8:pos + 8 + length]
        pos += 12 + length
    raw = zlib.decompress(idat)
    bpp, stride = 4, width * 4
    out = bytearray(height * stride)
    prev = bytearray(stride)
    read = 0
    for y in range(height):
        method = raw[read]
        read += 1
        line = bytearray(raw[read:read + stride])
        read += stride
        if method:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                up = prev[i]
                upleft = prev[i - bpp] if i >= bpp else 0
                if method == 1:
                    line[i] = (line[i] + left) & 255
                elif method == 2:
                    line[i] = (line[i] + up) & 255
                elif method == 3:
                    line[i] = (line[i] + (left + up) // 2) & 255
                else:
                    guess = left + up - upleft
                    dl, du, dul = (abs(guess - left), abs(guess - up),
                                   abs(guess - upleft))
                    if dl <= du and dl <= dul:
                        nearest = left
                    elif du <= dul:
                        nearest = up
                    else:
                        nearest = upleft
                    line[i] = (line[i] + nearest) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, out


def main():
    before, after = sys.argv[1], sys.argv[2]
    width, height, a = decode(before)
    width_b, height_b, b = decode(after)
    if (width, height) != (width_b, height_b):
        print(f"size changed: {width}x{height} -> {width_b}x{height_b}")
        return 78

    moved = 0
    noise = 0
    worst = 0
    box = None
    for i in range(0, len(a), 4):
        delta = max(abs(a[i] - b[i]), abs(a[i + 1] - b[i + 1]),
                    abs(a[i + 2] - b[i + 2]))
        if not delta:
            continue
        worst = max(worst, delta)
        if delta <= NOISE_DELTA:
            noise += 1
            continue
        moved += 1
        x, y = (i // 4) % width, (i // 4) // width
        if box is None:
            box = [x, y, x, y]
        else:
            box = [min(box[0], x), min(box[1], y),
                   max(box[2], x), max(box[3], y)]

    total = width * height
    print(f"{moved} pixels moved, {noise} within noise "
          f"(<= {NOISE_DELTA}), worst delta {worst}, of {total}")
    if moved <= NOISE_PIXELS:
        return 0
    print(f"changed region: x {box[0]}..{box[2]}, y {box[1]}..{box[3]}")
    return 78


if __name__ == "__main__":
    sys.exit(main())
