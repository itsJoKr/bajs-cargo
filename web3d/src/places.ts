// The name of where the car is, from the sample points tool/export_web.dart
// writes: squares and parks win over the streets that cross them.

type Sample = [number, number, string, number];

class Places {
  private samples: Sample[] = [];

  async load(url: string) {
    const data = (await fetch(url).then((r) => r.json())) as { names: Sample[] };
    this.samples = data.names;
  }

  nearest(x: number, z: number): string {
    let best = '';
    let bestD = 22 * 22;
    for (const [sx, sz, name, area] of this.samples) {
      // An area sample counts as a little closer, so the square's name holds
      // across the streets that run through it.
      const d = (sx - x) ** 2 + (sz - z) ** 2 - (area ? 60 : 0);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }
}

export const places = new Places();
