import { describe, expect, it } from "vitest";
import { addSourceRange, removeClip, splitClip, trimClip } from "./edit";
import type { Clip, MediaAsset, Project } from "./model";
import { newProject } from "./model";

const media: MediaAsset[] = [
  {
    id: "red",
    name: "red.mp4",
    kind: "video",
    duration: 4,
    mimeType: "video/mp4",
    bytes: 1,
  },
  {
    id: "blue",
    name: "blue.mp4",
    kind: "video",
    duration: 4,
    mimeType: "video/mp4",
    bytes: 1,
  },
  {
    id: "middle",
    name: "middle.mp4",
    kind: "video",
    duration: 4,
    mimeType: "video/mp4",
    bytes: 1,
  },
  {
    id: "song",
    name: "song.wav",
    kind: "audio",
    duration: 4,
    mimeType: "audio/wav",
    bytes: 1,
  },
];
const clip = (
  id: string,
  mediaId: string,
  startFrame: number,
  sourceInFrame: number,
  durationFrames = 60,
): Clip => ({
  id,
  mediaId,
  trackId: "v1",
  startFrame,
  durationFrames,
  sourceInFrame,
  sourceOutFrame: sourceInFrame + durationFrames,
});
function project(): Project {
  const p = newProject();
  p.tracks[0].clips = [
    clip("a", "red", 0, 0),
    clip("b", "middle", 60, 60),
    clip("c", "blue", 120, 60),
  ];
  p.tracks[1].clips = [{ ...clip("music", "song", 120, 0), trackId: "a1" }];
  p.markers = [{ id: "m", frame: 120, label: "hit" }];
  return p;
}

describe("FilmCraft TS edit plans", () => {
  it("inserts marked frames at a cut and moves later Sync clips and markers", () => {
    const original = project();
    const planned = addSourceRange(
      original,
      media[0],
      "v1",
      60,
      90,
      "insert",
      120,
      "new",
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(
      planned.project.tracks[0].clips.find((c) => c.id === "new"),
    ).toMatchObject({ startFrame: 120, durationFrames: 30, sourceInFrame: 60 });
    expect(
      planned.project.tracks[0].clips.find((c) => c.id === "c")?.startFrame,
    ).toBe(150);
    expect(planned.project.tracks[1].clips[0].startFrame).toBe(150);
    expect(planned.project.markers[0].frame).toBe(150);
    expect(original.tracks[0].clips).toHaveLength(3);
  });

  it("blocks insert through a clip", () => {
    expect(
      addSourceRange(project(), media[0], "v1", 0, 30, "insert", 30, "new"),
    ).toMatchObject({ ok: false });
  });

  it("slips source frames without moving the timeline clip", () => {
    const planned = trimClip(project(), media, "b", -15, "slip");
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.project.tracks[0].clips[1]).toMatchObject({
      startFrame: 60,
      durationFrames: 60,
      sourceInFrame: 45,
      sourceOutFrame: 105,
    });
  });

  it("slides between touching neighbors while preserving the span", () => {
    const planned = trimClip(project(), media, "b", 15, "slide");
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(
      planned.project.tracks[0].clips.map((c) => [
        c.startFrame,
        c.durationFrames,
      ]),
    ).toEqual([
      [0, 75],
      [75, 60],
      [135, 45],
    ]);
  });

  it("rolls a cut and ripples later tracks without overlapping", () => {
    const rolled = trimClip(project(), media, "a", 10, "roll");
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(
      rolled.project.tracks[0].clips
        .slice(0, 2)
        .map((c) => [c.durationFrames, c.startFrame]),
    ).toEqual([
      [70, 0],
      [50, 70],
    ]);
    const rippled = trimClip(project(), media, "b", -10, "ripple");
    expect(rippled.ok).toBe(true);
    if (!rippled.ok) return;
    expect(rippled.project.tracks[0].clips[2].startFrame).toBe(110);
    expect(rippled.project.tracks[1].clips[0].startFrame).toBe(110);
    expect(rippled.project.markers[0].frame).toBe(110);
  });

  it("splits and ripple-deletes with one-frame bounds", () => {
    const split = splitClip(project(), "b", 90, "right");
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(
      split.project.tracks[0].clips.find((c) => c.id === "right"),
    ).toMatchObject({ startFrame: 90, sourceInFrame: 90, durationFrames: 30 });
    const removed = removeClip(project(), "b", true);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(
      removed.project.tracks[0].clips.find((c) => c.id === "c")?.startFrame,
    ).toBe(60);
    expect(removed.project.tracks[1].clips[0].startFrame).toBe(60);
  });
});
