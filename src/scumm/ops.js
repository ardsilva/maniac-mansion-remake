// SCUMM v2 opcode table + instruction decoder (shared by the disassembler and the VM).
//
// Arg spec letters:
//   r  result variable (byte)          R  indirect result variable (byte)
//   v  variable reference (byte)       b  literal byte      w  literal word
//   1/2/3  var-or-byte selected by opcode bit 0x80/0x40/0x20
//   A/B/C  var-or-word selected by opcode bit 0x80/0x40/0x20
//   j  relative jump (signed word)     s  plain string      S  message string
//   *  custom (handled in decode)

export const SPEC = {
  stopObjectCode: '', putActor: '123', startMusic: '1', getActorRoom: 'r1',
  isGreaterEqual: 'vAj', drawObject: 'A23', getActorElevation: 'r1',
  setState08: 'A', clearState08: 'A', setState04: 'A', clearState04: 'A',
  setState02: 'A', clearState02: 'A', setState01: 'A', clearState01: 'A',
  ifState08: 'Aj', ifNotState08: 'Aj', ifState04: 'Aj', ifNotState04: 'Aj',
  ifState02: 'Aj', ifNotState02: 'Aj', ifState01: 'Aj', ifNotState01: 'Aj',
  isNotEqual: 'vAj', isEqual: 'vAj', isLess: 'vAj', isLessEqual: 'vAj', isGreater: 'vAj',
  faceActor: '1B', assignVarWordIndirect: 'RA', setObjPreposition: 'Ab',
  resourceRoutines: '1b', walkActorToActor: '12b', putActorAtObject: '1B',
  getObjectOwner: 'rA', animateActor: '12', panCameraTo: '1', actorOps: '*',
  print: '1S', printEgo: 'S', actorFromPos: 'r12', getRandomNr: 'r1',
  jumpRelative: 'j', doSentence: '*', move: 'rA', setBitVar: 'w12', getBitVar: 'rw1',
  startSound: '1', ifClassOfIs: 'A2j', walkActorTo: '123', stopMusic: '',
  saveLoadGame: 'r1', getActorY: 'r1', getActorX: 'r1', loadRoomWithEgo: 'A2bb',
  setVarRange: '*', equalZero: 'vj', notEqualZero: 'vj', setOwnerOf: 'A2',
  addIndirect: 'RA', subIndirect: 'RA', delayVariable: 'v', assignVarByte: 'rb',
  putActorInRoom: '12', delay: '*', setBoxFlags: '1b', setCameraAt: '1',
  roomOps: '12b', getDist: 'rAB', findObject: 'r12', walkActorToObject: '1B',
  subtract: 'rA', add: 'rA', waitForActor: '1', stopSound: '1',
  setActorElevation: '12', cutscene: '', endCutscene: '', startScript: '1',
  stopScript: '1', chainScript: '1', increment: 'r', decrement: 'r',
  waitForSentence: '', waitForMessage: '', pickupObject: 'A', actorFollowCamera: '1',
  setObjectName: 'As', getActorMoving: 'r1', getActorFacing: 'r1', getActorCostume: 'r1',
  getActorWalkBox: 'r1', beginOverride: '*', dummy: '', cursorCommand: 'A',
  getClosestObjActor: 'rA', isScriptRunning: 'r1', getObjPreposition: 'rA',
  lights: '1bb', loadRoom: '1', verbOps: '*', isSoundRunning: 'r1', restart: '',
  switchCostumeSet: 'b', drawSentence: '', pseudoRoom: '*', breakHere: '',
};

const BASE = [
  /* 00 */ 'stopObjectCode', 'putActor', 'startMusic', 'getActorRoom',
  /* 04 */ 'isGreaterEqual', 'drawObject', 'getActorElevation', 'setState08',
  /* 08 */ 'isNotEqual', 'faceActor', 'assignVarWordIndirect', 'setObjPreposition',
  /* 0c */ 'resourceRoutines', 'walkActorToActor', 'putActorAtObject', 'ifNotState08',
  /* 10 */ 'getObjectOwner', 'animateActor', 'panCameraTo', 'actorOps',
  /* 14 */ 'print', 'actorFromPos', 'getRandomNr', 'clearState02',
  /* 18 */ 'jumpRelative', 'doSentence', 'move', 'setBitVar',
  /* 1c */ 'startSound', 'ifClassOfIs', 'walkActorTo', 'ifState02',
  /* 20 */ 'stopMusic', 'putActor', 'saveLoadGame', 'getActorY',
  /* 24 */ 'loadRoomWithEgo', 'drawObject', 'setVarRange', 'setState04',
  /* 28 */ 'equalZero', 'setOwnerOf', 'addIndirect', 'delayVariable',
  /* 2c */ 'assignVarByte', 'putActorInRoom', 'delay', 'ifNotState04',
  /* 30 */ 'setBoxFlags', 'getBitVar', 'setCameraAt', 'roomOps',
  /* 34 */ 'getDist', 'findObject', 'walkActorToObject', 'setState01',
  /* 38 */ 'isLessEqual', 'doSentence', 'subtract', 'waitForActor',
  /* 3c */ 'stopSound', 'setActorElevation', 'walkActorTo', 'ifNotState01',
  /* 40 */ 'cutscene', 'putActor', 'startScript', 'getActorX',
  /* 44 */ 'isLess', 'drawObject', 'increment', 'clearState08',
  /* 48 */ 'isEqual', 'faceActor', 'chainScript', 'setObjPreposition',
  /* 4c */ 'waitForSentence', 'walkActorToActor', 'putActorAtObject', 'ifState08',
  /* 50 */ 'pickupObject', 'animateActor', 'actorFollowCamera', 'actorOps',
  /* 54 */ 'setObjectName', 'actorFromPos', 'getActorMoving', 'setState02',
  /* 58 */ 'beginOverride', 'doSentence', 'add', 'setBitVar',
  /* 5c */ 'dummy', 'ifClassOfIs', 'walkActorTo', 'ifNotState02',
  /* 60 */ 'cursorCommand', 'putActor', 'stopScript', 'getActorFacing',
  /* 64 */ 'loadRoomWithEgo', 'drawObject', 'getClosestObjActor', 'clearState04',
  /* 68 */ 'isScriptRunning', 'setOwnerOf', 'subIndirect', 'dummy',
  /* 6c */ 'getObjPreposition', 'putActorInRoom', 'dummy', 'ifState04',
  /* 70 */ 'lights', 'getActorCostume', 'loadRoom', 'roomOps',
  /* 74 */ 'getDist', 'findObject', 'walkActorToObject', 'clearState01',
  /* 78 */ 'isGreater', 'doSentence', 'verbOps', 'getActorWalkBox',
  /* 7c */ 'isSoundRunning', 'setActorElevation', 'walkActorTo', 'ifState01',
];
// Opcodes whose 0x80 variant is a different instruction rather than a parameter flag.
const HIGH = {
  0x80: 'breakHere', 0x98: 'restart', 0xa0: 'stopObjectCode', 0xa8: 'notEqualZero',
  0xab: 'switchCostumeSet', 0xac: 'drawSentence', 0xae: 'waitForMessage',
  0xc0: 'endCutscene', 0xc6: 'decrement', 0xcc: 'pseudoRoom', 0xd8: 'printEgo',
};

export const OPNAME = new Array(256);
for (let i = 0; i < 256; i++) OPNAME[i] = HIGH[i] || BASE[i & 0x7f];

export const V = (n) => ({ v: n }); // variable reference

// Decode one instruction at pc. Returns { op, name, args, next } (jump args are absolute).
export function decode(d, pc) {
  const start = pc;
  const op = d[pc++];
  const name = OPNAME[op];
  const args = [];
  const byte = () => d[pc++];
  const word = () => { const w = d[pc] | (d[pc + 1] << 8); pc += 2; return w; };
  const vob = (mask) => (op & mask ? V(byte()) : byte());
  const vow = (mask) => (op & mask ? V(byte()) : word());
  const str = () => { let s = pc; while (d[pc] !== 0) pc++; const out = d.subarray(s, pc); pc++; return out; };
  const msg = () => {
    // message string with escape codes; codes 4..7 carry one extra byte
    const s = pc;
    for (;;) {
      const c = d[pc++];
      if (c === 0) break;
      if ((c & 0x7f) > 3 && (c & 0x7f) < 8) pc++;
    }
    return d.subarray(s, pc - 1);
  };
  const jump = () => { const o = word(); return (pc + ((o << 16) >> 16)) & 0xffff; };

  const spec = SPEC[name];
  if (spec === undefined) throw new Error('no spec for ' + name);
  if (spec !== '*') {
    for (const c of spec) {
      switch (c) {
        case 'r': case 'R': case 'v': args.push(byte()); break;
        case 'b': args.push(byte()); break;
        case 'w': args.push(word()); break;
        case '1': args.push(vob(0x80)); break;
        case '2': args.push(vob(0x40)); break;
        case '3': args.push(vob(0x20)); break;
        case 'A': args.push(vow(0x80)); break;
        case 'B': args.push(vow(0x40)); break;
        case 'C': args.push(vow(0x20)); break;
        case 'j': args.push(jump()); break;
        case 's': args.push(str()); break;
        case 'S': args.push(msg()); break;
      }
    }
  } else {
    switch (name) {
      case 'actorOps': {
        const act = vob(0x80);
        const arg = vob(0x40);
        const sub = byte();
        args.push(act, arg, sub);
        if (sub === 2) args.push(byte()); // palette slot
        else if (sub === 3) args.push(str()); // actor name
        break;
      }
      case 'doSentence': {
        const verb = vob(0x80);
        args.push(verb);
        if (typeof verb === 'number' && (verb === 0xfb || verb === 0xfc)) break;
        args.push(vow(0x40), vow(0x20), byte());
        break;
      }
      case 'setVarRange': {
        args.push(byte());
        const n = byte();
        const vals = [];
        for (let i = 0; i < n; i++) vals.push(op & 0x80 ? word() : byte());
        args.push(vals);
        break;
      }
      case 'delay': {
        const a = byte(), b = byte(), c = byte();
        args.push(0xffffff - (a | (b << 8) | (c << 16)));
        break;
      }
      case 'beginOverride':
        // followed by a jumpRelative that is skipped on first execution
        args.push(pc);
        pc += 3;
        break;
      case 'verbOps': {
        const sub = byte();
        args.push(sub);
        if (sub === 0) args.push(vob(0x80));
        else if (sub === 0xff) args.push(byte(), byte());
        else { args.push(byte(), byte(), vob(0x80), byte(), str()); }
        break;
      }
      case 'pseudoRoom': {
        args.push(byte());
        const list = [];
        for (let j = byte(); j !== 0; j = byte()) list.push(j);
        args.push(list);
        break;
      }
    }
  }
  return { pc: start, op, name, args, next: pc };
}

// v2 message text -> JS string. Escape codes are returned as {code, arg} tokens.
export function decodeText(bytes) {
  const out = [];
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const raw = bytes[i];
    const c = raw & 0x7f;
    if (c < 8) {
      if (s) { out.push(s); s = ''; }
      const tok = { code: c };
      if (c > 3) tok.arg = bytes[++i];
      out.push(tok);
    } else s += String.fromCharCode(c);
    if (raw & 0x80) s += ' ';
  }
  if (s) out.push(s);
  return out;
}

export function textToString(tokens) {
  return tokens.map((t) => (typeof t === 'string' ? t : t.code === 1 ? '\n' : t.code === 3 ? '\f' : `<${t.code}${t.arg !== undefined ? ':' + t.arg : ''}>`)).join('');
}
