// A lightweight energy-rise detector, not a BPM estimator. Times in beatMap
// are seconds relative to the excerpt, not to the full track.
export async function findBestAudioMoment(file, seconds = 15) {
  const Decoder = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Decoder) throw new Error("Audio analysis is unavailable");
  const decoder = new Decoder(1, 1, 22050);
  const audio = await decoder.decodeAudioData(await file.arrayBuffer());
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const hop = Math.round(audio.sampleRate * 0.02);
  const step = hop / audio.sampleRate;
  const energy = [];
  for (let offset = 0; offset + hop <= audio.length; offset += hop) {
    let sum = 0;
    for (const channel of channels) {
      for (let i = offset; i < offset + hop; i += 4) sum += channel[i] ** 2;
    }
    energy.push(Math.sqrt(sum / (Math.ceil(hop / 4) * channels.length)));
  }
  const rise = energy.map((level, i) => Math.max(0, level - (energy[i - 2] ?? level)));
  const events = [];
  let baseline = 0;
  for (let i = 1; i < rise.length - 1; i++) {
    baseline = 0.96 * baseline + 0.04 * rise[i - 1];
    if (rise[i] < Math.max(0.012, baseline * 3) || rise[i] < rise[i - 1] || rise[i] <= rise[i + 1]) continue;
    const previous = events.at(-1);
    if (previous && (i - previous.index) * step < 0.22) {
      if (rise[i] > previous.strength) events.pop();
      else continue;
    }
    events.push({ index: i, strength: rise[i] });
  }

  const excerptDuration = Math.min(seconds, audio.duration);
  const length = Math.max(1, Math.round(excerptDuration / step));
  const prefix = [0];
  for (let i = 0, event = 0; i < energy.length; i++) {
    const strength = events[event]?.index === i ? events[event++].strength : 0;
    prefix.push(prefix.at(-1) + energy[i] + 4 * Math.min(0.3, strength));
  }
  let best = 0;
  let score = -Infinity;
  const last = Math.max(0, energy.length - length);
  for (let i = 0; i <= last; i++) {
    const candidate = prefix[Math.min(i + length, energy.length)] - prefix[i];
    if (candidate > score + 1e-6) {
      best = i;
      score = candidate;
    }
  }
  const startTime = Math.min(best * step, audio.duration - excerptDuration);
  const beatMap = events.map(({ index }) => index * step - startTime)
    .filter((time) => time >= 0.2 && time <= excerptDuration - 0.2);
  return { startTime, excerptDuration, beatMap: beatMap.length >= 2 ? beatMap : [] };
}

export function frameSchedule(count, duration, beatMap) {
  const evenly = Array.from({ length: Math.max(0, count - 1) }, (_, i) => (i + 1) * duration / count);
  const candidates = Array.isArray(beatMap)
    ? [...new Set(beatMap.filter((time) => Number.isFinite(time) && time > 0 && time < duration))].sort((a, b) => a - b)
    : [];
  if (!evenly.length || candidates.length < Math.max(2, evenly.length)) return { times: evenly, detected: false };
  // Choose an onset close to each evenly spaced target. Leave room for
  // the existing photo animation and avoid clustering around one beat.
  const radius = Math.min(duration / count * 0.38, 1.3);
  const times = evenly.map((target) => candidates.reduce((best, time) =>
    Math.abs(time - target) < Math.abs(best - target) ? time : best, Infinity));
  if (times.some((time, i) => Math.abs(time - evenly[i]) > radius
      || time - (times[i - 1] ?? 0) < 0.4 || duration - time < 0.4)) {
    return { times: evenly, detected: false };
  }
  return { times, detected: true };
}

function tagSize(bytes, offset, synchsafe) {
  return bytes.slice(offset, offset + 4).reduce((value, byte) => value * (synchsafe ? 128 : 256) + byte, 0);
}

function decodeTag(bytes) {
  const labels = ["windows-1252", "utf-16", "utf-16be", "utf-8"];
  const label = labels[bytes[0]];
  if (!label) return "";
  const text = bytes.subarray(1);
  return new TextDecoder(label === "utf-16" && text[0] === 0xfe && text[1] === 0xff ? "utf-16be" : label)
    .decode(text).replace(/\0.*$/s, "").trim();
}

export async function readId3(file) {
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  const latin = new TextDecoder("windows-1252");
  const result = { title: "", artist: "" };
  const version = header[3];
  // Common uncompressed ID3v2.2–2.4 tags. Skip formats that need
  // unsynchronization/decompression rather than returning garbled text.
  if (header.length === 10 && latin.decode(header.subarray(0, 3)) === "ID3"
      && version >= 2 && version <= 4 && !(header[5] & 0xc0)) {
    const bytes = new Uint8Array(await file.slice(10, 10 + Math.min(tagSize(header, 6, true), 1024 * 1024)).arrayBuffer());
    const frameHeader = version === 2 ? 6 : 10;
    for (let offset = 0; offset + frameHeader <= bytes.length;) {
      const id = latin.decode(bytes.subarray(offset, offset + (version === 2 ? 3 : 4)));
      const size = version === 2
        ? bytes[offset + 3] * 65536 + bytes[offset + 4] * 256 + bytes[offset + 5]
        : tagSize(bytes, offset + 4, version === 4);
      const start = offset + frameHeader;
      if (!size || start + size > bytes.length || !/^[A-Z0-9]+$/.test(id)) break;
      if (version === 2 || !bytes[offset + 9]) {
        if (id === "TIT2" || id === "TT2") result.title ||= decodeTag(bytes.subarray(start, start + size));
        if (id === "TPE1" || id === "TP1") result.artist ||= decodeTag(bytes.subarray(start, start + size));
      }
      if (result.title && result.artist) break;
      offset = start + size;
    }
  }
  if ((!result.title || !result.artist) && file.size >= 128) {
    const bytes = new Uint8Array(await file.slice(-128).arrayBuffer());
    if (latin.decode(bytes.subarray(0, 3)) === "TAG") {
      result.title ||= latin.decode(bytes.subarray(3, 33)).replace(/\0.*$/s, "").trim();
      result.artist ||= latin.decode(bytes.subarray(33, 63)).replace(/\0.*$/s, "").trim();
    }
  }
  return result;
}
