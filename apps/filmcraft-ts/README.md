# FilmCraft TS comparison editor

An independent, browser-only TypeScript editor made for comparing a familiar Premiere-style workflow with [Irie Cut](https://iriecut.com/). It takes workflow inspiration from [FilmCraft](https://github.com/corey470/filmcraft) by the ArtCraft Team. It does not use FilmCraft's Rust engine or claim feature parity with it.

## Run

Requires Node.js 20.19+ and pnpm 10.

```sh
cd apps/filmcraft-ts
pnpm install
pnpm dev
```

Open `http://127.0.0.1:8767/`. The editor works with local files in the browser and does not upload them. Builds are static:

```sh
pnpm test
pnpm run build
pnpm preview
```

## Current comparison surface

- Import video, audio, and still images into a source bin.
- Mark exact source In/Out frames, then append or insert at the playhead.
- Edit a 30 fps V1/A1 timeline with select, edge trim, ripple, roll, slip, slide, split, delete, and ripple delete. Edits reject collisions and impossible source ranges.
- Preview picture and a separate audio track, use transport and frame scrubbing, and undo/redo edits.
- Save the current workspace and imported files in browser IndexedDB. Reloading the same browser profile restores them.
- Export video and still-image tracks to 1280×720 VP9/VP8 WebM via browser MediaRecorder.

## Boundaries

This is a usable comparison build, not a port of FilmCraft's Rust renderer or its complete editor. It has one video track and one audio track, a fixed 30 fps timeline, no linked source audio, no effects, and no audio mix in WebM export. Export runs in real time, is limited to two minutes, and depends on the browser's video decoder and MediaRecorder. The workspace lives only in that browser profile; the exported WebM is the portable result. Keep original media files until you have checked the export.

The interface uses an original text mark and permissively licensed Lucide icons. It does not bundle ArtCraft brand marks, Adobe assets, or FilmCraft media. Plain-text attribution is included above and in the app.

## Implementation

- `src/model.ts`: frame-based project and media model.
- `src/edit.ts`: pure edit plans and collision/source bounds validation.
- `src/storage.ts`: IndexedDB project and media storage.
- `src/export.ts`: browser WebM video export.
- `src/App.tsx`: source, program, and timeline UI.

The source fork revision used for comparison was `0bae537ad0ae7ffc7f15b57e3047cae18a527c23`. The original Rust/WebAssembly build remains separately available in the fork's `main` branch.
