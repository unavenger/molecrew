// config.js — every tunable number in one place.
//
// Convention used across the project:
//   DECISION (Claude): ...   = a choice Claude made, not specified by Felix.
//   DECISION (Felix):  ...   = a choice Felix made in the design brief.
// Values without a tag are plain technical constants.

export const CONFIG = {
  // --- Map ---------------------------------------------------------------
  mapW: 44, // DECISION (Claude): map size; big enough for several rooms, small enough to clear in ~15–25 min.
  mapH: 36,
  startRoomRadius: 2, // DECISION (Claude): 5x5 starting room around the burrow.
  hardRock: false, // DECISION (Felix): hard rock paused (all rock is plain dirt) until specialists are tuned.

  // --- Crew --------------------------------------------------------------
  startCrew: 3, // DECISION (Claude, brief suggestion): guaranteed starting crew.
  crewCap: 12, // DECISION (Claude): per-level cap (open question in the brief).
  moleSpeed: 2.6, // tiles per second when walking.
  carrySpeedFactor: 0.85, // DECISION (Claude): moles walk a little slower when carrying ore.

  // --- Digging (seconds per tile at normal speed) --------------------------
  digTime: {
    dirt: 1.2, // DECISION (Claude)
    ore: 2.0, // DECISION (Claude)
    hard: 9.0, // DECISION (Felix): hard rock is diggable by anyone, just very slow. Exact value: Claude.
  },
  reinforcedDigFactor: 1.3, // DECISION (Claude, brief suggestion): reinforced walls dig a bit slower.

  // --- Job choice --------------------------------------------------------
  hardPenalty: 1000, // DECISION (Felix): moles prefer fast tiles; hard rock only when nothing faster is in reach.
  focusWeight: 0.35, // DECISION (Claude, brief suggestion): prefer marks near the camera, so action stays on screen.
  idleThink: 0.5, // seconds between job searches for a mole with nothing to do.

  // --- Slap --------------------------------------------------------------
  slapBoostMult: 1.8, // DECISION (Claude): how much faster a slapped mole works.
  slapBoostTime: 4.0, // DECISION (Claude): boost length. Re-slapping refreshes it but never stacks (DECISION Felix: no stacking).
  slapReactTime: 0.7, // DECISION (Claude): how long a slap interrupts the mole. Long enough to notice (brief).

  // --- Burrow / growth ---------------------------------------------------
  moleCostBase: 3, // DECISION (Claude): ore loads for the first new mole.
  moleCostStep: 1, // DECISION (Claude, brief suggestion): each new mole costs one load more.
  assembleTime: 2.0, // DECISION (Claude): seconds a new mole takes to pop out once paid for.

  // --- Walls -------------------------------------------------------------
  reinforceTime: [3.0, 4.0], // seconds for rough→dressed and dressed→decorated. DECISION (Claude)
  reinforceStagePenalty: 4, // DECISION (Claude): dress rough walls before decorating dressed ones.

  // --- Idle --------------------------------------------------------------
  wanderRadius: 5, // DECISION (Claude): idle moles wander within this many tiles of the burrow.

  // --- Rooms (draft 2) ---------------------------------------------------
  // DECISION (Felix): every room gets a lever; pulling it cycles the room type. Rooms form both
  // in walled spaces and as patches in big open halls, and lock in place once made.
  roomMinOpen: 3, // DECISION (Claude): a tile counts as "room floor" if it sits in a fully dug 3x3 square.
  roomMaxEnclosed: 36, // DECISION (Claude): open areas up to 36 tiles are one walled room; bigger ones are halls.
  hallPatch: 5, // DECISION (Claude, draft 8): 5x5 hall rooms (was 4x4), so room count stays close to visitor count.
  villageRadius: 12, // DECISION (Felix): rooms only form near the burrow, a functional village. Radius 12 (≈10 rooms when fully dug): Claude.
  leverPullTime: 0.6, // seconds the lever animation lasts (renderer).

  // --- Portal and visitors (draft 2) ---------------------------------------
  portalMinDist: 14, // DECISION (Claude): portal chamber is at least this far from the burrow (outside the village).
  visitorCap: 15, // DECISION (Claude, brief suggestion): visitors at once.
  visitorInterval: 18, // DECISION (Claude): seconds between arrivals while below the cap.
  visitorFirstDelay: 2, // seconds after the portal wakes before the first visitor.
  roomAttractBonus: 4, // DECISION (Claude): extra pick weight per room that attracts a visitor kind.

  // --- Visitor growth (draft 5) ---------------------------------------------
  // DECISION (Felix): visitors grow up when their needs are met; final forms stay a while then
  // leave; younger ones leave if their needs stay unmet too long.
  needStart: 0.6, // DECISION (Claude): newcomers arrive fairly content, so they don't fret at once.
  needFill: 1 / 10, // DECISION (Claude): per second, while resting in a room of a needed type.
  needDrain: 1 / 100, // DECISION (Claude): per second, always.
  needMet: 0.35, // DECISION (Claude): a need counts as met above this.
  growTime: [40, 60], // DECISION (Claude): seconds with both needs met to grow baby→grown, grown→final.
  unmetLeave: 120, // DECISION (Claude): seconds of unmet needs before a baby or grown-up goes home.
  finalStay: 180, // DECISION (Claude): seconds a final-form visitor stays before leaving.

  // --- Visitor interactions (draft 5) ---------------------------------------
  // DECISION (Felix): creatures interact with one another. All details below: Claude.
  greetRadius: 0.9, // tiles: friends this close stop to say hello
  greetTime: 2.0, // seconds the hello lasts
  greetCooldown: 25, // seconds before the same visitor greets again
  followTime: 15, // seconds a visitor may tag along after a friend
  chaseTime: 8, // seconds a fox cub chases a beetle
  maxInteractions: 3, // at most this many greetings/chases at once, so the cave doesn't get busy
  groupEvery: 6, // seconds between group moments (chorus etc.) in a room

  // --- Floors and roads (draft 3) ------------------------------------------
  // DECISION (Felix): moles decorate bare floor outside rooms (DK2-style claiming), and roads
  // connect the rooms, standing in for corridors once the walls come down.
  claimTime: 1.0, // DECISION (Claude): seconds to pave one floor tile.
  roadLampChance: 0.2, // DECISION (Claude): about one road tile in five gets a little lamp post.
};
