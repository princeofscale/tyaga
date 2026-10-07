# Third-party materials

The MIT licence at the root covers Tyaga application code and original curated
metadata. It does not relicense the following third-party content.

## Muscle map

SVG path data from [react-native-body-highlighter](https://github.com/HichamELBSI/react-native-body-highlighter/tree/8ed39ac2ae9cb46fb79d77eedec7e5b029a75174),
Copyright © 2022 ELABBASSI Hicham, MIT. Original coordinates are unchanged; path
arrays were converted to JSON. Original full licence is in
[`src/assets/anatomy/LICENSE`](src/assets/anatomy/LICENSE), also distributed through
`public/licenses/third-party.txt`. Visualisation combines muscle groups and is not
an independently validated clinical atlas.

## Fonts and libraries

Manrope and Unbounded: SIL Open Font License 1.1. React, React DOM, Lucide,
Motion/Framer Motion and TanStack Query: their original MIT notices apply.
Apple Health import: fflate (MIT), saxes (ISC) and xmlchars (MIT).
Full applicable notices copied from the pinned installed packages are included in
`public/licenses/third-party.txt` and served with the application.

## wger community catalogue

[`data/wger`](data/wger/README.md) is a separate licensed data collection. Each
exercise and chosen translation carries original licence, author history, source
URL and adaptation description. The source retains CC BY-SA 3.0, CC BY-SA 4.0 or
CC0 as specified per record. Adapted records remain under the original licence.
Media and wger AGPL application source are not included. Source attribution also
travels with saved workout definitions and exports.

The Russian release in `data/wger/catalog-v2-ru.json` is an adaptation of the
immutable `catalog-v1.json`. Russian names and aliases were editorially translated
with AI assistance; descriptions were machine translated at build time. Original
descriptions and attributions remain in each record. These translations retain
the applicable original CC BY-SA/CC0 licence, not the application's MIT licence.
Tyaga does not claim scientific or professional certification of these records.

## Product inspiration

OpenGym's documented routines, double progression, personal exercises and history
imports informed product choices. Their implementations here are original; no
OpenGym AGPL source or media are redistributed.

The reviewed Russian release in `data/wger/catalog-v3-reviewed.json` adds explicit
AI-assisted editorial reviews to 26 records, retaining original source records
and applicable CC licences. The review layer does not relicense the data.
