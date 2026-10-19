// Writing files back to this device. Uses the File System Access API's save
// picker where the browser has it, and falls back to a plain download
// everywhere else. A file written through the picker keeps its handle, so
// "Save" can write the same file again without asking.

/** Whether this browser can write files through a picker. */
export function supported() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

/** Whether this browser can pick a folder to write into. */
export function canPickFolder() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// The folder chosen for this session. Handles cannot be serialised, so this
// lives in memory and is lost on reload.
let folderHandle = null;

export function currentFolder() {
  return folderHandle;
}

/** The folder's name, for display. */
export function currentFolderName() {
  return folderHandle?.name || null;
}

/** Asks the user for a folder to write into. Resolves its name, or null. */
export async function chooseFolder() {
  if (!canPickFolder()) return null;
  const handle = await window.showDirectoryPicker({ id: 'audioslim-export', mode: 'readwrite' });
  folderHandle = handle;
  return handle.name;
}

/** Forgets the chosen folder. */
export function clearFolder() {
  folderHandle = null;
}

/** The file types offered by the save picker for a format id. */
export function pickerTypes(formatId) {
  const map = {
    wav: [{ description: 'Wave PCM', accept: { 'audio/wav': ['.wav'] } }],
    aiff: [{ description: 'AIFF', accept: { 'audio/aiff': ['.aif', '.aiff'] } }],
    flac: [{ description: 'FLAC', accept: { 'audio/flac': ['.flac'] } }],
    mp3: [{ description: 'MP3', accept: { 'audio/mpeg': ['.mp3'] } }],
    opus: [{ description: 'Opus', accept: { 'audio/ogg': ['.opus'] } }],
    m4a: [{ description: 'M4A', accept: { 'audio/mp4': ['.m4a'] } }],
    zip: [{ description: 'Session archive', accept: { 'application/zip': ['.zip'] } }],
  };
  return map[formatId] || [];
}

/** Writes a blob into a file handle, replacing its contents. */
export async function writeHandle(handle, blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Whether a name is free in the folder chosen for this session. */
export async function folderHas(name) {
  if (!folderHandle) return false;
  try {
    await folderHandle.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a blob into the folder chosen for this session. Resolves the final
 * name, or null when no folder is chosen.
 */
export async function writeInFolder(name, blob) {
  if (!folderHandle) return null;
  const handle = await folderHandle.getFileHandle(name, { create: true });
  await writeHandle(handle, blob);
  return handle.name;
}

/**
 * Writes a blob to this device. Uses the folder chosen for this session, else
 * the save picker, else nothing (the caller downloads instead).
 * Resolves { name, handle } or null when the browser has no save picker.
 * Throws AbortError when the user dismisses the picker.
 */
export async function saveBlob(blob, suggestedName, { format, description } = {}) {
  if (folderHandle) {
    const handle = await folderHandle.getFileHandle(suggestedName, { create: true });
    await writeHandle(handle, blob);
    return { name: handle.name, handle };
  }
  if (!supported()) return null;
  const handle = await window.showSaveFilePicker({
    suggestedName,
    description: description || 'Audio file',
    types: pickerTypes(format),
  });
  await writeHandle(handle, blob);
  return { name: handle.name, handle };
}
