# wger catalogue snapshot

`catalog-v1.json` contains 918 exercise records fetched from the official public
`https://wger.de/api/v2/exerciseinfo/` endpoint on 7 October 2026. Ten records have
a Russian translation. Other names/descriptions use the English translation.

This directory is **not licensed under Tyaga's MIT application licence**. Every
record retains its original authors, source URLs and content licences in
`attributions`. The current snapshot includes CC BY-SA 3.0, CC BY-SA 4.0 and CC0
records. Corresponding licence URLs are included per exercise and translation.
Adaptations remain under the applicable original content licence. No wger
application code, images, videos or exercise media are included.

Changes made by the importer: choose RU/EN names, turn description HTML into plain
text, cap descriptions at 6,000 characters, preserve aliases and muscle/equipment
metadata, omit all media. This is a community catalogue, not scientific
certification. Each record identifies these changes in `adaptation`.

The content hash is part of the exercise ID. The SQL repository keeps immutable
definitions and release memberships separately. Workout entries contain a
server-verified definition snapshot; edits cannot replace it with client data.
Unreviewed wger records do not contribute to the Tyaga coverage, external volume
or estimated 1RM. Cardio and recognised duration-based records remain browseable
but cannot be recorded in the rep-based logger.

To refresh, write a **new** snapshot instead of overwriting a published file:

```sh
npm run catalog:import -- --output data/wger/catalog-v2.json
```

Review licences and changes, update the server's snapshot import and release the
new source. Old database definitions are retained. Do not put seed datasets in
schema migrations: the API imports at most 200 records per request, in bounded,
atomic, retry-safe D1 batches, and reports progress until the release is complete.
