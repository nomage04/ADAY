// photos.js — user-uploaded photos that MUST be integrated into the
// generated deck.
//
// Storage: one versionable JSON file per photo in customs/photos/.
// Cap: 10 photos max. Each is downscaled to 1280 px on the longest
// side and stored as JPEG q=0.88 data URL.
//
// Descriptions are filled on-demand (inside onPlan) using the vision
// LLM — never at upload time, to avoid wasted tokens.

const PHOTO_CAP = window.PPTGen.constraints.collectionCaps.photos;
const PHOTO_MAX_SIDE = 1280;
const PHOTO_JPEG_QUALITY = 0.88;

// ---- storage ------------------------------------------------------------
function getPhotos() {
  return window.PPTGen.repoStore.getAll("photos");
}
async function savePhotos(list) {
  const normalized = list.map(photo => window.PPTGen?.security?.normalizePhoto(photo));
  if (normalized.some(photo => !photo)) throw new Error("Invalid photo");
  const wanted = new Set(normalized.map(photo => photo.id));
  for (const photo of normalized) await window.PPTGen.repoStore.put("photos", photo);
  for (const photo of getPhotos()) {
    if (!wanted.has(photo.id)) await window.PPTGen.repoStore.remove("photos", photo.id);
  }
}
function getPhotoById(id) {
  return getPhotos().find(p => p.id === id) || null;
}

// ---- ingestion ---------------------------------------------------------
async function ingestPhotoFile(file) {
  const photos = getPhotos();
  if (photos.length >= PHOTO_CAP) {
    throw new Error(`Cap atteint — ${PHOTO_CAP} photos max par session.`);
  }
  const dataUrl = await downscalePhoto(
    await fileToDataUrl(file), PHOTO_MAX_SIDE, PHOTO_JPEG_QUALITY);
  const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const entry = {
    id,
    name: file.name || (id + ".jpg"),
    description: "",     // filled by vision at gen time if still empty
    dataUrl,
    addedAt: new Date().toISOString(),
  };
  await window.PPTGen.repoStore.put("photos", entry);
  return entry;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function downscalePhoto(dataUrl, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * ratio);
      const h = Math.round(img.naturalHeight * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL("image/jpeg", quality)); }
      catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("photo load failed for downscale"));
    img.src = dataUrl;
  });
}

async function deletePhoto(id) {
  await window.PPTGen.repoStore.remove("photos", id);
}
async function updatePhoto(id, patch) {
  const list = getPhotos();
  const i = list.findIndex(p => p.id === id);
  if (i >= 0) {
    list[i] = { ...list[i], ...patch };
    await window.PPTGen.repoStore.put("photos", list[i]);
  }
}

// ---- vision-time description fill --------------------------------------
// Called from onPlan() right before the content/layout agents fire.
async function ensurePhotoDescriptions(visionCfg, onLog) {
  const emit = onLog || (() => {});
  const list = getPhotos();
  const missing = list.filter(p => !p.description || !p.description.trim());
  if (!missing.length) return;

  emit("step", `Vision: describing ${missing.length} photo(s) without caption`);

  // Run them in parallel — but cap at 3 concurrent to avoid rate-limiting.
  const CONC = 3;
  const queue = [...missing];
  const runners = Array.from({ length: Math.min(CONC, queue.length) }, async () => {
    while (queue.length) {
      const photo = queue.shift();
      try {
        const desc = await describePhoto(visionCfg, photo);
        await updatePhoto(photo.id, { description: desc });
        emit("ok", `Photo "${photo.name}" described: ${desc.slice(0, 100)}...`);
      } catch (e) {
        emit("warn", `Description failed for "${photo.name}": ${e.message}`);
        await updatePhoto(photo.id, { description: "Photo fournie par l'utilisateur." });
      }
    }
  });
  await Promise.all(runners);
  renderPhotoGallery();    // refresh UI with new descriptions
}

const PHOTO_DESCRIBE_SYSTEM = `You describe a single image in 1 concise sentence (≤ 25 words) aimed at helping a slide-deck builder decide where to place it. Focus on subject, key visual elements, and tone. No fluff, no "this image shows…" preamble.

Return a JSON object: { "description": "…" }`;

async function describePhoto(cfg, photo) {
  const userContent = [
    { type: "text", text: "Describe this image in ≤ 25 words." },
    { type: "image_url", image_url: { url: photo.dataUrl } },
  ];
  const baseOpts = {
    model: cfg.visionModel || cfg.model,
    temperature: 0.3, stream: false, reasoningFormat: null,
  };
  try {
    const res = await llmJson(cfg, PHOTO_DESCRIBE_SYSTEM, userContent,
      { ...baseOpts, useJsonMode: true });
    return res.data?.description || "Photo fournie.";
  } catch {
    const res = await llmJson(cfg, PHOTO_DESCRIBE_SYSTEM, userContent,
      { ...baseOpts, useJsonMode: false });
    return res.data?.description || "Photo fournie.";
  }
}

// ---- gallery UI --------------------------------------------------------
function renderPhotoGallery() {
  const grid = document.getElementById("photoGrid");
  if (!grid) return;
  const list = getPhotos();
  const counter = document.getElementById("photoCounter");
  if (counter) counter.textContent = `${list.length}/${PHOTO_CAP}`;

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "muted photo-grid-empty";
    empty.textContent = "No photo imported. Added photos must be placed in the deck.";
    grid.replaceChildren(empty);
    window.renderDataBackupStats?.();
    return;
  }
  const cards = list.map(photo => {
    const card = document.createElement("div");
    card.className = "photo-card";
    card.dataset.id = photo.id;
    const image = document.createElement("img");
    image.src = photo.dataUrl;
    image.alt = photo.name;
    const body = document.createElement("div");
    body.className = "photo-body";
    const name = document.createElement("div");
    name.className = "photo-name";
    name.title = photo.name;
    name.textContent = photo.name;
    const description = document.createElement("textarea");
    description.className = "photo-desc";
    description.rows = 2;
    description.placeholder = "Description (empty: generated when creating)";
    description.value = photo.description;
    body.append(name, description);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "photo-delete";
    remove.dataset.del = photo.id;
    remove.title = "Delete";
    remove.setAttribute("aria-label", `Delete photo ${photo.name}`);
    remove.textContent = "×";
    card.append(image, body, remove);
    return card;
  });
  grid.replaceChildren(...cards);

  grid.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", async () => {
    try {
      await deletePhoto(btn.dataset.del);
      renderPhotoGallery();
    } catch (error) { alert(`Suppression impossible : ${error.message}`); }
  }));
  grid.querySelectorAll(".photo-desc").forEach(ta => ta.addEventListener("change", async e => {
    const id = e.target.closest(".photo-card").dataset.id;
    try { await updatePhoto(id, { description: e.target.value }); }
    catch (error) { alert(`Description not saved: ${error.message}`); }
  }));
  window.renderDataBackupStats?.();
}

// ---- prompt injection --------------------------------------------------
function buildPhotosPromptSection() {
  const list = getPhotos();
  if (!list.length) return null;
  return {
    photos: list.map(p => ({
      id: "photo:" + p.id,
      name: p.name,
      description: p.description || "(no description — vision should infer)",
    })),
    rules: [
      "Every photo above MUST appear in at least one slide in the final plan.",
      "Use the photo id (e.g. `photo:" + list[0].id + "`) as the value of the `image` field on any layout that accepts one (photo_hero, split_image_text).",
      "If a photo's description suggests a specific subject (chart, person, product…), pick the slide whose content best matches it.",
      "Do NOT invent photo ids that aren't in the list above.",
    ],
  };
}

// ---- init --------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await window.PPTGen.repoReady;
  const input = document.getElementById("photoInput");
  if (!input) return;
  const btn = document.getElementById("btnAddPhotos");
  if (btn) btn.addEventListener("click", () => input.click());
  input.addEventListener("change", async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const slotsLeft = PHOTO_CAP - getPhotos().length;
    if (slotsLeft <= 0) {
      alert(`Cap atteint — ${PHOTO_CAP} photos max.`);
      return;
    }
    const toAdd = files.slice(0, slotsLeft);
    if (files.length > slotsLeft) {
      alert(`Only the first ${slotsLeft} photo(s) were added (cap ${PHOTO_CAP}).`);
    }
    for (const f of toAdd) {
      try { await ingestPhotoFile(f); }
      catch (err) { alert(err.message); break; }
    }
    renderPhotoGallery();
  });
  renderPhotoGallery();
});
