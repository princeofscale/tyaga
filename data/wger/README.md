# wger catalogue snapshots

The current `catalog-v2-ru.json` is a Russian adaptation of all 918 records in the
immutable `catalog-v1.json`, fetched from the official public
`https://wger.de/api/v2/exerciseinfo/` endpoint on 7 October 2026. The source has
10 Russian translations; the new release has 918 Russian names and descriptions,
Russian search aliases and original English aliases. Names were editorially
translated with AI assistance; descriptions were machine translated at build
time. The original description and localisation status remain in every record.

This directory is **not licensed under Tyaga's MIT application licence**. Every
record retains original authors, source URLs and content licences in
`attributions`: CC BY-SA 3.0, CC BY-SA 4.0 or CC0 as stated per record. Adaptations
retain the applicable source licence. No wger AGPL application source, images,
videos or exercise media are included.

Original import changes: choose RU/EN names, turn description HTML into plain
text, cap descriptions at 6,000 characters and preserve equipment/muscle metadata.
Russian adaptation changes: translate names and descriptions, add aliases and
identify time-based recording. Neither release claims scientific certification.

Content hashes are part of exercise IDs. SQL stores immutable definitions and
separate release memberships; workout snapshots are verified by the server.
Historical IDs remain resolvable, including on a fresh JSON restore. The new
release does not rewrite old workout names, roles or load semantics.

Unreviewed records are excluded from muscle coverage, external volume and e1RM.
Timed records use seconds and optional kilometres. The service entry for rest is
browseable but cannot be added to a workout.

Reproduce the current adaptation offline:

```sh
npm run catalog:localize
```

See [localisation inputs](../localization/README.md). To fetch new data, choose a
**new file and release**, review licences and variants, then update server inputs:

```sh
npm run catalog:import -- --output data/wger/catalog-v3.json
```

Do not overwrite published snapshots or seed whole datasets in migrations. D1
imports at most 200 records per request in bounded, atomic, retry-safe batches.
