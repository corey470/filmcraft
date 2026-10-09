export type MediaKind = "video" | "audio" | "image";
export type TrackKind = "video" | "audio";

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  duration: number;
  width?: number;
  height?: number;
  mimeType: string;
  bytes: number;
}

export interface Clip {
  id: string;
  mediaId: string;
  trackId: string;
  startFrame: number;
  durationFrames: number;
  sourceInFrame: number;
  sourceOutFrame: number;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  locked: boolean;
  muted: boolean;
  sync: boolean;
  clips: Clip[];
}

export interface Marker {
  id: string;
  frame: number;
  label: string;
}

export interface Project {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  tracks: Track[];
  markers: Marker[];
  updatedAt: number;
}

export const FPS = 30;
export const frameToSeconds = (frame: number, fps = FPS) => frame / fps;
export const secondsToFrame = (seconds: number, fps = FPS) =>
  Math.round(seconds * fps);
export const endFrame = (clip: Clip) => clip.startFrame + clip.durationFrames;
export const projectEndFrame = (project: Project) =>
  Math.max(0, ...project.tracks.flatMap((track) => track.clips.map(endFrame)));

export function newProject(): Project {
  return {
    id: crypto.randomUUID(),
    name: "Untitled cut",
    fps: FPS,
    width: 1920,
    height: 1080,
    tracks: [
      {
        id: "v1",
        name: "Video 1",
        kind: "video",
        locked: false,
        muted: false,
        sync: false,
        clips: [],
      },
      {
        id: "a1",
        name: "Audio 1",
        kind: "audio",
        locked: false,
        muted: false,
        sync: true,
        clips: [],
      },
    ],
    markers: [],
    updatedAt: Date.now(),
  };
}
