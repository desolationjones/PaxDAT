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
   scored 888. So the app is linked at **`0x08020000`**, which leaves the first
   128 KB of flash for a bootloader.
3. **Layout of `hapax.bin`:**

   | File offset | Content |
   |---|---|
   | `0x000000–0x172CF8` | application, linked at `0x08020000` |
   | up to `0x1E0000` | `DE AD C0 DE` filler |
   | `0x1E0000–end` | **second vector table** (SP `0x20018000`, reset `0x0800CC11`): the bootloader, linked at `0x08000000` |

4. **MCU family.** The bootloader references the flash controller at
   `0x40023C00`, the STM32F2/F4 address, and SRAM is at `0x2000xxxx`. The source
   tree's top folder is called `f2`.
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

- `CortexMSetup.java` adds the SRAM, CCM, peripheral and SCS memory blocks, sets
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

- The app and bootloader are plain, unencrypted Thumb code.
- Neither image references the STM32 CRC unit, a CRC32 table, or SHA-256
  constants. That suggests updates aren't signature-checked, **but this is not
  established yet**. The bootloader's update path hasn't been analysed: how
  `hapax.bin` reaches it, and why the bootloader is carried at the end of the file.
- Before any modification:
  - analyse the bootloader;
  - find a recovery path (STM32 ROM DFU through BOOT0, or SWD);
  - keep the stock image.

  A bricked bootloader can't be fixed over USB/SD.

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

## 8. Open firmware questions

| Question | Where to look |
|---|---|
| Note payload bit layout (10 bytes, raw `memcpy`) | Setters in the step-edit UI; MIDI-file exporter (`utils/midi_file_export.cpp`); the sequencer's note-on path |
| Meaning of each track field at `@0x18…@0x4a` | The track-settings UI, where each menu label leads to its offset |
| Enum tables (output type, port kinds, FX type ids) | UI string tables next to the code that indexes them |
| Capacity limits for notes, automation points and MPE | "MEMORY FULL" / "LOW MEMORY" paths, pool initialisation |
| Bootloader update path and integrity checks | Carved bootloader image (`re-work/carved/boot_0x08000000.bin`) |
