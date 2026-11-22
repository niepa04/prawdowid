const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  DetectorError,
  decodeBase64Image,
  createViews,
  scoreEmbedding,
  sigmoid,
  detectAiImage,
} = require('./detector');

test('decodeBase64Image obsluguje czysty base64 oraz Data URI', () => {
  const raw = Buffer.from('hello-png').toString('base64');
  assert.deepEqual(decodeBase64Image(raw), Buffer.from('hello-png'));
  assert.deepEqual(decodeBase64Image(`data:image/png;base64,${raw}`), Buffer.from('hello-png'));
  assert.throws(() => decodeBase64Image(''), (err) => err instanceof DetectorError && err.status === 400);
  assert.throws(() => decodeBase64Image('not-valid-b64!'), (err) => err instanceof DetectorError && err.status === 400);
});

test('createViews przycina obrazy do 528x528 (3 widoki domyslnie, 1 widok dla crops=1)', async () => {
  const widePng = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 20, g: 120, b: 220 } },
  })
    .png()
    .toBuffer();

  const three = await createViews(widePng, 3);
  assert.equal(three.length, 3);
  for (const buf of three) {
    const meta = await sharp(buf).metadata();
    assert.equal(meta.width, 528);
    assert.equal(meta.height, 528);
  }

  const one = await createViews(widePng, 1);
  assert.equal(one.length, 1);
  const metaOne = await sharp(one[0]).metadata();
  assert.equal(metaOne.width, 528);
  assert.equal(metaOne.height, 528);
});

test('createViews powieksza male obrazy do minimum 528x528', async () => {
  const tinyPng = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();

  const views = await createViews(tinyPng, 3);
  assert.equal(views.length, 3);
  const meta = await sharp(views[0]).metadata();
  assert.equal(meta.width, 528);
  assert.equal(meta.height, 528);
});

test('detectAiImage zwraca procent AI z zamockowanego llama-server', async () => {
  const samplePng = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .png()
    .toBuffer();
  const base64 = `data:image/png;base64,${samplePng.toString('base64')}`;

  const fakeHead = { weight: Array(768).fill(0), bias: 0 };
  fakeHead.weight[0] = 2.0; // przy emb[0] = 1.0 logit = 2.0 -> sigmoid(2) ~= 88.1%

  const fakeFetch = async (url) => {
    if (url.endsWith('/props')) {
      return new Response(JSON.stringify({ media_marker: '<__media__>' }), { status: 200 });
    }
    if (url.endsWith('/embeddings')) {
      const emb = Array(768).fill(0);
      emb[0] = 1.0;
      return new Response(JSON.stringify([{ embedding: emb }]), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await detectAiImage(base64, {
    serverUrl: 'http://konrad:8080',
    crops: 3,
    fetchImpl: fakeFetch,
    head: fakeHead,
  });

  const expectedProb = sigmoid(scoreEmbedding([1, ...Array(767).fill(0)], fakeHead));
  assert.equal(result.crops, 3);
  assert.equal(result.ai_probability, Number(expectedProb.toFixed(4)));
  assert.equal(result.ai_percent, Math.round(expectedProb * 1000) / 10);
  assert.equal(result.label, 'ai');
});
