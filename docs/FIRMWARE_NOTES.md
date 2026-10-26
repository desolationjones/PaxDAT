# Hapax OS 3.22 firmware: reverse-engineering notes

Purpose: learn the project file format from the code that writes it, and keep
the option open of modifying the firmware later.

**What is not in this repo.** The firmware binary, carved images, Ghidra
project, decompiled output and address/name lists stay local. `.gitignore`
excludes `Target Firmware/`, `re-work/` and `*.bin`. This document describes
findings and method only. It contains no firmware code. Reverse engineering
your own device for interoperability is the purpose here; don't redistribute
the firmware or decompiled code.

Firmware: `hapax.bin`, 2,093,968 bytes, SHA-256
`89898736f3e2154b9f6980dc0e2427d7d5b9f324a6dc9d5126a71c7861e96605`, OS 3.22.

---

## 1. Toolchain

| Tool | Use | Notes |
|---|---|---|
| `rea-agents` 6.8.0 (npm) | triage, evidence records (entropy, a first Ghidra pass) | installed locally under `re-work/tools` with `--ignore-scripts` |
| Ghidra 12.1.4 | disassembly and decompilation (headless) | download SHA-256 checked against the release notes |
| OpenJDK 21, `binutils-arm-none-eabi` | Ghidra runtime, quick objdump checks | apt |
| `tools/re/*` | our Ghidra scripts and Python catalogue scripts | see §7 for the workflow |

**Lessons about `rea`:**

- It worked well for triage, and every result carries a SHA-256-anchored "evidence" record.
- Its raw-binary import picked the generic `ARM:LE:32:v7` language rather than
  Cortex-M (Thumb-only). It treated the vector table as code, and its address
  mapping (image base `0x0`) rejected address-based queries.
- `extract-firmware` and `inspect-firmware-regions` need external `unblob` / `binwalk` installs.
- `rea doctor` wants Node ≥ 24.22.1; 24.21 worked anyway.
- I did **not** run `rea setup`, because it rewrites Claude Code / Copilot client
  registrations in your home directory.

For Cortex-M firmware, driving Ghidra directly with a small setup script (§3)
was the better path.

## 2. Image triage

1. **Vector table at offset 0.** The initial SP is `0x2001FC00` and the reset
   handler is `0x080F45A9` (odd = Thumb), so this is a Cortex-M part executing
   from flash at `0x08xxxxxx`.
2. **Base address by pointer voting.** Collect every aligned word that looks like
   a flash pointer, then find the base at which the most of them land exactly
   on the start of a string. `0x08020000` scored 2,660 hits; the next best
   scored 888. So the app is linked at **`0x08020000`**. The first 128 KB flash
   sector holds the H7's own bootloader, which is **not** part of `hapax.bin`.
3. **Layout of `hapax.bin`:**

   | File offset | Content |
   |---|---|
   | `0x000000–0x172CF8` | application, linked at `0x08020000` |
   | up to `0x1E0000` | `DE AD C0 DE` filler |
   | `0x1E0000–end` | **second vector table** (SP `0x20018000`, reset `0x0800CC11`): firmware for a **second, F4-class microcontroller** (see item 4), linked at `0x08000000` |

   The file isn't a flash image: placed at `0x08020000`, the tail would run past
   the end of 2 MB of flash. It's an **update container** that the device's
   bootloader unpacks. The H7 app never references the tail.

4. **MCU family** (corrected). The app is an **STM32H7 (Cortex-M7)**. It
   references the H7 RCC (`0x58024400`), the H7 flash controller
   (`0x52002000`), and AXI SRAM at `0x2400xxxx` (≈ 5,800 references), plus
   SRAM1–4 at `0x30…`/`0x38…`. The embedded second image uses **F4** peripheral
   addresses: RCC `0x40023800`, flash controller `0x40023C00`, 96 KB stack top.
   It's probably a co-processor, for example for the panel or USB host. The
   source folder name `f2` is a project or board name, not the chip. An earlier
   version of these notes called the tail image "the bootloader" and the chip
   "F2/F4"; both were wrong.
5. **Build information leaks.** There are GCC/newlib paths for two toolchains
   (`arm-13`, `arm-15`) and source paths such as
   `…/Hapax-release-3.22/f2/src/serde/project_save_load.cpp`. These give the
   module structure for free: `serde/` (save/load), `effects/`, `sequencer/`,
   `ui/modes/…`, `utils/midi_file_export.cpp`, and others.
6. **Entropy.** Code sits at 7.0–7.3 bits/byte. The tail of the app holds
   strings and data, and the filler has entropy 1.5. Nothing looks encrypted or
   compressed.

## 3. Ghidra setup (headless)

```
analyzeHeadless re-work/ghidra_proj hapax \
  -import re-work/carved/app_0x08020000.bin -loader BinaryLoader \
  -loader-baseAddr 0x08020000 -processor ARM:LE:32:Cortex \
  -scriptPath tools/re -preScript CortexMSetup.java -postScript ExportAll.java re-work/out
```

- `CortexMSetup.java` adds the H7 memory blocks (DTCM, AXI SRAM, SRAM1–4,
  peripherals, SCS; fixed after the first pass used an F4-style map), sets
  Thumb mode, creates a function for each of 149 vector handlers, and enables
  the aggressive instruction finder.
- `ExportAll.java` writes pseudo-C for all 4,302 functions plus a string index
  with the functions that reference each string (following one hop of
  literal-pool indirection).
- `ApplyNames.java` and `ExportRange.java` support the iterative loop: name
  functions, then re-decompile a region (§7).

## 4. The serialization framework 🔧

Found by searching string cross-references for the `serde/*.cpp` source paths
and the `/project.dat`-style file names. Every file has one save and one load
routine.

| File | Notes |
|---|---|
| `project.dat`, `notes.dat`, `autom.dat`, `drums.dat`, `mpe.dat` | written into the project folder |
| `/HAPAX/settings.dat`, `/HAPAX/AUTO.LOAD`, `/HAPAX/calibration.dat` | device files live in a `HAPAX` folder |

**Primitives:**

- A buffered writer with a 256-byte buffer flushes through FatFs `f_write`. Each
  file is opened with *create-always*. There's no temp file and no atomic
  rename, so a write interrupted on the device leaves a truncated file.
- A matching buffered reader.
- Serializers return no errors; a failed write hits a breakpoint instruction.

**Object tags.** Each class serializer writes `class_id`, then a version byte
`'0' + n`, then fields in a fixed order. Fields may be raw little-endian
integers, nested objects, or `0e` scalar wrappers whose width the caller picks.

**Loading.** Each deserializer checks the class byte and the version:

| Result | Meaning |
|---|---|
| wrong class | error 1, "CORRUPTED FILE" |
| version newer than the firmware knows | error 2, "UNSUPPORTED VERSION" |
| I/O failure | error 9 |
| track index mismatch | error 6 |

Older versions are always accepted and migrated in code. Examples:

- track < v9: 8 patterns instead of 16;
- track < v18: an enum at `+0x19` is renumbered, and project globals get the same remap;
- project-body < v5 or < v8: fewer global fields.

**Memory model.** There are two project slots in RAM (`proA` / `proB`). A
project holds 16 tracks of `0xcd8` bytes each. Notes are stored as
`[slot][16 tracks][17 lists]`, and a pattern header is a packed bitfield struct.

**Runtime state.** FX parameters store both a value and a live value, so
playback state is part of the saved file. See FORMAT §7.

## 5. Class catalogue (OS 3.22 writer versions) 🔧

Recovered automatically with `tools/re/catalog_writers.py` (it finds a
class-byte write followed by a version-byte write), then spot-checked by hand.
"Seen" is the version found in sample files.

| Class | v (3.22) | Seen | Meaning |
|---|---|---|---|
| `00` | 1 | 1 | note list (notes.dat) |
| `02` | 2 | n/a | ❓ |
| `03` | 4 | 4 | automation point list |
| `05` | 2 | 2 | notes.dat root |
| `06` | 2 | 2 | drums.dat root |
| `07` | n/a | 1 | autom.dat root |
| `09` | 3 | **1** | settings.dat key/value group (sample written by older OS) |
| `0b` | 5 | 5 | pattern header (bitfields) |
| `0c` | 19 | 18/19 | track |
| `0d` | 12 | 12 | project globals and body |
| `0e` | 1 | 1 | scalar value wrapper (width chosen by caller) |
| `0f` | 1 | 1 | project.dat root |
| `10` | 5 | 5 | FX slot |
| `11` | 3 | 3 | mod-matrix route |
| `12` | 2 | 2 | FX chain (also holds the 8 CC knob slots) |
| `13` / `14` | 2 / 1 | same | FX chain head: track 16 / tracks 1–15 |
| `15` | n/a | 1 | mod source |
| `16` | 1 | 1 | target (CC / FX parameter / 14-bit / mod destination) |
| `17` | 3 | 3 | automation container per track |
| `18` | 4 | 4 | FX parameter |
| `1a` | 4 | 4 | settings.dat root |
| `1b` / `1c` | 3 / 1 | same | song section / section list |
| `1d` / `1e` | n/a / 1 | 1 / 1 | song entry / song list |
| `1f` | 1 | 1 | ❓ per-track object |
| `21` / `22` | 5 / 2 | **4** / 2 | settings.dat tail (not decoded yet) |
| `23` | 1 | n/a | calibration.dat |
| `24` | 2 | 2 | ❓ project-level (×2) |
| `25` | 1 | 1 | ❓ per-track list of targets |
| `26` | 2 | 2 | mpe.dat root |
| `27` / `29` | 1 / 1 | n/a | MPE note list / MPE note with 3 expression curves |
| `28` | 2 | n/a | ❓ |
| `2a` | 1 | 1 | ❓ per-track (×8) |
| `2b` / `2c` | 3 / 4 | same | track inputs / track output |
| `2d` | 3 | 3 | drum-lane table |
| `2e` | 2 | 2 | automation lane |

## 6. Firmware-modification outlook (preliminary)

- The H7 app and the co-processor image are plain, unencrypted Thumb code.
- **Integrity checking is unknown.** The code that unpacks `hapax.bin` and
  would check it is the H7 bootloader, which isn't in the update file. Neither
  image contains obvious CRC32 or SHA-256 constants, but that says nothing
  about the bootloader. (An earlier version of these notes drew a conclusion
  from the wrong image.)
- Before any modification:
  - obtain or dump the H7 bootloader (SWD, if the board exposes it);
  - confirm a recovery path (STM32H7 ROM DFU through BOOT0, or SWD);
  - keep the stock image.

  Don't patch the co-processor image without knowing how it gets flashed.

## 7. Working loop (for learning)

1. **Anchor on strings.** Error messages, file names and source paths, via `strings.tsv`.
2. **Name what you understand.** Add `address<TAB>name` to `re-work/out/names.tsv`,
   run `ApplyNames.java`, then re-export just the region you're reading with
   `ExportRange.java`. Names show up at every call site and make the next
   function readable.
3. **Prefer the pair.** Read both the serializer and the deserializer. The
   writer gives exact field order; the reader gives version history, clamps and
   ranges.
4. **Check against bytes.** Every claim should be testable with
   `tools/paxdat_probe.py` against the samples.
5. **Read packed structs from shifts.** `(x << 0x1c) >> 0x1d` means a 3-bit
   field at bit 1. Bit widths tell you legal ranges.

## 8. Results from the second firmware pass 🔧

| Topic | Finding | How |
|---|---|---|
| FX type ids | `0` ModMatrix, `1` Arp, `2` Chance, `3` Euclid, `4` Filter, `5` Harmonizer, `6` LFO, `7` Randomizer, `8` Scaler, `9` Swing, `0x0A` Envelope, `0x0B` Output, `0x0C` Echo, `0x0E` Register, `0x10` Shaper, `0x11` Mono, `0x12` Arpoly, `0x13` Spring. `0x0D` and `0x0F` aren't constructible (hidden `__COLLECT` / `__MUTATE`?) | the effect factory `switch(type)`, matched to each constructor's parameter names |
| Automation / target type (`16` byte 0) | `0` CC, `4` poly aftertouch, `5` channel aftertouch, `6` pitch bend (14-bit), `8` program change; `3` = FX parameter (from samples) | MIDI-file exporter: the type → status byte switch |
| Note payload | position includes µTime; byte 6 = note-off velocity; bytes 11–12 = length in ticks; byte 9 = Math index; pitch bit 7 = skip flag | MIDI-file exporter + string tables |
| Math enum | 0 `PB <5` … 22 `FILL`, **23 `OFF`**, 24 `1:2` … (`X:Y`, then `! X:Y`), then `NO FX` variants | `{len, ptr}` string table, matched to the loader default `0x17` |
| Roll enum | 0 `OFF`, 1 `1/8`, 1/12, 1/16, 1/24, 1/32, 1/48, 1/64, 1/96, 1/128, 10 `1/256` | `{len, ptr}` string table plus a matching tick-interval table |
| Mod sources (UI order) | `FILL, CV IN 1, CV IN 2, LFO A, LFO B, AFTERTOUCH, PITCHBEND, PC, KEYTRACKING, VELOCITY` (+ CC) | string-pointer table |
| Destination kinds (UI order) | `CC, PITCHBEND, AFTERTOUCH, CV IN, CV OUT, PROG CHANGE, KEYTRACKING, VELOCITY, FILL, PROJECT LFO, NRPN, CC PAIR` | string-pointer table |
| `drums.dat` | same nesting as `notes.dat`; event lists are class `02 v2`: u32 count, `{u16 position, u8[10] payload}` (no `08` type byte) | drum serializer |
| `mpe.dat` | class `27 v1` lists; each MPE note: `08`, u16 position, then `29 v1` = payload + 3 expression curves | MPE serializer/deserializer |
| Capacity | notes, events and MPE points come from growable pools in one shared RAM arena ("MEMORY FULL", "MEMORY FULL - MPE", "MPE REC LIMIT"). There are no fixed per-type counts | pool accessors and the grow function |

## 9. Open firmware questions

| Question | Where to look |
|---|---|
| Remaining note bytes: 3 (flags beyond bit 0), 7, and confirming roll at byte 10 | Step-edit setters; the sequencer's roll scheduling |
| Meaning of each track field at `@0x18…@0x4a` | The track-settings UI, where each menu label leads to its offset |
| Remaining enums: output type, port kinds, mod-source numbering, scales | UI string tables next to the code that indexes them |
| Size of the shared arena, for an editor-side memory estimate | Arena initialisation (`0x2403e0xx` pools) |
| Update path and integrity checks | The H7 bootloader (not in `hapax.bin`; needs a flash dump). The co-processor image (`re-work/carved/boot_0x08000000.bin`, misnamed) |
