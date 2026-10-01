# Missing businesses

Businesses that look worth having as delivery destinations (`data/deliveries.json`)
but are missing a readable sign or a proper facade texture, so they have no pad
yet. Add the sign or facade (see the `recreate-building` skill), then add an
entry to `data/deliveries.json`, and remove the line here.

## How this list was made (and what it does not cover)

- **Delivered so far:** every business whose name is lettered on a hero facade
  (`data/hero/*.json` `look` text, checked on `.art/facades/<name>/raw.png`),
  plus the Calliope / Farmacia / Müller / Oktogon / Cathedral / Nadbiskupija /
  Mondiš set. Entries whose door is a guess carry a `note` in the data file.
- **This list:** named shops, cafés, museums, hotels and offices in the OSM
  snapshot (`data/osm/`) inside the playable extent, that no delivery covers,
  sorted by what their nearest wall has today. The OSM snapshot is thin (68 such
  POIs), so this is a starting list, not the full Google Maps inventory. Google
  Maps was only checked for Pod zidom 3 (Mondiš) so far; a street-by-street pass
  over Maps for the rest is still to do.
- Statues and other `tourism=artwork` points are left out on purpose.

## A. Shops on filler or invented walls (need a real facade)

| Business | Address | Wall | Notes |
| --- | --- | --- | --- |
| Slastičarnica Vincek | Ilica 18 | `w338686824_e4` | famous ice-cream café, filler texture |
| Springfield | Ilica 16 | `w585938445_e3` | `inv_w585938445_e4` is invented next door |
| Mango | Ilica 20 | `w97089769_e0` | filler |
| Adidas | Bogovićeva 1a | `w435116996_e4` | invented wall |
| Glas Koncila | Kaptol (shop, Wikidata Q489650) | `w289908870_e2` | filler |
| Florists: Imortelle, Monsterra, Biorine, Cvjećarnica Ankica, Cvijet Benjamin, Cvjećarnica Perica | Britanski trg / Ilica end | `w338689073_e7`, `w435117001_e2`, `w512839703_e7` | flower market row, filler/invented |
| Main Square Hostel | Pavla Radića side of the square | `w289863031_e6` | filler |
| Tržnica Dolac | Dolac 2 | `w735337390_e7` | plain wall; the market hall front is invented (`podzidom_dolac_*`) |
| Nacionalni muzej moderne umjetnosti | Ilica 5 | `w579294793_e2` | 23 m from the wall; the Oktogon shares the address |
| Muzej novca Moneterra | Augusta Cesarca 10 | `w101186069_e18` | filler |
| Tortureum, muzej torture | Pavla Radića 14 | `w289863009_e5` | filler |
| Svijet gljiva | Trg bana Jelačića 3 | `w105484833_e8` | invented |
| Vrhovni sud Republike Hrvatske | Trg Nikole Zrinskog 3 | `w137106329_e0` | invented |
| Embassies (Netherlands, Switzerland) | Augusta Cesarca 6 / 10 | `w101186069_e19`, `_e16` | filler; low priority |

## B. Real facade, but the sign or shop is not on it

| Business | Address | Wall | Notes |
| --- | --- | --- | --- |
| Hotel Dubrovnik | Gajeva 1 | `w97235396_e1` | facade exists, hotel lettering missing |
| Hrvatski športski muzej | Praška 2 | `w97235397_e1` | museum plaque / sign |
| Arheološki muzej | Trg Nikole Zrinskog 19 | `w137106310_e0` | museum sign |
| Županijski sud u Zagrebu | Trg Nikole Zrinskog 5 | `w390984160_e8` | |
| Turistička zajednica grada Zagreba | Kaptol 5 | `w290024699_e10` | shares the Kaptolska klet facade |
| Tisak kiosk | near the square | `w584464569_e1` | kiosk, ~10 m from the wall |
| Hostel Centar | Vlaška | `w289863017_e0` | Babushka shopfront is done, hostel door is not |
| Muzej blaženog Alojzija Stepinca | Kaptol 31 | none | outside the wall set |
| HaHa House, muzej smijeha | Gajeva 71/1 | none | outside the wall set |

## C. From the facade pictures: named in a `look` but no usable door

- VIP Travel (`amrus_s860`): only a projecting blade sign.
- Kavana, Đorđićeva (`djordjic_n149`): faded lettering, shop closed in the photo.
- Havana, Petrinjska (`petrinjska_havana_a/b`): ghost lettering, probably disused.
- Souvenirs shops (Tkalčićeva, Bakačeva): generic sign, no name.
- Cappy / Römerquelle / Coca-Cola awnings: drinks brands, not shops; the café under
  them has no name on the picture (Tkalčićeva 27, 28).
- Splavnica (`popovic_splavnica`): the name is not on the picture.
- Prodavaonica Pod zidom: not on any sign; Google Maps has **Mondiš** (shoe shop)
  at Pod zidom 3, which is what the facade shows, so the delivery is called Mondiš.
  Also on Maps: **Pod Zidom Bistro** (Pod zidom 5), THE HERB gift shop (Pod zidom 3).
  Neither is on the facade yet.

## D. Door positions to verify in the game

Entries with a `note` in `data/deliveries.json` that say "guess" or "window centre":
HPB, Konzum, Croatian Naive Art gallery, Optika Anda, Vitrum, Zaks, Home by Ciss,
Barefoot Shoes, Karlovačka banka, Visitor Center, Suveniri Zagreb - Širok, Obzor
putovanja, Furla, Pandora, Swarovski, Mephisto, Q Store, Pinsider, Vaudoom, Lapis
Art, L'Erbolario, Panasonic, Videntis, Schwarzkopf Professional, Elfs, Poliklinika
Amruševa, Jadran Zagreb. Zagrebačka nadbiskupija is the rear entrance on the palace's east
front, outside the Cathedral walls (the Google Maps pin); the precinct inside the walls is fenced off.

## E. Outside the playable extent (removed from deliveries)

Home by Ciss and Elfs (Palmotićeva) are past the east edge of the map (x > 341); they came back from the facade
list but cannot be reached. `deliveries.ts` now skips any entry outside `extent` or inside `blocked`.
