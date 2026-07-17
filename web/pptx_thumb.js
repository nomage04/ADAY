// pptx_thumb.js — render a schematic preview of a parsed slide or
// SmartArt drawing onto a canvas and return a JPEG data URL.
//
// Goal: give the user a good-enough-at-a-glance representation. We
// draw rectangles for every shape (with their original solid fill if
// known), plot the text flat (Arial, sized proportionally) and embed
// pictures. No gradients, no effects, no real PPT rendering — just
// enough for the gallery tile and the vision agent hint.

const THUMB_W = 480;      // final output width (px)
const _ASPECT = 16 / 9;   // slides are 16:9

/**
 * Render a parsed slide (from pptx_parser.js) into a JPEG data URL.
 */
async function renderSlideThumbnail(slide) {
  const canvas = document.createElement("canvas");
  canvas.width  = THUMB_W;
  canvas.height = Math.round(THUMB_W / _ASPECT);
  const ctx = canvas.getContext("2d");

  // White background by default (PowerPoint slide bg)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const shapes = slide.shapes || [];

  // Sort by area desc so small shapes (text on top of a card) paint
  // above larger ones (background rectangles).
  const sorted = [...shapes].sort((a, b) =>
    (b.w_pct * b.h_pct) - (a.w_pct * a.h_pct));

  for (const s of sorted) {
    await _drawShape(ctx, s, canvas.width, canvas.height);
  }

  return canvas.toDataURL("image/jpeg", 0.88);
}

/**
 * Render a SmartArt drawing (raw drawing*.xml) into a thumbnail.
 * drawingXml is the raw string of `ppt/diagrams/drawingN.xml`.
 */
async function renderSmartArtThumbnail(drawingXml) {
  const canvas = document.createElement("canvas");
  canvas.width  = THUMB_W;
  canvas.height = Math.round(THUMB_W / _ASPECT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!drawingXml) {
    _drawPlaceholder(ctx, canvas.width, canvas.height, "SmartArt (no drawing XML)");
    return canvas.toDataURL("image/jpeg", 0.88);
  }

  const shapes = extractShapesFromDrawingXml(drawingXml);
  // Drawing shapes coordinates are already in EMU relative to the
  // SmartArt bounding box — we rescale to canvas bounds.
  const bbox = _computeBbox(shapes);
  for (const s of shapes) {
    const mapped = {
      ...s,
      x_pct: ((s.x_emu - bbox.x) / bbox.w) * 100,
      y_pct: ((s.y_emu - bbox.y) / bbox.h) * 100,
      w_pct: (s.w_emu / bbox.w) * 100,
      h_pct: (s.h_emu / bbox.h) * 100,
    };
    await _drawShape(ctx, mapped, canvas.width, canvas.height);
  }

  return canvas.toDataURL("image/jpeg", 0.88);
}

/**
 * Parse drawing*.xml and return shape records in EMU. Exported so
 * smart_elements.js can reuse the same data at build time.
 */
function extractShapesFromDrawingXml(drawingXml) {
  const NS_DSP = "http://schemas.microsoft.com/office/drawing/2008/diagram";
  const NS_A   = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const doc = new DOMParser().parseFromString(drawingXml, "application/xml");
  const out = [];
  // <dsp:sp> contain the shapes of a rendered SmartArt.
  const sps = doc.getElementsByTagNameNS(NS_DSP, "sp");
  for (const sp of sps) {
    const spPr = sp.getElementsByTagNameNS(NS_DSP, "spPr")[0];
    if (!spPr) continue;
    const xfrm = spPr.getElementsByTagNameNS(NS_A, "xfrm")[0];
    if (!xfrm) continue;
    const off = xfrm.getElementsByTagNameNS(NS_A, "off")[0];
    const ext = xfrm.getElementsByTagNameNS(NS_A, "ext")[0];
    const x = off ? parseInt(off.getAttribute("x"), 10) || 0 : 0;
    const y = off ? parseInt(off.getAttribute("y"), 10) || 0 : 0;
    const w = ext ? parseInt(ext.getAttribute("cx"), 10) || 0 : 0;
    const h = ext ? parseInt(ext.getAttribute("cy"), 10) || 0 : 0;
    const preset = _presetGeom(spPr);
    const fill   = _solidFillHex(spPr);
    const text   = _runsText(sp);

    // Pick dominant run for text formatting — same strategy as the slide parser.
    const candidates = [
      ...sp.getElementsByTagNameNS(NS_A, "rPr"),
      ...sp.getElementsByTagNameNS(NS_A, "defRPr"),
    ];
    let bestRPr = null, bestSz = 0;
    for (const el of candidates) {
      const sz = parseInt(el.getAttribute("sz"), 10) || 0;
      if (sz >= bestSz) { bestSz = sz; bestRPr = el; }
    }
    if (!bestRPr && candidates.length) bestRPr = candidates[0];

    let textColor = null, bold = false, italic = false, fontFace = null;
    if (bestRPr) {
      bold   = bestRPr.getAttribute("b") === "1" || bestRPr.getAttribute("b") === "true";
      italic = bestRPr.getAttribute("i") === "1" || bestRPr.getAttribute("i") === "true";
      const sf = bestRPr.getElementsByTagNameNS(NS_A, "solidFill")[0];
      if (sf) {
        const srgb = sf.getElementsByTagNameNS(NS_A, "srgbClr")[0];
        if (srgb) textColor = srgb.getAttribute("val");
      }
      const latin = bestRPr.getElementsByTagNameNS(NS_A, "latin")[0];
      if (latin) fontFace = latin.getAttribute("typeface") || null;
    }
    let align = "center";
    const pPr = sp.getElementsByTagNameNS(NS_A, "pPr")[0];
    if (pPr) {
      const algn = pPr.getAttribute("algn");
      align = { l: "left", ctr: "center", r: "right", just: "justify" }[algn] || "center";
    }

    out.push({
      kind: "shape", preset, fill, text,
      fontSize: bestSz, textColor, bold, italic, fontFace, align,
      x_emu: x, y_emu: y, w_emu: w, h_emu: h,
    });
  }
  return out;
}

function _solidFillHex(spPr) {
  const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const sf = spPr.getElementsByTagNameNS(NS_A, "solidFill")[0];
  if (!sf) return null;
  const clr = sf.getElementsByTagNameNS(NS_A, "srgbClr")[0];
  return clr ? "#" + clr.getAttribute("val") : null;
}

function _presetGeom(spPr) {
  const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const pg = spPr.getElementsByTagNameNS(NS_A, "prstGeom")[0];
  return pg ? pg.getAttribute("prst") || "rect" : "rect";
}

function _runsText(el) {
  const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const runs = el.getElementsByTagNameNS(NS_A, "t");
  return Array.from(runs).map(r => r.textContent || "").join(" ").trim();
}

function _computeBbox(shapes) {
  if (!shapes.length) return { x: 0, y: 0, w: 914400 * 10, h: 914400 * 5.6 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    x0 = Math.min(x0, s.x_emu);
    y0 = Math.min(y0, s.y_emu);
    x1 = Math.max(x1, s.x_emu + s.w_emu);
    y1 = Math.max(y1, s.y_emu + s.h_emu);
  }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

async function _drawShape(ctx, s, cw, ch) {
  const x = (s.x_pct / 100) * cw;
  const y = (s.y_pct / 100) * ch;
  const w = (s.w_pct / 100) * cw;
  const h = (s.h_pct / 100) * ch;
  if (w < 1 || h < 1) return;

  if (s.kind === "image" && s.dataUrl) {
    try {
      const img = await _loadImg(s.dataUrl);
      ctx.drawImage(img, x, y, w, h);
    } catch {
      _paintRect(ctx, x, y, w, h, "#e2e8f0");
    }
    return;
  }

  // filled rect for background cards / SmartArt nodes
  if (s.fill) _paintRect(ctx, x, y, w, h, s.fill);
  else        _paintRect(ctx, x, y, w, h, null, "#e2e8f0");

  // preset ellipse?
  if (s.preset === "ellipse" || s.preset === "oval") {
    ctx.save();
    ctx.fillStyle = s.fill || "#94a3b8";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (s.text) {
    const szPt = s.fontSize ? s.fontSize / 100 : 14;
    const scaled = Math.max(8, Math.min(24, Math.round(szPt * (cw / 960))));
    ctx.save();
    ctx.fillStyle = _readableTextColor(s.fill);
    ctx.font = `${scaled}px Arial, sans-serif`;
    ctx.textBaseline = "top";
    _drawTextClamped(ctx, s.text, x + 4, y + 4, w - 8, h - 8, scaled * 1.2);
    ctx.restore();
  }
}

function _paintRect(ctx, x, y, w, h, fill, stroke) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

function _drawTextClamped(ctx, text, x, y, maxW, maxH, lineH) {
  const words = (text || "").split(/\s+/);
  let line = "";
  let cy = y;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    const m = ctx.measureText(test);
    if (m.width > maxW && line) {
      ctx.fillText(line, x, cy);
      cy += lineH;
      if (cy + lineH > y + maxH) { ctx.fillText("…", x, cy); return; }
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line && cy + lineH <= y + maxH) ctx.fillText(line, x, cy);
}

function _readableTextColor(bgHex) {
  if (!bgHex) return "#0f172a";
  const rgb = bgHex.replace("#", "").match(/.{2}/g);
  if (!rgb) return "#0f172a";
  const [r, g, b] = rgb.map(x => parseInt(x, 16));
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#0f172a" : "#ffffff";
}

function _loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function _drawPlaceholder(ctx, w, h, label) {
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "16px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, w / 2, h / 2);
}
