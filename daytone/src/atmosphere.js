const rules = [
  { key: "intense", label: "Restless", words: /дедлайн|срочн|напряж|офис|сдач|стресс|deadline|urgent|stress|office|rush/giu },
  { key: "joyful", label: "Bright", words: /радост|сме[хя]|танц|праздник|счаст|весел|солн|happy|laugh|dance|celebrat|joy|sunshine/giu },
  { key: "nostalgic", label: "Bittersweet", words: /скуча|груст|прощ|вспомин|дожд|прошл|тоск|miss|sad|rain|goodbye|remember/giu },
  { key: "tender", label: "Tender", words: /любим|обня|вместе|девуш|семь|мам|какао|love|hug|together|family|cocoa/giu },
  { key: "calm", label: "At ease", words: /тих|спокой|гуля|парк|прогул|медлен|пруд|peace|quiet|park|walk|slow|lake/giu },
];
const moods = { "At ease": "calm", Unhurried: "calm", Bright: "joyful", Bittersweet: "nostalgic", Restless: "intense", Tender: "tender" };
const techniques = {
  calm: "Impressionist light: spacious composition and gentle movement.",
  joyful: "Colour collage: vivid accents and a lively rhythm within the same diary grid.",
  nostalgic: "Film photography: muted colour and a soft grain texture.",
  intense: "Geometric abstraction: angular marks and a sharper rhythm.",
  tender: "Soft impressionist light: warm accents and unhurried transitions.",
};

export function inferMood(text, selected = "") {
  if (moods[selected]) return { key: moods[selected], label: selected, source: "Your chosen feeling" };
  const ranked = rules.map((rule) => ({ ...rule, score: [...String(text).matchAll(rule.words)].length }));
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0].score ? ranked[0] : rules.find((rule) => rule.key === "calm");
  return { key: best.key, label: best.label, source: ranked[0].score ? "Words in your story" : "Neutral, quiet treatment (no clear mood keywords)" };
}

export function suggestDayTitle(text) {
  const clean = String(text).trim();
  if (!clean) return "";
  const ru = /[а-яё]/i.test(clean);
  const contexts = ru ? [
    [/парк|листь|какао/i, "Прогулка", /какао/i.test(clean) ? "с тёплым какао" : "среди осенних листьев"],
    [/офис|дедлайн|сдач|проект/i, /ноч|поздн/i.test(clean) ? "Ночь" : "День", "перед сдачей проекта"],
    [/мор[еяю]|пляж/i, "День", "у морского берега"],
    [/дожд/i, "Дождь", "и тихие воспоминания"],
    [/семь|мам|дом|ужин/i, "Вечер", "с близкими дома"],
    [/танц|праздник/i, "Музыка", "и праздничные огни"],
  ] : [
    [/park|leaves|cocoa/i, "A walk", /cocoa/i.test(clean) ? "with warm cocoa" : "among autumn leaves"],
    [/office|deadline|project/i, "A night", "before the deadline"],
    [/sea|beach|ocean/i, "A day", "beside the sea"],
    [/rain/i, "Rain", "and quiet memories"],
    [/family|home|dinner/i, "An evening", "with loved ones"],
    [/dance|party/i, "Music", "and celebration lights"],
  ];
  const found = contexts.find(([pattern]) => pattern.test(clean));
  if (found) return `${found[1]} ${found[2]}`;
  const stop = ru ? /^(я|мы|и|а|но|в|на|с|это|был[аио]?|как|что|по|очень)$/i : /^(i|we|and|but|the|a|an|in|on|with|was|were|it|very)$/i;
  const words = clean.match(/[\p{L}\p{N}]+/gu) || [];
  const useful = words.filter((word) => !stop.test(word)).slice(0, 5);
  const result = useful.length ? useful : words.slice(0, 5);
  while (result.length < 3) result.push(ru ? (result.length === 1 ? "этого" : "дня") : (result.length === 1 ? "to" : "remember"));
  return result.join(" ").replace(/^./u, (letter) => letter.toUpperCase());
}

export async function samplePhotos(photos) {
  let r = 0, g = 0, b = 0, samples = 0;
  for (const photo of photos) {
    let bitmap, url;
    try {
      url = URL.createObjectURL(photo.blob);
      bitmap = new Image();
      bitmap.src = url;
      await bitmap.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, 24, 24);
      const data = context.getImageData(0, 0, 24, 24).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; samples++;
      }
    } catch {
      throw new Error(`Cannot read photograph “${photo.name || "image"}”. Convert it to JPG, PNG or WebP and try again.`);
    } finally { if (url) URL.revokeObjectURL(url); }
  }
  if (!samples) throw new Error("The photographs contain no visible pixels.");
  r /= samples * 255; g /= samples * 255; b /= samples * 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = !delta ? 35 : max === r ? ((g - b) / delta) * 60 : max === g ? ((b - r) / delta + 2) * 60 : ((r - g) / delta + 4) * 60;
  return { hue: Math.round((hue + 360) % 360), light: Math.round((max + min) * 50), count: photos.length };
}

export function composeAtmosphere(record, photo = { hue: 35, light: 55, count: 0 }) {
  const mood = inferMood(record.memory, record.mood);
  const description = String(record.musicDescription || "").toLowerCase();
  const energetic = /fast|energetic|electronic|rock|быстр|энерг|электрон|рок/i.test(description);
  const gentle = /slow|quiet|ambient|медлен|тих|эмбиент/i.test(description);
  const density = (record.beatMap?.length || 0) / Math.max(1, record.excerptDuration || 15);
  const energy = energetic ? "high" : gentle ? "low" : density > 1.5 ? "high" : density > 0.4 ? "medium" : "low";
  const described = energetic || gentle;
  const musicReason = described ? `Your music description sets a ${energy}-energy rhythm.`
    : record.sourceType === "local" ? `Detected audio events: ${(density).toFixed(1)} per second; ${energy}-energy rhythm. This is not a BPM or musical-key estimate.`
    : "No audio analysis is available for YouTube. Add a music description to influence the visual rhythm.";
  return {
    version: 1, key: mood.key, label: mood.label,
    hue: photo.hue, light: photo.light, motion: energy === "high" ? 3 : energy === "medium" ? 5 : 8,
    energy,
    explanation: `${mood.source}. ${techniques[mood.key]} ${photo.count} photo(s): average hue ${photo.hue}°, lightness ${photo.light}%. ${musicReason}`,
  };
}

export function applyAtmosphere(element, atmosphere) {
  if (!atmosphere) {
    delete element.dataset.atmosphere;
    ["--day-hue", "--day-light", "--day-motion"].forEach((key) => element.style.removeProperty(key));
    return;
  }
  element.dataset.atmosphere = atmosphere.key;
  element.dataset.energy = atmosphere.energy;
  element.style.setProperty("--day-hue", atmosphere.hue);
  element.style.setProperty("--day-light", atmosphere.light);
  element.style.setProperty("--day-motion", `${atmosphere.motion}s`);
}
