## Replace Scribe painting with Rembrandt's version

For the `---W` Scribe profile in `src/lib/flow-profile-paintings.ts`, swap the Caravaggio reference for Rembrandt's depiction of the same scene.

### Verification
- URL `https://commons.wikimedia.org/wiki/File:Rembrandt_Harmensz._van_Rijn_049.jpg` → HTTP 200.
- Public domain: page categories include `PD-Art (Yorck Project)`, `CC-PD-Mark`, `Author died more than 100 years ago public domain images`.
- Subject confirmed: structured-data label is "The evangelist Matthew and the Angel, 1661"; category `Saint Matthew and the angel by Rembrandt`.

### Changes (single file: `src/lib/flow-profile-paintings.ts`, entry `---W`)

- `title`: `"Saint Matthew and the Angel"` → `"The Evangelist Matthew Inspired by the Angel"`
- `artist`: `"Caravaggio"` → `"Rembrandt van Rijn"`
- `year`: `"1602"` → `"1661"`
- `sourceUrl`: → `https://commons.wikimedia.org/wiki/File:Rembrandt_Harmensz._van_Rijn_049.jpg`
- `rationale`: unchanged (the existing description fits both versions of the scene).

The locally bundled `src/assets/flow-profiles/w-scribe.jpg` image is left as-is per your prior instruction that image swaps aren't needed unless you say otherwise — only the link/metadata changes. Let me know if you'd also like the local image replaced with the Rembrandt.
