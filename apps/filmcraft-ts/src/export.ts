import type { MediaAsset, Project } from "./model";
import { frameToSeconds, projectEndFrame } from "./model";

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function seek(element: HTMLVideoElement, time: number): Promise<void> {
  if (element.readyState < 2) {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("A source video could not load for export.")),
        10000,
      );
      element.onloadeddata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      element.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("A source video could not load for export."));
      };
      element.load();
    });
  }
  if (Math.abs(element.currentTime - time) < 0.008 && element.readyState >= 2)
    return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("A source frame could not be decoded.")),
      10000,
    );
    element.onseeked = () => {
      window.clearTimeout(timer);
      resolve();
    };
    element.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("A source file could not be decoded."));
    };
    element.currentTime = time;
  });
}

/** Browser-native WebM proof export. Video and stills render frame by frame; audio is not mixed yet. */
export async function exportWebM(
  project: Project,
  media: MediaAsset[],
  urls: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<Blob> {
  const frames = projectEndFrame(project);
  if (!frames)
    throw new Error(
      "Put a video or image clip on the timeline before exporting.",
    );
  if (frames > project.fps * 120)
    throw new Error(
      "This comparison build exports sequences up to two minutes.",
    );
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream)
    throw new Error("This browser does not support WebM recording.");
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(project.width, 1280);
  canvas.height = Math.round((canvas.width * project.height) / project.width);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  const videos = new Map<string, HTMLVideoElement>();
  for (const item of media.filter(
    (entry) => entry.kind === "video" && urls[entry.id],
  )) {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.src = urls[item.id];
    videos.set(item.id, video);
  }
  const images = new Map<string, HTMLImageElement>();
  for (const item of media.filter(
    (entry) => entry.kind === "image" && urls[entry.id],
  )) {
    const image = new Image();
    image.src = urls[item.id];
    await image.decode();
    images.set(item.id, image);
  }
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & {
    requestFrame?: () => void;
  };
  const mimeType = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser cannot encode WebM.");
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });
  const chunks: Blob[] = [];
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () =>
      reject(new Error("The browser stopped recording."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  try {
    recorder.start();
    for (let frame = 0; frame < frames; frame++) {
      context.fillStyle = "#101016";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const clip = project.tracks
        .filter((item) => item.kind === "video" && !item.muted)
        .flatMap((item) => item.clips)
        .find(
          (item) =>
            frame >= item.startFrame &&
            frame < item.startFrame + item.durationFrames,
        );
      if (clip) {
        const source = media.find((item) => item.id === clip.mediaId);
        const video = videos.get(clip.mediaId);
        const image = images.get(clip.mediaId);
        if (!source || !urls[clip.mediaId])
          throw new Error("A timeline source file is missing.");
        if (video) {
          await seek(
            video,
            frameToSeconds(
              clip.sourceInFrame + frame - clip.startFrame,
              project.fps,
            ),
          );
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
        } else if (image)
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
      track.requestFrame?.();
      onProgress((frame + 1) / frames);
      await wait(1000 / project.fps);
    }
    recorder.stop();
    return await finished;
  } catch (error) {
    if (recorder.state !== "inactive") recorder.stop();
    throw error;
  } finally {
    stream.getTracks().forEach((item) => item.stop());
    videos.forEach((item) => {
      item.removeAttribute("src");
      item.load();
    });
  }
}
