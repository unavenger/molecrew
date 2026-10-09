// input.js — the hand, painting, slapping and the camera controls.
//
// Flow:
//   mousemove → updateHover()   decides what the hand would do here: slap a mole,
//                               paint rock, erase a mark, or nothing → sets the hand's look
//   mousedown (left)  → mole under hand? sim.slap()  :  start a box (mark, or erase if it starts on a mark)
//   mousedown (right) → start an erase box
//   drag              → renderer.setSelection() previews the box
//   mouseup           → applyBox() marks/unmarks every diggable tile inside it
//   wheel / WASD / arrows / middle-drag → move the camera
//
// DECISION (Felix, after playtest): drag a rectangle to mark, like Dungeon Keeper 2.
//
// DECISION (Felix): one context-sensitive hand that shows what a click will do before clicking.
// DECISION (Felix): when a mole and rock are both under the hand, the mole wins.
// Draft 2: priority under the hand is mole > lever > visitor > tile (draft 4: treasure before tile). DECISION (Claude) for the order
// after the mole: the lever is the backdrop's one purposeful button, so it beats a passing visitor.

export class Input {
  constructor(canvas, renderer, sim, world, handEl) {
    this.canvas = canvas;
    this.r = renderer;
    this.sim = sim;
    this.world = world;
    this.hand = handEl;
    this.mouse = null; // last mouse position in screen pixels
    this.stroke = null; // { mark: true|false, start: tileIndex, end: tileIndex } while dragging a box
    this.pan = null; // { x, y } while middle-dragging
    this.keys = new Set();
    this.mode = 'none';

    // addEventListener(name, fn) runs fn whenever the browser reports that event.
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    canvas.addEventListener('mouseleave', () => {
      this.mouse = null;
      this.setMode('none');
      this.r.setHover(null);
      this.hand.hidden = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // no browser menu on right-click
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault(); // stop the page from scrolling
        this.r.zoom *= Math.exp(e.deltaY * 0.0012);
      },
      { passive: false }, // needed so preventDefault() is allowed on wheel events
    );
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') this.r.closeFan(); // Escape closes an open lever fan
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onMove(e) {
    this.mouse = { x: e.clientX, y: e.clientY };
    this.hand.hidden = false;
    if (this.pan) {
      const k = this.r.zoom / 600; // DECISION (Claude): pan speed scales with zoom
      this.r.focus.x -= (e.clientX - this.pan.x) * k;
      this.r.focus.y -= (e.clientY - this.pan.y) * k * 1.4;
      this.pan = { x: e.clientX, y: e.clientY };
    }
    if (this.stroke) {
      const i = this.r.pickTile(e.clientX, e.clientY);
      if (i >= 0) this.stroke.end = i;
      this.r.setSelection(this.boxOf(this.stroke));
    }
    this.placeHand();
  }

  // The stroke's corners as tile coordinates, for the renderer's preview.
  boxOf(s) {
    const w = this.world;
    return { x0: w.xOf(s.start), y0: w.yOf(s.start), x1: w.xOf(s.end), y1: w.yOf(s.end), mark: s.mark };
  }

  onDown(e) {
    if (!this.mouse) this.mouse = { x: e.clientX, y: e.clientY };
    if (e.button === 1) {
      e.preventDefault();
      this.pan = { x: e.clientX, y: e.clientY };
      return;
    }
    this.updateHover();
    const h = this.hover;
    // Draft 8: the lever fan. A tap on a picture sets the room; a tap anywhere else just closes it.
    if (this.r.fan) {
      if (e.button === 0 && h && h.kind === 'fan') {
        this.sim.setRoomType(this.r.fan.roomId, h.type);
        this.animateHand('slap-anim');
      }
      this.r.closeFan();
      return;
    }
    if (e.button === 0 && h && h.kind === 'mole') {
      this.sim.slap(h.id);
      this.animateHand('slap-anim');
      return;
    }
    if (e.button === 0 && h && h.kind === 'lever') {
      // DECISION (Felix, draft 8): tapping a lever opens the fan of room pictures (no more cycling).
      this.r.openFan(h.id);
      this.animateHand('slap-anim');
      if (this.sound) this.sound.play('markOn');
      return;
    }
    if (e.button === 0 && h && h.kind === 'visitor') {
      this.sim.slapVisitor(h.id);
      this.animateHand('slap-anim');
      return;
    }
    if (e.button === 0 && h && h.kind === 'treasure') {
      this.sim.slapTreasure(h.id);
      this.animateHand('slap-anim');
      return;
    }
    if (h && h.kind === 'tile' && this.world.isDiggable(h.i)) {
      // DECISION (Claude, DK2-style): a left stroke that starts on an unmarked tile paints,
      // one that starts on a marked tile erases. Right-drag always erases. (Open question in the brief.)
      const mark = e.button === 2 ? false : !this.world.marked[h.i];
      this.stroke = { mark, start: h.i, end: h.i };
      this.r.setSelection(this.boxOf(this.stroke));
      this.animateHand('dab-anim');
    } else if (h && h.kind === 'tile' && (e.button === 0 || e.button === 2)) {
      // DECISION (Claude): a box can also start on open floor or the border, so you can sweep
      // across a room; it marks if left-dragged, erases if right-dragged.
      this.stroke = { mark: e.button === 0, start: h.i, end: h.i };
      this.r.setSelection(this.boxOf(this.stroke));
    }
  }

  onUp() {
    if (this.stroke) {
      this.applyBox(this.boxOf(this.stroke));
      this.animateHand('dab-anim');
      this.r.setSelection(null);
    }
    this.stroke = null;
    this.pan = null;
  }

  // Mark (or unmark) every diggable tile inside the box. setMark ignores floor and border.
  applyBox(b) {
    if (this.sound) this.sound.play(b.mark ? 'markOn' : 'markOff');
    const w = this.world;
    for (let y = Math.min(b.y0, b.y1); y <= Math.max(b.y0, b.y1); y++) {
      for (let x = Math.min(b.x0, b.x1); x <= Math.max(b.x0, b.x1); x++) w.setMark(w.idx(x, y), b.mark);
    }
  }

  updateHover() {
    if (!this.mouse) return;
    const { x, y } = this.mouse;
    let hover = null;
    // Draft 8: an open lever fan sits on top of everything else.
    if (this.r.fan && !this.stroke) {
      const type = this.r.pickFanButton(x, y);
      this.r.setFanHover(type === null ? -1 : type);
      if (type !== null) hover = { kind: 'fan', type };
    }
    if (!hover && !this.stroke) {
      const id = this.r.pickMole(x, y);
      if (id !== null) hover = { kind: 'mole', id };
    }
    if (!hover && !this.stroke) {
      const id = this.r.pickLever(x, y);
      if (id !== null) hover = { kind: 'lever', id };
    }
    if (!hover && !this.stroke) {
      const id = this.r.pickVisitor(x, y);
      if (id !== null) hover = { kind: 'visitor', id };
    }
    if (!hover && !this.stroke) {
      const id = this.r.pickTreasure(x, y);
      if (id !== null) hover = { kind: 'treasure', id };
    }
    if (!hover) {
      const i = this.r.pickTile(x, y);
      if (i >= 0) hover = { kind: 'tile', i };
    }
    this.hover = hover;
    this.r.setHover(hover);

    let mode = 'none';
    if (this.stroke) mode = this.stroke.mark ? 'paint' : 'erase';
    else if (hover && ['mole', 'lever', 'visitor', 'treasure', 'fan'].includes(hover.kind)) mode = 'slap';
    else if (hover && hover.kind === 'tile' && this.world.isDiggable(hover.i)) mode = this.world.marked[hover.i] ? 'erase' : 'paint';
    this.setMode(mode);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.hand.dataset.mode = mode; // dataset.mode sets the data-mode="..." attribute that the CSS reads
  }

  placeHand() {
    if (!this.mouse) return;
    // The hotspot (the point that "touches") is the fingertip for painting, the palm for slapping.
    const hot = this.mode === 'slap' ? [36, 40] : [22, 6];
    this.hand.style.transform = `translate(${this.mouse.x - hot[0]}px, ${this.mouse.y - hot[1]}px)`;
  }

  animateHand(cls) {
    const art = this.hand.firstElementChild;
    art.classList.remove('slap-anim', 'dab-anim');
    void art.offsetWidth; // reading a layout value restarts a CSS animation that just ran
    art.classList.add(cls);
  }

  // Called every frame: keyboard panning, and re-checking the hover (moles move under a still hand).
  update(dt) {
    const k = this.keys;
    const speed = this.r.zoom * 0.9 * dt; // DECISION (Claude): pan speed scales with zoom
    if (k.has('a') || k.has('arrowleft')) this.r.focus.x -= speed;
    if (k.has('d') || k.has('arrowright')) this.r.focus.x += speed;
    if (k.has('w') || k.has('arrowup')) this.r.focus.y -= speed;
    if (k.has('s') || k.has('arrowdown')) this.r.focus.y += speed;
    this.updateHover();
    this.placeHand();
  }
}
