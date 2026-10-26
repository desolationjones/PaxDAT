# Squarp Hapax project file format: working notes

Status: **third pass**. Sample-file analysis is now cross-checked against the
OS 3.22 firmware's own serializers (see `docs/FIRMWARE_NOTES.md`). Sources:

| Sample | OS | Notes |
|---|---|---|
| `Samples/OS 3.10/OT_REDUX-101026` | 3.10 | original sample |
| `Samples/OS 3.22/OT_REDUX-101026{A,B,C}` | 3.22 | variations: routings, notes, FX, automation, mod matrix, song |
| `Samples/OS 3.22/settings.dat`, `AUTO.LOAD`, `*.txt` | 3.22 | device-level files |
| OS 3.22 firmware (not in repo) | 3.22 | save/load code, read with Ghidra |

Nothing here comes from vendor documentation.
No drum, MPE or AFTR (poly-aftertouch) tracks have been captured yet.

Track and pattern numbers in prose are **1-based**, as on the device. Indexes
stored in the file are 0-based.

Confidence markers:

- 🔧 **firmware**: read directly from the firmware's serializer or deserializer.
- ✅ **confirmed**: `tools/paxdat_probe.py` parses every sample byte-for-byte with this layout.
- 🟡 **likely**: consistent across samples, but the meaning is inferred.
- ❓ **unknown**: position and size are known, meaning is not.

```
python3 tools/paxdat_probe.py "<project_dir>"     [--dump]   # project files
python3 tools/paxdat_probe.py "<sd_root>"         [--dump]   # settings.dat + AUTO.LOAD
```

---

## 1. SD card layout

```
<sd root>/
  settings.dat              device settings (key/value), see §8
  AUTO.LOAD                 name of the project to open at boot, see §9
  <Instrument>.txt          instrument definitions (plain text, documented by Squarp)
  <PROJECT NAME>/           one folder per project; folder name = project name
    project.dat             global + 16 tracks: settings, FX, pattern headers, lanes, song
    notes.dat               note events for poly tracks
    autom.dat               automation lanes
    drums.dat               drum-track events (empty in all samples)
    mpe.dat                 MPE events (empty in all samples)
```

- The project name is **not** stored inside any project file. It is the folder name. ✅
- File mtimes are 1980-01-01 because the device has no RTC. 🟡
- `*:Zone.Identifier` files come from Windows zip extraction and are not part of the format.
- No magic number, checksum or length field exists anywhere. ✅

## 2. Encoding primitives ✅

| Primitive | Encoding |
|---|---|
| Integers | little-endian |
| Float | IEEE-754 LE `f32` |
| String | ASCII, NUL-terminated, no length prefix, no padding |
| `opt<T>` | `u8` presence flag (0/1), then `T` only if 1 |
| `valN` | scalar wrapper: tag `0e 31` followed by an N-byte LE int. 🔧 The width (1, 2 or 4) is chosen by the *calling* serializer and isn't recorded in the stream. |

### Object tags

Most structures start with a 2-byte tag: `class_id`, then `0x30 + version`
(so `'1'`=v1, `'<'`=v12, `'B'`=v18, `'C'`=v19).

The tags are **not TLV**. Payload size is fixed by each class's serializer and
is not written to the file, so a parser has to know every class layout. The
version byte changes when a layout changes:

| Class | 3.10 | 3.22 | Layout change |
|---|---|---|---|
| `0c` Track | v18 | **v19** | v19 appends a `val32` at the end of the track (§3.1) |
| all others seen | n/a | n/a | unchanged |

🔧 How the firmware treats versions: every reader checks the class byte (a
mismatch gives `SD ERROR: CORRUPTED FILE`) and rejects versions newer than it
knows (`SD ERROR: UNSUPPORTED VERSION`). It **does accept every older
version** and migrates it in code. Examples: before track v9 there were only
8 patterns per track, and before track v18 one enum field was renumbered.
`docs/FIRMWARE_NOTES.md` §5 lists every class with the version OS 3.22 writes.

This is useful for an editor: a reader can dispatch on the version, and a
writer must emit the version the target firmware expects.

## 3. `project.dat` ✅ structure

```
0f 31                                   project root
0d 3c                                   globals
  u16  tempo × 10                       1300 = 130.0 BPM  🟡
  8 × val8                              [0,0,1,4,2,0,3,0]  ❓
16 × { u8 track_index; Track }
u8[16]                                  00 01 … 0f  ❓ (track order / mapping)
1c 31  u32 n  n × Section               song sections, see §3.7
1e 31  u32 n  n × SongEntry             song arrangement, see §3.7
2 × 24 32 { val8 val8 val8 val8 val16 val8 }   [0,1,60,10,0,50] ❓
16 × 25 31 u32                          all 0 ❓
18 × 00                                 trailing padding ❓
```

### 3.1 Track (`0c 42` / `0c 43`) 🔧

The firmware's track serializer writes these fields in this order. `@0x..` is
the field's offset in the in-memory `Track` struct (stride `0xcd8`, 16 tracks).
The offsets are stable names for the editor even where the meaning is unknown.

```
0c 43                           v19 (OS 3.22); v18 in 3.10. Reader accepts ≤ v19
  val32 @0x0c                   ❓ 0
2c 34  Output (§3.1.1)
2b 33  Inputs (§3.1.2)
  val8  @0x18                   60 by default; 0/12/24/36 seen  🟡 root note / range
  val8  @0x19                   enum; renumbered by migration from < v18  ❓ (clock/rate-like)
  val8  @0x1a                   1 on tracks with an instrument or notes  ❓
  val8  @0x1b                   3  ❓
  val8  @0x1d                   0  ❓ (separate reader: since v15)
  val8  @0x1c                   100  ❓
  val8  @0x1e                   127  ❓ (since v17)
  val8  @0x2b                   64  ❓ (since v17)
  val16 @0x2e                   0  ❓
  val16 @0x36                   48  ❓
  val8  @0x3f                   100 ❓   val8 @0x40  100 ❓
  val8  @0x41                   23  ❓   val8 @0x42  0 ❓
  val16 @0x48                   10000 ❓
  val8  @0x14                   0/1  ❓
  u8    @0x260                  track index (checked against position on load)
  u8    @0x261                  ❓ 0/1 (runtime-ish; changes A→B)
  opt<cstr> @0x264              instrument name ("OCTATRACK")
  val8  @0x4a                   4 ❓
  u16   @0x284                  ❓
  u8    @0x280                  ❓ (track 9: 0 → 1 between A and B)
  opt<cstr> @0x240              instrument definition file name. On load the
                                firmware re-reads this .txt ("LOADING INSTRUMENT DEF")
  u8 @0x287, u8 @0x286, u8 @0x289   01 00 00 ❓ (@0x286 since v14, @0x289 since v15)
16 × PatternHeader (0b 35) @0x2c0 + 0x18·n   §3.2
FxChain (12 32) @0x458                        §3.3 (includes the 8 CC knob slots)
LaneTable (2d 33)                             §3.6
1f 31 … @0xae8                                ❓
val8 @0x15                                    ❓
8 × 2a 31 @0x294 + 4·n                        ❓
[v19] val32 @0x10                             ❓ 0 (new in OS 3.22, maybe AFTR-related)
```

Earlier passes listed "16 values inside the `2b` block". The firmware shows the
`2b` block ends after the input routing; the 16 values are separate track
fields. The widths observed in the samples (`1,1,1,1,1,1,1,1,2,2,1,1,1,1,2,1`)
match the serializer exactly.

#### 3.1.1 Output (`2c 34`) 🔧

```
2c 34
  val8  midi_channel (0-based)
  u32   output type             0 = MIDI-style port ❓ (other types: CV/gate?)
  if type == 0:
    Port { u32 kind; u8 index }   kind 0 = MIDI DIN (index 2 bits: A–D)
                                  kind 1 = USB (index 4 bits)  kind 2 = CV/Gate (index 4 bits)  🟡
    u16   ❓ derived from the port by a lookup (00 0f in all samples)
  else: u8 (2-bit) + 2 zero bytes
```

Sample check: track 9 = `kind 0, index 3` → MIDI D. The Octatrack tracks use
`kind 1, index 0`, which matches `OUTPORT USBD1` in the instrument definition.

#### 3.1.2 Inputs (`2b 33`) 🔧

```
2b 33
  val8 ❓
  u32 mode_a ; if mode_a == 2: Port     (always 2 + {kind 2, index 0} in samples ❓)
  u32 mode_b ; if mode_b == 2: Port     0 / 1 / 2 seen; 2 = specific port + channel 🟡
```

The firmware's input-port names, in UI order: `INTERNAL, MIDI IN A, MIDI IN B
(TRS), USB DEVICE, USB HOST, MIDI AUTO`.

### 3.2 Pattern header (`0b 35`), 16 per track, 23 bytes 🔧

In memory the pattern is a **packed bitfield struct**. The serializer unpacks
each field into its own byte or u16. Bit widths are from the shift/mask code,
so they give each field's legal range:

| File bytes | Width | Default | Notes |
|---|---|---|---|
| 0 | u8 | | pattern index (@0x14) |
| 1 | 3 bits | 0 | ❓ (2 on track 11 pattern 1 in C) |
| 2 | 1 bit | 1 | ❓ (0 on track 11 pattern 1 in C) |
| 3 | 7 bits | 60 | 🟡 view / root note |
| 4-5 | 10 bits | 16 | **length**, 🟡 in 16th steps (32 on track 9 pattern 1) |
| 6 | 1 bit | 0 | ❓ (1 on track 9 pattern 1) |
| 7-8 | u16 | 0 | ❓ |
| 9-10 | u16 | ffff | ❓ |
| 11, 12, 13 | u8 | ff | ❓ (track 4, 3.10: `04 18 05`) |
| 14 | 1 bit | 0 | ❓ |
| 15, 16, 17 | 4 bits each | 0 | ❓ (`06` in one sample) |
| 18 | 7 bits | 100 | ❓ |
| 19-20 | 10 bits | 0 | ❓ |

Note data is not here (see §4).

### 3.3 FX chain (`12 32`) 🔧

```
12 32
  if track index == 15:  13 32 + val8     🔧 track 16 is special-cased in the serializer
  else:                  14 31 + val8
  8 × FxSlot                               @+0x400, stride 8
  8 × opt<16 31 Target>                    CC knob assignments (§3.5), @+0x440 stride 0xc
  val8 @+1, val8 @+2                       0, 100 ❓
```

```
FxSlot:
  10 35 u8 present
  if present:
    u8 slot_position          order in the chain (slots aren't stored sorted)
    u8 fx_type                see table
    u8[3] 0 ❓
    u8 live_off               🟡 1 when the param ON/OFF's value2 == 0
    u8 0x31|0x32              ❓ per-FX sub-version? (chance and filter use 0x32)
    Param… until idx == 0xFF
    if fx_type == 0: 4 × ModRoute (§3.4)
```

```
Param:  18 34
  u8  idx                     0xFF = ON/OFF, always last
  u16 value                   stored value
  u16 value2                  live/runtime value 🟡 (differs under automation or modulation)
  16 × opt<u16> slots         🟡 probably per-pattern values (16 patterns); 3.22 only
  cstr name
```

In 3.10 all 16 slots were absent, which is why the record looked like a fixed
20 bytes. The parameter names are stored in the file, so FX parameters are
largely self-describing.

| fx_type | Probable effect | Params |
|---|---|---|
| 0x00 | Mod Depth (slot 0 on every track; hosts the mod matrix) | Mod Depth 1-4 |
| 0x01 | Arpeggiator | STYLE RATE OCTAVE CHORD GATE HUMAN RE-TRIG REPEAT SYNC RATE% |
| 0x02 | Chance | CHANCE LOT SYNC SYNC-CH USE VELO |
| 0x03 | Euclidean | NOTE RATE STEPS PULSES ROTATE GATE |
| 0x04 | Filter? | NOTE MIN/MAX, CC MIN/MAX, DROP PB, DROP AFT, VELO MIN/MAX |
| 0x05 | Harmonizer / chord? | ORIGIN, NOTE 2…NOTE 8 |
| 0x07 | Randomizer? | NOTE-/+ OCTAVE-/+ VELO-/+ LENGTH CHANCE USE VELO |
| 0x09 | Groove | GROOVE SYNC ACCENT HUMAN |
| 0x0C | Echo? | SYNC RATE RATE% REPEATS VEL CURV GATE CURV NOTE+ NOTE- VOICES VEL END GATE END |
| 0x12 | ❓ | T1-T8, SPEED I-III, LOOP I-III, GATE, SHIFT |

Type ids 6, 8, 0x0A, 0x0B, 0x0D–0x11 haven't been seen yet.

### 3.4 ModRoute (`11 33`), 4 per Mod Depth slot ✅ structure

```
11 33
  opt<15 31 Source(u8[8])>    02 00 00 00 01 00 00 00 seen   ❓ (type 2 = LFO? index 1?)
  opt<16 31 Target(u8[8])>    0a 00 00 00 00 00 00 00 seen   ❓
  f32  depth                  1.0 default; 0.24 on the one configured route
  u16  ❓ 1
  u16  ❓ 500 default; 649 on the configured route
```

Only one populated route appears (track 9, in A/B/C). If you set up two, the
second one isn't in these files.

### 3.5 Target (`16 31`), shared by CC knobs, automation lanes and mod targets ✅

8 bytes after the tag. Byte 0 is the target type:

| type | Meaning | Layout seen |
|---|---|---|
| 0x00 | MIDI CC 🟡 | byte 5 = CC number; byte 6/7 vary (`00 00`, `01 00`, `03 61`) ❓ |
| 0x03 | FX parameter 🟡 | byte 4 = `slot << 5`? (0x20…0x80, 0x22); byte 5 = param idx (`ff` = ON/OFF) |
| 0x06 | 14-bit target, probably Pitch Bend 🟡 | values up to 11702, default 8568 |
| 0x0A | mod-matrix target ❓ | all other bytes 0 |

### 3.6 Lane table (`2d 33`) ✅

```
2d 33
  16 × cstr lane_name         from the instrument def DRUMLANES, else built-in defaults
  16 × u8[7] lane_record      byte0 = MIDI note, byte1 = row-1, byte2 = channel?  🟡
  u8 ❓
```

These are written from the highest lane to the lowest. They match the
`ROW:TRIG:CHAN:NOTE NAME` syntax in the instrument `.txt` files:
`8:NULL:8:43 TRACK 8` → `2b 07 01 …`.

### 3.7 Song mode ✅ structure, 🟡 meaning

```
Section:   u8 index?  1b 33  cstr name  u8[16] pattern_per_track?
           "SECTION A"  [1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0]
SongEntry: 1d 31  u8 section_index?  u16 length?   (0, 32)
```

## 4. `notes.dat` 🔧 structure

```
05 32                           reader accepts ≤ v2
u8 track_count
  u8 track_index                0..15
  u8 pattern_count
    u8 pattern_index            0..16 (17 slots per track in memory) 🔧
    00 31                       NoteList tag: class 0x00, v1 🔧
    u32 note_count
    note_count × { u8 0x08 (event type: note); u16 position; u8[10] payload }
```

🔧 The 10-byte payload is copied **verbatim from the in-memory note struct**
(`memcpy`, not field by field). Notes are kept in a container sorted by
position. The loader pre-fills defaults `0x64` (100) and `0x17` (23) at payload
bytes 5 and 6 (file bytes 8 and 9), which matches the probability and length
defaults below. The firmware stores notes in RAM as
`[project slot A/B][16 tracks][17 lists]`.

Note layout, from 22 notes across 4 tracks:

| Byte | Observed | Interpretation |
|---|---|---|
| 0 | `08` always | 🔧 event type "note" (the reader stops on anything else) |
| 1-2 | 0, 96, 102, 144, 192 … 672 | **u16 start position in ticks** 🟡 |
| 3 | `00`, `02`, `0c` | 🔧 bit 0 is a flag the UI clears (selection?); other bits ❓ |
| 4 | | **pitch** ✅ |
| 5 | `64`, `7f` | **velocity** ✅ |
| 6 | `00`; `64` on the 4-note chord on track 11 | ❓ |
| 7 | `00` | ❓ |
| 8 | `64`, `4e` | **probability %** 🟡 |
| 9-10 | 22, 23, 24, 279 | **u16 length?** 🟡 (unit unclear) |
| 11 | `30`, `90` (prob-78 note), `00` (track 4) | ❓ flags / condition |
| 12 | `00`, `03` (track 4) | ❓ |

Timing: automation points in a 16-step pattern stop at 765 (just under 768),
and notes sit on multiples of 48. That suggests **192 PPQN, 48 ticks per 16th
step**. 🟡

## 5. `autom.dat` ✅ structure

```
07 31
u8 track_count
  u8 track_index
  17 33
  u8 lane_count
    2e 32
    16 31 Target(u8[8])                  §3.5
    opt<u16> default_value              🟡
    17 × PointList
    opt<u16[8]>                          ❓ (one lane only: 35,82,87,92,97,107,108,127)
PointList:
  03 34  u8 0  u8 flag  u8 0  u8 4       flag 0/1 ❓ (smooth vs step?)
  u32 n  n × (u16 pos_ticks, u16 value)
```

Recorded lanes contain up to about 100 points per pattern. There are 17
PointLists per lane where 16 patterns would be expected; the extra one may be
a "lane default". ❓

## 6. `drums.dat` / `mpe.dat` ✅ (empty case only)

`06 32 00` / `26 32 00`: tag, then a zero count. Their layout is probably
similar to `notes.dat`. 🔧 From the firmware, an MPE note list is a separate
class (`27 v1`). Each MPE note has the same `08 / u16 position / 10-byte`
header, followed by a `29 v1` record: the payload plus **three expression
curves** (probably pitch, pressure and timbre). A sample capture is still needed
before writing these files.

## 7. Runtime state is saved too

A and B differ only in live state. For example, FX `value2` and the `live_off`
flag (§3.3) change while the stored `value`s stay the same. So the file
captures where the performance was when saving, not just the "document". An
editor can probably reset `value2 = value` and clear `live_off` safely, but
that still needs verifying on the device.

## 8. `settings.dat` ✅ (fully self-describing)

```
1a 34
9 × val8                                  [1,0,0,…] ❓
n × { 09 31  u32 count  count × (cstr key, u32 value) }   8 groups
21 34  <191 bytes not yet decoded: lists tagged 22 32 with u32 counts>
```

Groups seen: clock/sync (`clk_src`, `midi_start_stop` …), MIDI ports
(`midia`, `usbd` …), preferences (`autoload`, `metronome_*`, `contrast` …),
CV/gate/pedal, MIDI input filters (`ignore_*`), MIDI thru routing
(`usbd_to_a` …), per-port/channel compensation (`comp_a_01` …), and clock
outputs (`clock_div_l` …). Because the keys are stored as names, an editor
can read and write this file without fully understanding the firmware.

## 9. `AUTO.LOAD` ✅

The NUL-terminated folder name of the project to open at boot
(`OT_REDUX-101026C\0`). It probably only matters when `settings.dat`
`autoload` = 1.

## 10. Instrument definition `.txt` ✅ (documented by Squarp)

Plain text. Squarp documents the syntax in comments inside the file. Sections:
`TRACKNAME`, `TYPE` (POLY/DRUM/MPE), `OUTPORT`, `OUTCHAN`, `INPORT`, `INCHAN`,
`[DRUMLANES]`, `[PC]`, `[CC]`, `[NRPN]`, `[ASSIGN]`, `[AUTOMATION]`,
`[COMMENT]`. A project stores the file name (§3.1) and a copy of the lane
names and notes (§3.6). It does not store the whole definition.

---

## 11. Cross-reference with the Hapax manual

Source: the official manual (squarp.net/hapax/manual, PDF dated June 2026, and
the per-mode web pages). 📖 marks a field whose *meaning* comes from the
manual. The exact encoding of each still needs one confirmation, from firmware
or a capture.

| Area | Manual says | Matches in the file |
|---|---|---|
| Timing | Max zoom ×48 per 16th step; envelope: "48 clock ticks = 1 step" | **192 PPQN, 48 ticks per step** ✅. Note positions and automation points are in ticks |
| Pattern params | RUN (–– REVERSE PING-PONG RND BAR RND BEAT RND 1/16), TRIG (FREE/RESTART), LENGTH 1 step–32 bars (512 steps), PC/MSB/LSB, COLOR RGB1–8, FOLLOW 1/2 (–– STOP NEXT PREVIOUS ANY OTHER FIRST LAST RSTR) with probability, FOLLOW LEN, loop points, pattern mute | §3.2 bitfields 📖: 3-bit = RUN, 1-bit = TRIG, 10-bit = LENGTH, 3 × u8 `ff` = PC/MSB/LSB (`ff` = none), 4-bit fields = FOLLOW 1/2 and COLOR, 7-bit `100` = follow probability, 10-bit = FOLLOW LEN, u16 0 / u16 ffff = loop start/end, 1-bit = mute. The varying 7-bit `0x3c` field is likely piano-roll scroll (UI state) |
| Track 16 | Track 16 is the **transpose (TRSP) leader** | why the FX chain special-cases index 15 (§3.3) |
| Track settings | output port (MIDI A–D, USB DEVICE/HOST × **16 virtual cables**, CV/GATE 1–4, CV 1–4, GATE 1–4), output channel; input port (––, MIDI A–D, USB D/H, ALL ACTIVE), input channel (1–16, ALL); quantize (–– 1/64 1/32 1/24 1/16), strength %; pTRSP, pSCALE; track name; mono edit; instrument def; **time elasticity %** (per track); track type POLY / DRUM / MPE / **AFTR** | Port index of 4 bits = 16 virtual cables. `val16 @0x48 = 10000` = elasticity 100.00 %. The `opt<cstr> @0x264` is the **track name** (the instrument def sets it). Remaining `@0x18…` fields are quantize, strength, pTRSP, pSCALE, mono edit, track type and live-mode scale/key 📖 (order unconfirmed) |
| Project settings | pSCALE on/off, key, scale, STICK (down/up/filter), time signature (upper and lower numeral), TR16 TRSP (off/TRSP/CHRD) | the 8 `val8` globals in `0d` 📖. The scale list grew over versions (firmware remap for < v11 clamps at 66) |
| Tempo | BPM shared by both projects, with fine digits | stored from a global in `0d` (u16 1300 for 130 BPM). Whether the scale is ×10 or ×100 needs one capture |
| Project LFO A+B | wave (SINE TRI RAMP SQUARE RANDOM FLAT), SYNC, RATE 64 bars–1/128, PHASE ±180°, FLAT level | **the two `24 32` blocks** 📖 (`[0,1,60,10,0,50]`) |
| FX locking | "lock effect parameter to current pattern"; "lock ON/OFF per pattern" | the **16 `opt<u16>` slots** in each FX param are per-pattern locks ✅ |
| FX catalogue | ModMatrix (always first), Arpeggiator, Arpoly, Chance, Echo, Envelope, Euclid, Filter, Harmonizer, LFO, Mono, Output, Randomizer, Register, Scaler, Shaper, Spring, Swing (+ Quantizer and Project LFO outside the chain) | ids known: 0 matrix, 1 arp, 2 chance, 3 euclid, 4 filter, 5 harmonizer, 7 randomizer, 9 swing, 0x0C echo, **0x12 arpoly**. The rest (envelope, LFO, mono, output, register, scaler, shaper, spring) are unassigned among 6, 8, 0x0A, 0x0B, 0x0D–0x11. Every saved param carries its name, so FX can be identified by name |
| ModMatrix | sources: CC 0–119, PB, AT, CV IN 1–2, Project LFO A/B, keytracking, velocity, fill. Destinations: CC, PB, AT, PC, velocity, NRPN, CC pair, CV OUT 1–4, FX param. Params: DEPTH, OFFSET, POLARITY, CONSUME | `11 33`: `15` = source, `16` = destination, f32 = DEPTH, then OFFSET / POLARITY / CONSUME packed in the two u16s 📖 |
| Automation | destinations: CC, PB, AT, PC, velocity, NRPN, CC pair (14-bit), CV IN, CV OUT, effect param, VOID. Per-lane **default value**; **per-row snap values** (8 rows); **mute per pattern**; interpolation on/off; events stored per pattern | `opt<u16>` = default value; trailing `opt<u16[8]>` = **row snap values** ✅ (`35…127`). The per-pattern flag in each PointList header is mute or interpolation. `16 31` byte 0 = destination type 📖 |
| Sections / song | a section = 16 pattern selections (+ mute states), named "section A…"; a song = list of (section, duration); modes PLAY / LOOP / PERFORM | `1b` = name + 16 bytes; `1d` = (section, duration) ✅ |
| Drum lanes | per lane: INPUT note (0–127 or LINK), OUTPUT note, OUTPUT channel (TRACK CH, CH 1–16, GATE/CV/CVG 1–4); 16 lanes | the 7-byte lane record (§3.6) 📖 |
| Notes | per note: pitch, velocity, LENGTH (1/16…∞, tick fine-tune), µTIME ±50 %, CHANCE 0–100 %, ROLL 1/8…1/256, MATH (≈ 40 conditions incl. FILL, 1ST, PRE, SYNC, NT, PS, PB, X:Y, NO FX); AFTR/MPE: per-note pressure (curve or fixed) | the 10-byte payload holds exactly these. Pitch, velocity and chance are located; **length, µTime, roll and math encodings are not** |
| AFTR | new track type after MPE; single channel; per-note pressure curves | no separate file in firmware ⇒ probably `mpe.dat`-style curves 📖 |
| Settings | saved only when the user selects SAVE in settings | explains `settings.dat` carrying older class versions ✅; the `21`/`22` tail = **colour palette** (`palette_serde.cpp`) 📖 |

## 12. Open questions after the manual

Most meanings are now known. What remains is mainly **encodings** (bit
positions, enum numbering, field order). The firmware can answer these without
captures; a handful of small captures then confirm them.

| # | Open item | Best source |
|---|---|---|
| 1 | Note payload: bit layout and units of LENGTH, µTIME, ROLL, MATH (plus bytes 3, 6, 7, 11, 12) | firmware (step-edit setters); confirm with **one** capture |
| 2 | Enum numbering: track type, output kind/index, input port, FX ids (8 left), mod sources/destinations, automation destination types, scales, follow actions, run modes | firmware UI string tables (listed in enum order) |
| 3 | Order of the 8 project globals and of the track fields `@0x18…@0x4a` | firmware deserializer clamps + manual ranges; confirm with one capture |
| 4 | Tempo scale (×10 or ×100) | one capture (120.5 BPM) |
| 5 | `drums.dat` and `mpe.dat`/AFTR layouts | firmware writers (already located), then one capture each |
| 6 | Device capacity limits (notes, points, MPE) | firmware |
| 7 | Small unknown classes `02`, `1f`, `25`, `28`, `2a` and runtime flags | firmware; low priority (preserve as-is) |

The earlier questions about A → B, routings, note properties, pattern lengths,
mod matrix and song length are answered by the manual, or they reduce to items
1–4 above.

### Captures still needed (much shorter now)

One project, saved after each step, is enough:

1. Tempo 120.50; time signature 7/8; pSCALE on with a non-default key and scale.
2. One track: DRUM type with 2 hits in 2 lanes (one lane with OUTPUT = CH 10);
   one MPE track and one AFTR track, each with a single recorded note.
3. One poly note with every property non-default: length 3 steps + 5 ticks,
   µTime +25 %, chance 50 %, roll 1/32, math 2:3.
