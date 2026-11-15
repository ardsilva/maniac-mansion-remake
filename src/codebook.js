// Built-in "Owner's Disarmament Quick Reference Guide" for the security door keypad.
// The game computes the expected four buttons for the access key it shows; this module
// reads that answer and maps it to the on-screen keypad buttons, so the remake can show
// the same lookup the printed code book provided.
import { decode } from './scumm/ops.js';

const KEYPAD_ROOM = 43;
const VAR_ENTERING = 69, VAR_BUTTON = 68, VAR_CODE = 63;
const VAR_SECTION = 197, VAR_COLUMN = 191, VAR_ROW = 190;

// button value -> object, for the buttons inside the current camera window
function buttonMap(engine) {
  const map = new Map();
  const room = engine.room;
  const left = engine.camera.x - 160;
  for (const o of room.objects) {
    const entry = o.verbs.get(0xff);
    if (!entry || o.x + o.width <= left || o.x >= left + 320) continue;
    let pc = entry;
    for (let i = 0; i < 6 && pc < o.codeEnd; i++) {
      const ins = decode(room.data, pc);
      if (ins.name === 'move' && ins.args[0] === VAR_BUTTON && typeof ins.args[1] === 'number') { map.set(ins.args[1], o); break; }
      if (ins.name === 'stopObjectCode') break;
      pc = ins.next;
    }
  }
  return map;
}

// Returns null when no code is being requested, else
// { section, column, row, buttons: [{x, y, w, h}] } with room-view pixel rectangles.
export function codeBook(engine) {
  if (engine.roomId !== KEYPAD_ROOM || !engine.room || engine.vars[VAR_ENTERING] !== 1) return null;
  const map = buttonMap(engine);
  const left = engine.camera.x - 160;
  const buttons = [];
  for (let i = 0; i < 4; i++) {
    const o = map.get(engine.vars[VAR_CODE + i]);
    if (!o) return null;
    buttons.push({ x: o.x - left, y: o.y, w: o.width, h: o.height });
  }
  return {
    section: engine.vars[VAR_SECTION],
    column: String.fromCharCode(64 + engine.vars[VAR_COLUMN]),
    row: engine.vars[VAR_ROW],
    buttons,
  };
}
