// Effects > Generate: Tones, Noise and Silence. Generated audio is inserted
// at the playhead or replaces the selection in the active file; with no audio
// file open, a new file is created. Tones and Noise dialogs reuse the effect
// parameter controls and preset storage (ids gen.tones / gen.noise). Each
// dialog can play what it would generate before it is inserted.

import { h, announce } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { Channel } from '../audio/channel.js';
import { AudioFile } from '../model/audio-file.js';
import * as E from '../model/edits.js';
import { paramControls, inlinePrompt } from './dialog.js';
import { normalizeValues } from './params.js';
import { allPresets, savePreset, matchPreset, lastValues, rememberValues } from './presets.js';
import { generateTones, generateNoise, dbToGain, WAVEFORMS, NOISE_COLORS, NOISE_STYLES } from './generate.js';
import { tonesBody, noiseBody } from './generate-views.js';
import { controlsFor } from './layout.js';
import { withProgress } from './progress.js';
import { isAbort } from './apply.js';
import { encodeWav } from '../audio/wav.js';

const audio = (app) => (app.active?.kind === 'audio' ? app.active : null);

const PLACEMENT = { id: 'placement', label: 'Placement', type: 'choice', options: [{ value: 'insert', label: 'Insert at Playhead' }, { value: 'replace', label: 'Replace Selection' }], default: 'replace' };

const COMPONENTS = [1, 2, 3, 4, 5];

export const TONES_DEF = {
  id: 'gen.tones',
  name: 'Generate Tones',
  dialogClass: 'gen-tones',
  body: (ctx) => tonesBody(ctx),
  params: [
    { id: 'sweep', label: 'Sweep Frequencies', type: 'bool', default: false },
    { id: 'base', label: 'Base Frequency', min: 1, max: 22000, step: 1, default: 440, unit: 'Hz', scale: 'log' },
    { id: 'modulateBy', label: 'Modulation Depth', min: 0, max: 20000, step: 1, default: 0, unit: 'Hz' },
    { id: 'modFreq', label: 'Modulation Rate', min: 0.1, max: 20000, step: 0.1, default: 1, unit: 'Hz', scale: 'log' },
    { id: 'endBase', label: 'Base Frequency', min: 1, max: 22000, step: 1, default: 880, unit: 'Hz', scale: 'log', section: 'Sweep End' },
    { id: 'endModulateBy', label: 'Modulation Depth', min: 0, max: 20000, step: 1, default: 0, unit: 'Hz', section: 'Sweep End' },
    { id: 'endModFreq', label: 'Modulation Rate', min: 0.1, max: 20000, step: 0.1, default: 1, unit: 'Hz', scale: 'log', section: 'Sweep End' },
    { id: 'sweepCurve', label: 'Sweep Curve', type: 'choice', options: [{ value: 'log', label: 'Logarithmic' }, { value: 'linear', label: 'Linear' }], default: 'log', section: 'Sweep End' },
    { id: 'waveform', label: 'Shape', type: 'choice', options: WAVEFORMS, default: 'sine', section: 'Waveform' },
    { id: 'symmetry', label: 'Symmetry', min: 1, max: 99, step: 1, default: 50, unit: '%', section: 'Waveform' },
    ...COMPONENTS.flatMap((k) => [
      { id: `on${k}`, label: `Component ${k}`, type: 'bool', default: k === 1, section: 'Frequency Components' },
      { id: `amp${k}`, label: `Component ${k} Amplitude`, min: -120, max: 0, step: 0.1, default: k === 1 ? 0 : Math.round(-20 * Math.log10(k) * 10) / 10, unit: 'dB', section: 'Frequency Components' },
      { id: `mul${k}`, label: `Component ${k} Multiplier`, min: 0.01, max: 64, step: 0.01, default: k, unit: '', section: 'Frequency Components' },
    ]),
    { id: 'volume', label: 'Volume', min: -120, max: 0, step: 0.1, default: -6, unit: 'dB', section: 'Output' },
    { id: 'duration', label: 'Duration', min: 0.01, max: 3600, step: 0.01, default: 5, unit: 's', scale: 'log', section: 'Output' },
    { id: 'startPhase', label: 'Start Phase', min: 0, max: 360, step: 1, default: 0, unit: 'deg', section: 'Advanced' },
    { id: 'phaseOffset', label: 'Right Channel Phase Offset', min: -180, max: 180, step: 1, default: 0, unit: 'deg', section: 'Advanced' },
  ],
  presets: [
    { name: 'Default', values: {} },
    { name: '1 kHz Reference at -18 dB', values: { base: 1000, volume: -18, duration: 10 } },
    { name: 'Rich Organ Tone', values: { base: 220, on2: true, on3: true, on4: true, on5: true, volume: -6, duration: 4 } },
    { name: 'Siren', values: { base: 800, modulateBy: 300, modFreq: 0.5, waveform: 'triangle', volume: -9, duration: 6 } },
    { name: 'Low Buzz', values: { base: 60, waveform: 'sawtooth', volume: -12, duration: 3 } },
    { name: 'Full Range Sweep', values: { sweep: true, base: 20, endBase: 20000, sweepCurve: 'log', volume: -12, duration: 20 } },
    { name: 'Narrow Pulse Train', values: { base: 100, waveform: 'square', symmetry: 10, volume: -12, duration: 3 } },
    { name: 'Stereo Phase Test (Quadrature)', values: { base: 1000, phaseOffset: 90, volume: -12, duration: 5 } },
    { name: 'Bell Partials', values: { base: 300, on2: true, amp2: -6, mul2: 2.76, on3: true, amp3: -10, mul3: 5.4, on4: true, amp4: -14, mul4: 8.93, volume: -9, duration: 3 } },
  ],
};

/** Tone generator options from Generate Tones values. */
export function toneOptions(v, rate, frames) {
  return {
    rate,
    frames,
    base: v.base,
    components: COMPONENTS.map((k) => (v[`on${k}`] ? dbToGain(v[`amp${k}`]) : 0)),
    multipliers: COMPONENTS.map((k) => v[`mul${k}`]),
    waveform: v.waveform,
    symmetry: v.symmetry / 100,
    modulateBy: v.modulateBy,
    modFreq: v.modFreq,
    sweep: v.sweep ? { base: v.endBase, modulateBy: v.endModulateBy, modFreq: v.endModFreq, curve: v.sweepCurve } : null,
    volumeDb: v.volume,
    startPhase: v.startPhase,
  };
}

/** Generate Tones audio: one channel, or two when the right channel is phase shifted. */
export function renderTones(v, rate, channels) {
  const o = toneOptions(v, rate, Math.round(v.duration * rate));
  const left = generateTones(o);
  if (channels < 2 || !v.phaseOffset) return [left];
  return [left, generateTones({ ...o, startPhase: v.startPhase + v.phaseOffset })];
}

export const NOISE_DEF = {
  id: 'gen.noise',
  name: 'Generate Noise',
  dialogClass: 'gen-noise',
  body: (ctx) => noiseBody(ctx),
  params: [
    { id: 'color', label: 'Color', type: 'choice', options: NOISE_COLORS, default: 'white' },
    { id: 'style', label: 'Style', type: 'choice', options: NOISE_STYLES, default: 'independent' },
    { id: 'delay', label: 'Delay', min: 0, max: 5000, step: 1, default: 500, unit: '\u00b5s' },
    { id: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { id: 'dcOffset', label: 'DC Offset', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { id: 'volume', label: 'Volume', min: -96, max: 0, step: 0.1, default: -12, unit: 'dB', section: 'Output' },
    { id: 'duration', label: 'Duration', min: 0.01, max: 3600, step: 0.01, default: 5, unit: 's', scale: 'log', section: 'Output' },
  ],
  presets: [
    { name: 'Default', values: {} },
    { name: 'Soft Pink Bed', values: { color: 'pink', volume: -30, duration: 30 } },
    { name: 'Brown Rumble', values: { color: 'brown', volume: -18, duration: 10 } },
    { name: 'Grey Masking Noise', values: { color: 'grey', volume: -24, duration: 30 } },
    { name: 'Wide Spatial Pink', values: { color: 'pink', style: 'spatial', delay: 700, volume: -18, duration: 10 } },
    { name: 'Mono Test Noise', values: { color: 'white', style: 'mono', volume: -20, duration: 10 } },
  ],
};

/** Generate Noise audio for `channels` channels. */
export function renderNoise(v, rate, channels, seed) {
  return generateNoise({ frames: Math.round(v.duration * rate), channels, rate, color: v.color, intensity: v.intensity / 100, volumeDb: v.volume, style: v.style, delayUs: v.delay, dcOffset: v.dcOffset / 100, seed });
}

export const SILENCE_DEF = {
  id: 'gen.silence',
  name: 'Generate Silence',
  params: [{ id: 'duration', label: 'Duration', min: 0.001, max: 3600, step: 0.001, default: 1, unit: 's', scale: 'log' }],
  presets: [],
};

/** Puts generated per-channel samples into the active file, or a new file when none is open. */
export function placeGenerated(app, outs, rate, { label, name, placement = 'replace' }) {
  const doc = audio(app);
  const n = outs[0]?.length || 0;
  if (!n) return null;
  if (!doc) {
    const count = app.prefs.get('defaultChannels') === 1 ? 1 : 2;
    const channels = Array.from({ length: count }, (_, i) => Channel.fromSamples(i < outs.length ? outs[i] : outs[0].slice()));
    const created = new AudioFile({ name: app.uniqueName(name), sampleRate: rate, channels });
    app.addDocument(created);
    created.setSelection(0, n);
    announce(`${label}: new file created`);
    return created;
  }
  const clip = { channels: E.conformChannels({ channels: outs.map((o) => Channel.fromSamples(o)) }, doc.channelCount) };
  const replace = placement === 'replace' && doc.hasSelection;
  const at = replace ? doc.selection.start : doc.cursor;
  const state = replace ? E.replaceRange(doc.state, doc.selection.start, doc.selection.end, clip, doc.channelMask) : E.insertClip(doc.state, at, clip, doc.channelMask);
  doc.apply(label, state, { selection: { start: at, end: at + n }, cursor: at });
  announce(`${label} inserted`);
  return doc;
}

/**
 * Values and change notification for a generator dialog, shaped like the
 * effect dialog ctx so the layout helpers (layout.js) work in both.
 */
export function generatorContext(def, initial) {
  let values = normalizeValues(def, initial);
  const subscribers = new Set();
  const ctx = {
    def,
    get values() {
      return values;
    },
    set(id, v) {
      const next = normalizeValues(def, { ...values, [id]: v });
      if (JSON.stringify(next) === JSON.stringify(values)) return;
      values = next;
      subscribers.forEach((fn) => fn(values));
    },
    setAll(next) {
      values = normalizeValues(def, next);
      subscribers.forEach((fn) => fn(values));
    },
    subscribe: (fn) => subscribers.add(fn),
  };
  return ctx;
}

/** Longest stretch a generator preview renders (s); longer durations preview their start. */
export const PREVIEW_SECONDS = 20;

/**
 * Play/stop and loop buttons that preview generated audio in a dialog.
 * render() returns (or resolves) { outs: Float32Array[], rate } or null.
 * While playing, refresh() renders again and carries on from the same spot,
 * so changes are heard as they are made. Returns { el, play, stop, refresh,
 * dispose, playing() }.
 */
export function previewPlayer(app, render, { label = 'Preview' } = {}) {
  const audio = typeof Audio !== 'undefined' ? new Audio() : null;
  let url = null;
  let on = false;
  let token = 0;
  let timer = 0;
  const status = h('span.gen-preview-status.faint', { 'aria-live': 'polite' });
  const playBtn = h('button.icon-btn.fx-play', { type: 'button', 'aria-label': label, title: 'Play what will be generated', onclick: () => (on ? stop() : play()) }, icon('transport-play', 15));
  const loopOn = () => app.prefs?.get?.('genPreviewLoop') === true;
  const loopBtn = h('button.icon-btn.fx-loop', { type: 'button', 'aria-pressed': String(loopOn()), 'aria-label': 'Loop preview', title: 'Loop the preview', onclick: () => {
    const next = loopBtn.getAttribute('aria-pressed') !== 'true';
    loopBtn.setAttribute('aria-pressed', String(next));
    app.prefs?.set?.('genPreviewLoop', next);
    if (audio) audio.loop = next;
  } }, icon('transport-loop', 15));
  const show = (playing) => {
    on = playing;
    playBtn.replaceChildren(icon(playing ? 'transport-stop' : 'transport-play', 15));
    playBtn.setAttribute('aria-label', playing ? 'Stop preview' : label);
    playBtn.classList.toggle('on', playing);
  };
  audio?.addEventListener('ended', () => {
    if (!audio.loop) show(false);
  });
  async function play(at = 0) {
    if (!audio) return;
    const mine = ++token;
    show(true);
    status.textContent = '';
    let r;
    try {
      r = await render();
    } catch (err) {
      if (mine === token) {
        show(false);
        status.textContent = err?.message || 'The preview could not be made.';
      }
      return;
    }
    if (mine !== token || !on) return;
    if (!r?.outs?.length || !r.outs[0].length) {
      show(false);
      return;
    }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(encodeWav({ sampleRate: r.rate, channels: r.outs.slice(0, 2), bitDepth: 32 }));
    audio.src = url;
    audio.loop = loopOn();
    try {
      audio.currentTime = Math.min(at, r.outs[0].length / r.rate);
    } catch {
      // Not seekable yet: start from the top.
    }
    try {
      await audio.play();
    } catch (err) {
      if (mine === token && err?.name !== 'AbortError') {
        show(false);
        status.textContent = 'Playback was blocked by the browser.';
      }
    }
  }
  function stop() {
    token++;
    clearTimeout(timer);
    audio?.pause();
    show(false);
  }
  function refresh() {
    if (!on) return;
    clearTimeout(timer);
    timer = setTimeout(() => play(audio?.currentTime || 0), 150);
  }
  function dispose() {
    stop();
    if (url) URL.revokeObjectURL(url);
    url = null;
  }
  const el = h('div.fx-footer-tools.gen-preview', playBtn, loopBtn, status);
  return { el, play, stop, refresh, dispose, playing: () => on, audio };
}

/** Dialog for a generator pseudo-definition with presets; resolves values or null. */
async function generatorDialog(app, def, { withPlacement, preview = null }) {
  const fullDef = withPlacement ? { ...def, params: [...def.params, { ...PLACEMENT, section: 'Output' }] } : def;
  const ctx = generatorContext(fullDef, lastValues(app.prefs, fullDef));
  ctx.app = app;
  ctx.rate = rateFor(app);
  ctx.channels = channelsFor(app);
  ctx.withPlacement = withPlacement;
  const presetSel = h('select.select.fx-preset-select', { 'aria-label': 'Presets' });
  const syncPresets = () => {
    const list = allPresets(app.prefs, def);
    const cur = matchPreset(app.prefs, def, ctx.values);
    presetSel.replaceChildren(...(cur ? [] : [h('option', { value: '' }, '(Custom)')]), ...list.map((p) => h('option', { value: p.name }, p.name)));
    presetSel.value = cur;
  };
  presetSel.addEventListener('change', () => {
    const p = allPresets(app.prefs, def).find((x) => x.name === presetSel.value);
    if (p) ctx.setAll({ ...normalizeValues(def, p.values), placement: ctx.values.placement });
  });
  let content;
  if (def.body) content = def.body(ctx);
  else {
    const controls = paramControls(fullDef, () => ctx.values, (id, v) => ctx.set(id, v));
    ctx.subscribe((v) => controls.refresh(v));
    content = controls.el;
  }
  ctx.subscribe(syncPresets);
  const nameRow = h('div.fx-namebar', { hidden: true });
  let dismiss = null;
  const saveBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Save settings as a preset', title: 'Save settings as a preset', onclick: () => {
    dismiss = inlinePrompt(nameRow, { label: 'Preset name:', value: 'My Preset', returnFocus: saveBtn, onSave: (n) => {
      savePreset(app.prefs, def, n, ctx.values);
      syncPresets();
    } });
  } }, icon('save', 15));
  syncPresets();
  const player = preview ? previewPlayer(app, () => preview(ctx.values)) : null;
  if (player) ctx.subscribe(() => player.refresh());
  const r = await openDialog({
    title: def.name,
    className: `fx-dialog${def.dialogClass ? `.${def.dialogClass}` : ''}`,
    body: h('div.fx-dialog-body', def.presets.length ? h('div.fx-presetbar', h('label.fx-label', 'Presets:'), presetSel, saveBtn) : null, nameRow, content),
    footerStart: player?.el,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'OK', value: 'ok', primary: true },
    ],
    initialFocus: '.fx-params .hot, .fx-params select, .fx-params input',
  });
  player?.dispose();
  dismiss?.();
  if (r !== 'ok') return null;
  rememberValues(app.prefs, fullDef, ctx.values);
  return ctx.values;
}

async function runGenerator(app, label, name, make, placement) {
  try {
    const { outs, rate } = await withProgress(app, label, async (signal) => {
      await new Promise((res) => setTimeout(res, 0));
      if (signal.aborted) return { outs: [], rate: 0 };
      return make();
    });
    return placeGenerated(app, outs, rate, { label, name, placement });
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

const rateFor = (app) => audio(app)?.sampleRate || app.prefs.get('defaultRate') || 48000;
const channelsFor = (app) => audio(app)?.channelCount || (app.prefs.get('defaultChannels') === 1 ? 1 : 2);

/** The start of the generated audio (at most PREVIEW_SECONDS), for the dialog preview. */
const previewOf = (v) => ({ ...v, duration: Math.min(v.duration, PREVIEW_SECONDS) });

export async function generateTonesCommand(app) {
  const rate0 = rateFor(app);
  const v = await generatorDialog(app, TONES_DEF, { withPlacement: Boolean(audio(app)?.hasSelection), preview: (vals) => ({ outs: renderTones(previewOf(vals), rate0, channelsFor(app)), rate: rate0 }) });
  if (!v) return null;
  const rate = rateFor(app);
  return runGenerator(app, 'Generate Tones', 'Tones', () => {
    return { outs: renderTones(v, rate, channelsFor(app)), rate };
  }, v.placement);
}

export async function generateNoiseCommand(app) {
  const seed = (Date.now() & 0x7fffffff) | 1;
  const rate0 = rateFor(app);
  const v = await generatorDialog(app, NOISE_DEF, { withPlacement: Boolean(audio(app)?.hasSelection), preview: (vals) => ({ outs: renderNoise(previewOf(vals), rate0, channelsFor(app), seed), rate: rate0 }) });
  if (!v) return null;
  const rate = rateFor(app);
  return runGenerator(app, 'Generate Noise', 'Noise', () => ({ outs: renderNoise(v, rate, channelsFor(app), seed), rate }), v.placement);
}

export async function generateSilenceCommand(app) {
  const v = await generatorDialog(app, SILENCE_DEF, { withPlacement: false });
  if (!v) return null;
  const rate = rateFor(app);
  return placeGenerated(app, [new Float32Array(Math.round(v.duration * rate))], rate, { label: 'Generate Silence', name: 'Silence', placement: 'insert' });
}

export function installGenerators(app) {
  app.commands.register([
    { id: 'gen.tones', label: 'Tones...', run: () => generateTonesCommand(app) },
    { id: 'gen.noise', label: 'Noise...', run: () => generateNoiseCommand(app) },
    { id: 'gen.silence', label: 'Silence...', run: () => generateSilenceCommand(app) },
  ]);
}
