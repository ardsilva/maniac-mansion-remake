# Mansion Remake

A browser engine that plays the 1988 Atari ST release of Maniac Mansion (SCUMM v2) from
**your own disk image**. No game data is in this repository: the engine reads the `.st`
file you supply, runs the original scripts, and redraws the result at 4x with a smoothing
filter, a new palette and a modern text/verb interface.

## Run

```sh
python3 -m http.server 8765        # any static server works
# open http://127.0.0.1:8765/ and drop your .st disk image on the page
```

For development, `?disk=<url>` loads an image directly, e.g.
`http://127.0.0.1:8765/?disk=research/disk/mm.st` (`research/` is git-ignored).

Controls: mouse for everything (one click runs a finished command; hovering shows what is
under the pointer), `F` fullscreen, `Esc` skip cutscene, `.` or `Space` skip a line of
dialogue, `F1`-`F3` switch kid, `F5` save, `F7` load, `F8` restart. The toolbar appears when
the pointer is near the top edge: graphics mode (remaster / smooth / pixel), palette, sound,
code book, save and load.

## Layout

- `src/disk.js` - FAT12 reader for `.st` images
- `src/scumm/resources.js` - index, rooms, objects, walk boxes
- `src/scumm/gfx.js` - room/object bitmap and z-plane decoder
- `src/scumm/costume.js` - actor sprite decoder and limb animation
- `src/scumm/ops.js` - opcode table and instruction decoder
- `src/scumm/engine.js` - script VM, actors, verbs, sentences, camera, dialogue, save state
- `src/scumm/music.js` - sequencer for the disk's own music and sound-effect data
- `src/render.js` - frame composition, dither blending, Scale2x, anti-aliasing, palettes
- `src/audio.js` - WebAudio synth for the sequencer; `sounds/<id>.ogg|mp3|wav` overrides a sound
- `src/codebook.js` - built-in code book for the security-door keypad
- `tools/` - Node utilities: `dump.mjs` (rooms to PNG), `disasm.mjs` (script disassembler,
  `--check` validates every script), `headless.mjs` (run the game without graphics),
  `shot.mjs` (drive the browser build and take screenshots)

## Status

Working: boot, kid selection, intro and credits, dialogue, verbs, inventory, walking, room
changes, object state, cutscenes and skipping, kid switching, the doorbell, the security-door
keypad with code book, save/load (one manual slot plus an autosave per room change), music
and effects from the disk data. An automated sweep runs every verb on every object in all
52 rooms without engine errors.

Known gaps: instrument envelopes and vibrato are approximations, so music timbre differs
from the original; walking uses simplified box pathing; no hand-made replacement sprites
(the original art is filtered and recoloured); the game has not been played to an ending.
