function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read this day's media for export."));
    reader.readAsDataURL(blob);
  });
}

export async function portableDay(record) {
  const images = await Promise.all(record.photos.map(async (photo) =>
    `<img src="${await dataUrl(photo.blob)}" alt="${escapeHtml(photo.name)}">`));
  const atmosphere = record.atmosphere;
  const hue = Number(atmosphere?.hue) || 35;
  const safeYoutube = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(record.sourceUrl || "");
  const soundtrack = record.sourceType === "local" && record.audioBlob instanceof Blob
    ? `<audio id="song" controls src="${await dataUrl(record.audioBlob)}"></audio>`
    : safeYoutube ? `<a href="${escapeHtml(record.sourceUrl)}&amp;t=${Math.max(0, Number(record.startTime) || 0)}s" target="_blank" rel="noopener noreferrer">Open soundtrack on YouTube</a>` : "<p>Soundtrack unavailable.</p>";
  const start = Math.max(0, Number(record.startTime) || 0);
  const duration = Math.max(1, Number(record.excerptDuration) || 15);
  return `<!doctype html><html lang="${/[а-яё]/i.test(record.memory) ? "ru" : "en"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(record.title)} · DAYTONE</title>
<style>body{margin:0;background:hsl(${hue} 24% 92%);color:#282c25;font:18px/1.6 Georgia,serif}main{max-width:900px;margin:auto;padding:32px}h1{font-size:clamp(32px,6vw,64px);line-height:1.1}img{width:100%;height:55vh;object-fit:contain;display:none;background:#242820}img.active{display:block}p{white-space:pre-wrap;overflow-wrap:anywhere}audio{width:100%}button,a{font:inherit;color:inherit}button{padding:10px;margin:8px 4px;border:1px solid #777;background:transparent;cursor:pointer}small{display:block}details{font-size:14px;margin-top:24px}</style>
<main><small>DAYTONE · ${escapeHtml(record.date)} · ${escapeHtml(atmosphere?.label || record.mood)}</small><h1>${escapeHtml(record.title)}</h1>
<section id="frames">${images.join("")}</section><button id="previous">Previous frame</button><button id="next">Next frame</button><p>${escapeHtml(record.memory)}</p>
<strong>${escapeHtml(record.trackTitle)}</strong>${soundtrack}<small>Excerpt ${start.toFixed(1)}–${(start + duration).toFixed(1)} seconds</small>
<details><summary>Why this day looks this way</summary><p>${escapeHtml(atmosphere?.explanation || "Original diary styling")}</p></details>
<small>This portable copy contains your original media. Share only materials you have permission to share. YouTube requires internet access.</small></main>
<script>const frames=[...document.querySelectorAll('#frames img')];let position=0;function show(i){position=(i+frames.length)%frames.length;frames.forEach((frame,n)=>frame.classList.toggle('active',n===position));}if(frames.length)show(0);document.querySelector('#previous').onclick=()=>show(position-1);document.querySelector('#next').onclick=()=>show(position+1);const song=document.querySelector('#song');if(song){song.addEventListener('loadedmetadata',()=>song.currentTime=${start});song.addEventListener('play',()=>{if(song.currentTime<${start}||song.currentTime>=${start + duration})song.currentTime=${start};});song.addEventListener('timeupdate',()=>{if(song.currentTime>=${start + duration})song.pause();if(frames.length)show(Math.min(frames.length-1,Math.floor(Math.max(0,song.currentTime-${start})/${duration}*frames.length)));});}</script></html>`;
}

// Uncompressed ZIP: no dependency, no external service, UTF-8 filenames.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function zip(files) {
  const parts = [], directory = [];
  let offset = 0, directorySize = 0;
  for (const [name, blob] of files) {
    const filename = new TextEncoder().encode(name);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + filename.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
    view.setUint16(26, filename.length, true); header.set(filename, 30);
    const central = new Uint8Array(46 + filename.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true); central.set(filename, 46);
    parts.push(header, bytes); directory.push(central);
    offset += header.length + bytes.length; directorySize += central.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}

export async function exportDay(record) {
  const folder = `${record.date} ${record.title}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").slice(0, 110);
  const files = [
    [`${folder}/memory.html`, new Blob([await portableDay(record)], { type: "text/html" })],
    [`${folder}/story.txt`, new Blob([record.memory], { type: "text/plain" })],
    [`${folder}/day.json`, new Blob([JSON.stringify({ ...record, audioBlob: undefined, photos: record.photos.map(({ blob, ...photo }) => photo) }, null, 2)], { type: "application/json" })],
  ];
  record.photos.forEach((photo, i) => {
    const extension = ({ "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" })[photo.blob.type] || "jpg";
    files.push([`${folder}/photos/${i + 1}.${extension}`, photo.blob]);
  });
  if (record.audioBlob instanceof Blob) files.push([`${folder}/soundtrack.${/wav|wave/.test(record.audioBlob.type) ? "wav" : "mp3"}`, record.audioBlob]);
  else files.push([`${folder}/soundtrack.txt`, new Blob([record.sourceUrl || ""])]);
  const blob = await zip(files);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `${folder}.zip`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
