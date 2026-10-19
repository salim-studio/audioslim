// Saving and loading a session's video file. A session carries its video in
// the archive it is saved as; a video that cannot be found opens offline: the
// clip keeps its place and shows a placeholder strip.

import { addVideoSource, videoPool } from '../model/session-video.js';
import { videoInfo } from './media.js';

const bytesCache = new WeakMap(); // Blob -> Uint8Array, read ahead for synchronous ZIP writing

/** Reads the session's video into memory so sessionZip() can store it. */
export async function prepareVideoBytes(session) {
  for (const src of videoPool(session).values()) {
    if (src.blob && !bytesCache.has(src.blob) && session.state.video?.sourceId === src.id) bytesCache.set(src.blob, new Uint8Array(await src.blob.arrayBuffer()));
  }
}

/** ZIP entry for the video returned by serializeSession({ embedVideo: true }), or null when not read ahead. */
export function videoZipEntry(video) {
  const data = video?.blob && bytesCache.get(video.blob);
  if (!data) return null;
  bytesCache.delete(video.blob);
  return { name: video.file, data };
}

/**
 * Adds the video of a parsed session ("video" entry) to its video pool,
 * reading it through `loadMedia(entry, fileName)` like the session's audio.
 * Returns true when found, false when it is offline.
 */
export async function loadSessionVideo(session, entry, { source, loadMedia }) {
  let blob = null;
  try {
    if (entry.file) blob = await loadMedia(entry, entry.file.split('/').pop());
  } catch {
    blob = null;
  }
  let info = null;
  if (blob) {
    // Files read back may carry no type (or the wrong one, from a ZIP).
    const typed = blob.type !== (entry.mime || '') ? new Blob([blob], { type: entry.mime || '' }) : blob;
    info = await videoInfo(typed, entry.name, { path: null, fallbackDuration: entry.duration || 0 }).catch(() => null);
  }
  const meta = { id: entry.id, name: entry.name || 'Video', mime: entry.mime || '', width: entry.width || 0, height: entry.height || 0, duration: entry.duration || 0, fps: entry.fps || 0, path: null };
  if (!info) {
    addVideoSource(session, { ...meta, blob: null, offline: true });
    return false;
  }
  addVideoSource(session, { ...meta, ...info, id: entry.id, name: meta.name, fps: info.fps || meta.fps, path: null });
  return true;
}
