import type { Clip, MediaAsset, Project, Track } from "./model";
import { endFrame } from "./model";

export type EditResult =
  | { ok: true; project: Project; selectedId?: string }
  | { ok: false; error: string };
export type TrimTool = "edge" | "ripple" | "roll" | "slip" | "slide";

const fail = (error: string): EditResult => ({ ok: false, error });
const copy = (project: Project): Project => ({
  ...project,
  updatedAt: Date.now(),
  tracks: project.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => ({ ...clip })),
  })),
  markers: project.markers.map((marker) => ({ ...marker })),
});
const findTrack = (project: Project, id: string) =>
  project.tracks.find((track) => track.id === id);
const findClip = (track: Track, id: string) =>
  track.clips.find((clip) => clip.id === id);
const mediaFrames = (media: MediaAsset, fps: number) =>
  Math.floor(media.duration * fps + 0.00001);
const validSource = (clip: Clip, media: MediaAsset, fps: number) =>
  media.kind === "image" ||
  (clip.sourceInFrame >= 0 &&
    clip.sourceOutFrame <= mediaFrames(media, fps) &&
    clip.sourceOutFrame - clip.sourceInFrame === clip.durationFrames);
const collision = (track: Track) => {
  const clips = [...track.clips].sort((a, b) => a.startFrame - b.startFrame);
  return clips.some(
    (clip, index) =>
      clip.startFrame < 0 ||
      clip.durationFrames < 1 ||
      (index > 0 && endFrame(clips[index - 1]) > clip.startFrame),
  );
};
const validProject = (project: Project) =>
  project.tracks.every((track) => !collision(track));

function result(project: Project, selectedId?: string): EditResult {
  if (!validProject(project))
    return fail(
      "The edit would overlap another clip or make a clip shorter than one frame.",
    );
  return { ok: true, project, selectedId };
}

/** Add only the marked source frames, or open a gap at an existing cut. */
export function addSourceRange(
  original: Project,
  media: MediaAsset,
  trackId: string,
  inFrame: number,
  outFrame: number,
  mode: "append" | "insert",
  playheadFrame: number,
  id: string,
): EditResult {
  if (![inFrame, outFrame, playheadFrame].every(Number.isInteger))
    return fail("Use whole project frames for the source range.");
  if (
    inFrame < 0 ||
    outFrame <= inFrame ||
    (media.kind !== "image" && outFrame > mediaFrames(media, original.fps))
  )
    return fail("Choose an In and Out range inside the source.");
  const project = copy(original);
  const track = findTrack(project, trackId);
  if (
    !track ||
    track.locked ||
    track.kind !== (media.kind === "audio" ? "audio" : "video")
  )
    return fail("Choose an unlocked matching track.");
  const durationFrames = outFrame - inFrame;
  const at =
    mode === "append"
      ? Math.max(0, ...track.clips.map(endFrame))
      : Math.max(0, playheadFrame);
  const affected =
    mode === "insert"
      ? project.tracks.filter(
          (item) => !item.locked && (item.id === trackId || item.sync),
        )
      : [track];
  if (
    mode === "insert" &&
    affected.some((item) =>
      item.clips.some((clip) => clip.startFrame < at && endFrame(clip) > at),
    )
  ) {
    return fail(
      "Split any clip crossing the playhead on this or a Sync track before inserting.",
    );
  }
  if (mode === "insert") {
    for (const item of affected)
      for (const clip of item.clips)
        if (clip.startFrame >= at) clip.startFrame += durationFrames;
    for (const marker of project.markers)
      if (marker.frame >= at) marker.frame += durationFrames;
  }
  track.clips.push({
    id,
    mediaId: media.id,
    trackId,
    startFrame: at,
    durationFrames,
    sourceInFrame: inFrame,
    sourceOutFrame: outFrame,
  });
  return result(project, id);
}

export function splitClip(
  original: Project,
  clipId: string,
  atFrame: number,
  newId: string,
): EditResult {
  const project = copy(original);
  const track = project.tracks.find((item) =>
    item.clips.some((clip) => clip.id === clipId),
  );
  if (!track || track.locked)
    return fail("Select a clip on an unlocked track.");
  const clip = findClip(track, clipId)!;
  if (
    !Number.isInteger(atFrame) ||
    atFrame <= clip.startFrame ||
    atFrame >= endFrame(clip)
  )
    return fail("Put the playhead inside the selected clip to split it.");
  const leftDuration = atFrame - clip.startFrame;
  const right: Clip = {
    ...clip,
    id: newId,
    startFrame: atFrame,
    durationFrames: clip.durationFrames - leftDuration,
    sourceInFrame: clip.sourceInFrame + leftDuration,
  };
  clip.durationFrames = leftDuration;
  clip.sourceOutFrame = right.sourceInFrame;
  track.clips.push(right);
  return result(project, newId);
}

export function moveClip(
  original: Project,
  clipId: string,
  startFrame: number,
): EditResult {
  if (!Number.isInteger(startFrame) || startFrame < 0)
    return fail("Move to a nonnegative project frame.");
  const project = copy(original);
  const track = project.tracks.find((item) =>
    item.clips.some((clip) => clip.id === clipId),
  );
  if (!track || track.locked) return fail("The track is locked.");
  findClip(track, clipId)!.startFrame = startFrame;
  return result(project, clipId);
}

/** Frame-based trim plans. Edits return a new project and never modify the input. */
export function trimClip(
  original: Project,
  media: MediaAsset[],
  clipId: string,
  delta: number,
  tool: TrimTool,
  edge: "in" | "out" = "out",
): EditResult {
  if (!Number.isInteger(delta) || delta === 0)
    return fail("Choose at least one frame.");
  const project = copy(original);
  const track = project.tracks.find((item) =>
    item.clips.some((clip) => clip.id === clipId),
  );
  if (!track || track.locked) return fail("The track is locked.");
  const clip = findClip(track, clipId)!;
  const source = media.find((item) => item.id === clip.mediaId);
  if (!source) return fail("The source file is missing.");
  const touchingBefore = track.clips.find(
    (item) => item.id !== clip.id && endFrame(item) === clip.startFrame,
  );
  const touchingAfter = track.clips.find(
    (item) => item.id !== clip.id && item.startFrame === endFrame(clip),
  );

  if (tool === "slip") {
    if (source.kind === "image")
      return fail("Slip works on video and audio clips.");
    clip.sourceInFrame += delta;
    clip.sourceOutFrame += delta;
    if (!validSource(clip, source, project.fps))
      return fail("The source has no frames in that direction.");
    return result(project, clipId);
  }
  if (tool === "slide") {
    if (!touchingBefore || !touchingAfter)
      return fail("Slide needs touching clips on both sides.");
    const beforeMedia = media.find(
      (item) => item.id === touchingBefore.mediaId,
    );
    const afterMedia = media.find((item) => item.id === touchingAfter.mediaId);
    if (!beforeMedia || !afterMedia)
      return fail("A neighboring source file is missing.");
    touchingBefore.durationFrames += delta;
    touchingBefore.sourceOutFrame += delta;
    clip.startFrame += delta;
    touchingAfter.startFrame += delta;
    touchingAfter.durationFrames -= delta;
    touchingAfter.sourceInFrame += delta;
    if (
      !validSource(touchingBefore, beforeMedia, project.fps) ||
      !validSource(touchingAfter, afterMedia, project.fps)
    )
      return fail("A neighboring source has no frames for that slide.");
    return result(project, clipId);
  }
  if (tool === "roll") {
    const before = edge === "in" ? touchingBefore : clip;
    const after = edge === "in" ? clip : touchingAfter;
    if (!before || !after) return fail("Roll needs two touching clips.");
    const beforeMedia = media.find((item) => item.id === before.mediaId);
    const afterMedia = media.find((item) => item.id === after.mediaId);
    if (!beforeMedia || !afterMedia) return fail("A source file is missing.");
    before.durationFrames += delta;
    before.sourceOutFrame += delta;
    after.startFrame += delta;
    after.durationFrames -= delta;
    after.sourceInFrame += delta;
    if (
      !validSource(before, beforeMedia, project.fps) ||
      !validSource(after, afterMedia, project.fps)
    )
      return fail("A source has no frames for that roll.");
    return result(project, clipId);
  }
  if (edge === "in") {
    if (tool === "ripple")
      return fail("Ripple uses the clip out edge in this build.");
    clip.startFrame += delta;
    clip.durationFrames -= delta;
    clip.sourceInFrame += delta;
  } else {
    const oldEnd = endFrame(clip);
    clip.durationFrames += delta;
    clip.sourceOutFrame += delta;
    if (tool === "ripple") {
      const affected = project.tracks.filter(
        (item) => !item.locked && (item.id === track.id || item.sync),
      );
      if (
        affected.some((item) =>
          item.clips.some(
            (other) =>
              other.id !== clipId &&
              other.startFrame < oldEnd &&
              endFrame(other) > oldEnd,
          ),
        )
      ) {
        return fail("A clip crosses this edit point on a Sync track.");
      }
      for (const item of affected)
        for (const other of item.clips)
          if (other.id !== clipId && other.startFrame >= oldEnd)
            other.startFrame += delta;
      for (const marker of project.markers)
        if (marker.frame >= oldEnd) marker.frame += delta;
    }
  }
  if (!validSource(clip, source, project.fps))
    return fail("The source has no frames for that trim.");
  return result(project, clipId);
}

export function removeClip(
  original: Project,
  clipId: string,
  ripple = false,
): EditResult {
  const project = copy(original);
  const track = project.tracks.find((item) =>
    item.clips.some((clip) => clip.id === clipId),
  );
  if (!track || track.locked) return fail("The track is locked.");
  const clip = findClip(track, clipId)!;
  track.clips = track.clips.filter((item) => item.id !== clipId);
  if (ripple) {
    const at = endFrame(clip);
    const affected = project.tracks.filter(
      (item) => !item.locked && (item.id === track.id || item.sync),
    );
    if (
      affected.some((item) =>
        item.clips.some(
          (other) => other.startFrame < at && endFrame(other) > at,
        ),
      )
    )
      return fail("A clip crosses the gap on a Sync track.");
    for (const item of affected)
      for (const other of item.clips)
        if (other.startFrame >= at) other.startFrame -= clip.durationFrames;
    for (const marker of project.markers)
      if (marker.frame >= at)
        marker.frame = Math.max(0, marker.frame - clip.durationFrames);
  }
  return result(project);
}
