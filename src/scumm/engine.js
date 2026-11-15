// SCUMM v2 game engine (headless): script VM, actors, objects, verbs, camera, text.
// Rendering and audio are done by the host through `engine.hooks` and the public state.
import { decode, decodeText, SPEC } from './ops.js';
import { Costume, newCostState } from './costume.js';
import { readString } from './resources.js';

// v2 variable numbers
export const VAR = {
  EGO: 0, CAMERA_POS_X: 2, HAVE_MSG: 3, ROOM: 4, OVERRIDE: 5, MACHINE_SPEED: 6, CHARCOUNT: 7,
  ACTIVE_VERB: 8, ACTIVE_OBJECT1: 9, ACTIVE_OBJECT2: 10, NUM_ACTOR: 11, CURRENT_LIGHTS: 12,
  CURRENTDRIVE: 13, MUSIC_TIMER: 17, VERB_ALLOWED: 18, ACTOR_RANGE_MIN: 19, ACTOR_RANGE_MAX: 20,
  CURSORSTATE: 21, CAMERA_MIN_X: 23, CAMERA_MAX_X: 24, TIMER_NEXT: 25, SENTENCE_VERB: 26,
  SENTENCE_OBJECT1: 27, SENTENCE_OBJECT2: 28, SENTENCE_PREPOSITION: 29, VIRT_MOUSE_X: 30,
  VIRT_MOUSE_Y: 31, CLICK_AREA: 32, CLICK_VERB: 33, CLICK_OBJECT: 35, ROOM_RESOURCE: 36,
  LAST_SOUND: 37, BACKUP_VERB: 38, KEYPRESS: 39, CUTSCENEEXIT_KEY: 40, TALK_ACTOR: 41,
};
const US = { SET_CURSOR: 1, CURSOR_ON: 2, SET_FREEZE: 4, FREEZE_ON: 8, SET_IFACE: 16, SENTENCE: 32, INVENTORY: 64, VERBS: 128 };
const CLICK = { VERB: 1, SCENE: 2, INVENTORY: 3, KEY: 4, SENTENCE: 5 };
const OWNER_ROOM = 0x0f;
const PREPOSITIONS = ['', ' in', ' with', ' on', ' to'];
export const SCREEN = { W: 320, H: 200, ROOM_TOP: 16, ROOM_H: 128, VERB_TOP: 144, INV_TOP: 176 };
const NUM_ACTORS = 25;

class Actor {
  constructor(id) {
    this.id = id;
    this.name = '';
    this.room = 0;
    this.x = 0; this.y = 0; this.elevation = 0;
    this.costumeId = 0; this.cost = null; this.cs = newCostState();
    this.facing = 2; // 0 left, 1 right, 2 front, 3 back
    this.moving = false;
    this.destX = 0; this.destY = 0; this.destDir = -1; this.destBox = -1;
    this.walkbox = -1;
    this.talkColor = 15;
    this.palette = {};
    this.sound = 0;
    this.bodyFrame = 1; // stand
    this.talking = false;
    this.extraAnim = -1;
    this.prevX = 0; this.prevY = 0;
  }
}

export class Engine {
  constructor(res, hooks = {}) {
    this.res = res;
    this.hooks = hooks; // { sound(id), stopSound(id), music(id), stopMusic(), log(msg) }
    this.vars = new Int32Array(800);
    this.objOwner = Uint8Array.from(res.objectOwner);
    this.objState = Uint8Array.from(res.objectState);
    this.objNames = new Map(); // setObjectName overrides
    this.objPrep = new Map();
    this.actors = [];
    for (let i = 0; i < NUM_ACTORS + 1; i++) this.actors.push(new Actor(i));
    this.slots = [];
    this.current = null;
    this.verbs = []; // {id, slot, x, y, name, on}
    this.sentence = []; // sentence stack
    this.userState = 0;
    this.userPut = false;
    this.cursorOn = false;
    this.room = null;
    this.roomId = 0;
    this.roomPalette = null;
    this.camera = { x: 160, dest: 160, mode: 0, follows: 0, movingToActor: false };
    this.text = null; // { pages:[string], page, timer, color, actor }
    this.sentenceLine = '';
    this.cutscene = { data: [0, 0, 0, 0], script: null, ptr: 0 };
    this.mouse = { x: 160, y: 80 };
    this.clicks = [];
    this.keys = [];
    this.invOffset = 0;
    this.sounds = new Map(); // id -> remaining jiffies
    this.music = 0;
    this.objectIndex = null;
    this.costumes = new Map();
    this.warned = new Set();
    this.rng = Math.random;
    this.ticks = 0;
    this.restartRequested = false;
    this.drawOverrides = new Map(); // obj id -> {x,y}
    this.flashlight = { w: 0, h: 0 };
    this.autoExecute = true;
    this._buildObjectIndex();
  }

  log(msg) { if (this.hooks.log) this.hooks.log(msg); }
  warn(msg) { if (!this.warned.has(msg)) { this.warned.add(msg); this.log('WARN ' + msg); } }

  _buildObjectIndex() {
    this.objectIndex = new Map();
    for (let n = 1; n < 60; n++) {
      const r = this.res.room(n);
      if (!r) continue;
      for (const o of r.objects) if (!this.objectIndex.has(o.id)) this.objectIndex.set(o.id, o);
    }
  }

  boot() {
    this.vars[VAR.CURRENT_LIGHTS] = 11;
    this.vars[VAR.MACHINE_SPEED] = 10;
    this.vars[VAR.TIMER_NEXT] = 4;
    this.vars[VAR.NUM_ACTOR] = NUM_ACTORS;
    this.runScript(1);
  }

  // ---------------------------------------------------------------- objects
  obj(id) { return this.objectIndex.get(id) || null; }
  objInRoom(id) { return this.room ? this.room.objects.find((o) => o.id === id) || null : null; }
  whereIs(id) {
    if (id < 1) return 'none';
    if (this.objOwner[id] !== OWNER_ROOM) return this.obj(id) ? 'inventory' : 'none';
    return this.objInRoom(id) ? 'room' : 'none';
  }
  objName(id) {
    if (id > 0 && id <= NUM_ACTORS && id < this.actors.length) return this.actors[id].name;
    if (this.objNames.has(id)) return this.objNames.get(id);
    const o = this.obj(id);
    return o ? o.name.replace(/@+/g, '') : '';
  }
  objPos(o) {
    const ov = this.drawOverrides.get(o.id);
    return ov ? { x: ov.x, y: ov.y, walkX: ov.walkX, walkY: ov.walkY } : { x: o.x, y: o.y, walkX: o.walkX * 8, walkY: o.walkY * 8 };
  }
  // visibility through the parent chain (state bit 8 must match parentState)
  objChainOk(o) {
    let cur = o;
    for (let guard = 0; guard < 16; guard++) {
      if (!cur.parent) return true;
      const parent = this.room.objects[cur.parent - 1];
      if (!parent) return true;
      const want = cur.parentState ? 8 : 0;
      if ((this.objState[parent.id] & 8) !== want) return false;
      cur = parent;
    }
    return true;
  }
  visibleObjects() {
    if (!this.room) return [];
    const out = [];
    for (let i = this.room.objects.length - 1; i >= 0; i--) {
      const o = this.room.objects[i];
      if ((this.objState[o.id] & 8) && this.objChainOk(o)) out.push(o);
    }
    return out;
  }
  findObject(x, y) {
    if (!this.room) return 0;
    for (const o of this.room.objects) {
      if (this.objState[o.id] & 2) continue;
      if (!this.objChainOk(o)) continue;
      const p = this.objPos(o);
      if (p.x <= x && x < p.x + o.width && p.y <= y && y < p.y + o.height) return o.id;
    }
    return 0;
  }
  verbEntry(id, verb) {
    const o = this.obj(id);
    if (!o) return 0;
    if (o.verbs.has(verb)) return o.verbs.get(verb);
    if (o.verbs.has(0xff)) return o.verbs.get(0xff);
    return 0;
  }
  // position/direction an actor should stand at for an object or actor
  objActXY(id) {
    if (id > 0 && id <= NUM_ACTORS) {
      const a = this.actors[id];
      if (a.room !== this.roomId) return null;
      return { x: a.x, y: a.y, dir: -1 };
    }
    const where = this.whereIs(id);
    if (where === 'inventory') {
      const owner = this.actors[this.objOwner[id]];
      if (owner && owner.room === this.roomId) return { x: owner.x, y: owner.y, dir: -1 };
      return null;
    }
    if (where !== 'room') return null;
    const o = this.objInRoom(id);
    const p = this.objPos(o);
    return { x: p.walkX, y: p.walkY, dir: o.actorDir & 3 };
  }
  inventory(owner = this.vars[VAR.EGO]) {
    const out = [];
    for (let id = 1; id < this.objOwner.length; id++) if (this.objOwner[id] === owner && this.obj(id)) out.push(id);
    return out;
  }

  // ---------------------------------------------------------------- boxes
  box(i) {
    const b = this.room.boxes[i];
    return { uy: b.uy * 2, ly: b.ly * 2, ulx: b.ulx * 8, urx: b.urx * 8, llx: b.llx * 8, lrx: b.lrx * 8, mask: b.mask, flags: this.boxFlags[i] };
  }
  closestInBox(i, x, y) {
    const b = this.box(i);
    const cy = Math.max(b.uy, Math.min(b.ly, y));
    const t = b.ly === b.uy ? 0 : (cy - b.uy) / (b.ly - b.uy);
    const lx = b.ulx + (b.llx - b.ulx) * t;
    const rx = b.urx + (b.lrx - b.urx) * t;
    const cx = Math.max(Math.min(lx, rx), Math.min(Math.max(lx, rx), x));
    const dx = (cx - x) / 8, dy = (cy - y) / 2;
    return { x: cx, y: cy, dist: dx * dx + dy * dy, box: i };
  }
  adjustXY(x, y) {
    if (!this.room || !this.room.boxes.length) return { x, y, box: -1 };
    let best = null;
    for (let i = 0; i < this.room.boxes.length; i++) {
      if (this.boxFlags[i] & 0x80) continue;
      const c = this.closestInBox(i, x, y);
      if (!best || c.dist < best.dist) best = c;
    }
    return best || { x, y, box: -1 };
  }
  nextBox(from, to) {
    const d = this.room.data, m = this.room.boxMatrixOffs, n = this.room.boxes.length;
    const v = d[m + n + d[m + from] + to];
    return v > 127 ? -1 : v;
  }

  // ---------------------------------------------------------------- actors
  costume(id) {
    if (!this.costumes.has(id)) {
      const data = this.res.costume(id);
      this.costumes.set(id, data ? new Costume(data) : null);
    }
    return this.costumes.get(id);
  }
  setCostume(a, id) {
    a.costumeId = id;
    a.cost = id ? this.costume(id) : null;
    this.resetAnim(a);
  }
  startAnim(a, frame) {
    if (a.cost) a.cost.startAnim(a.cs, frame * 4 + a.facing);
  }
  resetAnim(a) {
    a.cs = newCostState();
    a.extraAnim = -1;
    this.startAnim(a, a.moving ? 0 : 1);
    this.startAnim(a, 2);
    this.startAnim(a, a.talking ? 5 : 4);
  }
  setFacing(a, dir) {
    if (dir < 0 || dir > 3 || a.facing === dir) return;
    a.facing = dir;
    const extra = a.extraAnim;
    this.resetAnim(a);
    if (extra >= 0) { a.extraAnim = extra; this.startAnim(a, extra); }
  }
  putActor(a, x, y, room = a.room) {
    a.x = x; a.y = y; a.room = room;
    a.prevX = x; a.prevY = y;
    a.moving = false;
    if (room === this.roomId && this.room) {
      const adj = this.adjustXY(x, y);
      a.walkbox = adj.box;
    }
    this.resetAnim(a);
  }
  stopMoving(a) {
    if (!a.moving) return;
    a.moving = false;
    this.startAnim(a, 1);
  }
  startWalk(a, x, y, dir) {
    if (a.room !== this.roomId || !this.room) { a.x = x; a.y = y; if (dir >= 0) this.setFacing(a, dir); return; }
    const adj = this.adjustXY(x, y);
    a.destX = adj.x; a.destY = adj.y; a.destBox = adj.box; a.destDir = dir;
    if (a.walkbox < 0) a.walkbox = this.adjustXY(a.x, a.y).box;
    if (Math.abs(a.x - a.destX) < 1 && Math.abs(a.y - a.destY) < 1) {
      this.stopMoving(a);
      if (dir >= 0) this.setFacing(a, dir);
      return;
    }
    if (!a.moving) { a.moving = true; this.startAnim(a, 0); }
  }
  walkStep(a) {
    a.prevX = a.x; a.prevY = a.y;
    if (!a.moving) return;
    let tx = a.destX, ty = a.destY;
    if (a.walkbox >= 0 && a.destBox >= 0 && a.walkbox !== a.destBox) {
      const nb = this.nextBox(a.walkbox, a.destBox);
      if (nb < 0 || this.boxFlags[nb] & 0x80) { this.stopMoving(a); return; }
      const c = this.closestInBox(nb, a.x, a.y);
      if (c.dist < 0.01) { a.walkbox = nb; return this.walkStepInner(a); }
      tx = c.x; ty = c.y;
    }
    this.moveToward(a, tx, ty);
    if (a.walkbox === a.destBox || a.destBox < 0) {
      if (Math.abs(a.x - a.destX) < 0.5 && Math.abs(a.y - a.destY) < 0.5) {
        a.x = a.destX; a.y = a.destY;
        this.stopMoving(a);
        if (a.destDir >= 0) this.setFacing(a, a.destDir);
      }
    } else {
      const nb = this.nextBox(a.walkbox, a.destBox);
      if (nb >= 0 && this.closestInBox(nb, a.x, a.y).dist < 0.01) a.walkbox = nb;
    }
  }
  walkStepInner(a) {
    // re-evaluate after switching boxes (bounded recursion)
    a._depth = (a._depth || 0) + 1;
    if (a._depth < 6) this.walkStep(a);
    a._depth = 0;
  }
  moveToward(a, tx, ty) {
    const dx = tx - a.x, dy = ty - a.y;
    const t = Math.max(Math.abs(dx) / 8, Math.abs(dy) / 2);
    if (t <= 1) { a.x = tx; a.y = ty; } else { a.x += dx / t; a.y += dy / t; }
    let dir;
    if (Math.abs(dx) / 8 >= Math.abs(dy) / 2) dir = dx < 0 ? 0 : 1; else dir = dy < 0 ? 3 : 2;
    if (t > 0 && dir !== a.facing) { a.facing = dir; this.resetAnim(a); }
  }
  actorAt(x, y) {
    for (let i = 1; i <= NUM_ACTORS; i++) {
      const a = this.actors[i];
      if (a.room !== this.roomId || !a.cost || i === this.vars[VAR.EGO]) continue;
      if (Math.abs(x - a.x - 8) <= 12 && y <= a.y - a.elevation && y >= a.y - a.elevation - 48) return i;
    }
    return 0;
  }

  // ---------------------------------------------------------------- scripts
  runScript(n) {
    if (!n) return;
    this.stopScript(n);
    const data = this.res.script(n);
    if (!data) { this.warn('missing script ' + n); return; }
    this._runSlot({ number: n, kind: 'global', data, pc: 4, status: 'run', delay: 0, frozen: false, didExec: false });
  }
  runObjectScript(obj, verb) {
    const o = this.obj(obj);
    const entry = this.verbEntry(obj, verb);
    if (!o || !entry) return false;
    const room = this.res.room(o.room);
    const old = this.slots.find((s) => s.kind === 'obj' && s.number === obj && s.status !== 'dead');
    if (old) old.status = 'dead';
    this._runSlot({ number: obj, kind: 'obj', data: room.data, pc: entry, status: 'run', delay: 0, frozen: false, didExec: false });
    return true;
  }
  runRoomScript(offs, number) {
    if (!offs || !this.room) return;
    this._runSlot({ number, kind: 'room', room: this.roomId, data: this.room.data, pc: offs, status: 'run', delay: 0, frozen: false, didExec: false });
  }
  _runSlot(slot) {
    this.slots.push(slot);
    this._exec(slot);
  }
  stopScript(n) {
    for (const s of this.slots) if (s.kind === 'global' && s.number === n && s.status !== 'dead') s.status = 'dead';
  }
  stopObjectScript(n) {
    for (const s of this.slots) if (s.kind === 'obj' && s.number === n && s.status !== 'dead') s.status = 'dead';
  }
  isScriptRunning(n) {
    return this.slots.some((s) => s.kind === 'global' && s.number === n && s.status !== 'dead');
  }
  freezeScripts() { for (const s of this.slots) if (s !== this.current && s.status !== 'dead') s.frozen = true; }
  unfreezeScripts() { for (const s of this.slots) s.frozen = false; }

  _exec(slot) {
    const prev = this.current;
    this.current = slot;
    slot.didExec = true;
    slot.breakNow = false;
    let guard = 0;
    while (slot.status === 'run' && !slot.breakNow) {
      if (++guard > 200000) { this.warn(`script ${slot.kind} ${slot.number} runaway`); slot.status = 'dead'; break; }
      let ins;
      try { ins = decode(slot.data, slot.pc); } catch (e) { this.warn('decode ' + e.message); slot.status = 'dead'; break; }
      slot.insPc = slot.pc;
      slot.pc = ins.next;
      const fn = this['op_' + ins.name];
      if (!fn) { this.warn('unimplemented op ' + ins.name); continue; }
      try { fn.call(this, ins.args, ins, slot); } catch (e) {
        this.warn(`op ${ins.name} in ${slot.kind} ${slot.number}@${slot.insPc}: ${e.message}`);
      }
    }
    this.current = prev;
  }
  val(a) { return a !== null && typeof a === 'object' && !(a instanceof Uint8Array) && !Array.isArray(a) ? this.vars[a.v] : a; }
  setVar(n, v) {
    this.vars[n] = v;
  }
  jumpIf(cond, target) { if (!cond) this.current.pc = target; }
  breakHere() { this.current.breakNow = true; }
  rewind() { this.current.pc = this.current.insPc; this.breakHere(); }

  // --- flow
  op_stopObjectCode() { this.current.status = 'dead'; }
  op_breakHere() { this.breakHere(); }
  op_jumpRelative([t]) { this.current.pc = t; }
  op_delay([n]) { this.current.delay = n; this.current.status = 'pause'; this.breakHere(); }
  op_delayVariable([v]) { this.current.delay = this.vars[v]; this.current.status = 'pause'; this.breakHere(); }
  op_startScript([n]) { this.runScript(this.val(n)); }
  op_stopScript([n]) {
    let s = this.val(n);
    if (s === 0) { this.current.status = 'dead'; return; }
    this.stopScript(s);
  }
  op_chainScript([n]) { const s = this.val(n); this.current.status = 'dead'; this.runScript(s); }
  op_isScriptRunning([r, n]) { this.setVar(r, this.isScriptRunning(this.val(n)) ? 1 : 0); }
  op_restart() { this.restartRequested = true; this.current.status = 'dead'; }
  op_dummy() {}
  op_resourceRoutines() {}
  op_switchCostumeSet() {}
  op_pseudoRoom() {}

  // --- variables
  op_move([r, v]) { this.setVar(r, this.val(v)); }
  op_assignVarByte([r, v]) { this.setVar(r, v); }
  op_assignVarWordIndirect([r, v]) { this.setVar(this.vars[r], this.val(v)); }
  op_addIndirect([r, v]) { this.vars[this.vars[r]] += this.val(v); }
  op_subIndirect([r, v]) { this.vars[this.vars[r]] -= this.val(v); }
  op_add([r, v]) { this.vars[r] += this.val(v); }
  op_subtract([r, v]) { this.vars[r] -= this.val(v); }
  op_increment([r]) { this.vars[r]++; }
  op_decrement([r]) { this.vars[r]--; }
  op_setVarRange([r, vals]) { vals.forEach((v, i) => this.setVar(r + i, v)); }
  op_getRandomNr([r, max]) { this.setVar(r, Math.floor(this.rng() * (this.val(max) + 1))); }
  op_setBitVar([base, a, v]) {
    const bit = base + this.val(a);
    const idx = bit >> 4, mask = 1 << (bit & 15);
    if (this.val(v)) this.vars[idx] |= mask; else this.vars[idx] &= ~mask;
  }
  op_getBitVar([r, base, a]) {
    const bit = base + this.val(a);
    this.setVar(r, (this.vars[bit >> 4] >> (bit & 15)) & 1);
  }
  op_isEqual([v, b, t]) { this.jumpIf(this.val(b) === this.vars[v], t); }
  op_isNotEqual([v, b, t]) { this.jumpIf(this.val(b) !== this.vars[v], t); }
  op_isGreaterEqual([v, b, t]) { this.jumpIf(this.val(b) >= this.vars[v], t); }
  op_isGreater([v, b, t]) { this.jumpIf(this.val(b) > this.vars[v], t); }
  op_isLess([v, b, t]) { this.jumpIf(this.val(b) < this.vars[v], t); }
  op_isLessEqual([v, b, t]) { this.jumpIf(this.val(b) <= this.vars[v], t); }
  op_equalZero([v, t]) { this.jumpIf(this.vars[v] === 0, t); }
  op_notEqualZero([v, t]) { this.jumpIf(this.vars[v] !== 0, t); }

  // --- object state
  _setState(o, bit, on) {
    const id = this.val(o);
    if (id <= 0 || id >= this.objState.length) return;
    if (on) this.objState[id] |= bit; else this.objState[id] &= ~bit;
  }
  _ifState(o, bit, want, t) {
    const id = this.val(o);
    const has = id > 0 && id < this.objState.length && (this.objState[id] & bit) !== 0;
    this.jumpIf(has === want, t);
  }
  op_setState08([o]) { this._setState(o, 8, true); }
  op_clearState08([o]) { this._setState(o, 8, false); }
  op_setState04([o]) { this._setState(o, 4, true); }
  op_clearState04([o]) { this._setState(o, 4, false); }
  op_setState02([o]) { this._setState(o, 2, true); }
  op_clearState02([o]) { this._setState(o, 2, false); }
  op_setState01([o]) { this._setState(o, 1, true); }
  op_clearState01([o]) { this._setState(o, 1, false); }
  op_ifState08([o, t]) { this._ifState(o, 8, true, t); }
  op_ifNotState08([o, t]) { this._ifState(o, 8, false, t); }
  op_ifState04([o, t]) { this._ifState(o, 4, true, t); }
  op_ifNotState04([o, t]) { this._ifState(o, 4, false, t); }
  op_ifState02([o, t]) { this._ifState(o, 2, true, t); }
  op_ifNotState02([o, t]) { this._ifState(o, 2, false, t); }
  op_ifState01([o, t]) { this._ifState(o, 1, true, t); }
  op_ifNotState01([o, t]) { this._ifState(o, 1, false, t); }
  op_ifClassOfIs([o, cls, t]) {
    const od = this.obj(this.val(o));
    const c = this.val(cls);
    const data = od ? this.res.room(od.room).data : null;
    this.jumpIf(!!od && (data[od.codeOffs + 6] & c) === c, t);
  }
  op_getObjectOwner([r, o]) { this.setVar(r, this.objOwner[this.val(o)]); }
  op_setOwnerOf([o, owner]) {
    const id = this.val(o), ow = this.val(owner);
    if (ow === 0) this.stopObjectScript(id);
    this.objOwner[id] = ow;
    this.clampInventory();
  }
  op_pickupObject([o]) {
    const id = this.val(o);
    if (id < 1 || !this.objInRoom(id) || this.whereIs(id) === 'inventory') return;
    this.objOwner[id] = this.vars[VAR.EGO];
    this.objState[id] |= 8 | 2;
    this.clampInventory();
  }
  op_setObjectName([o, name]) { this.objNames.set(this.val(o), readString(name, 0).replace(/@+/g, '')); }
  op_getObjPreposition([r, o]) {
    const id = this.val(o);
    const od = this.obj(id);
    if (!od || this.whereIs(id) === 'none') { this.setVar(r, 0xff); return; }
    this.setVar(r, this.objPrep.has(id) ? this.objPrep.get(id) : od.walkBits);
  }
  op_setObjPreposition([o, p]) { this.objPrep.set(this.val(o), p); }
  op_drawObject([o, x, y]) {
    const id = this.val(o), xp = this.val(x), yp = this.val(y);
    const od = this.objInRoom(id);
    if (!od) return;
    if (xp !== 0xff) {
      const nx = xp * 8, ny = yp * 8;
      this.drawOverrides.set(id, { x: nx, y: ny, walkX: od.walkX * 8 + nx - od.x, walkY: od.walkY * 8 + ny - od.y });
    }
    const p = this.objPos(od);
    for (const other of this.room.objects) {
      const q = this.objPos(other);
      if (q.x === p.x && q.y === p.y && other.width === od.width && other.height === od.height) this.objState[other.id] &= ~8;
    }
    this.objState[id] |= 8;
  }
  op_findObject([r, x, y]) { this.setVar(r, this.findObject(this.val(x) * 8, this.val(y) * 2)); }
  op_getDist([r, a, b]) {
    const ia = this.val(a), ib = this.val(b);
    const p = this.objActXY(ia);
    let q = this.objActXY(ib);
    if (!p || !q) { this.setVar(r, 0xff); return; }
    // an object's stand-point is measured after snapping it into the walkable area
    if (ia <= NUM_ACTORS && ib > NUM_ACTORS && this.whereIs(ib) === 'room') q = this.adjustXY(q.x, q.y);
    this.setVar(r, Math.min(0xff, Math.floor(Math.max(Math.abs(p.x - q.x) / 8, Math.abs(p.y - q.y) / 2))));
  }
  op_getClosestObjActor([r, o]) {
    const p = this.objActXY(this.val(o));
    let best = 0xff, bestDist = 0xff;
    if (p) {
      for (let i = this.vars[VAR.ACTOR_RANGE_MIN]; i <= this.vars[VAR.ACTOR_RANGE_MAX]; i++) {
        const q = this.objActXY(i);
        if (!q || i === this.val(o)) continue;
        const dist = Math.max(Math.abs(p.x - q.x) / 8, Math.abs(p.y - q.y) / 2);
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
    }
    this.setVar(r, best);
  }

  // --- actors
  act(n) { const a = this.actors[this.val(n)]; if (!a) throw new Error('bad actor ' + this.val(n)); return a; }
  op_actorOps([act, arg, sub, extra]) {
    const a = this.act(act), v = this.val(arg);
    switch (sub) {
      case 1: a.sound = v; break;
      case 2: a.palette[extra] = v; break;
      case 3: a.name = readString(extra, 0).replace(/@+/g, ''); break;
      case 4: this.setCostume(a, v); break;
      case 5: a.talkColor = v; break;
      default: this.warn('actorOps ' + sub);
    }
  }
  op_putActor([act, x, y]) { const a = this.act(act); this.putActor(a, this.val(x) * 8, this.val(y) * 2); }
  op_putActorInRoom([act, room]) {
    const a = this.act(act), r = this.val(room);
    a.room = r;
    a.moving = false;
    if (!r) { a.facing = 2; a.x = 0; a.y = 0; }
    this.resetAnim(a);
  }
  op_putActorAtObject([act, o]) {
    const a = this.act(act);
    const p = this.objActXY(this.val(o)) || { x: 240, y: 120 };
    const adj = this.adjustXY(p.x, p.y);
    this.putActor(a, adj.x, adj.y);
  }
  op_walkActorTo([act, x, y]) { this.startWalk(this.act(act), this.val(x) * 8, this.val(y) * 2, -1); }
  op_walkActorToObject([act, o]) {
    const a = this.act(act);
    const p = this.objActXY(this.val(o));
    if (p) this.startWalk(a, p.x, p.y, p.dir);
  }
  op_walkActorToActor([act, act2, dist]) {
    const a = this.act(act), b = this.act(act2);
    if (a.room !== this.roomId || b.room !== this.roomId) return;
    const d = dist * 8;
    this.startWalk(a, b.x < a.x ? b.x + d : b.x - d, b.y, -1);
  }
  op_faceActor([act, o]) {
    const a = this.act(act);
    const p = this.objActXY(this.val(o));
    if (p) this.setFacing(a, p.x > a.x ? 1 : 0);
  }
  op_animateActor([act, anim]) {
    const a = this.act(act), v = this.val(anim);
    const cmd = v >> 2, dir = v & 3;
    if (cmd === 0x3f) this.stopMoving(a);
    else if (cmd === 0x3e || cmd === 0x3d) this.setFacing(a, dir);
    else {
      a.extraAnim = cmd;
      if (cmd === 0 || cmd === 1) a.extraAnim = -1;
      this.startAnim(a, cmd);
    }
  }
  op_waitForActor([act]) { if (this.act(act).moving) this.rewind(); }
  op_getActorRoom([r, act]) { this.setVar(r, this.act(act).room); }
  op_getActorX([r, act]) { this.setVar(r, Math.round(this.act(act).x / 8)); }
  op_getActorY([r, act]) { this.setVar(r, Math.round(this.act(act).y / 2)); }
  op_getActorElevation([r, act]) { this.setVar(r, this.act(act).elevation); }
  op_setActorElevation([act, e]) { this.act(act).elevation = this.val(e); }
  op_getActorMoving([r, act]) { this.setVar(r, this.act(act).moving ? 1 : 0); }
  op_getActorFacing([r, act]) { this.setVar(r, this.act(act).facing); }
  op_getActorCostume([r, act]) { this.setVar(r, this.act(act).costumeId); }
  op_getActorWalkBox([r, act]) { this.setVar(r, Math.max(0, this.act(act).walkbox)); }
  op_actorFromPos([r, x, y]) { this.setVar(r, this.actorAt(this.val(x) * 8, this.val(y) * 2)); }
  op_actorFollowCamera([act]) { this.actorFollowCamera(this.val(act)); }

  // --- camera / room
  actorFollowCamera(n) {
    const a = this.actors[n];
    this.camera.mode = 2;
    this.camera.follows = n;
    if (!a) return;
    if (a.room !== this.roomId) {
      this.startScene(a.room);
      this.camera.mode = 2;
      this.camera.follows = n;
      this.camera.x = this.camera.dest = a.x;
    } else if (Math.abs(a.x - this.camera.x) > 80 * 2) this.camera.x = this.camera.dest = a.x;
    this.clampCamera();
  }
  clampCamera() {
    const min = this.vars[VAR.CAMERA_MIN_X], max = this.vars[VAR.CAMERA_MAX_X];
    for (const k of ['x', 'dest']) this.camera[k] = Math.max(min, Math.min(max, this.camera[k]));
    this.vars[VAR.CAMERA_POS_X] = this.camera.x >> 3;
  }
  op_setCameraAt([x]) { this.camera.mode = 1; this.camera.x = this.camera.dest = this.val(x) * 8; this.camera.movingToActor = false; this.clampCamera(); }
  op_panCameraTo([x]) { this.camera.mode = 1; this.camera.dest = this.val(x) * 8; this.camera.movingToActor = false; }
  moveCamera() {
    const c = this.camera;
    const min = this.vars[VAR.CAMERA_MIN_X], max = this.vars[VAR.CAMERA_MAX_X];
    c.prevX = c.x;
    c.x &= ~7;
    if (c.x < min) { c.x += 8; return this.clampTick(); }
    if (c.x > max) { c.x -= 8; return this.clampTick(); }
    const a = c.mode === 2 ? this.actors[c.follows] : null;
    if (a && a.room === this.roomId) {
      const t = Math.floor(a.x / 8) - ((c.x - 160) >> 3);
      if (t < 10 || t > 30) c.movingToActor = true;
      if (c.movingToActor) c.dest = a.x;
    }
    c.dest = Math.max(min, Math.min(max, c.dest));
    if (c.x < c.dest) c.x += 8;
    if (c.x > c.dest + 7) c.x -= 8;
    if (a && c.movingToActor && (c.x >> 3) === (Math.floor(a.x) >> 3)) c.movingToActor = false;
    this.clampTick();
  }
  clampTick() { this.vars[VAR.CAMERA_POS_X] = this.camera.x >> 3; }
  // Debug/helper: move the current kid to a room, standing at an object (or the first box).
  teleport(roomId, objId = 0) {
    const a = this.actors[this.vars[VAR.EGO]];
    a.room = roomId;
    this.startScene(roomId);
    const p = (objId && this.objActXY(objId)) || { x: 160, y: 120 };
    const adj = this.adjustXY(p.x, p.y);
    this.putActor(a, adj.x, adj.y, roomId);
    this.camera.mode = 2; this.camera.follows = a.id; this.camera.x = this.camera.dest = a.x;
    this.clampCamera();
  }
  op_loadRoom([r]) { const room = this.val(r); if (room !== this.roomId) this.startScene(room); }
  op_loadRoomWithEgo([o, r, x, y]) {
    const obj = this.val(o), room = this.val(r);
    const a = this.actors[this.vars[VAR.EGO]];
    a.room = room;
    a.moving = false;
    this.startScene(room);
    const p = this.objActXY(obj) || { x: 160, y: 120, dir: 2 };
    const adj = this.adjustXY(p.x, p.y);
    this.putActor(a, adj.x, adj.y, room);
    if (p.dir >= 0) this.setFacing(a, p.dir ^ 1);
    this.camera.x = this.camera.dest = a.x;
    this.camera.mode = 2; this.camera.follows = a.id; this.camera.movingToActor = false;
    this.clampCamera();
    this.camera.prevX = this.camera.x;
    this.resetSentence();
    const sx = (x << 24) >> 24, sy = (y << 24) >> 24;
    if (sx >= 0 && sy >= 0) this.startWalk(a, sx * 8, sy * 2, -1);
    this.runScript(5);
  }
  startScene(roomId) {
    if (this.room) this.runRoomScript(this.room.excdOffs, 10001);
    for (const s of this.slots) {
      if (s.status === 'dead') continue;
      if (s.kind === 'room') s.status = 'dead';
      if (s.kind === 'obj' && this.objOwner[s.number] === OWNER_ROOM) s.status = 'dead';
    }
    this.stopTalk();
    this.vars[VAR.ROOM] = roomId;
    this.vars[VAR.ROOM_RESOURCE] = roomId;
    this.roomId = roomId;
    this.room = roomId ? this.res.room(roomId) : null;
    this.drawOverrides.clear();
    this.camera.mode = 1;
    this.camera.movingToActor = false;
    if (!this.room) { this.boxFlags = []; return; }
    this.boxFlags = this.room.boxes.map((b) => b.flags);
    this.roomPalette = Array.from({ length: 16 }, (_, i) => i);
    this.vars[VAR.CAMERA_MIN_X] = 160;
    this.vars[VAR.CAMERA_MAX_X] = Math.max(160, this.room.width - 160);
    this.camera.x = this.camera.dest = 160;
    this.camera.prevX = 160;
    this.clampCamera();
    for (const a of this.actors) {
      if (a.room === roomId) { const adj = this.adjustXY(a.x, a.y); a.walkbox = adj.box; a.moving = false; this.resetAnim(a); }
    }
    if (this.hooks.roomChanged) this.hooks.roomChanged(roomId);
    this.runRoomScript(this.room.encdOffs, 10002);
  }
  op_roomOps([a, b, sub]) {
    const x = this.val(a), y = this.val(b);
    switch (sub & 0x1f) {
      case 1: {
        const w = this.room ? this.room.width : 320;
        this.vars[VAR.CAMERA_MIN_X] = Math.max(160, Math.min(w - 160, x * 8));
        this.vars[VAR.CAMERA_MAX_X] = Math.max(160, Math.min(w - 160, y * 8));
        break;
      }
      case 2: if (this.roomPalette) { this.roomPalette[y] = x; if (this.hooks.roomChanged) this.hooks.roomChanged(this.roomId); } break;
      default: this.warn('roomOps ' + sub);
    }
  }
  op_setBoxFlags([b, f]) { const i = this.val(b); if (this.boxFlags && i < this.boxFlags.length) this.boxFlags[i] = f; }
  op_lights([a, b, c]) {
    const v = this.val(a);
    if (c === 0) this.vars[VAR.CURRENT_LIGHTS] = v;
    else if (c === 1) this.flashlight = { w: v, h: b };
  }

  // --- sound
  _startSound(id) {
    this.vars[VAR.LAST_SOUND] = id;
    if (this.hooks.sound) this.hooks.sound(id, this.res.sound(id));
    // without an audio host, estimate: short effects ~0.5s, long pieces keep "running"
    const data = this.res.sound(id);
    this.sounds.set(id, data && data.length > 2500 ? 60 * 120 : 30);
    this.musicClock = 0;
  }
  soundRunning(id) {
    if (!id) return false;
    if (this.hooks.soundRunning) return this.hooks.soundRunning(id);
    return this.sounds.has(id);
  }
  op_startSound([s]) { this._startSound(this.val(s)); }
  op_startMusic([s]) { this.music = this.val(s); this._startSound(this.music); }
  op_stopSound([s]) { const id = this.val(s); this.sounds.delete(id); if (this.hooks.stopSound) this.hooks.stopSound(id); }
  op_isSoundRunning([r, s]) { this.setVar(r, this.soundRunning(this.val(s)) ? 1 : 0); }
  op_stopMusic() { this.music = 0; this.sounds.clear(); if (this.hooks.stopMusic) this.hooks.stopMusic(); }

  // --- text
  expandText(bytes) {
    const pages = [''];
    for (const t of decodeText(bytes)) {
      const p = pages.length - 1;
      if (typeof t === 'string') pages[p] += t.replace(/\^/g, '\u2026');
      else if (t.code === 1) pages[p] += '\n';
      else if (t.code === 2) pages.keep = true;
      else if (t.code === 3) pages.push('');
      else if (t.code === 4) pages[p] += String(this.vars[t.arg]);
      else if (t.code === 5) { const v = this.verbs.find((x) => x.id === this.vars[t.arg]); pages[p] += v ? v.name : ''; }
      else if (t.code === 6) pages[p] += this.objName(this.vars[t.arg]);
      else if (t.code === 7) {
        // string stored as character codes in consecutive variables
        for (let i = t.arg; i < t.arg + 40 && this.vars[i] > 0; i++) pages[p] += String.fromCharCode(this.vars[i] & 0x7f);
      }
    }
    const out = pages.filter((s, i) => s.trim().length || i === 0);
    out.keep = !!pages.keep;
    return out;
  }
  talk(actorNum, bytes) {
    const pages = this.expandText(bytes);
    const prev = this.text;
    if (prev && prev.keep && prev.actor === actorNum && pages.length === 1 && pages[0].length) {
      // "keep text" mode: append to what is already on screen (used by the keypad prompt)
      prev.pages[prev.page] += pages[0];
      prev.keep = pages.keep;
      return;
    }
    this.stopTalk();
    if (pages.length === 1 && !pages[0].trim()) return;
    let color = 15;
    const a = actorNum < this.actors.length ? this.actors[actorNum] : null;
    if (a) {
      color = a.talkColor;
      if (a.room === this.roomId) { a.talking = true; this.startAnim(a, 5); }
    }
    this.vars[VAR.TALK_ACTOR] = a ? actorNum : 0xff;
    this.text = { pages, page: 0, timer: this.pageTime(pages[0]), color, actor: actorNum, keep: pages.keep };
    this.vars[VAR.HAVE_MSG] = 0xff;
    this.vars[VAR.CHARCOUNT] = pages[0].length;
  }
  pageTime(s) { return 60 + s.length * 5; }
  stopTalk() {
    if (!this.text) { this.vars[VAR.HAVE_MSG] = 0; return; }
    const a = this.actors[this.text.actor];
    if (a) { a.talking = false; this.startAnim(a, 4); }
    this.text = null;
    this.vars[VAR.HAVE_MSG] = 0;
  }
  skipText() {
    if (!this.text) return;
    if (++this.text.page >= this.text.pages.length) this.stopTalk();
    else {
      this.text.timer = this.pageTime(this.text.pages[this.text.page]);
      this.vars[VAR.CHARCOUNT] += this.text.pages[this.text.page].length;
    }
  }
  op_print([act, msg]) { this.talk(this.val(act), msg); }
  op_printEgo([msg]) { this.talk(this.vars[VAR.EGO], msg); }
  op_waitForMessage() { if (this.vars[VAR.HAVE_MSG]) this.rewind(); }

  // --- verbs / sentences / interface
  op_verbOps([sub, ...rest]) {
    if (sub === 0) {
      const slot = this.val(rest[0]);
      this.verbs = this.verbs.filter((v) => v.slot !== slot);
    } else if (sub === 0xff) {
      const v = this.verbs.find((x) => x.id === rest[0]);
      if (v) v.on = rest[1] !== 0;
    } else {
      const [x, y, slotArg, prep, name] = rest;
      const slot = this.val(slotArg);
      this.verbs = this.verbs.filter((v) => v.slot !== slot);
      const raw = readString(name, 0).replace(/@+/g, '');
      const lead = raw.length - raw.trimStart().length; // padding used to position kid names
      this.verbs.push({ id: sub, slot, x: (x + lead) * 8, y: y * 8, prep, name: raw.trim(), on: true });
    }
  }
  resetSentence() {
    this.vars[VAR.SENTENCE_VERB] = this.vars[VAR.BACKUP_VERB];
    this.vars[VAR.SENTENCE_OBJECT1] = 0;
    this.vars[VAR.SENTENCE_OBJECT2] = 0;
    this.vars[VAR.SENTENCE_PREPOSITION] = 0;
  }
  op_doSentence([verbArg, a, b, mode]) {
    const verb = this.val(verbArg);
    if (verb === 0xfc) { this.sentence.length = 0; this.stopScript(2); return; }
    if (verb === 0xfb) { this.resetSentence(); return; }
    const st = { verb, objA: this.val(a), objB: this.val(b) };
    if (mode === 0) { this.sentence.push(st); return; }
    if (mode === 1) {
      if (st.verb === 254) { this.stopObjectScript(st.objA); return; }
      if (st.verb !== 253 && st.verb !== 250) {
        this.vars[VAR.ACTIVE_VERB] = st.verb;
        this.vars[VAR.ACTIVE_OBJECT1] = st.objA;
        this.vars[VAR.ACTIVE_OBJECT2] = st.objB;
      } else st.verb = 253;
      this.runObjectScript(st.objA, st.verb);
      return;
    }
    this.vars[VAR.SENTENCE_VERB] = st.verb;
    this.vars[VAR.SENTENCE_OBJECT1] = st.objA;
    this.vars[VAR.SENTENCE_OBJECT2] = st.objB;
    this.op_drawSentence();
  }
  op_drawSentence() {
    if (!(this.userState & US.SENTENCE)) return;
    const v = this.verbs.find((x) => x.id === this.vars[VAR.SENTENCE_VERB]);
    if (!v) return;
    let s = v.name;
    const o1 = this.vars[VAR.SENTENCE_OBJECT1], o2 = this.vars[VAR.SENTENCE_OBJECT2], prep = this.vars[VAR.SENTENCE_PREPOSITION];
    if (o1 > 0) s += ' ' + this.objName(o1);
    if (prep > 0 && prep <= 4) s += PREPOSITIONS[prep];
    if (o2 > 0) s += ' ' + this.objName(o2);
    this.sentenceLine = s;
  }
  op_waitForSentence() { if (this.sentence.length || this.isScriptRunning(2)) this.rewind(); }
  checkSentence() {
    if (this.slots.some((s) => s.kind === 'global' && s.number === 2 && s.status !== 'dead' && !s.frozen)) return;
    if (!this.sentence.length) return;
    const st = this.sentence.pop();
    if (st.objB && st.objB === st.objA) return;
    this.vars[VAR.ACTIVE_VERB] = st.verb;
    this.vars[VAR.ACTIVE_OBJECT1] = st.objA;
    this.vars[VAR.ACTIVE_OBJECT2] = st.objB;
    this.vars[VAR.VERB_ALLOWED] = this.verbEntry(st.objA, st.verb) ? 1 : 0;
    this.runScript(2);
  }
  setUserState(state) {
    if (state & US.SET_IFACE) this.userState = (this.userState & ~0xe0) | (state & 0xe0);
    if (state & US.SET_FREEZE) { if (state & US.FREEZE_ON) this.freezeScripts(); else this.unfreezeScripts(); }
    if (state & US.SET_CURSOR) {
      this.userState = (this.userState & ~US.CURSOR_ON) | (state & US.CURSOR_ON);
      this.userPut = this.cursorOn = (state & US.CURSOR_ON) !== 0;
    }
    if (!(this.userState & US.SENTENCE)) this.sentenceLine = '';
    else if (state & US.SET_IFACE) this.op_drawSentence();
  }
  op_cursorCommand([c]) {
    const cmd = this.val(c);
    if (cmd & 0xff) this.vars[VAR.CURSORSTATE] = cmd & 0xff;
    this.setUserState(cmd >> 8);
  }
  op_cutscene() {
    const c = this.cutscene;
    c.data = [this.userState | (this.userPut ? 16 : 0), this.vars[VAR.CURSORSTATE], this.roomId, this.camera.mode];
    this.vars[VAR.CURSORSTATE] = 200;
    this.setUserState(US.SET_IFACE | US.SET_CURSOR | US.SET_FREEZE | US.FREEZE_ON);
    this.sentence.length = 0;
    this.stopScript(2);
    this.resetSentence();
    c.ptr = 0;
  }
  op_endCutscene() {
    const c = this.cutscene;
    this.vars[VAR.OVERRIDE] = 0;
    c.script = null; c.ptr = 0;
    this.vars[VAR.CURSORSTATE] = c.data[1];
    this.setUserState(c.data[0] | US.SET_IFACE | US.SET_CURSOR | US.SET_FREEZE);
    this.camera.mode = c.data[3];
    if (this.camera.mode === 2) this.actorFollowCamera(this.vars[VAR.EGO]);
    else if (c.data[2] !== this.roomId) this.startScene(c.data[2]);
  }
  op_beginOverride([jumpPc]) { this.cutscene.ptr = jumpPc; this.cutscene.script = this.current; }
  abortCutscene() {
    const c = this.cutscene;
    if (!c.ptr || !c.script || c.script.status === 'dead') return false;
    c.script.pc = c.ptr;
    c.script.status = 'run';
    c.script.delay = 0;
    c.script.frozen = false;
    c.ptr = 0;
    this.vars[VAR.OVERRIDE] = 1;
    this.stopTalk();
    return true;
  }
  op_saveLoadGame([r, a]) {
    const v = this.val(a);
    const op = v & 0xe0, slot = v & 0x1f;
    let result = 0;
    if (this.hooks.saveLoad) result = this.hooks.saveLoad(op, slot);
    else if (op === 0x40 || op === 0x80) result = 5; // failed
    else if (op === 0xc0) result = 7; // not found
    this.setVar(r, result);
  }

  // ---------------------------------------------------------------- input
  clampInventory() {
    const n = this.inventory().length;
    if (this.invOffset >= n) this.invOffset = Math.max(0, (n - 1) & ~1);
  }
  inventoryLayout() {
    const items = this.inventory();
    const out = [];
    for (let i = 0; i < 4; i++) {
      const id = items[this.invOffset + i];
      if (id === undefined) continue;
      out.push({ id, x: i & 1 ? 176 : 0, y: SCREEN.INV_TOP + (i >> 1) * 8, w: 144, h: 8, name: this.objName(id) });
    }
    return { items: out, up: this.invOffset > 0, down: this.invOffset + 4 < items.length };
  }
  verbAt(x, y) {
    if (!(this.userState & US.VERBS)) return null;
    for (const v of this.verbs) {
      if (!v.on) continue;
      if (y >= v.y && y < v.y + 8 && x >= v.x && x < v.x + Math.max(v.name.length, 1) * 8) return v;
    }
    return null;
  }
  // The 1988 interface needs a second click to run a finished sentence. With autoExecute
  // the engine issues that confirming click itself once the sentence is complete.
  maybeAutoExecute(area) {
    if (!this.autoExecute || !this.userPut) return;
    if (area !== CLICK.SCENE && area !== CLICK.INVENTORY) return;
    const verb = this.vars[VAR.SENTENCE_VERB], o1 = this.vars[VAR.SENTENCE_OBJECT1];
    const o2 = this.vars[VAR.SENTENCE_OBJECT2], prep = this.vars[VAR.SENTENCE_PREPOSITION];
    if (!o1 || verb === this.vars[VAR.BACKUP_VERB] || verb === 15) return;
    if (prep && !o2) return;
    this.confirmSentence();
  }
  // The input script runs a sentence when its last object is clicked a second time.
  confirmSentence() {
    const o = this.vars[VAR.SENTENCE_OBJECT2] || this.vars[VAR.SENTENCE_OBJECT1];
    if (o) this.inputScript(CLICK.INVENTORY, o, 0);
    else this.inputScript(CLICK.SENTENCE, 0, 0);
  }
  inputScript(area, val, mode) {
    this.vars[VAR.CLICK_AREA] = area;
    if (area === CLICK.VERB) this.vars[VAR.CLICK_VERB] = val;
    else if (area === CLICK.SCENE || area === CLICK.INVENTORY) this.vars[VAR.CLICK_OBJECT] = val;
    else if (area === CLICK.KEY) this.vars[VAR.KEYPRESS] = val;
    this.runScript(4);
  }
  processInput() {
    const setVirtMouse = (m) => {
      const ry = Math.max(0, Math.min(SCREEN.ROOM_H - 1, m.y - SCREEN.ROOM_TOP));
      this.vars[VAR.VIRT_MOUSE_X] = (m.x + this.camera.x - 160) >> 3;
      this.vars[VAR.VIRT_MOUSE_Y] = ry >> 1;
    };
    setVirtMouse(this.mouse);
    const keys = this.keys; this.keys = [];
    const clicks = this.clicks; this.clicks = [];
    for (const k of keys) {
      if (k === 27) { this.abortCutscene(); continue; }
      if (k === 46 || k === 32) { this.skipText(); if (k === 32) continue; }
      if (this.userPut) this.inputScript(CLICK.KEY, k, 1);
    }
    for (const c of clicks) {
      if (!this.userPut) { continue; }
      setVirtMouse(c);
      const code = c.button === 2 ? 2 : 1;
      if (c.y >= SCREEN.VERB_TOP && c.y < SCREEN.VERB_TOP + 8) { this.confirmSentence(); continue; }
      if (c.y >= SCREEN.INV_TOP) {
        if (!(this.userState & US.INVENTORY)) continue;
        const inv = this.inventoryLayout();
        if (c.x >= 144 && c.x < 176) {
          if (c.y < SCREEN.INV_TOP + 8 && inv.up) this.invOffset -= 2;
          else if (c.y >= SCREEN.INV_TOP + 8 && inv.down) this.invOffset += 2;
          continue;
        }
        const it = inv.items.find((i) => c.x >= i.x && c.x < i.x + i.w && c.y >= i.y && c.y < i.y + i.h);
        if (it) { this.inputScript(CLICK.INVENTORY, it.id, 0); this.maybeAutoExecute(CLICK.INVENTORY); }
        continue;
      }
      const v = this.verbAt(c.x, c.y);
      if (v) this.inputScript(CLICK.VERB, v.id, code);
      else {
        const area = c.y >= SCREEN.ROOM_TOP && c.y < SCREEN.VERB_TOP ? CLICK.SCENE : CLICK.VERB;
        this.inputScript(area, 0, code);
        this.maybeAutoExecute(area);
      }
    }
  }

  // ---------------------------------------------------------------- main loop
  tick() {
    this.ticks++;
    const delta = Math.max(1, this.vars[VAR.TIMER_NEXT]);
    this.processInput();
    this.checkSentence();
    // timers
    for (const s of this.slots) {
      if (s.status === 'pause' && !s.frozen) { s.delay -= delta; if (s.delay < 0) { s.status = 'run'; s.delay = 0; } }
      s.didExec = false;
    }
    for (const [id, t] of this.sounds) { if (t - delta <= 0) this.sounds.delete(id); else this.sounds.set(id, t - delta); }
    if (this.hooks.musicTimer) this.vars[VAR.MUSIC_TIMER] = this.hooks.musicTimer();
    else { this.musicClock = (this.musicClock || 0) + delta; this.vars[VAR.MUSIC_TIMER] = Math.floor((this.musicClock / 60) * (236 / 66)); }
    if (this.text && !this.text.keep) {
      this.text.timer -= delta;
      if (this.text.timer <= 0) this.skipText();
    }
    // scripts (slots started during this pass run immediately via runScript)
    const n = this.slots.length;
    for (let i = 0; i < n; i++) {
      const s = this.slots[i];
      if (s.status === 'run' && !s.frozen && !s.didExec) this._exec(s);
    }
    this.slots = this.slots.filter((s) => s.status !== 'dead');
    for (let i = 1; i <= NUM_ACTORS; i++) {
      const a = this.actors[i];
      if (a.room !== this.roomId || !a.cost) { a.prevX = a.x; a.prevY = a.y; continue; }
      this.walkStep(a);
      a.cost.step(a.cs);
    }
    this.moveCamera();
  }

  // ---------------------------------------------------------------- save / load
  snapshot() {
    const live = this.slots.filter((s) => s.status !== 'dead');
    return {
      v: 1,
      vars: Array.from(this.vars),
      objOwner: Array.from(this.objOwner),
      objState: Array.from(this.objState),
      objNames: [...this.objNames],
      objPrep: [...this.objPrep],
      actors: this.actors.map((a) => ({
        name: a.name, room: a.room, x: a.x, y: a.y, elevation: a.elevation, costumeId: a.costumeId, facing: a.facing,
        moving: a.moving, destX: a.destX, destY: a.destY, destDir: a.destDir, destBox: a.destBox, walkbox: a.walkbox,
        talkColor: a.talkColor, palette: a.palette, sound: a.sound, extraAnim: a.extraAnim,
      })),
      slots: live.map((s) => ({ number: s.number, kind: s.kind, room: s.room || 0, pc: s.pc, status: s.status, delay: s.delay, frozen: s.frozen })),
      verbs: this.verbs,
      sentence: this.sentence,
      userState: this.userState, userPut: this.userPut, cursorOn: this.cursorOn,
      roomId: this.roomId, roomPalette: this.roomPalette, boxFlags: this.boxFlags,
      camera: this.camera,
      cutscene: { data: this.cutscene.data, ptr: this.cutscene.ptr, script: live.indexOf(this.cutscene.script) },
      drawOverrides: [...this.drawOverrides],
      invOffset: this.invOffset, sentenceLine: this.sentenceLine, flashlight: this.flashlight,
    };
  }
  restore(snap) {
    if (!snap || snap.v !== 1) return false;
    this.vars.set(snap.vars);
    this.objOwner.set(snap.objOwner);
    this.objState.set(snap.objState);
    this.objNames = new Map(snap.objNames);
    this.objPrep = new Map(snap.objPrep);
    this.roomId = snap.roomId;
    this.room = snap.roomId ? this.res.room(snap.roomId) : null;
    this.roomPalette = snap.roomPalette;
    this.boxFlags = snap.boxFlags || [];
    snap.actors.forEach((sa, i) => {
      const a = this.actors[i];
      Object.assign(a, sa);
      a.cost = a.costumeId ? this.costume(a.costumeId) : null;
      a.talking = false;
      a.prevX = a.x; a.prevY = a.y;
      const extra = a.extraAnim;
      this.resetAnim(a);
      if (extra >= 0) { a.extraAnim = extra; this.startAnim(a, extra); }
    });
    this.slots = [];
    for (const ss of snap.slots) {
      let data = null;
      if (ss.kind === 'global') data = this.res.script(ss.number);
      else if (ss.kind === 'obj') { const o = this.obj(ss.number); data = o ? this.res.room(o.room).data : null; }
      else { const r = this.res.room(ss.room || snap.roomId); data = r ? r.data : null; }
      this.slots.push({ ...ss, data, didExec: false, status: data ? ss.status : 'dead' });
    }
    this.verbs = snap.verbs;
    this.sentence = snap.sentence;
    this.userState = snap.userState; this.userPut = snap.userPut; this.cursorOn = snap.cursorOn;
    this.camera = { ...snap.camera, prevX: snap.camera.x };
    this.cutscene = { data: snap.cutscene.data, ptr: snap.cutscene.ptr, script: snap.cutscene.script >= 0 ? this.slots[snap.cutscene.script] : null };
    this.drawOverrides = new Map(snap.drawOverrides);
    this.invOffset = snap.invOffset;
    this.sentenceLine = snap.sentenceLine;
    this.flashlight = snap.flashlight;
    this.text = null;
    this.vars[VAR.HAVE_MSG] = 0;
    this.sounds.clear();
    this.clicks = []; this.keys = [];
    this.current = null;
    if (this.hooks.stopMusic) this.hooks.stopMusic();
    if (this.hooks.roomChanged) this.hooks.roomChanged(this.roomId);
    return true;
  }

  // Draw list of actors in the current room, back to front.
  visibleActors() {
    const out = [];
    for (let i = 1; i <= NUM_ACTORS; i++) {
      const a = this.actors[i];
      if (a.room === this.roomId && a.cost) out.push(a);
    }
    return out.sort((p, q) => p.y - q.y);
  }
}
