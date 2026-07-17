// Gallery — renders 2 grids (icons + layouts) with toggles.
// Selection state lives in LayoutSelection / IconSelection sets stored in memory.
// app.js reads them to filter what goes into the agent prompts.

const IconSelection  = new Set();    // stems that are ENABLED
const LayoutSelection = new Set();   // layout names that are ENABLED

// Initialize selections — start everything on (built-ins + customs), then
// remove anything the user had previously disabled in customs/gallery.json.
function initSelections() {
  LayoutSelection.clear();
  IconSelection.clear();
  ALLOWED_LAYOUTS.forEach(n => LayoutSelection.add(n));
  ALLOWED_ICONS.forEach(n => IconSelection.add(n));
  // Custom layouts (stored under pptgen.cl.<id>) are referenced with
  // `custom:<id>` keys so they can't clash with built-in names.
  if (typeof getCustomLayoutIds === "function") {
    getCustomLayoutIds().forEach(id => LayoutSelection.add(id));
  }
  // Custom icons live under pptgen.ci.<stem>. Their id IS their stem —
  // selected by default on first import.
  if (typeof getCustomIconStems === "function") {
    getCustomIconStems().forEach(id => IconSelection.add(id));
  }
  const saved = window.PPTGen.repoStore.getDocument("gallery");
  (saved.disabledIcons || []).forEach(s => IconSelection.delete(s));
  (saved.disabledLayouts || []).forEach(s => LayoutSelection.delete(s));
}

// All icon stems the UI + validation should know about (built-ins + customs).
function currentAllIcons() {
  const extras = (typeof getCustomIconStems === "function")
    ? getCustomIconStems() : [];
  return [...ALLOWED_ICONS, ...extras];
}

// All layout keys the UI + validation should know about (built-ins + customs).
function currentAllLayouts() {
  const extras = (typeof getCustomLayoutIds === "function")
    ? getCustomLayoutIds() : [];
  return [...ALLOWED_LAYOUTS, ...extras];
}

async function persistGallerySelection() {
  const disabledIcons = currentAllIcons().filter(s => !IconSelection.has(s));
  const disabledLayouts = currentAllLayouts().filter(s => !LayoutSelection.has(s));
  try { await window.PPTGen.repoStore.putDocument("gallery", { disabledIcons, disabledLayouts }); }
  catch (error) {
    if (typeof log === "function") log("error", error.message);
    else console.error(error);
  }
}

// ---- Layout thumbnails ---------------------------------------------------
// Tiny schematic SVGs. Purely indicative — 120x70 (16:9 ratio-ish).

const LAYOUT_THUMBS = {
  title: `<rect width="120" height="70" fill="#1a3c34"/>
          <rect x="80" y="0" width="40" height="70" fill="#00915a"/>
          <rect x="10" y="25" width="55" height="5" fill="#fff"/>
          <rect x="10" y="34" width="40" height="3" fill="#b0c4b0"/>
          <rect x="10" y="42" width="15" height="2" fill="#00915a"/>`,

  closing: `<rect width="120" height="70" fill="#1a3c34"/>
            <rect x="35" y="28" width="50" height="6" fill="#fff"/>
            <rect x="52" y="40" width="16" height="2" fill="#00915a"/>
            <rect x="45" y="47" width="30" height="3" fill="#b0c4b0"/>`,

  cards: `<rect width="120" height="70" fill="#fafaf7"/>
          <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
          <rect x="8" y="14" width="8" height="1" fill="#00915a"/>
          <rect x="8" y="22" width="32" height="38" fill="#f0f0eb"/>
          <rect x="8" y="22" width="32" height="2" fill="#00915a"/>
          <rect x="44" y="22" width="32" height="38" fill="#f0f0eb"/>
          <rect x="44" y="22" width="32" height="2" fill="#e67e22"/>
          <rect x="80" y="22" width="32" height="38" fill="#f0f0eb"/>
          <rect x="80" y="22" width="32" height="2" fill="#006b42"/>`,

  two_col: `<rect width="120" height="70" fill="#fafaf7"/>
            <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
            <rect x="8" y="22" width="50" height="40" fill="#f0f0eb"/>
            <rect x="8" y="22" width="50" height="2" fill="#e67e22"/>
            <rect x="12" y="28" width="40" height="2" fill="#1a1a1a"/>
            <rect x="12" y="34" width="35" height="1" fill="#666"/>
            <rect x="12" y="38" width="38" height="1" fill="#666"/>
            <rect x="62" y="22" width="50" height="40" fill="#f0f0eb"/>
            <rect x="62" y="22" width="50" height="2" fill="#00915a"/>
            <rect x="66" y="28" width="40" height="2" fill="#1a1a1a"/>
            <rect x="66" y="34" width="35" height="1" fill="#666"/>`,

  stats: `<rect width="120" height="70" fill="#fafaf7"/>
          <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
          <rect x="8" y="24" width="34" height="36" fill="#f0f0eb"/>
          <text x="25" y="44" font-size="11" font-weight="bold" fill="#00915a" text-anchor="middle">42%</text>
          <rect x="44" y="24" width="34" height="36" fill="#f0f0eb"/>
          <text x="61" y="44" font-size="11" font-weight="bold" fill="#e67e22" text-anchor="middle">8M</text>
          <rect x="80" y="24" width="34" height="36" fill="#f0f0eb"/>
          <text x="97" y="44" font-size="11" font-weight="bold" fill="#006b42" text-anchor="middle">24h</text>`,

  big_stats: `<rect width="120" height="70" fill="#fafaf7"/>
              <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
              <rect x="8" y="22" width="50" height="40" fill="#f0f0eb"/>
              <text x="33" y="45" font-size="16" font-weight="bold" fill="#00915a" text-anchor="middle">+42%</text>
              <rect x="62" y="22" width="50" height="40" fill="#f0f0eb"/>
              <text x="87" y="45" font-size="16" font-weight="bold" fill="#e67e22" text-anchor="middle">8M€</text>`,

  kpi_hero: `<rect width="120" height="70" fill="#fafaf7"/>
             <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
             <ellipse cx="60" cy="38" rx="30" ry="22" fill="#f0f0eb"/>
             <text x="60" y="44" font-size="18" font-weight="bold" fill="#00915a" text-anchor="middle">94%</text>`,

  timeline: `<rect width="120" height="70" fill="#fafaf7"/>
             <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
             <line x1="20" y1="35" x2="100" y2="35" stroke="#00915a" stroke-width="2"/>
             <circle cx="25" cy="35" r="6" fill="#00915a"/>
             <circle cx="50" cy="35" r="6" fill="#e67e22"/>
             <circle cx="75" cy="35" r="6" fill="#006b42"/>
             <circle cx="100" cy="35" r="6" fill="#d63031"/>
             <text x="25" y="38" font-size="6" fill="#fff" text-anchor="middle">1</text>
             <text x="50" y="38" font-size="6" fill="#fff" text-anchor="middle">2</text>
             <text x="75" y="38" font-size="6" fill="#fff" text-anchor="middle">3</text>
             <text x="100" y="38" font-size="6" fill="#fff" text-anchor="middle">4</text>`,

  chart_bar: `<rect width="120" height="70" fill="#fafaf7"/>
              <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
              <rect x="10" y="22" width="58" height="38" fill="#f0f0eb"/>
              <rect x="15" y="50" width="8" height="8" fill="#00915a"/>
              <rect x="26" y="44" width="8" height="14" fill="#e67e22"/>
              <rect x="37" y="35" width="8" height="23" fill="#006b42"/>
              <rect x="48" y="28" width="8" height="30" fill="#d63031"/>
              <rect x="72" y="26" width="35" height="1" fill="#666"/>
              <rect x="72" y="30" width="30" height="1" fill="#666"/>
              <rect x="72" y="34" width="32" height="1" fill="#666"/>`,

  compare_two: `<rect width="120" height="70" fill="#fafaf7"/>
                <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
                <rect x="8" y="22" width="50" height="40" fill="#f0f0eb"/>
                <rect x="8" y="22" width="50" height="2" fill="#e67e22"/>
                <rect x="12" y="28" width="25" height="2" fill="#e67e22"/>
                <rect x="62" y="22" width="50" height="40" fill="#f0f0eb"/>
                <rect x="62" y="22" width="50" height="2" fill="#00915a"/>
                <rect x="66" y="28" width="25" height="2" fill="#00915a"/>`,

  quote: `<rect width="120" height="70" fill="#fafaf7"/>
          <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
          <rect x="15" y="22" width="1" height="30" fill="#00915a"/>
          <circle cx="15.5" cy="21" r="1.5" fill="#00915a"/>
          <rect x="20" y="26" width="75" height="2" fill="#1a1a1a" opacity="0.7"/>
          <rect x="20" y="31" width="85" height="2" fill="#1a1a1a" opacity="0.7"/>
          <rect x="20" y="36" width="60" height="2" fill="#1a1a1a" opacity="0.7"/>
          <rect x="20" y="48" width="12" height="1" fill="#00915a"/>
          <rect x="20" y="52" width="40" height="2" fill="#666"/>`,

  logo_grid: `<rect width="120" height="70" fill="#fafaf7"/>
              <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
              ${[0, 1, 2, 3].map(i =>
                `<rect x="${12 + i * 25}" y="24" width="18" height="18" fill="${CATEGORY_ACCENTS[i]}" rx="3"/>
                 <rect x="${12 + i * 25}" y="46" width="18" height="2" fill="#1a1a1a"/>`
              ).join("")}`,

  pyramid: `<rect width="120" height="70" fill="#fafaf7"/>
            <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
            <polygon points="30,56 90,56 83,44 37,44" fill="#00915a"/>
            <polygon points="37,44 83,44 76,32 44,32" fill="#e67e22"/>
            <polygon points="44,32 76,32 69,20 51,20" fill="#006b42"/>`,

  funnel: `<rect width="120" height="70" fill="#fafaf7"/>
           <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
           <rect x="20" y="22" width="80" height="8" fill="#00915a"/>
           <rect x="25" y="32" width="70" height="8" fill="#e67e22"/>
           <rect x="30" y="42" width="60" height="8" fill="#006b42"/>
           <rect x="38" y="52" width="44" height="8" fill="#d63031"/>`,

  matrix_2x2: `<rect width="120" height="70" fill="#fafaf7"/>
               <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
               <rect x="25" y="22" width="70" height="40" fill="#f0f0eb"/>
               <line x1="60" y1="22" x2="60" y2="62" stroke="#999" stroke-width="1"/>
               <line x1="25" y1="42" x2="95" y2="42" stroke="#999" stroke-width="1"/>
               <circle cx="40" cy="32" r="3" fill="#00915a"/>
               <circle cx="78" cy="32" r="3" fill="#e67e22"/>
               <circle cx="40" cy="52" r="3" fill="#006b42"/>
               <circle cx="78" cy="52" r="3" fill="#d63031"/>`,

  process_circular: `<rect width="120" height="70" fill="#fafaf7"/>
                     <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
                     <circle cx="60" cy="42" r="9" fill="#00915a"/>
                     <circle cx="60" cy="22" r="5" fill="#e67e22"/>
                     <circle cx="78" cy="42" r="5" fill="#006b42"/>
                     <circle cx="60" cy="62" r="5" fill="#d63031"/>
                     <circle cx="42" cy="42" r="5" fill="#00915a"/>`,

  swot: `<rect width="120" height="70" fill="#fafaf7"/>
         <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
         <rect x="12" y="22" width="48" height="18" fill="#f0f0eb"/>
         <rect x="12" y="22" width="48" height="4" fill="#00915a"/>
         <rect x="62" y="22" width="48" height="18" fill="#f0f0eb"/>
         <rect x="62" y="22" width="48" height="4" fill="#e67e22"/>
         <rect x="12" y="42" width="48" height="18" fill="#f0f0eb"/>
         <rect x="12" y="42" width="48" height="4" fill="#006b42"/>
         <rect x="62" y="42" width="48" height="18" fill="#f0f0eb"/>
         <rect x="62" y="42" width="48" height="4" fill="#d63031"/>`,

  venn: `<rect width="120" height="70" fill="#fafaf7"/>
         <rect x="8" y="8" width="35" height="3" fill="#1a3c34"/>
         <circle cx="48" cy="42" r="15" fill="#00915a" fill-opacity="0.8"/>
         <circle cx="72" cy="42" r="15" fill="#e67e22" fill-opacity="0.8"/>`,
};

function layoutThumb(name) {
  const packed = (typeof getAssetLayoutThumb === "function") && getAssetLayoutThumb(name);
  if (packed) return `<img src="${packed}" alt="${name}">`;
  // Prefer the embedded PNG thumbnail generated by build_layout_thumbs.py.
  const png = (typeof LAYOUT_THUMB_URLS !== "undefined") && LAYOUT_THUMB_URLS[name];
  if (png) return `<img src="${png}" alt="${name}">`;
  // Fallback: the inline SVG schema (older versions).
  const inner = LAYOUT_THUMBS[name] || `<rect width="120" height="70" fill="#eee"/>`;
  return `<svg viewBox="0 0 120 70" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// ---- Rendering -----------------------------------------------------------

function renderIconGallery(container) {
  const builtIns = (typeof assetIconIds === "function")
    ? assetIconIds()
    : Array.from(ALLOWED_ICONS).sort();
  const customs = (typeof getCustomIcons === "function") ? getCustomIcons() : [];
  const fragment = document.createDocumentFragment();
  const makeCard = ({ id, name, title, src, custom = false, analysis = null }) => {
    const label = document.createElement("label");
    label.className = `gallery-item${custom ? " is-custom" : ""}`;
    label.title = title || name;
    label.dataset.category = "icons";
    label.dataset.search = `${name} ${title || ""}`.toLowerCase();
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.stem = id;
    input.checked = IconSelection.has(id);
    const image = document.createElement("img");
    image.src = src;
    image.alt = name;
    image.loading = "lazy";
    const text = document.createElement("span");
    text.textContent = name;
    label.append(input, image, text);
    if (custom) {
      if (["pending", "failed"].includes(analysis?.descriptionStatus)) {
        const status = document.createElement("span");
        status.className = "enrich-dot";
        status.title = analysis.descriptionStatus === "pending"
          ? "Vision description in progress"
          : (analysis.errorMessage || "Description not generated — open to retry");
        status.textContent = analysis.descriptionStatus === "pending" ? "↻" : "⚠";
        text.appendChild(status);
      }
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn-edit-custom";
      edit.dataset.customIconEdit = id;
      edit.title = "Edit description";
      edit.setAttribute("aria-label", `Edit icon ${name}`);
      edit.textContent = "✎";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-delete-custom";
      remove.dataset.customIconDel = id;
      remove.title = "Delete";
      remove.setAttribute("aria-label", `Delete icon ${name}`);
      remove.textContent = "×";
      label.append(edit, remove);
    }
    return label;
  };
  for (const id of builtIns) {
    const meta = getAssetIconMeta(id);
    fragment.appendChild(makeCard({
      id, name: id,
      title: meta?.description ? `${id} - ${meta.description}` : id,
      src: getAssetIconDataUrl(id),
    }));
  }
  for (const icon of customs) {
    fragment.appendChild(makeCard({
      id: icon.id, name: icon.id, title: icon.description || icon.name,
      src: icon.dataUrl, custom: true, analysis: icon.analysis,
    }));
  }
  container.replaceChildren(fragment);

  container.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", async e => {
      const stem = e.target.dataset.stem;
      if (e.target.checked) IconSelection.add(stem);
      else IconSelection.delete(stem);
      await persistGallerySelection();
      updateGalleryStats();
    });
  });
  container.querySelectorAll("[data-custom-icon-del]").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.preventDefault(); e.stopPropagation();
      if (!confirm("Delete this icon?")) return;
      try {
        await deleteCustomIcon(btn.dataset.customIconDel);
        IconSelection.delete(btn.dataset.customIconDel);
        await persistGallerySelection();
        renderIconGallery(container);
      } catch (error) { alert(`Delete failed: ${error.message}`); }
    });
  });
  container.querySelectorAll("[data-custom-icon-edit]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      openEditCustomIconModal(button.dataset.customIconEdit);
    });
  });
  window.renderDataBackupStats?.();
  updateGalleryStats();
  applyGalleryFilters();
}

// Group layouts by manifest category. Asset-pack layouts and local
// browser-only layouts use the same category slugs.
const LAYOUT_GROUPS = [
  { title: "Structural", slug: "structural" },
  { title: "Content",    slug: "content" },
  { title: "SmartArt",   slug: "smartart" },
  { title: "Image",      slug: "image" },
  { title: "Custom",     slug: "custom" },
];

// Render a single custom layout card. Same shape as built-in cards but
// with the "is-custom" badge, an edit button, and an optional role
// badge when the entry plays a structural role (title / closing).
function _renderCustomCard(c) {
  const key = "custom:" + c.id;
  const status = ((typeof getEnrichStatus === "function") ? getEnrichStatus(c.id) : null)
    || c.analysis?.descriptionStatus;
  const cat = (typeof getCustomCategory === "function") ? getCustomCategory(c) : "custom";
  const label = document.createElement("label");
  label.className = "gallery-item layout-item is-custom";
  label.title = c.description || c.name;
  label.dataset.category = cat;
  label.dataset.search = `${c.name} ${c.description || ""} ${cat} custom`.toLowerCase();
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.layout = key;
  input.checked = LayoutSelection.has(key);
  label.appendChild(input);
  if (cat === "structural" && c.structural_role) {
    const role = document.createElement("span");
    role.className = "role-badge";
    role.textContent = c.structural_role;
    label.appendChild(role);
  }
  const thumb = document.createElement("div");
  thumb.className = "layout-thumb";
  const image = document.createElement("img");
  image.src = c.thumbnailDataUrl || c.imageDataUrl || "";
  image.alt = c.name;
  thumb.appendChild(image);
  const name = document.createElement("span");
  name.textContent = c.name;
  if (status === "pending") {
    const enrich = document.createElement("span");
    enrich.className = "enrich-dot";
    enrich.title = "Vision analysis in progress...";
    enrich.textContent = "🔄";
    name.appendChild(enrich);
  } else if (status === "failed") {
    const enrich = document.createElement("span");
    enrich.className = "enrich-dot";
    enrich.title = c.analysis?.errorMessage || "Description not generated — open editing to retry";
    enrich.textContent = "⚠";
    name.appendChild(enrich);
  }
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn-edit-custom";
  edit.dataset.customEdit = c.id;
  edit.title = "Rename / change category";
  edit.setAttribute("aria-label", `Edit layout ${c.name}`);
  edit.textContent = "✎";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn-delete-custom";
  remove.dataset.customDel = c.id;
  remove.title = "Delete";
  remove.setAttribute("aria-label", `Delete layout ${c.name}`);
  remove.textContent = "×";
  label.append(thumb, name, edit, remove);
  return label;
}

function _renderBuiltinCard(name) {
  const meta = (typeof getAssetLayoutMeta === "function") ? getAssetLayoutMeta(name) : null;
  const title = meta?.description ? `${name} - ${meta.description}` : name;
  const cat = (typeof getAssetLayoutCategory === "function") ? getAssetLayoutCategory(name) : "custom";
  const label = document.createElement("label");
  label.className = "gallery-item layout-item";
  label.title = title;
  label.dataset.category = cat;
  label.dataset.search = `${name} ${meta?.description || ""} ${cat}`.toLowerCase();
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.layout = name;
  input.checked = LayoutSelection.has(name);
  const thumb = document.createElement("div");
  thumb.className = "layout-thumb";
  const image = document.createElement("img");
  image.src = getAssetLayoutThumb(name);
  image.alt = name;
  thumb.appendChild(image);
  const text = document.createElement("span");
  text.textContent = name;
  label.append(input, thumb, text);
  return label;
}

function renderLayoutGallery(container) {
  const customs = (typeof getCustomLayouts === "function") ? getCustomLayouts() : [];

  // Bucket customs by their assigned category. Unknown / missing →
  // "custom" bucket which renders in its own dedicated group at the end.
  const customsByCat = {};
  for (const c of customs) {
    const cat = (typeof getCustomCategory === "function") ? getCustomCategory(c) : "custom";
    (customsByCat[cat] = customsByCat[cat] || []).push(c);
  }

  // Render each built-in group, interleaving customs that opted into it.
  const assetLayouts = (typeof assetLayoutIds === "function")
    ? assetLayoutIds()
    : [...ALLOWED_LAYOUTS];
  const assetLayoutsByCat = {};
  for (const id of assetLayouts) {
    const cat = (typeof getAssetLayoutCategory === "function")
      ? getAssetLayoutCategory(id)
      : "custom";
    (assetLayoutsByCat[cat] = assetLayoutsByCat[cat] || []).push(id);
  }

  const renderGroup = (title, names, groupCustoms) => {
    const total = names.length + groupCustoms.length;
    if (!total) return [];
    const head = document.createElement("div");
    head.className = "layout-group-head";
    head.dataset.category = LAYOUT_GROUPS.find(group => group.title === title)?.slug || title.toLowerCase();
    head.innerHTML = `<span>${title}</span><strong>${total}</strong>`;
    const grid = document.createElement("div");
    grid.className = "layout-group-grid";
    grid.append(...names.map(_renderBuiltinCard), ...groupCustoms.map(_renderCustomCard));
    return [head, grid];
  };
  const nodes = LAYOUT_GROUPS.flatMap(group =>
    renderGroup(group.title, assetLayoutsByCat[group.slug] || [], customsByCat[group.slug] || []));

  const knownCats = new Set(LAYOUT_GROUPS.map(g => g.slug));
  const extraCats = new Set([
    ...Object.keys(assetLayoutsByCat),
    ...Object.keys(customsByCat),
  ].filter(cat => !knownCats.has(cat)));
  nodes.push(...[...extraCats].sort().flatMap(cat =>
    renderGroup(cat, assetLayoutsByCat[cat] || [], customsByCat[cat] || [])));
  if (!nodes.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No layout available. Generate an asset pack, then reload the page.";
    nodes.push(empty);
  }
  container.replaceChildren(...nodes);

  container.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", async e => {
      const n = e.target.dataset.layout;
      if (e.target.checked) LayoutSelection.add(n);
      else LayoutSelection.delete(n);
      await persistGallerySelection();
      updateGalleryStats();
    });
  });

  container.querySelectorAll("[data-custom-del]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof deleteCustomLayout === "function") {
        deleteCustomLayout(btn.dataset.customDel);
      }
    });
  });

  container.querySelectorAll("[data-custom-edit]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openEditCustomModal === "function") {
        openEditCustomModal(btn.dataset.customEdit);
      }
    });
  });
  window.renderDataBackupStats?.();
  updateGalleryStats();
  applyGalleryFilters();
}

let galleryFilter = "all";

function activeGalleryPanel() {
  return document.querySelector(".sub-panel.active");
}

function updateGalleryStats() {
  const layoutCards = [...document.querySelectorAll("#layoutGrid .gallery-item")];
  const iconCards = [...document.querySelectorAll("#iconGrid .gallery-item")];
  const countBy = category => layoutCards.filter(card => card.dataset.category === category).length;
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set("galleryCountAll", layoutCards.length);
  set("galleryCountStructural", countBy("structural"));
  set("galleryCountContent", countBy("content"));
  set("galleryCountCustom", layoutCards.filter(card => card.classList.contains("is-custom") || card.dataset.category === "custom").length);
  set("galleryCountIcons", iconCards.length);
}

function setGalleryFilter(nextFilter) {
  galleryFilter = nextFilter || "all";
  document.querySelectorAll("[data-gallery-filter]").forEach(button => {
    const active = button.dataset.galleryFilter === galleryFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (galleryFilter === "icons") activateGalleryTab("panelIcons");
  else activateGalleryTab("panelLayouts");
  applyGalleryFilters();
}

function activateGalleryTab(panelId) {
  const btns = document.querySelectorAll(".sub-tab");
  const panels = document.querySelectorAll(".sub-panel");
  btns.forEach(button => {
    const active = button.dataset.subTab === panelId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  panels.forEach(panel => {
    const active = panel.id === panelId;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function applyGalleryFilters() {
  const term = (document.getElementById("gallerySearch")?.value || "").trim().toLowerCase();
  const panel = activeGalleryPanel();
  if (!panel) return;
  const isIconPanel = panel.id === "panelIcons";
  let visibleCount = 0;
  panel.querySelectorAll(".gallery-item").forEach(card => {
    const matchesSearch = !term || (card.dataset.search || card.textContent || "").toLowerCase().includes(term);
    const matchesFilter = isIconPanel
      ? galleryFilter === "icons"
      : galleryFilter === "all" || galleryFilter === card.dataset.category
        || (galleryFilter === "custom" && card.classList.contains("is-custom"));
    const visible = matchesSearch && matchesFilter;
    card.toggleAttribute("hidden", !visible);
    card.setAttribute("aria-hidden", visible ? "false" : "true");
    if (visible) visibleCount++;
  });
  panel.querySelectorAll(".layout-group-grid").forEach(grid => {
    const visibleCards = [...grid.querySelectorAll(".gallery-item")].filter(card => !card.hidden);
    const visible = visibleCards.length > 0;
    grid.toggleAttribute("hidden", !visible);
    const head = grid.previousElementSibling;
    if (head?.classList?.contains("layout-group-head")) {
      head.toggleAttribute("hidden", !visible);
      const count = head.querySelector("strong");
      if (count) count.textContent = String(visibleCards.length);
    }
  });
  let empty = panel.querySelector(".gallery-empty-results");
  if (!empty) {
    empty = document.createElement("p");
    empty.className = "gallery-empty-results";
    panel.appendChild(empty);
  }
  empty.textContent = isIconPanel ? "No matching icons." : "No matching layouts.";
  empty.toggleAttribute("hidden", visibleCount > 0);
}

function escAttrG(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setupGalleryTabs() {
  const btns = document.querySelectorAll(".sub-tab");
  btns.forEach(b => b.addEventListener("click", () => {
    const filter = b.dataset.subTab === "panelIcons" ? "icons" : "all";
    setGalleryFilter(filter);
  }));
}

function setupGalleryControls() {
  document.getElementById("gallerySearch")?.addEventListener("input", applyGalleryFilters);
  document.querySelectorAll("[data-gallery-filter]").forEach(button => {
    button.addEventListener("click", () => setGalleryFilter(button.dataset.galleryFilter));
  });
}

function setupGalleryBulkActions() {
  document.querySelectorAll("[data-bulk]").forEach(b => {
    b.addEventListener("click", async () => {
      const [scope, action] = b.dataset.bulk.split(":");
      const selection = scope === "icons" ? IconSelection : LayoutSelection;
      const source = scope === "icons" ? currentAllIcons() : currentAllLayouts();
      const container = scope === "icons"
        ? document.getElementById("iconGrid")
        : document.getElementById("layoutGrid");
      if (action === "all") {
        source.forEach(s => selection.add(s));
      } else if (action === "none") {
        selection.clear();
      }
      container.querySelectorAll("input[type=checkbox]").forEach(cb => {
        const stem = cb.dataset.stem || cb.dataset.layout;
        cb.checked = selection.has(stem);
      });
      await persistGallerySelection();
      updateGalleryStats();
    });
  });
}

function initGallery() {
  initSelections();
  renderIconGallery(document.getElementById("iconGrid"));
  renderLayoutGallery(document.getElementById("layoutGrid"));
  setupGalleryTabs();
  setupGalleryControls();
  setupGalleryBulkActions();
  setGalleryFilter("all");
}

// ---- Catalog filtering ---------------------------------------------------
// Rebuild the 3 catalog strings (shown to the layout agent) from selections.

function filteredLogosCatalog() {
  return LOGOS_CATALOG;   // logos aren't filtered in V1 UI
}

// Restricted version of buildCustomCatalogSection that only emits customs
// in the `allowedIds` array. Delegates to the shared renderer.
function buildCustomCatalogSectionFor(allowedFullIds) {
  if (typeof getCustomLayouts !== "function") return "";
  const wanted = new Set(allowedFullIds);
  const list = getCustomLayouts().filter(c => wanted.has("custom:" + c.id));
  if (typeof _renderCustomCatalog !== "function") return "";
  return _renderCustomCatalog(list).replace(/^\n/, "");
}

function filteredIconsCatalog() {
  const allowed = Array.from(IconSelection).sort();
  if (!allowed.length) {
    return "# Icons catalog\n\n**No icons are available.** Do not reference icon names in your output. Leave icon fields empty.\n";
  }

  const assetIds = allowed.filter(s => ALLOWED_ICONS.has(s));
  const lines = [];
  if (typeof buildIconCatalogMarkdown === "function") {
    lines.push(buildIconCatalogMarkdown(assetIds, allowed.length !== currentAllIcons().length));
  } else {
    lines.push("# Icons catalog", "", "**Allowed icon stems:**", "");
    lines.push(...assetIds.map(s => "- `" + s + "`"));
  }

  const customStems = (typeof getCustomIconStems === "function") ? getCustomIconStems() : [];
  const customs = allowed.filter(s => customStems.includes(s));
  if (customs.length) {
    lines.push("", "**Repository custom icons:**", "");
    for (const stem of customs) {
      const icon = (typeof getCustomIconById === "function") ? getCustomIconById(stem) : null;
      const description = icon?.description
        || (typeof customIconDescriptionFallback === "function" ? customIconDescriptionFallback(icon) : icon?.name || stem);
      lines.push(`- \`${stem}\`: ${description}`);
    }
  }
  return lines.join("\n");
}

function filteredLayoutsCatalog() {
  const allowedAssetLayouts = Array.from(LayoutSelection)
    .filter(n => !n.startsWith("custom:"))
    .filter(n => ALLOWED_LAYOUTS.includes(n));
  const allowedLocalLayouts = Array.from(LayoutSelection)
    .filter(n => n.startsWith("custom:"));

  const manifestSection = (typeof buildLayoutCatalogMarkdown === "function")
    ? buildLayoutCatalogMarkdown(allowedAssetLayouts)
    : LAYOUTS_CATALOG;
  const customSection = (typeof buildCustomCatalogSection === "function")
    ? buildCustomCatalogSectionFor(allowedLocalLayouts) : "";

  return [manifestSection, customSection].filter(Boolean).join("\n\n");
}

/**
 * Post-generation enforcement — strip anything the LLM snuck through that
 * the user had disabled. Returns a list of human-readable warnings.
 */
function enforceSelectionOnPlan(plan) {
  const warnings = [];
  const stripIcon = (obj, key, ctx) => {
    if (!obj || !obj[key]) return;
    if (!IconSelection.has(obj[key])) {
      warnings.push(`${ctx}: disabled icon "${obj[key]}" removed`);
      delete obj[key];
    }
  };
  for (let i = 0; i < plan.length; i++) {
    const spec = plan[i];
    const ctx = `slide ${i + 1}`;
    // Disabled layouts are rejected by the contract validator.
    // Icons - every icon* field is cleared if disabled.
    stripIcon(spec, "left_icon",  ctx);
    stripIcon(spec, "right_icon", ctx);
    (spec.cards      || []).forEach((c, j) => stripIcon(c, "icon", `${ctx} card ${j + 1}`));
    (spec.stats      || []).forEach((s, j) => stripIcon(s, "icon", `${ctx} stat ${j + 1}`));
    (spec.quadrants  || []).forEach((z, j) => stripIcon(z, "icon", `${ctx} quad ${j + 1}`));
    (spec.blocks     || []).forEach((b, j) => stripIcon(b, "icon", `${ctx} block ${j + 1}`));
  }
  return warnings;
}
