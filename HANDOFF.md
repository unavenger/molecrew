# Mole Crew: handoff

Written 2026-10-09 at the end of draft 8. Read this first, then `README.md` (how to play, file table) and `src/config.js` (every tunable, tagged with who decided it).

## What this is and why

Felix (clinical psychologist, Sweden) builds games for his 5-year-old son, who is bilingual; English is fine. Mole Crew branched off his tractor cave game. It is a Dungeon Keeper 2-style digging game where Claude does all the work: browser, Three.js and plain JavaScript, with Blender art possibly later.

The project is half a game for his son and half a puzzle for Felix: **find out what made him love DK2, and whether it survives repackaging for a young child.**

Fixed constraints:
- No failure states, and no numbers on screen.
- Player-facing text says **"tap"**. The code still says `slap`, after DK2, and that is fine.
- Avoid complexity. Felix cut the build-wall idea for that reason.

What Felix said tickles him: **digging automatically builds more diggers**, with a DK2-style *living dungeon* as background entertainment.

## How Felix works (follow these)

- **Discuss direction before building.** Propose a plan, flag trouble spots, give your lean, and wait for his call on design questions.
- **Flag every self-made decision in code.** Use `// DECISION (Claude): …`. His choices are `// DECISION (Felix): …`.
- **Explain built-in or library APIs in a comment at first use**, so he can follow the code.
- **Flag trouble spots proactively.** He wants honest critique, not cheerleading.
- **Number deliveries as drafts.** The wordmark in `index.html` shows `<small>draft 8</small>`; bump it with each delivery.

## Where things live

| What | Where |
| --- | --- |
| Felix's copy (the real repo) | `C:\Users\felix\OneDrive\Documents\GitHub\molecrew\` on his PC. Reached through the linked-computer tools (`mcp__remote-devices__device_commit_files` to write; folder access was granted). |
| Working copy in the cloud session | `/home/claude/molecrew`. It is ephemeral, so restore it from Felix's folder with `device_stage_files` if it's gone. |
| Published artifact (playable link) | https://claude.ai/artifact/LEdPL1C7BiognZ8n5VSMd1 (version 11 = draft 8). |
| Design brief | Claude Docs project `9aeb21bb-9a03-4994-9bf7-637c50ed1f47`, prose node `35675ea5-8afc`. It is **stale**: current through draft 5 plus the hard-rock pause. It doesn't cover drafts 6–8 and still says "slap" in places. Updating it was offered, not confirmed. |
| Tractor cave game (sibling project) | Separate project. It already has a Diablo-1-style multi-level setup: levels cached per session, ramps, persistent hub. That is relevant to the open levels question. |

**Delivery routine:**
1. Copy the changed files to `/mnt/user-data/outputs/molecrew/…`.
2. Commit them with `device_commit_files` to the matching paths in his folder.
3. Republish the artifact. The artifact page is `index.html` with its doctype and `<head>` wrapper stripped. Publish it with `files` mapping every `src/*.js` and passing the existing `url`.

Felix runs the game with `start.bat`, which calls `node server.cjs` on :8137 and opens the browser.

## How to test

- **`node tests/sweep.mjs`** runs headless rule checks across many seeded caves (14 invariants, about 30 s). It covers:
  - full clear, tap spam, erase and repaint
  - roads connect every room; rooms lock and stay inside the village
  - idle crew paves and decorates
  - all 16 treasures get displayed
  - visitors reach final form, greet, group and leave; with no rooms they leave without growing
  - narrator pacing

  Last run: **ALL PASSED**.
- **`tests/smoke/`** holds browser smoke tests that use a Proxy-based Three.js stand-in (`three-mock.js`). The workspace can't reach the Three.js CDN or use a GPU.
  1. Start `node tests/smoke/server.cjs` (port 8199). It serves the real `index.html` with only the import map rewritten.
  2. Run any of `run.cjs` (general), `fan.cjs` (lever fan), `narr.cjs` (narrator), `sound-test.cjs` (renders every generated sound offline), or `preview.cjs <out.wav>` (sound montage).

  The expected console noise is a Google Fonts tunnel error and a 404 for `assets/voice/manifest.json`, because voice files haven't been generated.
- **The rendering has never been seen by Claude.** Smoke tests only prove no errors. The built-in browser couldn't open the artifact (claude.ai wasn't signed in), and localhost:8137 only works while Felix has `start.bat` running. Visual tuning so far rests on Felix's screenshots and comments: fan button size and spacing, lever sign size, mark colours. Ask for a screenshot after visual changes.
- **The workspace network is allowlisted.** npm and CDNs are blocked. Playwright is at `/opt/npm-tools/node_modules/playwright`, and `tests/smoke/pw.cjs` falls back to a normal install.

## What's built (drafts 1–8)

**Core loop**
- Box-drag to mark rock for digging, as in DK2. A box that starts on a mark erases; right-drag also erases. Bright blocks can be dug now; outlined blocks wait for a tunnel to reach them.
- Pickaxe moles dig and haul ore to the burrow. Ore builds new moles: 3 to start, cap 12, each new mole costs one load more than the last.
- Idle moles pave bare floor, then dress and decorate walls in two stages.
- Tapping a mole interrupts it briefly, then speeds it up for 4 s. Boosts don't stack. Felix wants his son to discover for himself that over-tapping interrupts the flow, so it is deliberately left unexplained.
- Hard rock is **paused** (`hardRock: false`). It returns when specialists get tuned.

**Living dungeon**
- **Village:**
  - Rooms form only within 12 tiles of the burrow, in walled spaces up to 36 tiles or as 5×5 patches of bigger halls. A room locks once made.
  - Each room gets a lever with a sign. Tap the lever and a **fan** of six room pictures opens: garden, pond, nap room, kitchen, glowworm grotto, map room.
  - Switching a room's type starts that room fresh.
  - Each new room gets a road (cobbles plus lamps) to the nearest room, road or burrow.
- **Portal:** sealed in the wild cave at least 14 tiles out. Digging to it wakes it, and visitors arrive (up to 15).
- **Visitors:** 7 kinds, each needing two room types.
  - They grow from baby to grown to a final form while both needs are met.
  - Final forms stay about 3 minutes, then go home happy. Younger ones go home after 2 minutes with an unmet need.
  - A thought bubble shows a missing room type.
  - They interact: friend pairs greet each other, they tag along, a fox cub chases a beetle, and same-kind groups have a group moment.
- **Treasure ring:** 16 treasures hide in the rock. Moles carry them to pedestals around the burrow. They are for display only; tapping one makes it twirl.

**Sound and voice**
- **Sound:** everything is generated with the Web Audio API, with voice limits, distance attenuation and ducking under the narrator. M mutes.
- **Narrator:**
  - 82 lines about creatures: arrivals and needs, missing rooms, growing up, leaving and why.
  - Pacing: at least 7 s between lines, a 120 s cooldown per line, and a nudge about a need after 15 s.
  - Uses browser speech, or Kokoro WAVs if generated. `tools/make_voices.py` is **untested** and is Felix's to run on his PC.
  - Captions show at the bottom of the screen; C toggles them.

## Felix's decisions so far (don't relitigate)

- Moles with pickaxes, like DK2 imps, with vehicles possibly later. PC first.
- One context-sensitive hand that shows its mode before you click. A mole beats rock under the hand.
- Box drag, not line painting. Unreachable marks must look clearly different.
- Rooms form in the open too, not only behind walls, because he remembers regretting torn-down walls in DK2. No build-wall mechanic.
- Pick room types with the lever fan rather than cycling. A switched room starts fresh.
- Rooms stay near the base as a functional village.
- Rooms must match visitors' needs. Visitors grow by having their needs met.
- The background cave can be interactive (tappable) but has no gameplay consequences in this build.
- Roads stand in for corridors once the walls come down. Floors get paved.
- Pause hard rock.
- Use "tap" in player-facing text.

## Open thread: where we stopped

Claude gave a design critique. Felix is answering it point by point.

1. **Room switching.** Resolved: the lever fan, built in draft 8.
2. **Rooms must match visitors; keep rooms near base.** Resolved: the village radius, built in draft 8.
3. **The digging loop runs dry after about 7 minutes, and leftover ore has no use.** Felix: *"for it to keep being a thing this would need to be multiple levels, more than just the one sandbox."*

   Claude proposed this shape (**not built, waiting on Felix**):
   - **A stack of caves under the burrow.** Each level is its own cave with its own village, portal and treasure ring. Technically, each level is a cached `World` + `Sim`; only the active one updates and renders.
   - **Spare ore builds a lift** beside the burrow once the crew is full. It assembles visibly, like the mole ghost, which gives ore a use. Tap the lift to ride down or up. No level menu and no depth counter.
   - **Levels you aren't on pause**, so nothing happens behind your back.
   - **Depth brings variety:** a new palette, a new set of 16 treasures and new visitor kinds per level. Hard rock and specialists (maybe Felix's vehicles) come back deeper down.
   - **Trouble spots:**
     - It's the biggest change yet, touching the main loop, renderer, sound and narrator. The narrator must ignore inactive levels.
     - Rebuilding the scene when switching levels may stutter; a fade during the ride covers it.
     - Same-loop-again might bore on level 2 instead of level 1, which only a playtest will show.

   **Questions waiting on Felix (Claude's lean in brackets):**
   1. A fresh crew of 3 per level, or the whole crew comes along? [fresh, to keep the growth curve he loves]
   2. Is the lift built from ore at the burrow, or found as a sealed shaft in the rock? [ore, because it fixes the ore sink]
   3. How many levels in the first pass? [3 themed levels, then decide on endless]

**Other critique points, not yet discussed:**
- Moles lack personality.
- Treasures repeat across caves. Per-level treasure sets would fix this.
- The tap trade-off isn't visible.
- Complexity keeps growing.
- **Playtest with his son before adding much more.** Watch whether he actually runs out of things to do around minute 7.

## Gotchas learned the hard way

- `package.json` has `"type":"module"`, so any CommonJS script must be named `.cjs`.
- InstancedMesh `instanceColor` starts black. Fill it with 1s before tinting.
- A `.rotation` on `parent.add(child)` hits the parent, because `add` returns the parent.
- `pkill -f` can match its own shell. Kill by saved PID instead.
- The tests must reset the per-cave memo (`roomMemo`) and use `reach` (not raw type) for "decoratable" checks. The portal-chamber walls fooled the test once.
- Room count per village depends on `villageRadius` and `hallPatch`. Radius 12 with a patch of 5 gives about 10 rooms, roughly one per visitor kind and then some.
