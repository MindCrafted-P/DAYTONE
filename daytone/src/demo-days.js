import { composeAtmosphere, samplePhotos, suggestDayTitle } from "./atmosphere.js";

const scenarios = [
  { id: "autumn", date: "2026-11-19", text: "Гуляли по парку среди жёлтых листьев. Пили тёплое какао и долго разговаривали у пруда. Было спокойно, хотелось запомнить этот вечер.", music: "Slow ambient / медленная тихая мелодия", colors: ["#bc8850", "#ebcf8d", "#6f7950"], notes: [261.63, 329.63, 392], tempo: 60 },
  { id: "deadline", date: "2026-11-20", text: "Срочная сдача проекта: ночь в офисе, яркие окна и электронная музыка. Мы спорили, собирали всё заново и всё-таки успели к дедлайну.", music: "Fast electronic / быстрая электронная музыка", colors: ["#344f70", "#90acbd", "#292d43"], notes: [146.83, 220, 293.66], tempo: 132 },
  { id: "celebration", date: "2026-11-21", text: "Праздник у друзей. Мы смеялись, танцевали и пели вместе. В окнах мерцали огни, и радость этого дня хотелось унести с собой.", music: "Energetic dance / энергичная танцевальная музыка", colors: ["#cb7965", "#f1bf6d", "#717d66"], notes: [329.63, 440, 523.25], tempo: 108 },
];

function soundtrack(notes, tempo) {
  const rate = 22050, seconds = 15;
  const buffer = new ArrayBuffer(44 + rate * seconds * 2), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, buffer.byteLength - 44, true);
  const beat = 60 / tempo;
  for (let i = 0; i < rate * seconds; i++) {
    const time = i / rate, phase = time % beat;
    const note = notes[Math.floor(time / beat) % notes.length];
    const envelope = Math.min(1, phase * 40) * Math.exp(-phase * 4) * Math.min(1, (seconds - time) * 3);
    const sample = Math.sin(2 * Math.PI * note * time) * envelope * 0.28;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function illustration(colors, variant, scene) {
  const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 680;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 900, 680);
  gradient.addColorStop(0, colors[1]); gradient.addColorStop(1, colors[0]);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 900, 680);
  if (scene === "deadline") {
    for (let x = 0; x < 9; x++) for (let y = 0; y < 6; y++) {
      ctx.fillStyle = (x + y + variant) % 3 ? colors[2] : colors[1];
      ctx.fillRect(x * 115 - 30, y * 125 + 80, 82, 93);
    }
  } else if (scene === "autumn") {
    ctx.fillStyle = colors[2]; ctx.fillRect(0, 440, 900, 240);
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = "#635344"; ctx.fillRect(75 + x * 130 - variant * 20, 170, 12, 360);
      ctx.beginPath(); ctx.fillStyle = x % 2 ? colors[0] : colors[1];
      ctx.ellipse(80 + x * 130 - variant * 20, 190, 90, 150, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#b5b3a1"; ctx.beginPath(); ctx.ellipse(580, 610, 330, 70, -.1, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = colors[2]; ctx.fillRect(0, 380, 900, 300);
    for (let i = 0; i < 30; i++) {
      ctx.beginPath(); ctx.fillStyle = i % 2 ? colors[1] : colors[0];
      ctx.arc((i * 137 + variant * 55) % 900, 50 + (i * 71) % 500, 8 + i % 18, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = "#fff7e9"; ctx.font = "18px sans-serif"; ctx.fillText("DAYTONE · DEMO ILLUSTRATION", 30, 645);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create demo image.")), "image/png"));
}

export async function makeDemoDays() {
  const records = [];
  for (const scenario of scenarios) {
    const photos = await Promise.all([0, 1, 2].map(async (index) => ({
      id: `${scenario.id}-${index}`, name: `Original demo illustration ${index + 1}`, type: "image/png",
      blob: await illustration(scenario.colors, index, scenario.id),
    })));
    const record = {
      id: `daytone-demo-${scenario.id}`, demo: true, date: scenario.date,
      title: suggestDayTitle(scenario.text), memory: scenario.text, mood: "",
      photos, coverPhotoId: photos[0].id, sourceType: "local",
      audioBlob: soundtrack(scenario.notes, scenario.tempo), audioDuration: 15,
      fileName: `daytone-original-${scenario.id}.wav`, trackTitle: `DAYTONE original · ${scenario.id}`, channel: "",
      sourceUrl: "", thumbnailUrl: "", startTime: 0, excerptDuration: 15,
      musicDescription: scenario.music,
      beatMap: Array.from({ length: Math.floor(15 * scenario.tempo / 60) }, (_, i) => i * 60 / scenario.tempo).filter((time) => time > 0),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    record.atmosphere = composeAtmosphere(record, await samplePhotos(photos));
    records.push(record);
  }
  return records;
}
