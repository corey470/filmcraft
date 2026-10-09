import type { MediaAsset, Project } from "./model";

const database = "filmcraft-ts-comparison";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("workspace"))
        db.createObjectStore("workspace");
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open browser storage."));
    request.onblocked = () =>
      reject(new Error("Close other FilmCraft TS tabs and reload."));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Browser storage failed."));
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Browser storage was interrupted."),
      );
  });
}

function read<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not read browser storage."));
  });
}

export async function loadWorkspace(): Promise<{
  project?: Project;
  media: MediaAsset[];
  urls: Record<string, string>;
}> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(["workspace", "files"], "readonly");
    const done = complete(transaction);
    const saved = await read<{ project: Project; media: MediaAsset[] }>(
      transaction.objectStore("workspace"),
      "current",
    );
    const media = saved?.media ?? [];
    const urls: Record<string, string> = {};
    await Promise.all(
      media.map(async (item) => {
        const blob = await read<Blob>(
          transaction.objectStore("files"),
          item.id,
        );
        if (blob) urls[item.id] = URL.createObjectURL(blob);
      }),
    );
    await done;
    return { project: saved?.project, media, urls };
  } finally {
    db.close();
  }
}

export async function saveWorkspace(
  project: Project,
  media: MediaAsset[],
): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction("workspace", "readwrite");
    transaction.objectStore("workspace").put({ project, media }, "current");
    await complete(transaction);
  } finally {
    db.close();
  }
}

export async function saveMedia(id: string, file: File): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction("files", "readwrite");
    transaction.objectStore("files").put(file, id);
    await complete(transaction);
  } finally {
    db.close();
  }
}

export async function inspectFile(
  file: File,
): Promise<{ asset: MediaAsset; url: string }> {
  const kind = file.type.startsWith("video/")
    ? "video"
    : file.type.startsWith("audio/")
      ? "audio"
      : file.type.startsWith("image/")
        ? "image"
        : null;
  if (!kind)
    throw new Error(`${file.name}: choose a video, audio, or image file.`);
  const url = URL.createObjectURL(file);
  try {
    let duration = 5;
    let width: number | undefined;
    let height: number | undefined;
    if (kind === "image") {
      const image = new Image();
      image.src = url;
      await image.decode();
      width = image.naturalWidth;
      height = image.naturalHeight;
    } else {
      const element = document.createElement(kind);
      element.preload = "metadata";
      element.src = url;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error(`${file.name}: media metadata timed out.`)),
          15000,
        );
        element.onloadedmetadata = () => {
          window.clearTimeout(timer);
          resolve();
        };
        element.onerror = () => {
          window.clearTimeout(timer);
          reject(
            new Error(`${file.name}: the browser could not read this file.`),
          );
        };
      });
      duration = element.duration;
      if (kind === "video") {
        width = (element as HTMLVideoElement).videoWidth;
        height = (element as HTMLVideoElement).videoHeight;
      }
      element.removeAttribute("src");
      element.load();
    }
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error(`${file.name}: source duration is unavailable.`);
    return {
      asset: {
        id: crypto.randomUUID(),
        name: file.name,
        kind,
        duration,
        width,
        height,
        mimeType: file.type,
        bytes: file.size,
      },
      url,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
