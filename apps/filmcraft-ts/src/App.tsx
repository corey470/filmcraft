import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Download,
  Film,
  FolderOpen,
  Lock,
  LockOpen,
  Pause,
  Play,
  Redo2,
  Scissors,
  SkipBack,
  Undo2,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  addSourceRange,
  moveClip,
  removeClip,
  splitClip,
  trimClip,
  type EditResult,
  type TrimTool,
} from "./edit";
import { exportWebM } from "./export";
import {
  endFrame,
  frameToSeconds,
  newProject,
  projectEndFrame,
  secondsToFrame,
  type MediaAsset,
  type Project,
} from "./model";
import {
  inspectFile,
  loadWorkspace,
  saveMedia,
  saveWorkspace,
} from "./storage";

const tools: { id: TrimTool | "select"; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Move a clip into empty space" },
  { id: "edge", label: "Trim", hint: "Change one clip edge" },
  {
    id: "ripple",
    label: "Ripple",
    hint: "Trim the out edge and shift later clips",
  },
  { id: "roll", label: "Roll", hint: "Move a cut between touching clips" },
  {
    id: "slip",
    label: "Slip",
    hint: "Change source frames without moving the clip",
  },
  {
    id: "slide",
    label: "Slide",
    hint: "Move a clip while trimming its neighbors",
  },
];
const fmt = (frame: number, fps = 30) => {
  const seconds = Math.floor(frame / fps);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}:${String(frame % fps).padStart(2, "0")}`;
};

function App() {
  const [project, setProject] = useState<Project>(newProject);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string>();
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const [tool, setTool] = useState<TrimTool | "select">("select");
  const [edge, setEdge] = useState<"in" | "out">("out");
  const [delta, setDelta] = useState(15);
  const [sourceIn, setSourceIn] = useState(0);
  const [sourceOut, setSourceOut] = useState(30);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(3);
  const [status, setStatus] = useState(
    "Import a video, audio file, or image to begin.",
  );
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Project[]>([]);
  const [redo, setRedo] = useState<Project[]>([]);
  const sourceVideo = useRef<HTMLVideoElement>(null);
  const sourceAudio = useRef<HTMLAudioElement>(null);
  const programVideo = useRef<HTMLVideoElement>(null);
  const programAudio = useRef<HTMLAudioElement>(null);
  const playheadRef = useRef(playhead);
  const pointer = useRef<
    { id: string; x: number; edge?: "in" | "out" } | undefined
  >(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  playheadRef.current = playhead;

  useEffect(() => {
    let active = true;
    loadWorkspace()
      .then((saved) => {
        if (!active) return;
        if (saved.project) setProject(saved.project);
        setMedia(saved.media);
        setUrls(saved.urls);
        setLoaded(true);
        setStatus(
          saved.project
            ? "Your last browser workspace is ready."
            : "Import a source to begin.",
        );
      })
      .catch((error) => {
        setLoaded(true);
        setStatus(`Storage: ${String(error)}`);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(
      () =>
        saveWorkspace(project, media).catch((error) =>
          setStatus(`Save failed: ${String(error)}`),
        ),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [project, media, loaded]);

  function commit(next: Project, selectedId?: string) {
    setUndo((items) => [...items.slice(-49), project]);
    setRedo([]);
    setProject(next);
    if (selectedId) setSelectedClipId(selectedId);
  }
  function apply(result: EditResult) {
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    commit(result.project, result.selectedId);
    setStatus("Edit saved. Undo is available.");
  }
  function history(direction: "undo" | "redo") {
    const stack = direction === "undo" ? undo : redo;
    const previous = stack.at(-1);
    if (!previous) return;
    if (direction === "undo") {
      setUndo(stack.slice(0, -1));
      setRedo((items) => [...items, project]);
    } else {
      setRedo(stack.slice(0, -1));
      setUndo((items) => [...items, project]);
    }
    setProject(previous);
    setSelectedClipId(undefined);
    setStatus(direction === "undo" ? "Undid edit." : "Redid edit.");
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    for (const file of Array.from(files)) {
      try {
        const { asset, url } = await inspectFile(file);
        await saveMedia(asset.id, file);
        setMedia((items) => [...items, asset]);
        setUrls((items) => ({ ...items, [asset.id]: url }));
        setSelectedMediaId(asset.id);
        setSourceIn(0);
        setSourceOut(
          asset.kind === "image"
            ? 150
            : Math.max(1, Math.floor(asset.duration * project.fps)),
        );
        added++;
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }
    if (added)
      setStatus(
        `Imported ${added} source${added === 1 ? "" : "s"} into this browser.`,
      );
    if (fileInput.current) fileInput.current.value = "";
    setBusy(false);
  }
  const selectedMedia = media.find((item) => item.id === selectedMediaId);
  const selectedClip = project.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selectedClipId);
  const selectedTrack = project.tracks.find((track) =>
    track.clips.some((clip) => clip.id === selectedClipId),
  );
  const end = projectEndFrame(project);
  const activeVideo = project.tracks
    .filter((track) => track.kind === "video" && !track.muted)
    .flatMap((track) => track.clips)
    .find((clip) => playhead >= clip.startFrame && playhead < endFrame(clip));
  const activeVideoMedia = media.find(
    (item) => item.id === activeVideo?.mediaId,
  );
  const activeAudio = project.tracks
    .filter((track) => track.kind === "audio" && !track.muted)
    .flatMap((track) => track.clips)
    .find((clip) => playhead >= clip.startFrame && playhead < endFrame(clip));

  useEffect(() => {
    const video = programVideo.current;
    if (!video || !activeVideo || activeVideoMedia?.kind !== "video") return;
    const time = frameToSeconds(
      activeVideo.sourceInFrame + playhead - activeVideo.startFrame,
      project.fps,
    );
    if (Math.abs(video.currentTime - time) > 0.09) video.currentTime = time;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [activeVideo?.id, activeVideoMedia?.kind, playhead, project.fps, playing]);
  useEffect(() => {
    const audio = programAudio.current;
    if (!audio || !activeAudio) return;
    const time = frameToSeconds(
      activeAudio.sourceInFrame + playhead - activeAudio.startFrame,
      project.fps,
    );
    if (Math.abs(audio.currentTime - time) > 0.12) audio.currentTime = time;
    if (playing) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [activeAudio?.id, playhead, project.fps, playing]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const started =
      performance.now() -
      frameToSeconds(playheadRef.current, project.fps) * 1000;
    const tick = () => {
      const next = Math.round(
        ((performance.now() - started) * project.fps) / 1000,
      );
      if (next >= end) {
        setPlaying(false);
        setPlayhead(end);
        return;
      }
      setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, project.fps, end]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((current) => !current);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        history(event.shiftKey ? "redo" : "undo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function add(mode: "append" | "insert") {
    if (!selectedMedia) {
      setStatus("Select an imported source first.");
      return;
    }
    const trackId = selectedMedia.kind === "audio" ? "a1" : "v1";
    apply(
      addSourceRange(
        project,
        selectedMedia,
        trackId,
        sourceIn,
        sourceOut,
        mode,
        playhead,
        crypto.randomUUID(),
      ),
    );
  }
  function editDelta(amount: number, editEdge = edge) {
    if (!selectedClipId) {
      setStatus("Select a timeline clip first.");
      return;
    }
    if (tool === "select") {
      apply(
        moveClip(
          project,
          selectedClipId,
          (selectedClip?.startFrame ?? 0) + amount,
        ),
      );
      return;
    }
    apply(trimClip(project, media, selectedClipId, amount, tool, editEdge));
  }
  async function exportFile() {
    setBusy(true);
    setPlaying(false);
    try {
      const blob = await exportWebM(project, media, urls, (fraction) =>
        setStatus(`Exporting video ${Math.round(fraction * 100)}%`),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${
        project.name
          .trim()
          .replace(/[^a-z0-9-_]+/gi, "-")
          .toLowerCase() || "filmcraft-cut"
      }.webm`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus(
        `Exported ${blob.size.toLocaleString()} bytes of WebM video. Audio mixing is not included yet.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
  }
  const timelineWidth = Math.max(900, (end + 120) * zoom);
  const ticks = Array.from(
    { length: Math.ceil((end + 120) / 30) + 1 },
    (_, index) => index * 30,
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            F<span>+</span>
          </span>
          <div>
            <strong>FilmCraft TS</strong>
            <small>comparison editor</small>
          </div>
        </div>
        <div className="project-name">
          <input
            aria-label="Project name"
            value={project.name}
            onChange={(event) =>
              setProject({
                ...project,
                name: event.target.value,
                updatedAt: Date.now(),
              })
            }
          />
          <span>30 fps · 16:9 · browser workspace</span>
        </div>
        <div className="top-actions">
          <button
            onClick={() => history("undo")}
            disabled={!undo.length}
            title="Undo"
          >
            <Undo2 size={16} />
          </button>
          <button
            onClick={() => history("redo")}
            disabled={!redo.length}
            title="Redo"
          >
            <Redo2 size={16} />
          </button>
          <button
            className="primary"
            onClick={exportFile}
            disabled={busy || !end}
          >
            <Download size={15} /> Export WebM
          </button>
        </div>
      </header>
      <main className="main-grid">
        <section className="panel media-panel">
          <div className="panel-title">
            <div>
              <b>Project media</b>
              <small>
                {media.length} source{media.length === 1 ? "" : "s"}
              </small>
            </div>
            <button
              className="subtle"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              <FolderOpen size={15} /> Import
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="video/*,audio/*,image/*"
              multiple
              hidden
              onChange={(event) => void importFiles(event.target.files)}
            />
          </div>
          <div className="media-list">
            {media.length ? (
              media.map((item) => (
                <button
                  key={item.id}
                  className={`media-item ${item.id === selectedMediaId ? "active" : ""}`}
                  onClick={() => {
                    setSelectedMediaId(item.id);
                    setSourceIn(0);
                    setSourceOut(
                      item.kind === "image"
                        ? 150
                        : Math.max(1, Math.floor(item.duration * project.fps)),
                    );
                  }}
                >
                  <span className={`media-icon ${item.kind}`}>
                    <Film size={19} />
                  </span>
                  <span>
                    <strong title={item.name}>{item.name}</strong>
                    <small>
                      {item.kind.toUpperCase()} ·{" "}
                      {item.kind === "image"
                        ? `${item.width}×${item.height}`
                        : `${item.duration.toFixed(1)}s`}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-media">
                <FolderOpen size={28} />
                <strong>Your media starts here</strong>
                <p>
                  Files stay in this browser. Import a clip to mark a range and
                  cut it into the timeline.
                </p>
                <button
                  className="primary"
                  onClick={() => fileInput.current?.click()}
                >
                  Import media
                </button>
              </div>
            )}
          </div>
          <div className="media-foot">Local files · saved with IndexedDB</div>
        </section>
        <section className="panel source-panel">
          <div className="panel-title">
            <div>
              <b>Source</b>
              <small>
                {selectedMedia?.name ?? "Choose a file in Project media"}
              </small>
            </div>
          </div>
          <div className="viewer">
            {selectedMedia && urls[selectedMedia.id] ? (
              selectedMedia.kind === "image" ? (
                <img src={urls[selectedMedia.id]} alt={selectedMedia.name} />
              ) : selectedMedia.kind === "video" ? (
                <video
                  ref={sourceVideo}
                  src={urls[selectedMedia.id]}
                  controls
                  preload="metadata"
                />
              ) : (
                <div className="audio-view">
                  <Volume2 size={42} />
                  <strong>{selectedMedia.name}</strong>
                  <audio
                    ref={sourceAudio}
                    src={urls[selectedMedia.id]}
                    controls
                  />
                </div>
              )
            ) : (
              <div className="viewer-placeholder">
                <Film size={43} />
                <span>Source preview</span>
              </div>
            )}
          </div>
          <div className="source-controls">
            <label>
              In{" "}
              <input
                type="number"
                min="0"
                value={sourceIn}
                onChange={(event) =>
                  setSourceIn(Math.round(Number(event.target.value)))
                }
              />
            </label>
            <button
              onClick={() =>
                setSourceIn(
                  secondsToFrame(
                    (selectedMedia?.kind === "audio"
                      ? sourceAudio.current
                      : sourceVideo.current
                    )?.currentTime ?? 0,
                    project.fps,
                  ),
                )
              }
            >
              Mark In
            </button>
            <label>
              Out{" "}
              <input
                type="number"
                min="1"
                value={sourceOut}
                onChange={(event) =>
                  setSourceOut(Math.round(Number(event.target.value)))
                }
              />
            </label>
            <button
              onClick={() =>
                setSourceOut(
                  secondsToFrame(
                    (selectedMedia?.kind === "audio"
                      ? sourceAudio.current
                      : sourceVideo.current
                    )?.currentTime ?? 0,
                    project.fps,
                  ),
                )
              }
            >
              Mark Out
            </button>
          </div>
          <div className="insert-controls">
            <span>{Math.max(0, sourceOut - sourceIn)} frames selected</span>
            <button onClick={() => add("append")} disabled={!selectedMedia}>
              <ArrowDownToLine size={15} /> Append
            </button>
            <button
              className="accent"
              onClick={() => add("insert")}
              disabled={!selectedMedia}
            >
              Insert at playhead
            </button>
          </div>
        </section>
        <section className="panel program-panel">
          <div className="panel-title">
            <div>
              <b>Program</b>
              <small>{project.name}</small>
            </div>
            <span className="timecode">
              {fmt(playhead, project.fps)} / {fmt(end, project.fps)}
            </span>
          </div>
          <div className="viewer program-view">
            {activeVideo && urls[activeVideo.mediaId] ? (
              activeVideoMedia?.kind === "image" ? (
                <img src={urls[activeVideo.mediaId]} alt="Timeline frame" />
              ) : (
                <video
                  ref={programVideo}
                  key={activeVideo.mediaId}
                  src={urls[activeVideo.mediaId]}
                  muted
                  playsInline
                  preload="auto"
                />
              )
            ) : (
              <div className="viewer-placeholder">
                <span>Program preview</span>
                <small>
                  {end ? "Black frame at this time" : "Build a sequence below"}
                </small>
              </div>
            )}
            <audio
              ref={programAudio}
              key={activeAudio?.mediaId ?? "empty"}
              src={activeAudio ? urls[activeAudio.mediaId] : undefined}
              preload="auto"
            />
          </div>
          <div className="transport">
            <button
              onClick={() => {
                setPlaying(false);
                setPlayhead(0);
              }}
              title="To start"
            >
              <SkipBack size={17} />
            </button>
            <button
              className="play"
              onClick={() => {
                if (playhead >= end) setPlayhead(0);
                setPlaying(!playing);
              }}
              disabled={!end}
              title={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause size={19} /> : <Play size={19} />}
            </button>
            <input
              aria-label="Playhead"
              type="range"
              min="0"
              max={Math.max(1, end)}
              value={playhead}
              onChange={(event) => {
                setPlaying(false);
                setPlayhead(Number(event.target.value));
              }}
            />
          </div>
        </section>
        <section className="panel timeline-panel">
          <div className="timeline-top">
            <div>
              <b>Timeline</b>
              <span>
                {project.tracks.reduce(
                  (count, track) => count + track.clips.length,
                  0,
                )}{" "}
                clips · {fmt(end, project.fps)}
              </span>
            </div>
            <div className="zoom">
              Zoom{" "}
              <input
                aria-label="Timeline zoom"
                type="range"
                min="1"
                max="8"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </div>
          </div>
          <div className="tools">
            {tools.map((item) => (
              <button
                key={item.id}
                title={item.hint}
                className={tool === item.id ? "chosen" : ""}
                onClick={() => setTool(item.id)}
              >
                {item.label}
              </button>
            ))}
            <span className="tool-help">
              {tools.find((item) => item.id === tool)?.hint}
            </span>
          </div>
          <div className="timeline-scroll">
            <div className="timeline-inner" style={{ width: timelineWidth }}>
              <div
                className="ruler"
                onClick={(event) =>
                  setPlayhead(
                    Math.max(
                      0,
                      Math.round(
                        (event.clientX -
                          event.currentTarget.getBoundingClientRect().left) /
                          zoom,
                      ),
                    ),
                  )
                }
              >
                {ticks.map((frame) => (
                  <span key={frame} style={{ left: frame * zoom }}>
                    {fmt(frame, project.fps)}
                  </span>
                ))}
              </div>
              {project.tracks.map((track) => (
                <div className="track" key={track.id}>
                  <div className="track-head">
                    <strong>{track.name}</strong>
                    <button
                      title={track.locked ? "Unlock" : "Lock"}
                      onClick={() =>
                        commit({
                          ...project,
                          tracks: project.tracks.map((item) =>
                            item.id === track.id
                              ? { ...item, locked: !item.locked }
                              : item,
                          ),
                        })
                      }
                    >
                      {track.locked ? (
                        <Lock size={13} />
                      ) : (
                        <LockOpen size={13} />
                      )}
                    </button>
                    <button
                      title={track.muted ? "Unmute" : "Mute"}
                      onClick={() =>
                        commit({
                          ...project,
                          tracks: project.tracks.map((item) =>
                            item.id === track.id
                              ? { ...item, muted: !item.muted }
                              : item,
                          ),
                        })
                      }
                    >
                      {track.muted ? (
                        <VolumeX size={13} />
                      ) : (
                        <Volume2 size={13} />
                      )}
                    </button>
                  </div>
                  <div
                    className="track-lane"
                    onClick={(event) => {
                      if (event.target === event.currentTarget)
                        setPlayhead(
                          Math.round(
                            (event.clientX -
                              event.currentTarget.getBoundingClientRect()
                                .left) /
                              zoom,
                          ),
                        );
                    }}
                  >
                    {[...track.clips]
                      .sort((a, b) => a.startFrame - b.startFrame)
                      .map((clip) => {
                        const asset = media.find(
                          (item) => item.id === clip.mediaId,
                        );
                        return (
                          <div
                            key={clip.id}
                            className={`timeline-clip ${track.kind} ${selectedClipId === clip.id ? "selected" : ""}`}
                            style={{
                              left: clip.startFrame * zoom,
                              width: clip.durationFrames * zoom,
                            }}
                            onPointerDown={(event) => {
                              const target = event.target as HTMLElement;
                              pointer.current = {
                                id: clip.id,
                                x: event.clientX,
                                edge: target.classList.contains("clip-grip")
                                  ? target.classList.contains("right")
                                    ? "out"
                                    : "in"
                                  : undefined,
                              };
                              event.currentTarget.setPointerCapture(
                                event.pointerId,
                              );
                              setSelectedClipId(clip.id);
                            }}
                            onPointerUp={(event) => {
                              const drag = pointer.current;
                              pointer.current = undefined;
                              if (!drag || drag.id !== clip.id) return;
                              const frames = Math.round(
                                (event.clientX - drag.x) / zoom,
                              );
                              if (frames) {
                                if (tool === "select")
                                  apply(
                                    moveClip(
                                      project,
                                      clip.id,
                                      clip.startFrame + frames,
                                    ),
                                  );
                                else
                                  apply(
                                    trimClip(
                                      project,
                                      media,
                                      clip.id,
                                      frames,
                                      tool,
                                      drag.edge ?? edge,
                                    ),
                                  );
                              }
                            }}
                          >
                            <span className="clip-grip" />{" "}
                            <span className="clip-label">
                              {asset?.name ?? "Missing source"}
                              <small>
                                {fmt(clip.durationFrames, project.fps)}
                              </small>
                            </span>
                            <span className="clip-grip right" />
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
              <div
                className="playhead-line"
                style={{ left: playhead * zoom }}
              />
            </div>
          </div>
          <div className="editbar">
            <span className="selection-title">
              {selectedClip
                ? `${media.find((item) => item.id === selectedClip.mediaId)?.name ?? "Clip"} · ${selectedTrack?.name}`
                : "Select a clip to edit"}
            </span>
            <label>
              Edge{" "}
              <select
                value={edge}
                onChange={(event) =>
                  setEdge(event.target.value as "in" | "out")
                }
              >
                <option value="out">Out</option>
                <option value="in">In</option>
              </select>
            </label>
            <label>
              Frames{" "}
              <input
                type="number"
                min="1"
                value={delta}
                onChange={(event) =>
                  setDelta(Math.max(1, Math.round(Number(event.target.value))))
                }
              />
            </label>
            <button onClick={() => editDelta(-delta)} disabled={!selectedClip}>
              − Apply
            </button>
            <button onClick={() => editDelta(delta)} disabled={!selectedClip}>
              + Apply
            </button>
            <button
              onClick={() =>
                selectedClipId &&
                apply(
                  splitClip(
                    project,
                    selectedClipId,
                    playhead,
                    crypto.randomUUID(),
                  ),
                )
              }
              disabled={!selectedClip}
            >
              <Scissors size={14} /> Split
            </button>
            <button
              onClick={() =>
                selectedClipId &&
                apply(removeClip(project, selectedClipId, false))
              }
              disabled={!selectedClip}
            >
              Delete
            </button>
            <button
              onClick={() =>
                selectedClipId &&
                apply(removeClip(project, selectedClipId, true))
              }
              disabled={!selectedClip}
            >
              Ripple delete
            </button>
          </div>
        </section>
      </main>
      <footer className="statusbar">
        <span>{status}</span>
        <span>
          FilmCraft concept by ArtCraft Team · independent TypeScript comparison
          build
        </span>
      </footer>
    </div>
  );
}

export default App;
