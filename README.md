# Mole Crew

A no-fail digging game in the spirit of Dungeon Keeper 2. Paint rock, pickaxe moles dig it out,
the ore they carry home becomes more moles, and idle moles pave the floors and dress and decorate the walls.

## Play

Double-click `start.bat` (needs Node.js). It starts a small local server and opens
`http://localhost:8137` in your browser. Close the black window to stop it.

- **Drag a box over rock** (or click one tile): mark it for digging. A box that starts on a marked tile erases instead. Right-drag also erases.
- **Bright yellow blocks** can be dug now. **Outlined blocks** are marked but wait until a tunnel reaches them.
- **Tap a mole** (click it): it hops, then works faster for a few seconds. Tapping again interrupts it again. (The code calls this a slap, after Dungeon Keeper.)
- **Village and levers**: rooms only form near the burrow (within 12 tiles), so the rooms make a village; farther out is wild cave. Every room (a walled space, or a 5×5 patch of a big hall) gets a lever with a sign showing its type. Tap the lever and a fan of six pictures opens: mushroom garden, pond, nap room, kitchen, glowworm grotto, map room. Tap one to turn the room into it; tap anywhere else (or Escape) to close the fan. The pictures match the visitors' thought bubbles.
- **Floors and roads**: with nothing marked, moles pave bare floor outside rooms, then dress the walls. Each new room gets a road to the nearest room, road or the burrow; roads show as cobbles with lamp posts once paved.
- **Visitors grow up**: each kind needs two room types (hedgehog: garden + kitchen, frog: pond + nap room, snail: garden + pond, beetle: grotto + kitchen, bat: nap room + grotto, owl: map room + grotto, fox cub: nap room + map room). They arrive as babies, grow up while both needs are met, and reach a final form (crowned frog, flowery snail, apple-carrying hedgehog, owl with spectacles and book, fluffy-tailed fox, golden beetle, glowing bat). Final forms stay a few minutes, then go home; younger ones go home if their needs stay unmet for two minutes. A thought bubble shows a needed room that doesn't exist yet.
- **Visitors meet**: friends stop to say hello (hearts), sometimes tag along together, fox cubs chase beetles, and several of a kind resting in one room have a group moment (frog chorus, bat nap, owls reading).
- **Treasure ring**: 16 treasures hide in the rock (their blocks twinkle). A mole carries each one home to its own pedestal in the ring around the burrow. They're for show, not spending; tap one to make it twirl.
- **Portal**: sealed somewhere in the rock. Dig to it and friendly visitors start arriving. Each room type attracts certain visitors, and they live in those rooms. Tap them for a squeak.
- **Sound**: every sound is generated in code (no files). It starts after the first click. **M** mutes (remembered per browser).
- **Narrator**: a voice talks about the creatures: who arrived and what they need, which room a visitor is missing, who grew up, who went home and why. One line at a time, at least 7 seconds apart. Captions show at the bottom (**C** toggles them).
- **WASD / arrows**: move the camera. **Scroll**: zoom. **Middle-drag**: pan.
- **H**: hide help. **N**: new cave. **F3**: debug numbers.
- Open `http://localhost:8137/?seed=123` to replay a specific cave (the seed is logged in the browser console).

Three.js loads from a CDN, so the game needs an internet connection.

## Files

| File | What it does |
| --- | --- |
| `src/config.js` | Every tunable number. Each one is tagged with who decided it. |
| `src/world.js` | Tile grid and seeded cave generation. |
| `src/path.js` | Breadth-first search over open floor. |
| `src/sim.js` | Moles, jobs, burrow, walls, slap. Pure rules, no drawing. |
| `src/rooms.js` | Finds rooms after digging, places levers; room types and who they attract. |
| `src/visitors.js` | The portal and the visitors that come through it. |
| `src/props.js` | Looks of room props, levers, the portal, visitors, treasures and pedestals. |
| `src/assets.js` | The only place that knows what things look like (placeholders for now). |
| `src/sound.js` | All sounds, generated with the Web Audio API; voice limits, distance volume, ambience. Put a file path in `SOUND_FILES` to replace any sound with a recording. |
| `src/narration.js` | The narrator: every line, when to say what, captions, and the voice (recorded file or browser speech). |
| `tools/export-lines.mjs`, `tools/make_voices.py` | Generate Kokoro voice files for every narrator line (see below). |
| `src/render.js` | Three.js scene: instanced walls, marks, moles, burrow, particles, lights. |
| `src/input.js` | The hand: hover, paint, erase, slap, camera controls. |
| `src/main.js` | Starts a cave and runs the frame loop. |
| `tests/sweep.mjs` | Headless rule checks across many caves: `node tests/sweep.mjs` |
| `tests/smoke/` | Browser smoke tests with a stand-in for Three.js: start `node tests/smoke/server.cjs`, then run e.g. `node tests/smoke/run.cjs` (needs Playwright). |
| `HANDOFF.md` | Where the project stands, open questions, and how Claude works on it. |

## Narrator voice files (Kokoro)

Without files, the narrator uses the browser's built-in English voice. For a nicer, consistent voice, generate files with Kokoro (free, runs on CPU):

1. Once: `pip install kokoro soundfile` (Kokoro's docs also recommend installing espeak-ng).
2. `node tools/export-lines.mjs` writes every line to `assets/voice/lines.json`.
3. `python tools/make_voices.py` writes `assets/voice/<line>.wav` and `manifest.json`. Options: `--voice af_heart --speed 0.95`, or `--only want_frog_pond` to redo one line.
4. Refresh the game. Lines with a file use it; the rest still use browser speech.

## Comment conventions

- `DECISION (Claude): …` marks a choice Claude made that Felix didn't specify.
- `DECISION (Felix): …` marks a choice from the design brief.

## Swapping in Blender art later

All models come from `src/assets.js`. Replace a builder with a loaded glTF (`.glb`) that keeps the same conventions:

- 1 world unit = 1 tile. Walls are `BLOCK_H` tall.
- Models are centred on their tile with the base at y = 0, facing +z.
- The mole keeps these part names, because the animation code moves them by name:
  `body`, `head`, `hat`, `armL`, `armR` (shoulder pivots), `pickaxe` (child of `armR`), `cargo`, `stars`.
