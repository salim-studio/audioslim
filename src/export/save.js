// Saving and exporting documents: Save (back to the file it came from), Save
// As, Save a Copy, Export File, Save Selection As and Download. Encoding
// always runs in the export worker behind a cancellable progress dialog.

import { exportAudio } from './export.js';
import { exportFileDialog } from './dialog.js';
import { withProgress } from './progress.js';
import { conformOptions, defaultOptions, docBitDepth, formatForName, getFormat } from './formats.js';
import { saveBlob, writeHandle } from '../storage/device-save.js';
import { downloadBlob } from '../storage/files.js';

/** Encodes frames [start, end) of a document with export options. */
export function encodeDoc(doc, options, { start = 0, end = doc.length, onProgress, signal } = {}) {
  return exportAudio({ channels: doc.state.channels, sampleRate: doc.sampleRate, start, end, markers: doc.state.markers, meta: doc.state.meta || {} }, options, { onProgress, signal });
}

/** Options for re-saving a document in `format`: what it was last saved with, else its own sample type. */
export function optionsForSave(doc, format) {
  const last = doc.info?.exportOptions;
  if (last && last.format === format) return conformOptions(format, last).options;
  const source = { sampleRate: doc.sampleRate, channels: doc.channelCount, bitDepth: docBitDepth(doc) };
  return defaultOptions(source, format);
}

function encodeWithProgress(doc, options, range, label) {
  return withProgress(label, (onProgress, signal) => encodeDoc(doc, options, { ...range, onProgress, signal }), { detail: label });
}

/** File > Save: in place when the document was written to a file on this
 * device in a writable format, else Save As. */
export async function saveDocument(app, doc, { saveAs = false, copy = false } = {}) {
  if (!doc) return false;
  const handle = doc.source?.type === 'device' ? doc.source.handle : null;
  const format = handle ? formatForName(doc.source.name) : null;
  if (!saveAs && !copy && handle && format && getFormat(format)) {
    const options = optionsForSave(doc, format);
    const state = doc.state;
    const blob = await encodeWithProgress(doc, options, {}, `Saving ${doc.name}`);
    if (!blob) return false;
    await withProgress(`Saving ${doc.name}`, () => writeHandle(handle, blob), { delay: 600, detail: 'Writing to this device' });
    // Only mark saved if nothing changed while encoding.
    if (doc.state === state) doc.markSaved();
    app.setStatus(`Saved ${doc.name}`);
    return true;
  }
  return saveFlow(app, doc, { mode: copy ? 'copy' : 'saveAs' });
}

/**
 * The dialog-driven flows. mode: 'saveAs' | 'copy' | 'export' | 'selection' | 'download'.
 * `range` = [start, end) for 'selection'.
 */
export async function saveFlow(app, doc, { mode = 'export', range = null } = {}) {
  const [start, end] = range || [0, doc.length];
  let initialName;
  for (;;) {
    const r = await exportFileDialog(app, doc, { mode, frames: end - start, initialName });
    if (!r) return false;
    const state = doc.state;
    const label = `${mode === 'export' || mode === 'download' ? 'Exporting' : 'Saving'} ${r.fileName}`;
    const blob = await encodeWithProgress(doc, r.options, { start, end }, label);
    if (!blob) {
      app.setStatus('Cancelled');
      return false;
    }
    let saved = null;
    if (r.location.type === 'device') {
      try {
        saved = await saveBlob(blob, r.fileName, { format: r.options.format, description: getFormat(r.options.format)?.label });
      } catch (err) {
        // The user dismissed the save picker.
        if (err?.name === 'AbortError') {
          app.setStatus('Cancelled');
          return false;
        }
        app.notify(err?.message || 'The file could not be saved.', { error: true });
        continue;
      }
      if (!saved) downloadBlob(blob, r.fileName);
    } else downloadBlob(blob, r.fileName);
    if (mode === 'saveAs') {
      doc.source = saved ? { type: 'device', handle: saved.handle, name: saved.name } : { type: 'download' };
      doc.info = { ...doc.info, format: r.options.format, exportOptions: r.options, size: blob.size };
      if (doc.name !== r.fileName) doc.rename(r.fileName);
      if (doc.state === state) doc.markSaved();
      else doc.emit('change', { kind: 'saved' });
    }
    app.setStatus(saved ? `Saved ${saved.name}` : `Downloaded ${r.fileName}`);
    app.emit('exported', { doc, fileName: r.fileName, options: r.options, mode });
    return true;
  }
}
