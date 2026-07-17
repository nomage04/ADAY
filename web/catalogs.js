// Runtime catalogs generated from the optional asset pack manifest.
//
// asset_pack.generated.js should define:
//   window.PPT_ASSET_PACK = {
//     version, name,
//     iconOrder: ["chart", ...], logoOrder: ["react", ...],
//     layoutOrder: ["title", ...],
//     icons: { chart: { id, name, description, tags, dataUrl } },
//     logos: { react: { id, name, dataUrl } },
//     layouts: { title: { id, name, category, description, renderer, schema, ... } }
//   };
//
// When no pack is loaded, icons/layouts are intentionally empty. That makes
// the folder/manifest the single source of truth.

const _EMPTY_PACK = {
  version: 2,
  name: "Empty asset pack",
  iconOrder: [],
  logoOrder: [],
  layoutOrder: [],
  icons: {},
  logos: {},
  layouts: {},
};

const ASSET_PACK = (() => {
  const raw = window.PPT_ASSET_PACK || _EMPTY_PACK;
  const icons = raw.icons && typeof raw.icons === "object" ? raw.icons : {};
  const logos = raw.logos && typeof raw.logos === "object" ? raw.logos : {};
  const layouts = raw.layouts && typeof raw.layouts === "object" ? raw.layouts : {};
  return {
    version: raw.version || 1,
    name: raw.name || _EMPTY_PACK.name,
    iconOrder: Array.isArray(raw.iconOrder) ? raw.iconOrder : Object.keys(icons),
    logoOrder: Array.isArray(raw.logoOrder) ? raw.logoOrder : Object.keys(logos),
    layoutOrder: Array.isArray(raw.layoutOrder) ? raw.layoutOrder : Object.keys(layouts),
    icons,
    logos,
    layouts,
  };
})();

function _orderedExisting(order, dict) {
  const seen = new Set();
  const out = [];
  for (const id of order || []) {
    if (!id || seen.has(id) || !dict[id]) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of Object.keys(dict).sort()) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

function assetIconIds() {
  return _orderedExisting(ASSET_PACK.iconOrder, ASSET_PACK.icons);
}

function assetLayoutIds() {
  return _orderedExisting(ASSET_PACK.layoutOrder, ASSET_PACK.layouts);
}

function assetLogoIds() {
  return _orderedExisting(ASSET_PACK.logoOrder, ASSET_PACK.logos);
}

function getAssetIconMeta(id) {
  return ASSET_PACK.icons[id] || null;
}

function getAssetIconDataUrl(id) {
  return getAssetIconMeta(id)?.dataUrl || null;
}

function getAssetLogoMeta(id) {
  return ASSET_PACK.logos[id] || null;
}

function getAssetLogoDataUrl(id) {
  return getAssetLogoMeta(id)?.dataUrl || null;
}

function getAssetLayoutMeta(id) {
  return ASSET_PACK.layouts[id] || null;
}

function getAssetLayoutThumb(id) {
  return getAssetLayoutMeta(id)?.thumbDataUrl || null;
}

function getAssetLayoutCategory(id) {
  return getAssetLayoutMeta(id)?.category || "custom";
}

function isAssetCustomLayout(id) {
  return getAssetLayoutMeta(id)?.renderer?.type === "custom";
}

function isAssetStructuralLayout(id) {
  const meta = getAssetLayoutMeta(id);
  return !!(meta && meta.category === "structural");
}

function isAssetStructuralRoleLayout(id, role) {
  const meta = getAssetLayoutMeta(id);
  if (!meta || meta.category !== "structural") return false;
  return meta.structural_role === role || id === role;
}

function pickActiveStructuralAsset(role) {
  const matches = assetLayoutIds()
    .map(id => getAssetLayoutMeta(id))
    .filter(meta => meta && meta.category === "structural")
    .filter(meta => meta.structural_role === role || meta.id === role)
    .filter(meta => typeof LayoutSelection === "undefined" || LayoutSelection.has(meta.id));
  return matches[0] || null;
}

function _schemaText(schema) {
  if (!schema) return "{}";
  if (typeof schema === "string") return schema;
  try { return JSON.stringify(schema); }
  catch { return String(schema); }
}

function _categoryTitle(slug) {
  return ({
    structural: "Structural",
    content: "Content",
    smartart: "SmartArt",
    image: "Image-aware",
    custom: "Custom",
  })[slug] || slug.charAt(0).toUpperCase() + slug.slice(1);
}

function buildIconCatalogMarkdown(ids = assetIconIds(), filtered = false) {
  const list = ids.map(id => getAssetIconMeta(id)).filter(Boolean);
  if (!list.length) {
    return [
      "# Icons catalog",
      "",
      "**No icons are available.** Do not reference icon names in your output. Leave icon fields empty.",
      "",
    ].join("\n");
  }

  const lines = [
    filtered ? "# Icons catalog (STRICTLY FILTERED by user)" : "# Icons catalog",
    "",
    filtered
      ? "**Allowed icon stems - no other stem may appear in your output:**"
      : "**Available icon stems with descriptions:**",
    "",
  ];
  for (const icon of list) {
    const desc = icon.description || icon.name || icon.id;
    const tags = Array.isArray(icon.tags) && icon.tags.length
      ? ` Tags: ${icon.tags.join(", ")}.`
      : "";
    lines.push(`- \`${icon.id}\`: ${desc}.${tags}`);
  }
  if (filtered) {
    lines.push("", "Any icon not in this list is forbidden. Leave icon fields empty rather than using a disallowed one.");
  }
  return lines.join("\n");
}

function buildLayoutCatalogMarkdown(ids = assetLayoutIds()) {
  const metas = ids.map(id => getAssetLayoutMeta(id)).filter(Boolean);
  const lines = [
    `# Layouts catalog (${metas.length} available)`,
    "",
    "**You may ONLY use layouts from this list.** Layouts that aren't here do not exist for this run - do not mention or use them.",
    "",
    "Contract enforced by build_deck:",
    "- `cards` capped at 2/deck when available",
    "- no layout > 40% on decks with >= 7 content slides",
    "- >= 3 distinct layouts on decks with >= 5 content slides",
    "- no two consecutive content slides with the same layout",
    "",
  ];

  if (!metas.length) {
    lines.push("- (no layouts enabled - please generate/load an asset pack)");
    return lines.join("\n");
  }

  const byCat = new Map();
  for (const meta of metas) {
    const cat = meta.category || "custom";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(meta);
  }
  const order = ["structural", "content", "smartart", "image", "custom"];
  for (const cat of [...order, ...[...byCat.keys()].filter(c => !order.includes(c)).sort()]) {
    const group = byCat.get(cat);
    if (!group?.length) continue;
    lines.push("", `## ${_categoryTitle(cat)} (${group.length})`, "");
    for (const meta of group) {
      const schema = _schemaText(meta.schema);
      const desc = meta.description || meta.name || meta.id;
      lines.push(`- \`${meta.id}\`: \`${schema}\` - ${desc}`);
      if (meta.renderer?.type === "custom" && Array.isArray(meta.zones)) {
        lines.push("  - `zones` must contain every zone listed below.");
        for (const z of meta.zones) {
          const example =
            z.type === "bullets" ? '["item 1", "item 2", ...]'
          : z.type === "kpi"     ? '"42%\\nKey metric"'
          : z.type === "image"   ? '"photo:<id>"'
          : '"text content"';
          const pos = `x:${Math.round(z.x_pct)}% y:${Math.round(z.y_pct)}% ${Math.round(z.w_pct)}x${Math.round(z.h_pct)}%`;
          lines.push(`    - \`${z.label}\` (${z.type}) [${pos}] -> ${example}`);
        }
      }
    }
  }
  return lines.join("\n");
}

const ALLOWED_LAYOUTS = assetLayoutIds();
const ALLOWED_ICONS = new Set(assetIconIds());
const LAYOUTS_CATALOG = buildLayoutCatalogMarkdown(ALLOWED_LAYOUTS);
const ICONS_CATALOG = buildIconCatalogMarkdown(assetIconIds());

function buildLogoCatalogMarkdown(ids = assetLogoIds()) {
  const logos = ids.map(id => getAssetLogoMeta(id)).filter(Boolean);
  return [
    `# Logos catalog (${logos.length} available)`,
    "",
    "Reference logos by stem. Only the following stems are available:",
    "",
    ...logos.map(logo => `- \`${logo.id}\`: ${logo.name || logo.id}`),
  ].join("\n");
}

const ALLOWED_LOGOS = new Set(assetLogoIds());
const LOGOS_CATALOG = buildLogoCatalogMarkdown(assetLogoIds());

function _assetPackProblems() {
  const problems = [];
  if (!window.PPT_ASSET_PACK) problems.push("asset_pack.generated.js est absent");
  if (ASSET_PACK.version < 2) problems.push("version de pack incompatible");
  if (assetLayoutIds().length === 0) problems.push("aucun layout intégré");
  if (assetIconIds().length === 0) problems.push("aucune icône intégrée");
  if (assetLogoIds().length === 0) problems.push("aucun logo intégré");
  for (const id of assetLayoutIds()) {
    const meta = getAssetLayoutMeta(id);
    if (meta?.renderer?.type === "registered" && meta.renderer.name !== id) {
      problems.push(`renderer invalide pour ${id}`);
    }
  }
  return problems;
}

function showAssetPackFatal(problems) {
  const panel = document.createElement("section");
  panel.className = "asset-pack-fatal";
  panel.setAttribute("role", "alert");
  const title = document.createElement("h1");
  title.textContent = "Pack d’assets indisponible";
  const details = document.createElement("p");
  details.textContent = problems.join(" · ");
  const help = document.createElement("p");
  help.textContent = "Régénérez le pack avec npm run build:assets puis rechargez index.html.";
  panel.append(title, details, help);
  document.body.replaceChildren(panel);
}

const ASSET_PACK_PROBLEMS = _assetPackProblems();
if (ASSET_PACK_PROBLEMS.length) showAssetPackFatal(ASSET_PACK_PROBLEMS);

window.ASSET_PACK = ASSET_PACK;
window.getAssetIconMeta = getAssetIconMeta;
window.getAssetIconDataUrl = getAssetIconDataUrl;
window.getAssetLogoMeta = getAssetLogoMeta;
window.getAssetLogoDataUrl = getAssetLogoDataUrl;
window.getAssetLayoutMeta = getAssetLayoutMeta;
window.getAssetLayoutThumb = getAssetLayoutThumb;
window.isAssetCustomLayout = isAssetCustomLayout;
window.isAssetStructuralLayout = isAssetStructuralLayout;
window.isAssetStructuralRoleLayout = isAssetStructuralRoleLayout;
window.pickActiveStructuralAsset = pickActiveStructuralAsset;
window.buildIconCatalogMarkdown = buildIconCatalogMarkdown;
window.buildLayoutCatalogMarkdown = buildLayoutCatalogMarkdown;
window.buildLogoCatalogMarkdown = buildLogoCatalogMarkdown;
