#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';

const DEFAULT_CHAT_TAG_URL = 'https://chat-tag-new.fly.dev';
const DEFAULT_STREAMWEAVER_URL = 'https://streamweaver-new.fly.dev';
const DEFAULT_TENANT_ID = 'spacemountainlive';
const DEFAULT_RESOLUTION = '2048x1280';
const DEFAULT_PROVIDER = 'seaart';
const DEFAULT_STATE_FILE = '.quackverse-art-rebuild-state.json';
const NEGATIVE_PROMPT = [
  'concept sheet', 'model sheet', 'reference sheet', 'turnaround', 'multiple angles',
  'duplicate character', 'panels', 'vignettes', 'diagram', 'callouts', 'labels',
  'text', 'watermark', 'logo', 'white background', 'cropped head', 'cropped bill',
  'cropped limbs', 'cropped weapon', 'contact sheet', 'collage', 'split panel',
].join(', ');

function parseArgs(argv) {
  const options = {
    chatTagUrl: process.env.CHAT_TAG_URL || DEFAULT_CHAT_TAG_URL,
    streamweaverUrl: process.env.STREAMWEAVER_URL || DEFAULT_STREAMWEAVER_URL,
    tenantId: process.env.QUACKVERSE_TENANT_ID || process.env.STREAMWEAVER_TENANT_ID || DEFAULT_TENANT_ID,
    provider: process.env.QUACKVERSE_IMAGE_PROVIDER || DEFAULT_PROVIDER,
    resolution: process.env.QUACKVERSE_IMAGE_RESOLUTION || DEFAULT_RESOLUTION,
    fallbackResolution: process.env.QUACKVERSE_IMAGE_FALLBACK_RESOLUTION || '1536x960',
    stateFile: process.env.QUACKVERSE_REBUILD_STATE_FILE || DEFAULT_STATE_FILE,
    botSecret: process.env.CHAT_TAG_BOT_SECRET || process.env.BOT_SECRET || '',
    fresh: false,
    dryRun: false,
    noAnimate: false,
    force: false,
    cardId: null,
    startId: null,
    limit: null,
    seed: Number(process.env.QUACKVERSE_IMAGE_SEED || 1987) || 1987,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    if (arg === '--fresh') options.fresh = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-animate') options.noAnimate = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--card') options.cardId = Number(next());
    else if (arg === '--start') options.startId = Number(next());
    else if (arg === '--limit') options.limit = Number(next());
    else if (arg === '--resolution') options.resolution = next();
    else if (arg === '--fallback-resolution') options.fallbackResolution = next();
    else if (arg === '--provider') options.provider = next();
    else if (arg === '--tenant') options.tenantId = next();
    else if (arg === '--chat-tag-url') options.chatTagUrl = next();
    else if (arg === '--streamweaver-url') options.streamweaverUrl = next();
    else if (arg === '--state-file') options.stateFile = next();
    else if (arg === '--seed') options.seed = Number(next());
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  options.chatTagUrl = options.chatTagUrl.replace(/\/$/, '');
  options.streamweaverUrl = options.streamweaverUrl.replace(/\/$/, '');
  if (options.cardId !== null && (!Number.isFinite(options.cardId) || options.cardId < 1)) throw new Error('--card must be a positive card id');
  if (options.startId !== null && (!Number.isFinite(options.startId) || options.startId < 1)) throw new Error('--start must be a positive card id');
  if (options.limit !== null && (!Number.isFinite(options.limit) || options.limit < 1)) throw new Error('--limit must be a positive number');
  if (!/^\d{3,4}x\d{3,4}$/i.test(options.resolution)) throw new Error('--resolution must look like 2048x1280');
  if (options.fallbackResolution && !/^\d{3,4}x\d{3,4}$/i.test(options.fallbackResolution)) throw new Error('--fallback-resolution must look like 1536x960');
  return options;
}

function usage() {
  return `Quackverse external art rebuilder\n\n` +
    `Runs outside ChatTag. It asks ChatTag for the canonical per-card prompt, generates one high-resolution image through StreamWeaver, uploads it through ChatTag's existing protected art API, then asks the existing DSH renderer to make/save the hover GIF.\n\n` +
    `Required environment:\n` +
    `  CHAT_TAG_BOT_SECRET=<live bot secret>\n\n` +
    `Examples:\n` +
    `  node scripts/quackverse-art-rebuild.mjs --fresh\n` +
    `  node scripts/quackverse-art-rebuild.mjs --card 7 --force\n` +
    `  node scripts/quackverse-art-rebuild.mjs --start 40 --limit 10\n` +
    `  node scripts/quackverse-art-rebuild.mjs --dry-run --limit 5\n\n` +
    `Defaults:\n` +
    `  ChatTag: ${DEFAULT_CHAT_TAG_URL}\n` +
    `  StreamWeaver: ${DEFAULT_STREAMWEAVER_URL}\n` +
    `  Resolution: ${DEFAULT_RESOLUTION}\n` +
    `  Provider: ${DEFAULT_PROVIDER}\n`;
}

async function requestJson(url, init = {}, label = 'request') {
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    const detail = data?.error || data?.message || data?.data?.error || data?.raw || `${response.status} ${response.statusText}`;
    throw new Error(`${label} failed: ${detail}`);
  }
  return data;
}

function botHeaders(options, extra = {}) {
  if (!options.botSecret) throw new Error('CHAT_TAG_BOT_SECRET is required for live writes.');
  return { 'x-bot-secret': options.botSecret, ...extra };
}

async function readManifest(options) {
  return requestJson(`${options.chatTagUrl}/api/quackverse/art`, {}, 'Quackverse art manifest');
}

async function classifyCards(options, ids) {
  const cards = new Map();
  for (let offset = 0; offset < ids.length; offset += 20) {
    const chunk = ids.slice(offset, offset + 20);
    const data = await requestJson(`${options.chatTagUrl}/api/quackverse/art/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variant: 'static',
        previewOnly: true,
        missingOnly: false,
        cardIds: chunk,
        limit: chunk.length,
      }),
    }, 'Quackverse prompt preview');
    for (const result of data?.results || []) {
      if (result?.cardId) cards.set(Number(result.cardId), result);
    }
  }
  return cards;
}

function seededShuffle(values, seed) {
  let state = (Number(seed) >>> 0) || 1987;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function buildGenderPlan(cardMeta, seed) {
  const duckIds = [...cardMeta.entries()]
    .filter(([, item]) => String(item?.type || '').toLowerCase() === 'duck')
    .map(([id]) => id);
  const shuffled = seededShuffle(duckIds, seed);
  const feminineCount = Math.floor(shuffled.length / 2);
  const feminine = new Set(shuffled.slice(0, feminineCount));
  const masculine = new Set(shuffled.slice(feminineCount));
  return { feminine, masculine, total: duckIds.length };
}

function artDirectionFor(cardId, meta, genderPlan, resolution) {
  if (String(meta?.type || '').toLowerCase() !== 'duck') {
    return `Native render resolution ${resolution}. Exactly one finished equipment/object illustration. No sheet, collage, border, card frame, labels or bleed.`;
  }
  const presentation = genderPlan.feminine.has(cardId) ? 'feminine-presenting' : 'masculine-presenting';
  return [
    `Character presentation: ${presentation} adult anthropomorphic waterfowl person.`,
    'Keep unmistakable species-correct avian anatomy, feathers, bill, arms and legs; never turn the subject into a human or a human wearing a bird mask.',
    'Preserve the canonical Quackverse family, class, armor, weapon, palette and effects.',
    `Native render resolution ${resolution} in exact 16:10 landscape.`,
    'Exactly one subject and one camera angle. No sheet, collage, split panels, duplicate character, border, card frame, labels, watermark or bleed.',
    'Keep the full head, bill, limbs and signature weapon safely inside the image with detailed feathers, armor surfaces and cinematic environmental depth.',
  ].join(' ');
}

async function previewPrompt(options, cardId, instructions) {
  const data = await requestJson(`${options.chatTagUrl}/api/quackverse/art/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      variant: 'static',
      previewOnly: true,
      missingOnly: false,
      cardIds: [cardId],
      limit: 1,
      customInstructions: instructions,
    }),
  }, `Card #${cardId} prompt preview`);
  const result = (data?.results || [])[0];
  if (!result?.prompt) throw new Error(`Card #${cardId} prompt preview did not return a prompt`);
  return result;
}

function rewritePromptResolution(prompt, resolution) {
  const value = String(prompt || '')
    .replace(/1024x640/gi, resolution)
    .replace(/1024x1024/gi, resolution);
  return `${value} Native output request: ${resolution}. Render the final image at this resolution rather than as a contact sheet or source sheet.`;
}

async function generateWithStreamWeaver(options, prompt, cardId) {
  const resolutions = [options.resolution];
  if (options.fallbackResolution && options.fallbackResolution !== options.resolution) resolutions.push(options.fallbackResolution);
  let lastError = null;

  for (const resolution of resolutions) {
    try {
      const seed = options.seed + Number(cardId);
      const raw = await requestJson(`${options.streamweaverUrl}/api/ai/image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mountainview-bridge': '1',
        },
        body: JSON.stringify({
          prompt: rewritePromptResolution(prompt, resolution),
          scope: 'public',
          tenantId: options.tenantId,
          resolution,
          numImages: 1,
          providerOverride: options.provider,
          providerParams: {
            negativePrompt: NEGATIVE_PROMPT,
            seed,
          },
        }),
      }, `Card #${cardId} StreamWeaver generation at ${resolution}`);
      const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
      const candidates = [
        ...(Array.isArray(data?.persistedImageUrls) ? data.persistedImageUrls : []),
        ...(Array.isArray(data?.images) ? data.images : []),
        data?.persistedImageUrl,
        data?.image,
        data?.imageResourceUrl,
      ].map((value) => String(value || '').trim()).filter(Boolean);
      const imageUrl = candidates[0];
      if (!imageUrl) throw new Error('StreamWeaver returned no image URL');
      return { imageUrl: new URL(imageUrl, options.streamweaverUrl).toString(), resolution, provider: data?.provider || options.provider };
    } catch (error) {
      lastError = error;
      if (resolution !== resolutions[resolutions.length - 1]) {
        console.warn(`  ! ${error.message}`);
        console.warn(`  -> retrying at ${resolutions[resolutions.indexOf(resolution) + 1]}`);
      }
    }
  }
  throw lastError || new Error(`Card #${cardId} generation failed`);
}

async function downloadImage(imageUrl, cardId) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Card #${cardId} generated image download failed: ${response.status}`);
  const mimeType = String(response.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
  if (!mimeType.startsWith('image/')) throw new Error(`Card #${cardId} generated asset is not an image (${mimeType})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Card #${cardId} generated image was empty`);
  if (bytes.length > 20 * 1024 * 1024) throw new Error(`Card #${cardId} image exceeds ChatTag's 20MB upload limit`);
  return { bytes, mimeType };
}

function extensionForMime(mimeType) {
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('avif')) return 'avif';
  if (mimeType.includes('gif')) return 'gif';
  return 'png';
}

async function uploadStatic(options, cardId, image, generation) {
  const ext = extensionForMime(image.mimeType);
  return requestJson(`${options.chatTagUrl}/api/quackverse/art`, {
    method: 'POST',
    headers: botHeaders(options, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      cardId,
      variant: 'static',
      file: {
        fileName: `external-${generation.provider || options.provider}-${generation.resolution}-card-${String(cardId).padStart(3, '0')}.${ext}`,
        mimeType: image.mimeType,
        base64: image.bytes.toString('base64'),
      },
    }),
  }, `Card #${cardId} static upload`);
}

async function animateAndPersist(options, cardId) {
  return requestJson(`${options.chatTagUrl}/api/quackverse/art/enhance-animate`, {
    method: 'POST',
    headers: botHeaders(options, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ cardId }),
  }, `Card #${cardId} enhance + animate`);
}

async function deleteCardArt(options, cardId) {
  return requestJson(`${options.chatTagUrl}/api/quackverse/art`, {
    method: 'DELETE',
    headers: botHeaders(options, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ cardId, variant: 'all' }),
  }, `Card #${cardId} art delete`);
}

async function writeState(fileName, state) {
  const payload = { ...state, updatedAt: new Date().toISOString() };
  await fs.writeFile(fileName, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function loadState(fileName) {
  try { return JSON.parse(await fs.readFile(fileName, 'utf8')); }
  catch { return { completed: {}, failed: {} }; }
}

function selectIds(allIds, options) {
  let ids = [...allIds].sort((a, b) => a - b);
  if (options.cardId !== null) ids = ids.filter((id) => id === options.cardId);
  if (options.startId !== null) ids = ids.filter((id) => id >= options.startId);
  if (options.limit !== null) ids = ids.slice(0, Math.floor(options.limit));
  return ids;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const manifest = await readManifest(options);
  const allIds = Object.keys(manifest?.cards || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!allIds.length) throw new Error('The live Quackverse manifest returned no card ids.');

  const metadata = await classifyCards(options, allIds);
  const genderPlan = buildGenderPlan(metadata, options.seed);
  console.log(`Quackverse live inventory: ${allIds.length} cards; ${genderPlan.total} duck characters; ${genderPlan.feminine.size} feminine / ${genderPlan.masculine.size} masculine.`);
  console.log(`Generation target: ${options.provider} ${options.resolution}${options.fallbackResolution ? ` (fallback ${options.fallbackResolution})` : ''}.`);

  const ids = selectIds(allIds, options);
  if (!ids.length) throw new Error('No card ids matched the requested range.');

  if (options.dryRun) {
    for (const cardId of ids) {
      const meta = metadata.get(cardId);
      const instructions = artDirectionFor(cardId, meta, genderPlan, options.resolution);
      const preview = await previewPrompt(options, cardId, instructions);
      const gender = genderPlan.feminine.has(cardId) ? 'feminine' : genderPlan.masculine.has(cardId) ? 'masculine' : 'n/a';
      console.log(`#${String(cardId).padStart(3, '0')} ${preview.name} | ${preview.type} | ${gender}`);
      console.log(`  ${rewritePromptResolution(preview.prompt, options.resolution).slice(0, 420)}...`);
    }
    return;
  }

  if (!options.botSecret) throw new Error('CHAT_TAG_BOT_SECRET is required. Refusing to write live art without the existing service credential.');

  const state = await loadState(options.stateFile);
  if (options.fresh) {
    console.log(`Deleting existing static + hover art for ${ids.length} selected cards through the existing protected ChatTag art API...`);
    for (let index = 0; index < ids.length; index += 1) {
      const cardId = ids[index];
      await deleteCardArt(options, cardId);
      console.log(`  deleted ${index + 1}/${ids.length} card #${cardId}`);
    }
    state.completed = {};
    state.failed = {};
    state.freshWipeAt = new Date().toISOString();
    await writeState(options.stateFile, state);
  }

  for (let index = 0; index < ids.length; index += 1) {
    const cardId = ids[index];
    const meta = metadata.get(cardId);
    const label = meta?.name || `card #${cardId}`;
    console.log(`\n[${index + 1}/${ids.length}] #${cardId} ${label}`);

    try {
      const live = await readManifest(options);
      const liveEntry = live?.cards?.[String(cardId)] || {};
      if (!options.force && liveEntry.static && (options.noAnimate || liveEntry.hover)) {
        console.log('  already complete; skipping');
        state.completed[String(cardId)] = { skipped: true, at: new Date().toISOString() };
        delete state.failed[String(cardId)];
        await writeState(options.stateFile, state);
        continue;
      }

      if (!liveEntry.static || options.force) {
        const instructions = artDirectionFor(cardId, meta, genderPlan, options.resolution);
        const preview = await previewPrompt(options, cardId, instructions);
        const gender = genderPlan.feminine.has(cardId) ? 'feminine' : genderPlan.masculine.has(cardId) ? 'masculine' : 'n/a';
        console.log(`  generating one ${gender} ${preview.type || 'card'} image...`);
        const generation = await generateWithStreamWeaver(options, preview.prompt, cardId);
        console.log(`  generated via ${generation.provider} at ${generation.resolution}; downloading...`);
        const image = await downloadImage(generation.imageUrl, cardId);
        console.log(`  uploading ${Math.round(image.bytes.length / 1024)} KB static master through ChatTag API...`);
        await uploadStatic(options, cardId, image, generation);
      } else {
        console.log('  static master already exists; keeping it and resuming animation');
      }

      if (!options.noAnimate) {
        console.log('  building + saving one hover GIF through the existing DSH renderer...');
        const animated = await animateAndPersist(options, cardId);
        if (!animated?.success) throw new Error('Enhance + Animate did not report success');
        console.log(`  saved static ${animated?.static?.width || '?'}x${animated?.static?.height || '?'} + hover GIF ${animated?.hover?.width || '?'}x${animated?.hover?.height || '?'} @ ${animated?.hover?.fps || '?'} fps`);
      }

      const verify = await readManifest(options);
      const entry = verify?.cards?.[String(cardId)] || {};
      if (!entry.static) throw new Error('Verification failed: static asset missing from live manifest');
      if (!options.noAnimate && !entry.hover) throw new Error('Verification failed: hover GIF missing from live manifest');

      state.completed[String(cardId)] = {
        name: label,
        static: entry.static?.fileName || entry.static?.url || true,
        hover: entry.hover?.fileName || entry.hover?.url || null,
        at: new Date().toISOString(),
      };
      delete state.failed[String(cardId)];
      await writeState(options.stateFile, state);
      console.log('  verified live manifest');
    } catch (error) {
      console.error(`  FAILED: ${error.message}`);
      state.failed[String(cardId)] = { name: label, error: error.message, at: new Date().toISOString() };
      await writeState(options.stateFile, state);
    }
  }

  const completed = Object.keys(state.completed || {}).filter((id) => ids.includes(Number(id))).length;
  const failed = Object.keys(state.failed || {}).filter((id) => ids.includes(Number(id))).length;
  console.log(`\nDone: ${completed}/${ids.length} complete, ${failed} failed.`);
  console.log(`Checkpoint: ${options.stateFile}`);
  if (failed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`Fatal: ${error?.message || error}`);
  process.exitCode = 1;
});
