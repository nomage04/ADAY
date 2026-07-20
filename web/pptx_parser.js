// pptx_parser.js — client-side .pptx parser.
// A .pptx is a ZIP of XML parts; we read it with JSZip and walk the
// shape trees with DOMParser. Everything runs 100 % in the browser
// under file:// — no server, no network.
//
// Coordinates inside the XML are in English Metric Units (EMU);
// 914400 EMU = 1 inch. We convert to % of the slide canvas so the
// rest of the app can consume the data regardless of the deck's
// original dimensions.

const EMU_PER_INCH = 914400;
const NS_A   = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P   = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R   = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_DGM = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
const PPTX_MAX_FILE_BYTES = 50 * 1024 * 1024;
const PPTX_MAX_SLIDES = 100;
const PPTX_MAX_ENTRIES = 2000;
const PPTX_MAX_EXPANDED_BYTES = 250 * 1024 * 1024;
const PPTX_MAX_XML_BYTES = 10 * 1024 * 1024;
const PPTX_MAX_MEDIA_BYTES = 25 * 1024 * 1024;

function _consumePptxBudget(zip, path, bytes, entryLimit) {
  const budget = zip.__pptgenBudget;
  if (!budget) return;
  if (bytes > entryLimit) throw new Error(`${path} exceeds the ${Math.round(entryLimit / 1024 / 1024)} MB limit`);
  if (budget.entries.has(path)) return;
  budget.entries.set(path, bytes);
  budget.expandedBytes += bytes;
  if (budget.expandedBytes > PPTX_MAX_EXPANDED_BYTES) {
    throw new Error("PPTX rejected: cumulative uncompressed content > 250 MB");
  }
}

/**
 * Parse a .pptx File (or Blob). Returns a structured snapshot the rest
 * of the app can consume without knowing anything about OOXML.
 */
async function parsePptxFile(file) {
  if (typeof JSZip === "undefined") throw new Error("JSZip non chargé (lib/jszip.min.js manquant ?)");
  if (Number.isFinite(file?.size) && file.size > PPTX_MAX_FILE_BYTES) {
    throw new Error("PPTX rejected: compressed file > 50 MB");
  }
  const zip = await JSZip.loadAsync(file);
  const entryNames = Object.keys(zip.files);
  if (entryNames.length > PPTX_MAX_ENTRIES) throw new Error(`PPTX rejected: more than ${PPTX_MAX_ENTRIES} ZIP entries`);
  Object.defineProperty(zip, "__pptgenBudget", {
    value: { expandedBytes: 0, entries: new Map() }, configurable: true,
  });
  const slidePaths = entryNames
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => _extractIndex(a) - _extractIndex(b));
  if (slidePaths.length > PPTX_MAX_SLIDES) throw new Error(`PPTX rejected: more than ${PPTX_MAX_SLIDES} slides`);

  // Slide canvas size (default 16:9 standard)
  const presXml = await _readXmlFromZip(zip, "ppt/presentation.xml");
  let slideWidthEmu  = 12192000;     // 13.333 in
  let slideHeightEmu = 6858000;      //  7.5   in
  if (presXml) {
    const sz = presXml.querySelector("sldSz");
    if (sz) {
      slideWidthEmu  = parseInt(sz.getAttribute("cx"), 10) || slideWidthEmu;
      slideHeightEmu = parseInt(sz.getAttribute("cy"), 10) || slideHeightEmu;
    }
  }

  // Theme (fonts + color scheme) — needed to resolve `+mj-lt` / `+mn-lt`
  // fontFace references and `<a:schemeClr val="...">` color references
  // on text runs. Without this the vast majority of slides lose their
  // typography because they inherit it from the theme, not inline.
  const theme = await _readTheme(zip);

  // Collect all slide XMLs (order matters)
  // Preload all media files as data URLs (images referenced from slides)
  const images = await _loadAllMedia(zip);

  const slides = [];
  const smartArts = [];

  for (const path of slidePaths) {
    const idx = _extractIndex(path);
    const xml = await _readXmlFromZip(zip, path);
    if (!xml) continue;

    // Load this slide's relationships file to map rId → image path
    const relsPath = path.replace("slides/", "slides/_rels/") + ".rels";
    const rels = await _readRelsFile(zip, relsPath);

    const shapes = _extractShapes(xml, rels, images, slideWidthEmu, slideHeightEmu, theme);

    // Find SmartArt occurrences (graphicFrame with dgm data)
    const frames = xml.getElementsByTagNameNS(NS_P, "graphicFrame");
    for (const gf of frames) {
      const relIdEl = gf.getElementsByTagNameNS(NS_DGM, "relIds")[0];
      if (!relIdEl) continue;
      const dmRid = relIdEl.getAttributeNS(NS_R, "dm");
      const loRid = relIdEl.getAttributeNS(NS_R, "lo");
      const qsRid = relIdEl.getAttributeNS(NS_R, "qs");
      const csRid = relIdEl.getAttributeNS(NS_R, "cs");
      const dataTarget = rels[dmRid];
      const layoutTarget = rels[loRid];
      if (!dataTarget) continue;

      const diagramDataPath = _resolvePath("ppt/slides/", dataTarget);
      const diagramLayoutPath = layoutTarget ? _resolvePath("ppt/slides/", layoutTarget) : null;

      // The rendered shapes live in diagrams/drawing*.xml, referenced by
      // diagrams/data*.xml relationships. Fall back to a direct lookup.
      const dataRelsPath = diagramDataPath.replace(/([^/]+)$/, "_rels/$1.rels");
      const dataRels = await _readRelsFile(zip, dataRelsPath);
      let drawingPath = null;
      for (const [, target] of Object.entries(dataRels)) {
        if (/drawing/.test(target)) {
          drawingPath = _resolvePath(diagramDataPath.replace(/[^/]+$/, ""), target);
          break;
        }
      }

      // frame position (for thumbnail placement if needed)
      const xfrm = gf.getElementsByTagNameNS(NS_P, "xfrm")[0]
                   || gf.getElementsByTagNameNS(NS_A, "xfrm")[0];
      const pos = _xfrmToPct(xfrm, slideWidthEmu, slideHeightEmu);

      smartArts.push({
        slideIndex: idx,
        dataXml: await _readRawFromZip(zip, diagramDataPath),
        layoutXml: diagramLayoutPath ? await _readRawFromZip(zip, diagramLayoutPath) : null,
        drawingXml: drawingPath ? await _readRawFromZip(zip, drawingPath) : null,
        position: pos,
      });
    }

    // Attach each smart frame in this slide to its resolved drawingXml,
    // matched by order of appearance (graphicFrame iteration above uses
    // the same doc order as the `sp`/`pic`/`graphicFrame` walk in
    // _extractShapes).
    const slideSmarts = smartArts.filter(sa => sa.slideIndex === idx);
    let smartCounter = 0;
    for (const sh of shapes) {
      if (sh.kind === "smart") {
        const match = slideSmarts[smartCounter++];
        if (match) sh.drawingXml = match.drawingXml;
      }
    }

    slides.push({
      index: idx,
      xmlPath: path,
      shapes,
      widthEmu: slideWidthEmu,
      heightEmu: slideHeightEmu,
    });
  }

  return { slides, smartArts, images, slideWidthEmu, slideHeightEmu };
}

// ---- helpers ----------------------------------------------------------

function _extractIndex(path) {
  const m = path.match(/slide(\d+)\.xml/);
  return m ? parseInt(m[1], 10) : 0;
}

async function _readRawFromZip(zip, path) {
  if (!path || !zip.files[path]) return null;
  const text = await zip.file(path).async("string");
  const bytes = typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(text).byteLength : text.length * 2;
  _consumePptxBudget(zip, path, bytes, PPTX_MAX_XML_BYTES);
  return text;
}

async function _readXmlFromZip(zip, path) {
  const text = await _readRawFromZip(zip, path);
  if (!text) return null;
  return new DOMParser().parseFromString(text, "application/xml");
}

async function _readRelsFile(zip, path) {
  const doc = await _readXmlFromZip(zip, path);
  if (!doc) return {};
  const map = {};
  for (const r of doc.getElementsByTagName("Relationship")) {
    map[r.getAttribute("Id")] = r.getAttribute("Target");
  }
  return map;
}

async function _loadAllMedia(zip) {
  const map = {};
  const names = Object.keys(zip.files).filter(p => /^ppt\/media\//.test(p));
  for (const name of names) {
    try {
      const bytes = await zip.file(name).async("uint8array");
      _consumePptxBudget(zip, name, bytes.byteLength, PPTX_MAX_MEDIA_BYTES);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const blob = btoa(binary);
      const ext  = name.split(".").pop().toLowerCase();
      const mime = ext === "png"  ? "image/png"
                 : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
                 : ext === "gif"  ? "image/gif"
                 : ext === "webp" ? "image/webp"
                 : "application/octet-stream";
      map[name] = `data:${mime};base64,${blob}`;
    } catch (error) {
      if (/limit|PPTX rejected/i.test(error?.message || "")) throw error;
      console.warn(`Unreadable PPTX media skipped: ${name}`);
    }
  }
  return map;
}

/**
 * Resolve a relative rels Target into its absolute zip path.
 * E.g. baseDir="ppt/slides/", target="../media/image1.png" → "ppt/media/image1.png"
 */
function _resolvePath(baseDir, target) {
  if (/^\//.test(target)) return target.slice(1);
  const parts = (baseDir + target).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function _xfrmToPct(xfrm, totalW, totalH) {
  if (!xfrm) return { x_pct: 0, y_pct: 0, w_pct: 0, h_pct: 0 };
  const off = xfrm.getElementsByTagNameNS(NS_A, "off")[0];
  const ext = xfrm.getElementsByTagNameNS(NS_A, "ext")[0];
  const x = off ? parseInt(off.getAttribute("x"), 10) || 0 : 0;
  const y = off ? parseInt(off.getAttribute("y"), 10) || 0 : 0;
  const w = ext ? parseInt(ext.getAttribute("cx"), 10) || 0 : 0;
  const h = ext ? parseInt(ext.getAttribute("cy"), 10) || 0 : 0;
  return {
    x_pct: (x / totalW) * 100,
    y_pct: (y / totalH) * 100,
    w_pct: (w / totalW) * 100,
    h_pct: (h / totalH) * 100,
  };
}

/**
 * Walk a slide's spTree and return an array of shape records.
 * Types returned:
 *   - "text"   : a <p:sp> with a <p:txBody>
 *   - "shape"  : a <p:sp> without text (used for background rects)
 *   - "image"  : a <p:pic>
 *   - "smart"  : a <p:graphicFrame> that hosts a SmartArt
 *
 * Walks <p:grpSp> groups recursively and composes their <a:xfrm> with
 * <a:chOff>/<a:chExt> so children drawn in local coordinates end up at
 * the correct absolute slide position. Without this, hand-drawn shape
 * groups (circles+labels, badges, …) are placed wrong or stacked at
 * (0,0) and look invisible.
 */
function _extractShapes(slideDoc, rels, images, totalW, totalH, theme) {
  const out = [];
  const spTree = slideDoc.getElementsByTagNameNS(NS_P, "spTree")[0];
  if (!spTree) return out;
  _walkShapeTree(spTree, null, out, rels, images, totalW, totalH, theme);
  return out;
}

function _walkShapeTree(node, xform, out, rels, images, totalW, totalH, theme) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1 || child.namespaceURI !== NS_P) continue;
    const tag = child.localName;
    if (tag === "grpSp") {
      const grpSpPr = _directChild(child, NS_P, "grpSpPr");
      const composed = _composeGroupXform(grpSpPr, xform);
      _walkShapeTree(child, composed, out, rels, images, totalW, totalH, theme);
    } else if (tag === "sp") {
      _emitSp(child, xform, out, totalW, totalH, theme);
    } else if (tag === "pic") {
      _emitPic(child, xform, out, rels, images, totalW, totalH);
    } else if (tag === "graphicFrame") {
      _emitGraphicFrame(child, xform, out, totalW, totalH);
    }
  }
}

function _emitSp(sp, xform, out, totalW, totalH, theme) {
  const spPr = _directChild(sp, NS_P, "spPr");
  if (!spPr) return;
  const xfrm = _directChild(spPr, NS_A, "xfrm");
  const abs = _applyXform(xfrm, xform);
  const pos = _emuToPct(abs, totalW, totalH);
  const fill = _solidFillHex(spPr) || _schemeFillHex(spPr, theme);
  const preset = _presetGeom(spPr);
  const text = _extractText(sp);
  const largestSz = _largestRunSize(sp);
  const style = _extractTextStyle(sp, theme);

  out.push({
    kind: text ? "text" : "shape",
    ...pos,
    fill, preset, text,
    fontSize: largestSz,
    textColor: style.textColor,
    bold:      style.bold,
    italic:    style.italic,
    fontFace:  style.fontFace,
    align:     style.align,
    name: _shapeName(sp),
  });
}

function _emitPic(pic, xform, out, rels, images, totalW, totalH) {
  const spPr = _directChild(pic, NS_P, "spPr");
  const xfrm = spPr ? _directChild(spPr, NS_A, "xfrm") : null;
  const abs = _applyXform(xfrm, xform);
  const pos = _emuToPct(abs, totalW, totalH);
  const blip = pic.getElementsByTagNameNS(NS_A, "blip")[0];
  let dataUrl = null;
  if (blip) {
    const rid = blip.getAttributeNS(NS_R, "embed");
    const target = rels[rid];
    if (target) {
      const mediaPath = _resolvePath("ppt/slides/", target);
      dataUrl = images[mediaPath] || null;
    }
  }
  out.push({ kind: "image", ...pos, dataUrl, name: _shapeName(pic) });
}

function _emitGraphicFrame(gf, xform, out, totalW, totalH) {
  const relIdEl = gf.getElementsByTagNameNS(NS_DGM, "relIds")[0];
  if (!relIdEl) return;
  const xfrm = _directChild(gf, NS_P, "xfrm") || _directChild(gf, NS_A, "xfrm");
  const abs = _applyXform(xfrm, xform);
  const pos = _emuToPct(abs, totalW, totalH);
  out.push({ kind: "smart", ...pos, name: _shapeName(gf) });
}

function _directChild(el, ns, local) {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === local) return c;
  }
  return null;
}

function _applyXform(xfrm, xform) {
  if (!xfrm) return { x: 0, y: 0, w: 0, h: 0 };
  const off = _directChild(xfrm, NS_A, "off");
  const ext = _directChild(xfrm, NS_A, "ext");
  const x = off ? parseInt(off.getAttribute("x"), 10) || 0 : 0;
  const y = off ? parseInt(off.getAttribute("y"), 10) || 0 : 0;
  const w = ext ? parseInt(ext.getAttribute("cx"), 10) || 0 : 0;
  const h = ext ? parseInt(ext.getAttribute("cy"), 10) || 0 : 0;
  if (!xform) return { x, y, w, h };
  return {
    x: xform.offX + (x - xform.chOffX) * xform.scaleX,
    y: xform.offY + (y - xform.chOffY) * xform.scaleY,
    w: w * xform.scaleX,
    h: h * xform.scaleY,
  };
}

function _composeGroupXform(grpSpPr, parent) {
  if (!grpSpPr) return parent;
  const xf = _directChild(grpSpPr, NS_A, "xfrm");
  if (!xf) return parent;
  const off = _directChild(xf, NS_A, "off");
  const ext = _directChild(xf, NS_A, "ext");
  const chOff = _directChild(xf, NS_A, "chOff");
  const chExt = _directChild(xf, NS_A, "chExt");
  const offX   = off   ? parseInt(off.getAttribute("x"),  10) || 0 : 0;
  const offY   = off   ? parseInt(off.getAttribute("y"),  10) || 0 : 0;
  const extX   = ext   ? parseInt(ext.getAttribute("cx"), 10) || 0 : 0;
  const extY   = ext   ? parseInt(ext.getAttribute("cy"), 10) || 0 : 0;
  const chOffX = chOff ? parseInt(chOff.getAttribute("x"), 10) || 0 : 0;
  const chOffY = chOff ? parseInt(chOff.getAttribute("y"), 10) || 0 : 0;
  const chExtX = chExt ? parseInt(chExt.getAttribute("cx"), 10) || 1 : 1;
  const chExtY = chExt ? parseInt(chExt.getAttribute("cy"), 10) || 1 : 1;
  const scaleX = chExtX ? extX / chExtX : 1;
  const scaleY = chExtY ? extY / chExtY : 1;
  if (!parent) {
    return { offX, offY, chOffX, chOffY, scaleX, scaleY };
  }
  // Compose this group on top of an outer group: project this group's
  // own offset through the parent's xform first, then use local chOff
  // and combined scale for the children.
  return {
    offX:   parent.offX + (offX - parent.chOffX) * parent.scaleX,
    offY:   parent.offY + (offY - parent.chOffY) * parent.scaleY,
    chOffX,
    chOffY,
    scaleX: parent.scaleX * scaleX,
    scaleY: parent.scaleY * scaleY,
  };
}

function _emuToPct(abs, totalW, totalH) {
  return {
    x_pct: (abs.x / totalW) * 100,
    y_pct: (abs.y / totalH) * 100,
    w_pct: (abs.w / totalW) * 100,
    h_pct: (abs.h / totalH) * 100,
  };
}

function _extractText(sp) {
  const runs = sp.getElementsByTagNameNS(NS_A, "t");
  if (!runs.length) return "";
  return Array.from(runs).map(r => r.textContent || "").join(" ").trim();
}

function _largestRunSize(sp) {
  let best = 0;
  // Check both inline run properties (<a:rPr>) and paragraph-level
  // default run properties (<a:defRPr>). Many authored decks only set
  // font size on defRPr so relying on rPr alone misses most shapes.
  for (const el of [
    ...sp.getElementsByTagNameNS(NS_A, "rPr"),
    ...sp.getElementsByTagNameNS(NS_A, "defRPr"),
  ]) {
    const sz = parseInt(el.getAttribute("sz"), 10);
    if (sz && sz > best) best = sz;
  }
  return best;
}

/**
 * Read formatting from the "dominant" run of a shape — taken as the run
 * with the largest `sz`. Falls back to the first run if none carries a
 * size. Returns a style object (hex without '#') safe for storage.
 *
 * When a theme is provided, references are resolved:
 *   - `<a:latin typeface="+mj-lt">` → theme.majorFont
 *   - `<a:latin typeface="+mn-lt">` → theme.minorFont
 *   - `<a:schemeClr val="accent1">` → theme.colors.accent1
 */
function _extractTextStyle(sp, theme) {
  // Consider both <a:rPr> (inline runs) and <a:defRPr> (paragraph defaults).
  // Pick the element with the largest explicit `sz` as the "dominant" source.
  const candidates = [
    ...sp.getElementsByTagNameNS(NS_A, "rPr"),
    ...sp.getElementsByTagNameNS(NS_A, "defRPr"),
  ];
  let best = null, bestSz = 0;
  for (const el of candidates) {
    const sz = parseInt(el.getAttribute("sz"), 10) || 0;
    if (sz >= bestSz) { bestSz = sz; best = el; }
  }
  if (!best && candidates.length) best = candidates[0];

  let textColor = null, bold = false, italic = false, fontFace = null;
  if (best) {
    const b = best.getAttribute("b");
    const i = best.getAttribute("i");
    bold   = b === "1" || b === "true";
    italic = i === "1" || i === "true";
    textColor = _resolveRunColor(best, theme);
    fontFace  = _resolveRunFont(best, theme);
  }

  // Still no font? Fall back to the theme's minor font — that's what
  // PowerPoint would do for body text that doesn't override the face.
  if (!fontFace && theme?.minorFont) fontFace = theme.minorFont;

  // Alignment is on <a:pPr>, not <a:rPr>. Take the first paragraph.
  let align = "left";
  const pPr = sp.getElementsByTagNameNS(NS_A, "pPr")[0];
  if (pPr) {
    const algn = pPr.getAttribute("algn");
    align = { l: "left", ctr: "center", r: "right", just: "justify" }[algn] || "left";
  }

  return { textColor, bold, italic, fontFace, align };
}

function _resolveRunColor(rPr, theme) {
  const sf = rPr.getElementsByTagNameNS(NS_A, "solidFill")[0];
  if (!sf) return null;
  const srgb = sf.getElementsByTagNameNS(NS_A, "srgbClr")[0];
  if (srgb) return srgb.getAttribute("val");
  const sys = sf.getElementsByTagNameNS(NS_A, "sysClr")[0];
  if (sys) return sys.getAttribute("lastClr") || null;
  const sch = sf.getElementsByTagNameNS(NS_A, "schemeClr")[0];
  if (sch && theme) return _resolveSchemeColor(sch.getAttribute("val"), theme);
  return null;
}

function _resolveRunFont(rPr, theme) {
  const latin = rPr.getElementsByTagNameNS(NS_A, "latin")[0];
  if (!latin) return null;
  const tf = latin.getAttribute("typeface") || null;
  if (!tf) return null;
  if (tf === "+mj-lt" && theme?.majorFont) return theme.majorFont;
  if (tf === "+mn-lt" && theme?.minorFont) return theme.minorFont;
  return tf;
}

// Fallback: some shapes reference scheme colors in spPr too
// (e.g. colored cards whose fill is <a:schemeClr val="accent1">).
function _schemeFillHex(spPr, theme) {
  if (!theme) return null;
  const sf = spPr.getElementsByTagNameNS(NS_A, "solidFill")[0];
  if (!sf) return null;
  const sch = sf.getElementsByTagNameNS(NS_A, "schemeClr")[0];
  if (!sch) return null;
  const hex = _resolveSchemeColor(sch.getAttribute("val"), theme);
  return hex ? "#" + hex : null;
}

function _resolveSchemeColor(val, theme) {
  if (!val || !theme?.colors) return null;
  // OOXML aliases: tx1/bg1/tx2/bg2 map to dk1/lt1/dk2/lt2 in clrScheme.
  const alias = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
  const key = alias[val] || val;
  return theme.colors[key] || null;
}

async function _readTheme(zip) {
  const paths = Object.keys(zip.files)
    .filter(p => /^ppt\/theme\/theme\d+\.xml$/.test(p))
    .sort();
  if (!paths.length) return null;
  const xml = await _readXmlFromZip(zip, paths[0]);
  if (!xml) return null;

  const colors = {};
  const clrScheme = xml.getElementsByTagNameNS(NS_A, "clrScheme")[0];
  if (clrScheme) {
    const names = ["dk1", "lt1", "dk2", "lt2",
                   "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
                   "hlink", "folHlink"];
    for (const name of names) {
      const el = clrScheme.getElementsByTagNameNS(NS_A, name)[0];
      if (!el) continue;
      const srgb = el.getElementsByTagNameNS(NS_A, "srgbClr")[0];
      const sys  = el.getElementsByTagNameNS(NS_A, "sysClr")[0];
      if (srgb) colors[name] = srgb.getAttribute("val");
      else if (sys) colors[name] = sys.getAttribute("lastClr") || null;
    }
  }

  let majorFont = null, minorFont = null;
  const fontScheme = xml.getElementsByTagNameNS(NS_A, "fontScheme")[0];
  if (fontScheme) {
    const major = fontScheme.getElementsByTagNameNS(NS_A, "majorFont")[0];
    const minor = fontScheme.getElementsByTagNameNS(NS_A, "minorFont")[0];
    if (major) {
      const latin = major.getElementsByTagNameNS(NS_A, "latin")[0];
      if (latin) majorFont = latin.getAttribute("typeface") || null;
    }
    if (minor) {
      const latin = minor.getElementsByTagNameNS(NS_A, "latin")[0];
      if (latin) minorFont = latin.getAttribute("typeface") || null;
    }
  }

  return { colors, majorFont, minorFont };
}

function _solidFillHex(spPr) {
  const sf = spPr.getElementsByTagNameNS(NS_A, "solidFill")[0];
  if (!sf) return null;
  const clr = sf.getElementsByTagNameNS(NS_A, "srgbClr")[0];
  return clr ? "#" + clr.getAttribute("val") : null;
}

function _presetGeom(spPr) {
  const pg = spPr.getElementsByTagNameNS(NS_A, "prstGeom")[0];
  return pg ? pg.getAttribute("prst") || "rect" : "rect";
}

function _shapeName(el) {
  const nv = el.getElementsByTagNameNS(NS_P, "cNvPr")[0];
  return nv ? nv.getAttribute("name") || "" : "";
}
