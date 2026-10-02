# Delivery locations review (2026-10-02)

What `data/deliveries.json` should hold: places anyone from around the centre knows by name
(Mali Medo on Tkalčićeva, Hotel Dubrovnik on Gajeva, Vincek on Ilica). Not what a sign happens to say
(Stretto is Franck's coffee on a blade sign), not chains with a branch on every corner (photocopy shops,
Konzum, banks, opticians), and not small boutiques nobody would name as a meeting point.

**How it was judged:** Google Maps, street by street through the playable extent (restaurants, cafés,
bars, shops, hotels, museums, cake shops), with review counts as the "does everyone know it" measure:
roughly 1,000+ reviews or a landmark. Addresses were mapped to walls with the OSM snapshot and the
Maps pins (tool frame, x east / z north), against `.art/walls_all.json` and the hero pictures.

**Done (2026-10-02):** the three photocopy shops went first (Print-Shop on Pod zidom, Foto Copy on Ilica,
Fotokopiranje on Đorđićeva); then the 105 "Remove" entries below, the two renames, and the twelve places in
"Applied" below. `data/deliveries.json` holds 42 places: 20 keep + 6 borderline + 2 renamed + 12 new, plus
Knjižara Verbum (Teslina 11, `tesle_verbum`) and MET Boutique Hotel (Praška 4, `praska_met`), put back at the
user's request: their facades already carry the sign.
The rest of "Add" is still a proposal (each needs its sign painted first).

## Applied: the twelve new places

Each building now shows the place: its picture was redrawn (gen-image edit of the old raw with a web photo of
the real place as reference, or a new picture from that photo; raws and prompts in `.art/deliveries/gen/`,
reference photos in `.art/deliveries/ref/`) and/or it carries 3D signs and decoration in `data/buildings.json`
(sign images from `tool/make_place_signs.py`, `web3d/public/features/place_*.png`).

| Place | Pad | Picture | 3D features |
| --- | --- | --- | --- |
| Nokturno, Skalinska 4 | `w289908875_e7` at 0.125 | `skalinska_rade_a`: the east house (first 13 m) coral red, glazed door with "Nokturno" (crop edited and pasted back: do not regenerate) | two cream awnings with NOKTURNO on the valances |
| La Štruk, Skalinska 5 | `w299519686_e6` at 0.109 | `skalinska_h686`: whitewash, salmon-pink window surrounds, black frames | black hanging sign "La Štruk" |
| Tržnica Dolac | x 3, z 106.5 (plateau, `probe` 10) | none needed | none |
| Capuciner, Kaptol 6 | x 91.6, z 222.9 (the lane side is a courtyard edge, not in city.json walls) | new `kaptol_capuciner` on `w290024543_e9` (was the low-res `behind_` crop): red brick, ground floor with the black CAPUCINER board | red hanging sign PIZZA SPAGHETTERIA, a table in the lane |
| Pivnica Mali Medo, Tkalčićeva 36 | `w293357441_e2` at 0.5 (south of the roadblock at z 306) | new `tkalciceva_mali_medo` (was a filler): PIVNICA MALI MEDO board, SINCE 1994, BREWERY | cream awning with "Pivnica Mali Medo" |
| Johann Franck, Trg 9 | `w105487407_e5` at 0.41 | `gradska_stedionica`: the cream awning on the north portico repainted black with copper "Johann Franck" | black canopy on wooden posts, the copper fascia, tables under it |
| Vinodol, Teslina 10 | `w435118932_e0` at 0.436 | unchanged (`tesle_n_grey`) | dark sign box "restoran vinodol" over the gateway, vertical blade with the red top |
| Vincek, Ilica 18 | `w338686824_e2` at 0.45 | new `ilica_vincek` (replaces `inv_w338686824_e2`): the real low house, 2 storeys (the building was 4), VINCEK Slastičarnica fascia | cream awning with VINCEK on the valance |
| Millennium, Bogovićeva 7 | `w435117000_e0` at 0.5 | new `bogo_millennium` (was a filler): glass front, green moss fascia MILLENNIUM | terrace in two halves round the pad |
| Hotel Dubrovnik, Gajeva 1 | `w97235396_e1` at 0.09 | `gajeva_b_hotel_dubrovnik`: the board over the north-end entrance says HOTEL DUBROVNIK with the striped emblem (it said MARIČEV PROLAZ, which opens at the south end) | the tall bronze "HOTEL dubrovnik" blade on the old building's corner (`w584464569_e2`) |
| Kozel Pub Tkalča, Tkalčićeva 16 | `w289908875_e9` at 0.18 | `skalinska_rade_b`: cream-pink, arched door, shuttered windows, a Kozel sign | cream awning with "Kozel", terrace |
| Submarine Burger, Tkalčićeva 12 | `w289908814_e2` at 0.764 | `tkalciceva_b_low_yellow_long`: salmon-pink shopfront right of the gate, black SUBMARINE board in yellow | round SUBMARINE blade sign, terrace |

Renames: `masaryk_e8_bestijak` is "Beštija" (street Masarykova 11), `tesle_pizzeria_lira` is "Thai Me Up by Lira"
(its facade still says Pizzeria Lira: repaint the sign some day).

## Keep

| Name | Street | id | Why |
| --- | --- | --- | --- |
| Cathedral | Kaptol | `cathedral` | landmark |
| Oktogon | Ilica 5 | `oktogon` | landmark passage (822) |
| Zagrebačka nadbiskupija | Kaptol, behind the Cathedral walls | `nadbiskupija` | the archbishop's palace, its own route |
| Nama | Ilica 4 | `ilica_nama` | landmark department store |
| Müller | Trg bana Jelačića 8 | `mueller` | 3,245 reviews, the Müller on the square |
| McDonald's | Jurišićeva ulica 3 | `jur_stern_mcdonalds` | 10,840, "the McDonald's by the square" |
| Boban | Gajeva ulica 9 | `gajeva_boban` | 5,914 |
| Tori Kaya Ramen Bar | Petrinjska ulica 2 | `pet_torikaya` | 4,609 |
| Otto&Frank | Tkalčićeva ulica 20 | `tkalc_otto_frank` | 3,028 |
| Alcatraz | Preradovićeva ulica 12 | `prad_alcatraz` | 2,457 (Night Club & Rock Bar Alcatraz) |
| Royal India | Tkalčićeva ulica 26 | `tkalciceva_royal_india` | 2,333 |
| Kaptolska klet | Kaptol 5 | `kaptol_klet_klet` | 2,230 |
| Bulldog | Bogovićeva ulica 6 | `bogo_bulldog` | 1,975 |
| Carpaccio | Ulica Nikole Tesle 14 | `tesle_carpaccio` | 1,800 |
| Sol | Petrinjska ulica 2 | `pet_sol` | 1,283 |
| Pošta | Jurišićeva ulica 13 | `jurisic_post_posta` | the main post office |
| Knjižara Ljevak | Trg bana Jelačića 17 | `ljevak` | the bookshop on the square |
| Parking Hotel Dubrovnik | Praška ulica 6 | `parking_dubrovnik` | the Hotel Dubrovnik garage |
| Pravoslavna crkva Preobraženja Gospodnjeg | Ulica Sv. Preobraženja | `crkva_preobrazenja` | the Orthodox church on Cvjetni |
| Javni WC | Park međunarodnog priznanja Republike Hrvatske | `javni_wc_cesarca` | the closed toilet, a joke worth keeping (your call) |

## Borderline (kept for now)

| Name | Street | id | Note |
| --- | --- | --- | --- |
| art'otel | Petrinjska ulica 7 | `petrinjska_artotel` | art'otel, 513 reviews: a hotel, but not one locals name |
| Joyful Kitchen | Ulica Pavla Radića 9 | `pavlaradica_joyful_kitchen` | OAZA Joyful Kitchen, 941 |
| Croatia Airlines | Gajeva ulica | `gajeva_croatia_airlines` | the airline office on Zrinjevac |
| Županijski sud | Trg Nikole Šubića Zrinskog 5 | `zupanijski_sud` | the county court on Zrinjevac |
| Knjižnica i čitaonica | Preradovićeva ulica 5a | `prad_citaonica` | the city library reading room |
| Visitor Center | Jurišićeva ulica | `feller_visitor_center` | a tourist visitor centre, door is a guess |

## Rename

| Now | Street | id | Change |
| --- | --- | --- | --- |
| Beštijak | Masarykova 3 | `masaryk_e8_bestijak` | "Beštija" (Masarykova 11/1, 936 reviews): the round sign in the passage is Beštija; "Beštijak" is a misreading |
| Pizzeria Lira | Ulica Nikole Tesle 5 | `tesle_pizzeria_lira` | "Thai Me Up by Lira" (Teslina 5, 1,476): Maps renamed it; the facade still says Pizzeria Lira, so either repaint the sign or drop it |

## Remove

**Brand or street sign, not the business** (5): Stretto (`tkalciceva_stretto_stretto`), Panasonic (`djordjic_s701_panasonic`), Pizza Gelato Jamnica (`tkalciceva_pizzagelato`), Harmica (`harmica_harmica`), Time (`tesle_s_dark_time`)

**Not on Maps here: closed, moved or something else** (6): Al Paso (`tkalciceva_al_paso_alpaso`), Burgeraj (`prad_burgeraj`), Snogu street wok bar (`pavlaradica_snogu_snogu`), Wiya (`masaryk_e8_wiya`), Koko (`masaryk_n725_koko`), Šira (`prad_sira`)

**Chain or service found all over town** (24): Konzum (`tesle_konzum`), SPAR (`jurisic_post_e4_spar`), Pekarnica Dinara (`gajeva_dinara_dinara`), Farmacia (`farmacia_ilica11`), Zagrebačka banka (`prad_zaba`), HPB (`pet_hpb`), HPB Nekretnine (`jur_hpb_nekretnine`), Karlovačka banka (`prad_karlo_east_banka`), Lutrija (`prad_arbanas_lutrija`), iNovine (`pet_inovine`), Rollo (`pet_rollo`), Generalturist (`praska_generalturist`), Obzor putovanja (`gajeva_obzor_putovanja`), Costa Coffee (`tesle_n_costa`), DermaCare (`tesle_n_dermacare`), Poliklinika Amruševa (`amrus_s549_poliklinika`), Škaro Frizer (`gajeva_dinara_skaro`), HairLife by Kostino (`pavlaradica_hairlife`), Schwarzkopf Professional (`berislavic_schwarzkopf`), Optika Anda (`gajeva_maricev_optika_anda`), Optotim (`ilw_optotim`), Videntis (`djordjic_videntis`), Mikronis (`jurisic_mikronis`), Koracell (`petrinjska_koracell`)

**Brand boutique: known brand, not a place people name** (18): Gant (`masaryk_s1005_gant`), Furla (`tesle_s_dark_furla`), Dolce & Gabbana (`gajeva_dolce_gabbana`), Elisabetta Franchi (`ilw_franchi`), Swarovski (`masaryk_swarovski`), Pandora (`ilw_pandora`), Jo Malone London (`ilw_jomalone`), Lush (`petrinjska_orna_lush`), högl (`ilw_prahir_hogl`), Mephisto (`masaryk_e8_mephisto`), L'Erbolario (`tesle_erbolario`), Calliope (`calliope`), Q Store (`bogo_qstore`), Picard (`masaryk_picard`), Manuela Picard (`gajeva_dinara_picard`), Vaudoom (`tesle_vaudoom`), Rosa Faia (`jurisic_rosafaia`), myCORE (`masaryk_mycore`)

**Small shop, gallery or office few people know** (51; Verbum and MET Boutique Hotel were put back): Mondiš (`mondis`), Sisters Kurtoš & Ice Cream (`amrus_n316_sisters`), Voćarna Ptiček (`djordjic_n912_pticek`), Uriho (`gajeva_uriho_uriho`), Lei (`gajeva_uriho_lei`), Crvenac (`gajeva_uriho_crvenac`), Feš & Nobl (`jurisic_s976_fes_nobl`), Salon cipela Igrec (`jurisic_n859_igrec`), Maria (`masaryk_n724_maria`), Krznarija (`masaryk_s1005_krznarija`), Galerie Ana (`pavlaradica_galerie_ana`), Ivana Bačura (`pavlaradica_bacura`), Feniks (`pavlaradica_feniks`), MET Boutique Hotel (`praska_met`), Pinsider (`praska_pinsider`), Zlatarna Zvonko Marić (`bogo_zlatarna_maric`), Miva (`tesle_miva`), Lapis Art Jewelry (`tkalc_lapis`), Croatian Naive Art Gallery Mirko Virius (`tkalc_naive_art`), YEZI (`amrus_yezi_yezi`), NERA (`jurisic_s966_nera`), Blau-Line (`pavlaradica_blau_line_blau`), Moda (`pavlaradica_moda21_moda`), Cover Store (`pavlaradica_ochre_balcony_cover`), Cloud (`prad_cream_east_cloud`), Galerija Branimir (`bak_gallery_branimir`), Prahir (`ilw_prahir_prahir`), Terranova (`ilw_terranova_terranova`), Ovac (`tesle_n_erker_ovac`), hikultura (`tesle_s_hikultura_hikultura`), Hrvatski poljoprivredni zadružni savez (`amrus_hpzs`), Vitrum (`masaryk_vitrum`), Zaks (`masaryk_zaks`), Kravata (`pavlaradica_kravata`), Selfie & Memories Museum Zagreb (`pavlaradica_selfie_museum`), Barefoot Shoes (`pavlaradica_barefoot`), Ella (`prad_ella`), Camea (`feller_camea`), Rodea (`jur_stern_rodea`), Suveniri Zagreb - Širok (`bak_suveniri_sirok`), Karla (`tesle_karla`), Meet & Eat (`tkalciceva_meet_eat`), Only Croatia (`vlaska_only_croatia`), Babushka (`vlaska_babushka`), Chrisma Exclusive (`amrus_chrisma`), Re Artù (`masaryk_reartu`), Lavanda-Mia (`petrinjska_orna_lavanda`), Jadran Zagreb (`podzidom_jadran`), Martin Arbanas (`prad_arbanas_martin`), AGM knjižara (`tesle_s_agm`), Adria (`zrinski_adria`)


## Add (needs the sign painted first)

None of these has its name on a facade today, so each needs a retexture (`recreate-building`)
before the delivery entry. "Now" is what the wall wears today: real = Street View picture without
this sign, invented, filler or plain. x, z are tool-frame metres of the Maps pin (or the OSM address).

### Tkalčićeva, Skalinska, Opatovina, Kaptol, Dolac

| Place | Address | Maps reviews | x, z | Wall (now) | Note |
| --- | --- | --- | --- | --- | --- |
| Pivnica Mali Medo | Tkalčićeva 36 | 7,785 | -41, 305 | `w293357441_e2` (Kuća Plavić, 5.9 m, filler), `w293357492_e4` (11.7 m, invented) | next door north of no. 34 (the old Stretto picture). The new Tkalčićeva roadblock (z 306) runs through its front: put the pad on `w293357441_e2` or move the roadblock ~5 m north |
| Submarine Burger | Tkalčićeva 12 | 1,486 | -73, 167 | `w289908814_e2` (21 m, invented `tkalciceva_b_low_yellow_long`) | east side; OSM puts no. 12 on the same block's back (`_e6`), the Maps pin is the street side |
| Kozel Pub Tkalča | Tkalčićeva 16 | 2,961 | -59, 198 | `w289908875_e9` (Kuća Rade, 8 m, invented) | corner of Skalinska |
| Caffe bar Argentina | Tkalčićeva 9 | 1,522 | -80, 125 | `w289863013_e2` (16.8 m, invented) | west side, near the south end |
| Koykan | Tkalčićeva 13 | 1,143 | -89, 147 | `w735313510_e4` (4.8 m, filler) | optional |
| Nokturno | Skalinska 4 | 12,312 | -27, 199 | `w289908875_e7` (Kuća Rade's Skalinska side, 39 m, invented) | the most reviewed place in the map |
| La Štruk | Skalinska 5 | 9,495 | -20, 214 | `w299519686_e6` (14.9 m, invented), `w299519687_e4` (filler) | north side of Skalinska, opposite Nokturno |
| Gostionica Ficlek / Pod Zidom Bistro | Pod zidom 5 | 3,623 / 3,316 | 79, 99 | `w292203494_e0` (18 m, real `podzidom_white_balconies`) | two restaurants at one door; pick one name or use both |
| Harat's Pub | Trg Petrice Kerempuha (Opatovina 11) | 4,359 | 43, 199 | `w290024702_e6` (6.9 m, invented) | |
| Pizzeria & Spaghetteria Capuciner | Kaptol 6 | 7,827 | 76, 227 | pin sits 22 m inside the block; Kaptol front is `w290024543_e10` (real `kaptol_brick_a`) or `w1073971966_e2` (filler) | check on Street View where its door and sign are |
| Tržnica Dolac (Dolac Market) | Dolac 9 | 8,601 | about 2, 102 | none needed: an `x`,`z` pad on the market plateau | the one addition that needs no texture work |
| Broom44 | Dolac 8 | 1,745 | 38, 129 | `w138251854_e16` (22 m, invented) | optional |
| Lanterna na Dolcu | Opatovina 31 | 1,185 | 0, 326 | `w296513277_e0` (7.6 m, filler) | optional; at the north edge of the map |

### Trg bana Jelačića, Ilica, Cvjetni, Bogovićeva, Preradovićeva

| Place | Address | Maps reviews | x, z | Wall (now) | Note |
| --- | --- | --- | --- | --- | --- |
| Hotel Dubrovnik | Gajeva 1 | 4,002 | -32, -48 | square front `w584464569_e1` (27.7 m, real `octagon_windows`), Gajeva front `w97235396_e1` (46 m, real `gajeva_b_hotel_dubrovnik`) | the lettering is missing on both pictures |
| Johann Franck | Trg bana Jelačića 9 | 6,906 | 123, 17 | `w105487407_e4` (Gradska štedionica, west end, invented); the square front `_e5` is real | at the corner of the square and Ulica Augusta Cesarca |
| Kraš choco & café | Trg bana Jelačića 5 | 895 | -3, 42 | `w105485745_e0` (Kuća Rado, 17 m, real `kuca_rado`) | under 1,000 reviews, but Kraš on the square is a fixture |
| Zagreb 360° (observation deck) | Neboder, Ilica 1a | 2,397 | -106, -18 | Ilica front `w97165331_e0` (real `tower_n`) / `w375381225_e9` (real `allianz_white_corner`) | the entrance in the tower's base |
| Slastičarnica Vincek | Ilica 18 | 6,353 | -294, 24 | Ilica front `w338686824_e2` (7.8 m, invented) | the 18 m side `_e4` (filler) is behind the side-path roadblock |
| Hotel Jägerhorn | Ilica 14 | 1,379 | -266, 22 | Ilica front `w97089772_e0` / `_e1` (Lovački rog, invented) | the hotel stands in the courtyard through Prolaz Lovački rog |
| Slastičarnica Millennium | Bogovićeva 7 | 5,005 | about -172, -126 | `w435117000_e0` (23 m, filler) | OSM address only (no Maps pin): check the door |
| La Bodega | Bogovićeva 5 | 1,498 | about -152, -115 | `w435116999_e0` (23.6 m, real `bogo_sw_palace`) | |
| Centar Cvjetni (Batak inside, 4,770) | Trg Petra Preradovića 6 | 4,770 | -263, -47 | `w338688378_e30` (24.6 m, filler), `_e29` | deliver to the mall entrance on the square |
| Namaste Bistro | Preradovićeva 2 | 1,332 | -231, -145 | `w512839703_e6` (32.7 m, invented `prad_salmon`) | |
| Kino Europa | Varšavska 3 | 1,881 | -295, -142 | building `w512839700`, all filler | Varšavska lies just past the west edge; check the entrance can be reached before painting |

### Teslina, Gajeva, Masarykova, Zrinjevac

| Place | Address | Maps reviews | x, z | Wall (now) | Note |
| --- | --- | --- | --- | --- | --- |
| Vinodol | Teslina 10 | 6,836 | -112, -184 | `w435118932_e0` (24.7 m, real `tesle_n_grey`) | |
| Good Food | Teslina 7 | 3,440 | -65, -192 | `w579294918_e16` (18 m, real `tesle_s_low_a`) | |
| Quahwa | Teslina 9 | 3,232 | about -129, -212 | `w446072042_e9` (10.8 m, invented) | OSM address only |
| Thai Me Up by Lira | Teslina 5 | 1,476 | | `w579294895_e0` (the Pizzeria Lira sign) | see Rename |
| Kiyomi | Gajeva 10 | 1,207 | -60, -232 | `w579294918_e14` (14 m, real `gajeva_b_dinara_s`) | |
| Arheološki muzej | Trg Nikole Šubića Zrinskog 19 | 1,793 | 14, -216 | `w137106310_e0` (Palača Vranyczany-Dobrinović, real) | the museum plaque is missing |
| Slastičarnica Zagreb | Masarykova 4 | 1,067 | about -250, -189 | `w512839704_e7` (28 m, invented) | optional; OSM address only |

### Jurišićeva, Petrinjska, Augusta Cesarca, Vlaška, Pavla Radića

| Place | Address | Maps reviews | x, z | Wall (now) | Note |
| --- | --- | --- | --- | --- | --- |
| Kai Street Food | Jurišićeva 2A | 2,575 | about 111, -84 | `w105489675_e6` (Kuća Berić, 20.5 m, invented) | OSM address only |
| HERITAGE Croatian Street Food | Petrinjska 14 | 2,932 | 208, -243 | `w390984149_e0` (10.5 m, real `petrinjska_havana_b`) | it now occupies the old "Havana" shopfront |
| Cheese Bar | Ulica Augusta Cesarca 2 | 1,584 | 151, 12 | `w105487407_e4` (Gradska štedionica, east part, invented) | same wall as Johann Franck |
| Amélie | Vlaška 6 | 2,067 | about 148, 75 | `w289863170_e0` (15.9 m, invented) | cake shop |
| Nutelino | Vlaška 10 | 1,566 | about 170, 51 | `w586039526_e4` (19.6 m, invented) | |
| Valhalla beer bar | Pavla Radića 3a | 1,665 | -103, 90 | `w97089777_e1` (9.3 m, real `pavlaradica_pink_dormers`) | |
| K&K Milčec | Jurišićeva 5 | 830 | about 193, -49 | `w286612861_e0` (Kuća Spitzer, invented) | optional |

## Well known but out of reach

Outside the extent or behind a roadblock, so no pad: Curry Bowl (Tkalčićeva 42-44, 4,966), History Bar &
Club (Tkalčićeva 68, 4,472), Batak Tkalčićeva (70, 3,266), BioMania (65, 2,376), Oliver Twist (60, 1,966),
Bar 45 (45, 1,939), Agava (39, 763): all north of the Tkalčićeva roadblock. Vis a vis by Vincek (Tomićeva 2,
1,389) and Roots Bar (Tomićeva 5, 1,819): behind the Uspinjača roadblock. Museum of Hangovers (Vlaška 55,
4,762), Burgeraj (Vlaška 35, 1,190), Meet Mia (Vlaška 43): east of the map. Bistro Fotić (Gajeva 25, 1,322),
Chocolat 041 (Masarykova 25, 2,155), Gostionica Purger (Petrinjska 33, 3,225, probably): south or west of the edge.
Museum of Broken Relationships, Lotrščak, Stari Fijaker: Gornji Grad, blocked.
