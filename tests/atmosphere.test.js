const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");

async function atmosphereModule() {
  const source = await readFile("daytone/src/atmosphere.js", "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("generated names are short and meaningful in Russian and English", async () => {
  const { suggestDayTitle } = await atmosphereModule();
  for (const text of ["Гуляли по парку и пили какао", "Ночь в офисе перед сдачей", "A walk in the park with cocoa", "Счастье", "Я", "We went somewhere new"]) {
    const title = suggestDayTitle(text);
    assert.ok(title.split(/\s+/).length >= 3 && title.split(/\s+/).length <= 7, title);
  }
  assert.match(suggestDayTitle("Гуляли по парку и пили какао"), /какао/);
});

test("story, chosen mood, photo colour and music influence reproducible styling", async () => {
  const { inferMood, composeAtmosphere } = await atmosphereModule();
  assert.equal(inferMood("Ночь в офисе, срочный дедлайн").key, "intense");
  assert.equal(inferMood("Тихая прогулка у пруда").key, "calm");
  assert.equal(inferMood("Ночь в офисе", "Tender").key, "tender");
  const record = { memory: "Тихая прогулка", sourceType: "youtube", musicDescription: "fast electronic" };
  const fast = composeAtmosphere(record, { hue: 200, light: 30, count: 2 });
  const slow = composeAtmosphere({ ...record, musicDescription: "slow ambient" }, { hue: 40, light: 70, count: 1 });
  assert.notEqual(fast.motion, slow.motion);
  assert.notEqual(fast.hue, slow.hue);
  assert.match(fast.explanation, /200°/);
  assert.deepEqual(fast, composeAtmosphere(record, { hue: 200, light: 30, count: 2 }));
});
