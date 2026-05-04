
# FLOW Profile — Painting Reveal Feature

Add a clickable "mystery box" on each FLOW Profile card. When clicked, it flips to reveal a public-domain painting matched to the profile, along with full attribution and a short rationale.

The reveal applies to all three profile sources (AI assessment, pre-self-assessment, post-self-assessment) and works in both the in-app FLOW Report and the public Shared Report.

---

## 1. Painting references and final rationales

All 16 paintings are sourced from Wikimedia Commons and are in the public domain.

| # | Profile | Painting | Artist | Year | Rationale |
|---|---------|----------|--------|------|-----------|
| 1 | FLOW — The Architect | Vitruvian Man | Leonardo da Vinci | c. 1490 | A figure of perfect proportion at the centre of every framework: anatomy, geometry, art and science. The Architect, like the Vitruvian Man, represents every dimension of the work. |
| 2 | FLO- — The Strategist | The Chess Players | Thomas Eakins | 1876 | Two minds bent over a board where the next move has already been calculated. Strategy precedes execution; the brushwork is delegated to the hand, but the plan is sovereign. |
| 3 | FL-W — The Essayist | The Reader (La Liseuse) | Jean-Honoré Fragonard | c. 1770–72 | A solitary reader absorbed in her book, voice and thought intertwined. The Essayist writes as they think, ideas and prose flowing from the same personal source. |
| 4 | FL-- — The Visionary | Wanderer above the Sea of Fog | Caspar David Friedrich | 1818 | The defining Romantic image of vision and inspiration. The figure stands above the world, gazing into the unknown. He has the perspective and the spark; what to do with it is for others to handle. |
| 5 | F-OW — The Editor | Woman Holding a Balance | Johannes Vermeer | c. 1664 | The figure weighs, judges, and refines. She did not invent the materials before her but she is the one bringing them into careful balance. Quiet authority over the work of selection and refinement. |
| 6 | F-O- — The Analyst | The Geographer | Johannes Vermeer | 1669 | A scholar at his desk, compass in hand, methodically engaging with a map, his notes spread around him. Pure research and structure made visible. |
| 7 | F--W — The Researcher-Writer | Camille au métier (Camille at the Loom) | Claude Monet | 1875 | Patient work at the loom, every thread chosen and placed. Research and prose woven by the same hand, even when the pattern was suggested elsewhere. |
| 8 | F--- — The Investigator | A Philosopher Lecturing on the Orrery | Joseph Wright of Derby | c. 1766 | Figures gathered around a mechanical model of the solar system, illuminated by a single light source. The painting is *about* investigation as a mode of being. |
| 9 | -LOW — The Auteur | The Art of Painting | Johannes Vermeer | c. 1666–68 | Vermeer painting an allegory in his own studio: vision, composition, and execution all his. |
| 10 | -LO- — The Thinker | I Lock My Door Upon Myself (detail) | Fernand Khnopff | 1891 | A figure withdrawn into private contemplation. The Thinker shapes ideas and structure inwardly, then hands the words to another voice. |
| 11 | -L-W — The Voice | Madame X (Madame Pierre Gautreau) | John Singer Sargent | 1884 | All presence and silhouette, Madame X commands the canvas through sheer personality. The scandal the painting caused when first exhibited speaks to its raw expressive power. |
| 12 | -L-- — The Spark | The Kiss | Gustav Klimt | 1907–08 | One luminous gesture, everything else melting into gold. The Spark contributes the single charged idea around which everything else is arranged. |
| 13 | --OW — The Craftsperson | The Great Wave off Kanagawa | Katsushika Hokusai | c. 1831 | Hokusai did not invent the wave or the mountain but his structural and technical mastery transformed them into an icon. This is craftsmanship at its purest. |
| 14 | --O- — The Organizer | Portrait of Lalla Vandervelde | Roger Fry | 1917 | A formalist's portrait: colour, plane, and arrangement above all. The Organizer brings order and proportion. |
| 15 | ---W — The Scribe | Saint Matthew and the Angel | Caravaggio | 1602 | The angel whispers, the evangelist writes. The Scribe gives the words their final shape, through tone or rhythm or breath, even when the inspiration came from elsewhere. |
| 16 | ---- — The Conductor | Nocturne in Black and Gold – The Falling Rocket | James Abbott McNeill Whistler | c. 1875 | A scatter of sparks against the dark, arranged into a single atmosphere. The Conductor selects, frames, and approves, whereas the gestures themselves come from many hands. |

The "Source" line on each card will link to that file's page on `commons.wikimedia.org`.

---

## 2. UX behaviour

Inside the existing `FlowWorkProfile` card, between the description and the pillar tiles, add a centred section:

- **Default (collapsed) state** — a square "mystery box" tile (~140×140 px) with a soft border, a question-mark / sparkle icon, and the caption *"Reveal your profile's painting"*. Hover lifts gently; cursor `pointer`. Accessible button (Enter / Space).
- **On click** — the tile flips on the Y-axis (~400 ms, similar feel to the existing `animate-card-flip`) to reveal the painting.
- **Revealed state** —
  - Painting (`object-contain`, max height ~360 px, rounded, soft shadow)
  - **Title** — italicised
  - **Artist · Year**
  - The rationale (italic, muted, max-width prose)
  - **Source** — small link reading *"Wikimedia Commons"*, opens in a new tab
  - Subtle *"Hide"* link returning it to the mystery box
- Reveal state is local component state (not persisted). Switching profile source (AI / pre / post) re-mounts the card via the existing `key={source}`, so the painting starts hidden again on each switch — consistent with current behaviour.

Layout note: fits comfortably inside the existing card padding at the current 886-px viewport; no surrounding layout changes.

---

## 3. Technical changes

**a. Assets** — Copy the 16 files from the uploaded zip into `src/assets/flow-profiles/` with clean filenames keyed by profile code, imported as ES modules so Vite fingerprints them. The single `.webp` (The Spark) will be saved as-is (Vite handles webp).

**b. New data module — `src/lib/flow-profile-paintings.ts`**
- Exports `PROFILE_PAINTINGS: Record<string /* profile code */, { image: string; title: string; artist: string; year: string; sourceUrl: string; rationale: string }>`.
- Keyed by the same `code` values used in `FLOW_PROFILES` (`"FLOW"`, `"-LO-"`, `"----"`, …).
- Source URLs point to each file's page on `commons.wikimedia.org`.

**c. New component — `src/components/flow-report/ProfilePaintingReveal.tsx`**
- Props: `code: string`.
- Looks up the painting via `PROFILE_PAINTINGS[code]`; renders nothing if missing (defensive).
- Owns local `revealed` state; renders either the mystery-box button or the painting block above.
- Tailwind 3D-flip wrapper (`perspective`, `rotate-y-180`, `backface-hidden`) — small inline styles for `transform-style` / `perspective`; Tailwind classes for the rest. No new dependencies.

**d. Wire into `FlowWorkProfile.tsx`** — render `<ProfilePaintingReveal code={profile.code} />` between the description (line 50) and the pillar grid (line 53).

**e. Shared report** — `SharedReport.tsx` already uses `ProfileTabContent` → `FlowWorkProfile`, so the reveal works automatically on the public link with no further changes. Images bundle as static assets, so they load on the unauthenticated route.

**f. Out of scope** — No DB changes, no edge-function changes, no new dependencies, no changes to the source-switcher or the parent `animate-card-flip` wrapper, no localisation.
