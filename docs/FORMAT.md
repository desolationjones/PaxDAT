# Squarp Hapax project file format: working notes

Status: **first pass**, reverse-engineered from a single sample project
(`Samples/OT_REDUX-101026`). Everything here comes from observation, not
from vendor documentation.

Confidence markers used below:

- ✅ **confirmed**: structurally verified. `tools/paxdat_probe.py` parses the
  sample byte-for-byte with this layout.
- 🟡 **likely**: strong circumstantial evidence, one sample only.
- ❓ **unknown**: position and size are known, meaning is not.

Run the probe with `python3 tools/paxdat_probe.py <project_dir> [--dump]`.

---

## 1. Project folder

```
OT_REDUX-101026/        <- folder name is the project name (not stored inside files)
  project.dat   18546 B  global settings, 16 tracks, patterns metadata, FX, lanes
  notes.dat        71 B  note events for (non-drum?) tracks
  autom.dat       221 B  automation lanes
  drums.dat         3 B  drum-track events (empty in this sample)
  mpe.dat           3 B  MPE data (empty in this sample)
```

- All files have mtime 1980-01-01 (FAT default, since the device has no RTC). 🟡
- `*:Zone.Identifier` files are Windows "downloaded from internet" alternate
  streams created when the zip was extracted. They are **not** part of the format.
- No magic number, checksum, or length field was found in any file. If the
  firmware validates anything, it does so by walking the structure.

## 2. Encoding primitives ✅

| Primitive | Encoding |
|---|---|
| Integers | Little-endian (`u16` 1300 = `14 05`; `u16` 10000 = `10 27`) |
| Float | IEEE-754 LE `f32` (`00 00 80 3f` = 1.0) |
| String | ASCII, NUL-terminated, **not** length-prefixed, no padding |
| Optional string | `u8` present flag; if 1, a C string follows |
| Optional object | `u8` present flag; if 1, the object follows (FX slots, CC slots) |

### Object tags

Almost every structure starts with a **2-byte tag**: `class_id`, then
`0x30 + version`. The version byte is an ASCII digit for small versions:
`'1'`=1, `'5'`=5, `'<'`=12, `'B'`=18.

```
0c 42   -> class 0x0c, version 18   (track)
2c 34   -> class 0x2c, version 4
0e 31   -> class 0x0e, version 1    (generic scalar value wrapper)
```

The tags are **not TLV**. No length follows the tag, and the payload size is
fixed by the class's (C++-style) `serialize()` code. The clearest example is
the generic value wrapper `0e 31`. Its payload is 1 byte in some positions and
2 bytes in others, and nothing in the stream tells you which:

```
0e 31 64        -> u8  100
0e 31 10 27     -> u16 10000
```

**Consequence:** a parser has to know each class's layout. You can't skip an
unknown object generically. The tags work well as sync and assert markers,
which is how the probe uses them.

## 3. `project.dat` ✅ (structure) / 🟡❓ (semantics)

```
0f 31                     project root, v1
0d 3c                     global settings, v12
  u16   tempo × 10        1300 -> 130.0 BPM  🟡
  8 × val8                [0,0,1,4,2,0,3,0]  ❓
16 × { u8 track_index; Track }        (index byte 0..15 precedes each track)
u8[16]                    00 01 02 … 0f   ❓ (track order / mapping?)
1c 31  u32                0  ❓
1e 31  u32                0  ❓
2 × 24 32 { val8 val8 val8 val8 val16 val8 }   [0,1,60,10,0,50] ❓ (CV/clock/metronome?)
16 × 25 31 u32            all 0  ❓ (one per track or scene?)
18 × 00                   trailing zero padding ❓
```

(`valN` means the `0e 31` wrapper followed by an N-byte int.)

### 3.1 Track (`0c 42`), 978 bytes when "empty", larger with FX

```
0c 42
  val8                        ❓ (0 on all tracks)
  u8[3]                       ❓
2c 34                         output/routing block 🟡
  val8  midi_channel (0-based)  tracks 4..15 = own index; t0=4, t1=5, t2=2, t3=0
  u8[11]                      ❓ byte 4 = 1 on tracks 0,1,3; byte 8 = 1 on track 3; last = 0x0f
2b 33                         track settings 🟡
  val8                        ❓
  u8[13]                      u32 2, u32 2, u8, u32 {0|1} ❓
  16 × val (widths 1,1,1,1,1,1,1,1,2,2,1,1,1,1,2,1)
       defaults: [60,0,0,3,0,100,127,64,0,48,100,100,23,0,10000,0]
       [0]  60 default; 0/12/24 on tracks 0/1/3  ❓ (root / transpose / range?)
       [2]  1 on tracks with instrument or notes  ❓
       [15] 1 on track 15 only  ❓
  u8    track_index (again)
  u8                          ❓
  optstr instrument_name      "OCTATRACK" (tracks 0,1)
  val8                        4 ❓
  u8[3]                       ❓
  optstr instrument_file      "ELEKTRON_OCTATRACK.TXT"
  u8[3]                       01 00 00 ❓
16 × Pattern header (0b 35)   see 3.2
FX chain (12 32)              see 3.3
8 × optional CC slot (u8 flag; 16 31 + u8[8])   see 3.4
val8                          0 ❓
val8                          100 ❓
2d 33  lane table             see 3.5
1f 31  u32 ❓
val8 ❓
8 × 2a 31 u8                  all 0 ❓ (8 per track: scenes?)
```

### 3.2 Pattern header (`0b 35`), 23 bytes, 16 per track ✅

```
0b 35  u8 pattern_index  then 20 bytes
default:  00 01 3c 10 00 00 00 00 ff ff ff ff ff 00 00 00 00 64 00 00
t3 p0:    00 01 31 10 00 00 00 00 ff ff 04 18 05 01 00 00 00 64 00 00
t3 p1:    00 01 25 10 00 00 00 00 ff ff 06 14 05 00 00 00 00 64 00 00
```

Track 3 patterns 0 and 1 are the ones holding notes in `notes.dat`. The `0x3c`
(60) byte probably relates to the visible note range or scroll position, and
`0x10` (16) is probably the length in steps or bars. Both are guesses.
Note data itself is **not** here.

### 3.3 FX chain (`12 32`) ✅ structure

```
12 32
  sub-tag: 14 31 (tracks 0..14) | 13 32 (track 15)   ❓ polymorphic?
  val8: 1 | 2
  8 × FX slot:
    10 35 u8 present
    if present:
      u8 slot_position           (order in the chain; slot list isn't sorted)
      u8 fx_type
      u8[5]  ❓  (byte 3 = 1 on the disabled arp; byte 4 = 0x31 or 0x32, maybe a version?)
      params until idx == 0xFF:
        18 34 u8 idx  u16 value  u16 value2  u8[16] zeros  cstr NAME
      if fx_type == 0: 4 × (11 33 u8 f32(=1.0) u8[5])      mod routings ❓
```

Each parameter **carries its own display name** (e.g. `RATE %`, `SPEED  II`),
which makes this part largely self-describing. `value` and `value2` were equal
everywhere in this sample, so `value2` may be a base or saved value.

| fx_type | Name (inferred from params) | Params |
|---|---|---|
| 0x00 | Mod Depth (always slot 0, every track) | Mod Depth 1-4 |
| 0x01 | Arpeggiator | STYLE RATE OCTAVE CHORD GATE HUMAN RE-TRIG REPEAT SYNC RATE% |
| 0x02 | Chance | CHANCE LOT SYNC SYNC-CH USE VELO |
| 0x03 | Euclidean | NOTE RATE STEPS PULSES ROTATE GATE |
| 0x09 | Groove | GROOVE SYNC ACCENT HUMAN |
| 0x12 | ❓ (step/loop FX) | T1-T8, SPEED I-III, LOOP I-III, GATE, SHIFT |

Every list ends with `ON/OFF` (idx 0xFF). Other FX types exist on the device
but don't appear in this sample.

### 3.4 CC slots (`16 31`)

Eight optional 8-byte records. They are present on the two Octatrack tracks
and appear to come from the instrument definition. Byte 5 holds CC numbers
34, 35, 36, 45, 20, 21, 23, 24. 🟡 The same `16 31` class is reused as the
target of an automation lane in `autom.dat`.

### 3.5 Lane table (`2d 33`) ✅ structure

```
2d 33
  16 × cstr lane_name
  16 × u8[7] lane_record   (byte 0 = MIDI note; on OT tracks also byte1 = index, byte2 = 1)
  u8 ❓
```

The lists are written from the highest lane down to the lowest:

- Octatrack tracks: `TRACK 8 … TRACK 1` → notes 43…36, then `D8 … D1` → 63…56.
- All other tracks: `COWBELL, HAND CLAP, HI TOM, LOW TOM, OPEN HH, CLOSE HH,
  SNARE, KICK` → 55…48, then `D8 … D1` → 63…56.

These are probably the drum-lane names and notes, which come from the
instrument definition file. 🟡

## 4. `notes.dat` 🟡 (fits the single sample, unverified)

```
05 32
u8 track_count
  u8 track_index            (3)
  u8 pattern_count
    u8 pattern_index
    00 31                   ❓ (tag of class 0, or two separate bytes)
    u32 note_count
    note_count × 13-byte note
```

Observed notes (all in track 3):

```
08 00 00 02 | 18 | 64 | 00 00 | 64 | 17 00 00 | 03     pitch 24, vel 100
08 00 00 02 | 24 | 64 | 00 00 | 64 | 17 00 00 | 03     pitch 36
(pattern 1: pitches 25, 37)
```

Byte 4 = pitch and byte 5 = velocity look right. Start position, length,
probability and the `08 … 02` prefix **cannot be resolved** because every note
in the sample shares the same values for all of them.

## 5. `autom.dat` 🟡

```
07 31
u8 track_count
  u8 track_index (1)
  17 33
  u8 lane_count
    2e 32
    16 31 u8[8]             target (byte 5 = 0x10, maybe CC 16)
    u8 flag, u16 value (35)
    17 × { 03 34  u8[4] hdr  u32 n  n × (u16 pos, u16 value) }
         first record: hdr 00 00 00 04, points (0,97) (336,35) (480,87)
         others:       hdr 00 01 00 04, empty
    u8 (1)  8 × u16  [35,82,87,92,97,107,108,127]  ❓
```

There are 17 records, not the 16 you'd expect for 16 patterns. The `00`/`01`
in the header may flag an "unset" pattern. Point positions look like ticks.

## 6. `drums.dat` / `mpe.dat` ✅ (empty case only)

`06 32 00` and `26 32 00`: tag followed by a zero count. They are probably laid
out like `notes.dat`.

---

## 7. Open questions and the variation sets needed to close them

Each variant should be a **copy of a baseline project with one change**, saved
under a descriptive folder name. A fresh "new project" baseline is better than
this Octatrack one.

| # | Change | Resolves |
|---|---|---|
| 1 | Brand-new empty project, unchanged | Baseline; separates defaults from OT_REDUX data |
| 2 | Tempo 120 → 121, 120.5 | Confirms tempo × 10 |
| 3 | One note at step 1; then the same note moved to step 5; then longer; then vel 50 | Note position, length, velocity fields |
| 4 | One note with probability or condition changed (each note option separately) | Remaining note bytes |
| 5 | Pattern length change; pattern 2 on/off; pattern copy | Pattern header bytes |
| 6 | Change MIDI channel, then output port (A/B/C/D/USB/CV) on track 1 | `2c 34` block |
| 7 | Change each track setting individually (track type, transpose, range, velocity...) | `2b 33` 16-value list |
| 8 | Drum track with one hit in two lanes | `drums.dat` layout |
| 9 | MPE track with one note | `mpe.dat` layout |
| 10 | Each remaining FX type, one per project | FX type ids and param lists |
| 11 | Automation: one lane, then two lanes, then a lane in pattern 2 | `autom.dat` counts and the 17-record question |
| 12 | Scenes / song mode / project settings changes | Global tail blocks `1c`/`1e`/`24`/`25` |
| 13 | Same project saved on two firmware versions | Which version bytes move |

Write down the firmware version for every capture.
