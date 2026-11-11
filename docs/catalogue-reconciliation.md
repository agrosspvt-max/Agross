# Catalogue reconciliation report

Generated 2026-11-11 from `chemical.json`, `nonchemical.json`, `chemicals.html` and `nonchemical.html`.
**Nothing has been published.** Every product was imported as a draft. The public site is unchanged.

## 1. Counts

| Source | Records in file | Unique IDs | Imported as drafts | Products with a decision pending |
| --- | --- | --- | --- | --- |
| chemical.json | 67 | 67 | 67 | 9 |
| nonchemical.json | 40 | 39 | 39 | 8 |

Grid cards under "All": chemical grid 63, non-chemical grid 36. Total imported: 106 products; 17 need a decision.

## 2. The two `veera` records

`veera` appears twice in `nonchemical.json`. The first record was imported as the draft; the second is stored beside it as an alternate so you can choose.

| Field | First record (imported) | Second record |
| --- | --- | --- |
| category | "Organic" | "PGPR" |
| dose | "250-300 gm/acre" | "250-300 Gm/acre" |
| technical | "SP Humate 98% with Seaweed" | "SP Humate 98% With Seaweed" |

Fields not listed are identical.
The grid shows `veera` under: pgpr. The second record's category (`PGPR`) would place it elsewhere.

## 3. Proposed category-to-tab mapping

The grids group products by tab, but the JSON `category` text does not match the tabs one-to-one. This table shows where each category currently appears. "Proposed" is the most common current tab; "Decision" marks categories that appear under more than one tab or under none.

| Catalogue | JSON category | Products | Currently shown under tab(s) | Not in any grid | Proposed tab | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| chemical | Fertilizer | 13 | chemicals:fertilizer x11, nonchemical:biofertilizer x2 | 0 | fertilizer | needed |
| chemical | Fungicide | 11 | chemicals:fungicide x11 | 0 | fungicide | ok |
| chemical | Herbicide | 13 | chemicals:herbicide x12 | 1 | herbicide | ok |
| chemical | Insecticide | 28 | chemicals:insecticide x28 | 0 | insecticide | ok |
| chemical | Pesticide | 1 | none | 1 | (none) | needed |
| chemical | Premium Plant Growth Regulator Hormones | 1 | none | 1 | (none) | needed |
| nonchemical | Bio-Fertilizer | 1 | nonchemical:pgpr x1 | 0 | pgpr | ok |
| nonchemical | Bio-Fungicide | 3 | nonchemical:biofungicide x3 | 0 | biofungicide | ok |
| nonchemical | Bio-Insecticide | 9 | nonchemical:bioinsecticide x9 | 0 | bioinsecticide | ok |
| nonchemical | Bio-Larvicide | 2 | nonchemical:biolarvicide x2 | 0 | biolarvicide | ok |
| nonchemical | Biological | 6 | nonchemical:biofertilizer x6 | 0 | biofertilizer | ok |
| nonchemical | BIOLOGICAL | 2 | nonchemical:biofertilizer x1, nonchemical:biofungicide x1 | 0 | biofertilizer | needed |
| nonchemical | Biological Pesticide | 1 | nonchemical:bioinsecticide x1 | 0 | bioinsecticide | ok |
| nonchemical | Botanical Insecticide | 2 | nonchemical:bioinsecticide x2 | 0 | bioinsecticide | ok |
| nonchemical | Manure | 2 | nonchemical:biofertilizer x2 | 0 | biofertilizer | ok |
| nonchemical | Organic | 7 | nonchemical:biofertilizer x4, nonchemical:pgpr x1 | 2 | biofertilizer | needed |
| nonchemical | PGPR | 4 | chemicals:fertilizer x1, nonchemical:pgpr x3 | 0 | pgpr | needed |

## 4. Products whose listing and JSON disagree

Each row is a product that needs your decision. "Kept as imported" is what the draft currently contains.

| Product | Catalogue | Problem(s) | Kept as imported | Detail |
| --- | --- | --- | --- | --- |
| fasal vriddhi kit | nonchemical | in a tab but not under All | nonchemical grid / pgpr | Appears under the "PGPR" tab but not under "All" on the current page. |
| manager | chemical | card label differs from JSON name | chemicals grid / fungicide | The Fungicide card says "MANGER" but the JSON name is "MANAGER". |
| max mad | chemical | card label differs from JSON name | chemicals grid / herbicide | The All card says "MAX MAD" but the JSON name is "MAXX MAD". The Herbicide card says "MAX MAD" but the JSON name is "MAXX MAD". |
| maxlone | chemical | card label differs from JSON name | chemicals grid / insecticide | The All card says "MAXLONE" but the JSON name is "MAXXLONE". The Insecticide card says "MAXLONE" but the JSON name is "MAXXLONE". |
| maxx grow | nonchemical | not in any grid | not listed | Not shown in any grid today. It is reachable by its link and in search. Proposed placement: the nonchemical grid, "Biofertilizer" tab. |
| maxx zyme | chemical | ID exists in both catalogues; not in any grid | not listed | The same ID also exists in the non-chemical catalogue as a separate record. Not shown in any grid today. It is reachable by its link and in search. Proposed placement: the chemicals grid, "Herbicide" tab. |
| maxx zyme | nonchemical | ID exists in both catalogues; category appears under several tabs | nonchemical grid / biofertilizer | The same ID also exists in the chemical catalogue as a separate record. |
| mex quin | chemical | image file missing; not in any grid | not listed | The image file "products/Mex Quin.png" does not exist. The product shows the logo until an image is uploaded. Not shown in any grid today. It is reachable by its link and in search. |
| mint | chemical | listed under the other catalogue's grid; category appears under several tabs | nonchemical grid / biofertilizer | Appears in the non-chemical grid although its record is in chemical.json. |
| ninja | nonchemical | in a tab but not under All | nonchemical grid / bioinsecticide | Appears under the "Bioinsecticide" tab but not under "All" on the current page. |
| potaxx dm | nonchemical | card label differs from JSON name | nonchemical grid / biofertilizer | The All card says "POTAXX DM" but the JSON name is "POTAX-DM". The Biofertilizer card says "POTAXX DM" but the JSON name is "POTAX-DM". |
| pretej | nonchemical | not in any grid | not listed | Not shown in any grid today. It is reachable by its link and in search. Proposed placement: the nonchemical grid, "Biofertilizer" tab. |
| shoot out | chemical | card label differs from JSON name | chemicals grid / insecticide | The All card says "SHOUT OUT" but the JSON name is "SHOOT-OUT". |
| tattoo | chemical | ID exists in both catalogues; not in any grid | not listed | The same ID also exists in the non-chemical catalogue as a separate record. Not shown in any grid today. It is reachable by its link and in search. |
| tattoo | nonchemical | ID exists in both catalogues; listed under the other catalogue's grid; category appears under several tabs | chemicals grid / fertilizer | The same ID also exists in the chemical catalogue as a separate record. Appears in the chemical grid although its record is in nonchemical.json. |
| veera | nonchemical | duplicate ID; category appears under several tabs | nonchemical grid / pgpr | Another record with this ID exists in nonchemical.json. The first was imported; the second is kept for comparison. |
| zilmil | chemical | listed under the other catalogue's grid; category appears under several tabs | nonchemical grid / biofertilizer | Appears in the non-chemical grid although its record is in chemical.json. |

## 5. Order inside tabs

The managed catalogue keeps one display order per product (the order under "All"). On the current pages these tabs list products in a different order from "All"; after publishing they will follow the "All" order unless you ask otherwise:

- chemicals grid, "Insecticide" tab.
- nonchemical grid, "PGPR" tab.
- nonchemical grid, "Bioinsecticide" tab.

## 6. Missing images and other gaps

Missing image files: `mex quin` (chemical).
Products with no benefits text: `red bull`, `open`.
Grid cards that point to a record missing from the JSON: none.

## 7. What the import changed in the text

- Names, categories and similar text had `&amp;` style entities decoded to plain characters (for example `Selective Pre &amp; Post Emergence Herbicide` became `Selective Pre & Post Emergence Herbicide`). This field is not shown on public pages today.
- Technical details and benefits keep their `<br>` line breaks; any other markup is cleaned to a safe subset.
- Each product's image text defaults to its name. Existing images stay in `products/`.
- Search aliases were seeded from the spellings the old search list recognised (Rotomaxx, Taanbad, Curiass, Casama, Max Mad, Maxlone, Potaxx DM).
