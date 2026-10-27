# PaxDAT: offline Hapax project editor design

Status: proposal (2026-10-26). It is based on `FORMAT.md` (sample-derived) and
`FIRMWARE_NOTES.md` (the OS 3.22 serializers). It is written to be built
incrementally: each phase is useful alone and only uses format knowledge that
is already confirmed.

---

## 1. Goals and non-goals

**Goals**

1. Open a Hapax SD card, or a copy of it, and browse projects without the device.
2. Make safe edits that load cleanly on the Hapax:
   - routing, FX parameters, song and sections;
   - notes and automation;
   - device settings, `AUTO.LOAD`, instrument definitions.
3. **Never corrupt a project.** Anything the editor doesn't understand
   round-trips byte for byte.
4. Track firmware versions explicitly, so a new OS doesn't silently break files.

**Non-goals for now**

- Real-time MIDI or sync with the device.
- Writing drum, MPE or AFTR data before sample captures confirm the layouts.
- Firmware modification. That is a separate track (FIRMWARE_NOTES §6).

## 2. Constraints learned from the firmware

| Fact | Consequence for the editor |
|---|---|
| Objects are `class + version + fixed-order fields`, with no lengths. | A parser must know every class layout; unknown objects can't be skipped. The codec is schema-driven per class *and* version. |
| The firmware rejects versions newer than it knows, and accepts and migrates older ones. | The editor writes **exactly** the versions of a chosen target OS. Writing an older version is allowed (the device migrates it), but it loses newer fields. |
| Different files on one card can carry different versions (e.g. `settings.dat` from an older OS). | Versions are decided per object, not per card. |
| Pattern headers and note payloads are packed bitfields. | Validate against bit widths. Keep the raw payload for bits we can't name yet. |
| The device writes with *create-always* and no atomic rename. | The editor must never edit in place on the only copy. It writes to a temp file and renames, and keeps backups. |
| Saves include runtime state (FX live values, live on/off). | Offer "normalize performance state" (`value2 := value`) as an explicit option. Default: preserve. |
| The project name is the folder name; instrument definitions are reloaded from `.txt` on load. | Rename a project = rename its folder. Lane tables in `project.dat` must stay consistent with the referenced `.txt`. |
| Fixed RAM pools hold notes, points and MPE data. | Edits that exceed device capacity must be blocked. Limits still need extracting (FIRMWARE_NOTES §8). |

## 3. Architecture

```
┌────────────────────────────── UI (web) ──────────────────────────────┐
│  Card browser · Project overview · Track/routing · FX · Piano roll   │
│  Automation · Song · Settings · Instrument-def editor · Diff view    │
└───────────────▲──────────────────────────────────────▲───────────────┘
                │ commands (undoable)                  │ queries
┌───────────────┴──────────────────────────────────────┴───────────────┐
│ Domain model    Project, Track, Pattern, Note, FxSlot, AutomationLane │
│                 Song, Settings, InstrumentDef (named, typed fields)   │
├──────────────────────────────────────────────────────────────────────┤
│ Validation      ranges (bit widths) · enums · capacity · consistency  │
├──────────────────────────────────────────────────────────────────────┤
│ Codec           class registry: (classId, version) → schema           │
│                 reader: bytes → object tree (+ raw spans)             │
│                 writer: object tree → bytes (target-OS versions)      │
├──────────────────────────────────────────────────────────────────────┤
│ Storage         SD/folder access · temp+rename · backups · snapshots  │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Technology

- **Core library in TypeScript** (`packages/core`), with no I/O dependencies.
  It runs in the browser, in Node (CLI and tests), and inside a desktop shell.
- **UI: a React web app** (Vite), browser-first, with **Firefox as the primary
  target**. Firefox has no File System Access API, so storage is built on
  APIs every browser has:
  - **Open:** `<input type="file" webkitdirectory>` (or drag-and-drop) reads a
    whole SD card or project folder into memory.
  - **Save:** the edited project is offered as a download: a `.zip` of the
    project folder, or single files. You copy it to the card yourself.
  - **Persist:** sessions and backups live in the browser's private storage
    (IndexedDB / OPFS), so work survives reloads.
  - **Chromium:** where the browser supports it, writing directly to the card
    is a progressive enhancement. A Tauri desktop wrapper stays an option for
    later.
- **CLI** (`paxdat`) on the same core: `inspect`, `diff`, `normalize`,
  `validate`, `export-json` and `import-json`. This is useful for scripting and
  for checking the device's output against the editor's.
- `tools/paxdat_probe.py` stays as the **research tool and independent
  oracle**. Its JSON dump is cross-checked against the TypeScript codec in CI.

### 3.2 Codec: declarative, versioned schemas

Each class version is declared once, mirroring the firmware serializer:

```ts
defineClass(0x2c, 4, 'TrackOutput', s => s
  .val('channel', u8)                       // 0e 31 wrapper
  .u32('outType')
  .when(o => o.outType === 0, s => s
      .obj('port', Port)                    // { u32 kind; u8 index }
      .u16('u_portCode'))
  .otherwise(s => s.u8('u_cvIndex').u16('u_pad')));

defineClass(0x0c, 19, 'Track', s => s
  .val('f_0x0c', u32).obj('output', TrackOutput).obj('inputs', TrackInputs)
  .val('f_0x18', u8)   /* … field order from FORMAT §3.1 … */
  .array('patterns', 16, PatternHeader).obj('fx', FxChain) /* … */
  .val('f_0x10', u32));                       // v19 only
```

Rules:

- **Field names default to firmware struct offsets** (`f_0x18`), which stay
  stable across versions. They are renamed to semantic names as we learn them,
  and a mapping table keeps old JSON exports loadable.
- **Unknown or opaque bytes are fields too** (`u_*`, typed raw). The writer
  re-emits them unchanged. Nothing is "skipped".
- **Note payload**: kept as 10 raw bytes, plus *views* for the bits we know
  (pitch, velocity, probability, length). Editing a known field changes only
  its bits.
- A **migration** registry (`(class, vN) → vN+1`) ports the firmware's own
  upgrade code, so old files can be opened and written for the current target.
- **Target profiles** (`os-3.10`, `os-3.22`, …) map each class to the version
  to write. Adding a firmware version means a new profile, plus schemas for
  any classes that changed.

### 3.3 Domain model and commands

- The UI never touches bytes. It edits the domain model through **commands**,
  for example `SetNoteVelocity` or `MoveNote`, `SetTrackOutput`, `SetFxParam`,
  `AddSongEntry`, `SetSetting`.
- Commands are undoable and validated before they apply.
- The domain model wraps the codec tree. A track view reads `track.f_0x18` and
  presents it as `rootNote` once that's confirmed.

### 3.4 Validation layers

1. **Structural.** Every value fits its bit width and enum. Arrays have the
   firmware counts: 16 tracks, 16 patterns, 8 FX slots, 17 lists.
2. **Semantic.** Port kinds and index ranges, MIDI channel 0–15, note positions
   inside the pattern length (192 PPQN, 48 ticks per step 🟡), sorted note lists.
3. **Capacity.** Note and automation-point budgets per device pool, once extracted.
4. **Consistency.**
   - The track's instrument-def file exists on the card.
   - Lane names and notes match that file.
   - `AUTO.LOAD` names an existing project folder.

### 3.5 Storage and safety

- **Open read-only by default.** Editing works on an in-memory model.
- **Save flow:**
  1. serialize every file of the project;
  2. **re-parse the result** and require a structurally equal model;
  3. package it as a download, under a new folder name by default.

  You copy the result to the card, so the card is never written partially by
  the editor. Where direct writing is available (Chromium), the flow is temp
  file, rename, then a backup under `.paxdat-backup/<timestamp>/`. Whether the
  device ignores unknown files needs checking on the device.
- **"Save as new project"** (a new folder) is the default for the first edits
  of a session. It's the safest test on the device.
- Never write `settings.dat` or `calibration.dat` unless the user explicitly
  edits settings. Never touch calibration.

## 4. Verification strategy

The device is the final oracle, so verification works on several levels:

1. **Golden round-trip.** For every sample, `parse → write` must equal the
   original bytes. This runs in CI over `Samples/` for both OS versions.
2. **Cross-implementation.** The Python probe and the TypeScript codec produce
   the same JSON for every sample.
3. **Device round-trip** (manual, per feature):
   1. edit with PaxDAT and save as a new project;
   2. load it on the Hapax and confirm the change is visible;
   3. save on the Hapax;
   4. `paxdat diff` the editor output against the device output.

   The only allowed differences are runtime state. A per-feature checklist
   lives in `docs/DEVICE_TESTS.md`.
4. **Fuzzing.** Mutate known fields inside their valid ranges and check that
   the writer and parser agree. On the device, spot-check that it never shows
   "CORRUPTED FILE".

## 5. Feature phases

| Phase | Scope | Format confidence it needs |
|---|---|---|
| **0: Inspector** | Card browser; read-only views of tracks, routing, FX, patterns, notes, automation, song, settings; JSON export; diff two projects | everything that parses today ✅ |
| **1: Safe edits** | FX parameter values (self-describing); MIDI channel; output port (MIDI A–D, USB); song sections and entries; tempo; `settings.dat` keys; `AUTO.LOAD`; instrument-def `.txt` authoring (documented syntax); normalize runtime state | 🔧 structure, plus one device test per edit type |
| **2: Sequence editing** | Piano roll: add, move, delete notes; velocity, length, probability; automation point editing; pattern length | note payload bits; capacity limits |
| **3: Track types** | Drum lanes and hits, MPE notes with curves, AFTR tracks | sample captures + `drums.dat` / `mpe.dat` / v19 field |
| **4: Interchange** | MIDI-file import and export, compatible with the device's own exporter; copy tracks or patterns between projects | phase 2 |

Phase 0 needs no further reverse engineering and can start immediately.

**Phase 0 status (2026-10-27): implemented.**
- `packages/core`: codec with a writer for every structure. Golden round-trip
  tests pass byte-identically on all local samples (OS 3.10 and 3.22),
  cross-checked against the Python probe.
- `packages/cli`: `inspect`, `diff`, `roundtrip`.
- `apps/web`: React inspector, verified in headless Firefox against the samples.

## 6. Repository layout (proposed)

```
docs/            FORMAT.md, FIRMWARE_NOTES.md, EDITOR_DESIGN.md, DEVICE_TESTS.md
tools/           paxdat_probe.py (research oracle), re/ (Ghidra + catalogue scripts)
packages/core/   codec (schemas, reader, writer, migrations, profiles), model, validation
packages/cli/    paxdat CLI
apps/web/        React UI (Vite); Firefox-first; a desktop wrapper only if needed later
Samples/         local test projects (git-ignored until the golden set exists)
```

`re-work/` and `Target Firmware/` stay git-ignored.

## 7. Decisions (2026-10-26)

1. **UI framework:** React.
2. **Platform:** browser-first, with Firefox as the primary browser. Storage
   uses the download flow in §3.1 and §3.5.
3. **Samples in git:** not yet. A purpose-built set of golden samples will be
   designed together later (see `FORMAT.md` §11 for the capture list). Until
   then, golden tests run locally against `Samples/`.

## 8. Next reverse-engineering items, by editor phase

- **Phase 1:**
  - output-type enum and USB/CV index meaning;
  - track field semantics at `@0x18…@0x4a`, from the track-settings UI;
  - meaning of the `value2` and per-pattern slots in FX parameters.
- **Phase 2:**
  - note payload bit layout (step-edit setters, MIDI-file exporter);
  - pattern-header fields;
  - capacity limits.
- **Phase 3:**
  - `drums.dat` and `mpe.dat` serializers (writers already located);
  - the new v19 track field.
