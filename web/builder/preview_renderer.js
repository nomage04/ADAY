// preview_renderer -- live SVG preview for the same layout renderers used by
// build_deck.js. It records pptxgen-style drawing calls and replays them into
// an SVG slide surface for the Studio preview panel.

(function () {
  const PPTGen = window.PPTGen = window.PPTGen || {};
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";
  const DEFAULT_FONT = "Calibri, Arial, sans-serif";

  function svgEl(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    }
    return node;
  }

  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeHex(value, fallback = "none") {
    if (!value) return fallback;
    const raw = String(value).trim();
    if (!raw) return fallback;
    if (raw === "none" || raw === "transparent") return raw;
    if (raw.startsWith("#")) return raw;
    if (/^[0-9a-f]{3,8}$/i.test(raw)) return `#${raw.slice(0, 6)}`;
    return raw;
  }

  function lineStyle(line = {}) {
    if (!line || line.type === "none") return { stroke: "none", width: 0 };
    return {
      stroke: normalizeHex(line.color || "999999"),
      width: Math.max(0.005, toNumber(line.width, 0.5) / 72),
    };
  }

  function ptToSlideUnits(pt, fallback = 14) {
    return Math.max(0.06, toNumber(pt, fallback) / 72);
  }

  function createRecorder() {
    const ops = [];
    const slide = {
      addShape(kind, opts = {}) {
        ops.push({ type: "shape", kind: String(kind || "rect"), opts: { ...opts } });
      },
      addText(text, opts = {}) {
        ops.push({ type: "text", text, opts: { ...opts } });
      },
      addImage(opts = {}) {
        ops.push({ type: "image", opts: { ...opts } });
      },
    };
    return { slide, ops };
  }

  function isCustomPreviewLayout(layout) {
    if (typeof isCustomLayout === "function") return isCustomLayout(layout);
    return typeof layout === "string" && layout.startsWith("custom:");
  }

  function getRenderer(layout) {
    if (isCustomPreviewLayout(layout)) {
      return typeof layoutCustom === "function" ? layoutCustom : null;
    }
    return typeof LAYOUT_REGISTRY !== "undefined" ? LAYOUT_REGISTRY[layout] : null;
  }

  function captureSlide(plan, index) {
    if (!Array.isArray(plan)) throw new Error("preview plan must be an array");
    const spec = plan[index];
    if (!spec || typeof spec.layout !== "string") throw new Error(`slide ${index + 1}: invalid layout`);
    const render = getRenderer(spec.layout);
    if (!render) throw new Error(`slide ${index + 1}: no preview renderer for '${spec.layout}'`);

    const { slide, ops } = createRecorder();
    render(slide, spec, { layout: "LAYOUT_WIDE" });

    return { spec, ops };
  }

  function ensureDefs(svg) {
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = svgEl("defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    return defs;
  }

  function addClip(svg, x, y, w, h, prefix) {
    const id = `${prefix}-${Math.random().toString(36).slice(2)}`;
    const clip = svgEl("clipPath", { id });
    clip.appendChild(svgEl("rect", { x, y, width: w, height: h }));
    ensureDefs(svg).appendChild(clip);
    return `url(#${id})`;
  }

  function renderShape(svg, op) {
    const opts = op.opts || {};
    const x = toNumber(opts.x);
    const y = toNumber(opts.y);
    const w = Math.max(0, toNumber(opts.w));
    const h = Math.max(0, toNumber(opts.h));
    if (!w || !h) return;

    const fill = normalizeHex(opts.fill?.color, "none");
    const line = lineStyle(opts.line);
    const attrs = {
      fill,
      stroke: line.stroke,
      "stroke-width": line.width,
    };

    if (op.kind === "ellipse" || op.kind === "oval") {
      svg.appendChild(svgEl("ellipse", {
        cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...attrs,
      }));
      return;
    }

    if (op.kind === "trapezoid") {
      const inset = Math.min(w * 0.08, 0.35);
      const points = [
        [x + inset, y],
        [x + w - inset, y],
        [x + w, y + h],
        [x, y + h],
      ].map(point => point.join(",")).join(" ");
      svg.appendChild(svgEl("polygon", { points, ...attrs }));
      return;
    }

    svg.appendChild(svgEl("rect", { x, y, width: w, height: h, ...attrs }));
  }

  function renderImage(svg, op, index) {
    const opts = op.opts || {};
    const x = toNumber(opts.x);
    const y = toNumber(opts.y);
    const w = Math.max(0, toNumber(opts.w));
    const h = Math.max(0, toNumber(opts.h));
    if (!w || !h) return;

    const data = opts.data || opts.path || "";
    if (!data) {
      const box = svgEl("rect", {
        x, y, width: w, height: h,
        fill: "#f0f0eb",
        stroke: "#dddddd",
        "stroke-width": 0.01,
      });
      svg.appendChild(box);
      return;
    }

    const img = svgEl("image", {
      x, y, width: w, height: h,
      preserveAspectRatio: opts.sizing?.type === "cover" ? "xMidYMid slice" : "xMidYMid meet",
      "clip-path": addClip(svg, x, y, w, h, `preview-image-${index}`),
    });
    img.setAttributeNS(XLINK_NS, "href", data);
    img.setAttribute("href", data);
    svg.appendChild(img);
  }

  function textParagraphs(input) {
    if (Array.isArray(input)) {
      return input
        .map(part => {
          const value = typeof part === "object" && part !== null ? part.text : part;
          const prefix = part?.options?.bullet ? "- " : "";
          return `${prefix}${value ?? ""}`.trimEnd();
        })
        .filter(Boolean);
    }
    return String(input ?? "").split(/\r?\n/).filter(line => line.length);
  }

  function splitLongWord(word, maxChars) {
    const out = [];
    for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
    return out;
  }

  function wrapParagraph(text, maxChars) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let current = "";
    for (const word of words) {
      const chunks = word.length > maxChars ? splitLongWord(word, maxChars) : [word];
      for (const chunk of chunks) {
        const candidate = current ? `${current} ${chunk}` : chunk;
        if (candidate.length <= maxChars) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = chunk;
        }
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function wrapText(input, maxChars) {
    return textParagraphs(input).flatMap(paragraph => wrapParagraph(paragraph, maxChars));
  }

  function renderText(svg, op, index) {
    const opts = op.opts || {};
    const x = toNumber(opts.x);
    const y = toNumber(opts.y);
    const w = Math.max(0, toNumber(opts.w));
    const h = Math.max(0, toNumber(opts.h));
    if (!w || !h) return;

    const margin = Math.min(0.08, Math.max(0.02, toNumber(opts.margin, 0.05)));
    const fontSize = ptToSlideUnits(opts.fontSize, 14);
    const lineHeight = fontSize * 1.18;
    const maxChars = Math.max(4, Math.floor((w - margin * 2) / (fontSize * 0.52)));
    const maxLines = Math.max(1, Math.floor((h - margin * 2) / lineHeight));
    const lines = wrapText(op.text, maxChars).slice(0, maxLines);
    if (!lines.length) return;

    const align = opts.align || "left";
    const anchorX = align === "center" ? x + w / 2 : align === "right" ? x + w - margin : x + margin;
    const textAnchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
    const contentHeight = lines.length * lineHeight;
    const availableHeight = Math.max(0, h - margin * 2);
    const extraY = opts.valign === "middle" ? Math.max(0, (availableHeight - contentHeight) / 2)
      : opts.valign === "bottom" ? Math.max(0, availableHeight - contentHeight)
      : 0;
    const firstBaseline = y + margin + extraY + fontSize;

    const text = svgEl("text", {
      x: anchorX,
      y: firstBaseline,
      "font-size": fontSize,
      "font-family": opts.fontFace || DEFAULT_FONT,
      "font-weight": opts.bold ? 700 : 400,
      "font-style": opts.italic ? "italic" : "normal",
      fill: normalizeHex(opts.color || "1A1A1A", "#1A1A1A"),
      "text-anchor": textAnchor,
      "clip-path": addClip(svg, x, y, w, h, `preview-text-${index}`),
    });

    lines.forEach((line, lineIndex) => {
      const tspan = svgEl("tspan", {
        x: anchorX,
        y: firstBaseline + lineIndex * lineHeight,
      });
      tspan.textContent = line;
      text.appendChild(tspan);
    });
    svg.appendChild(text);
  }

  function renderOps(ops, spec, options = {}) {
    const width = typeof SLIDE_W !== "undefined" ? SLIDE_W : 13.333;
    const height = typeof SLIDE_H !== "undefined" ? SLIDE_H : 7.5;
    const svg = svgEl("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `${spec?.title || spec?.layout || "Slide"} preview`,
      class: options.thumbnail ? "ppt-live-slide ppt-live-slide-thumb" : "ppt-live-slide",
      "data-preview-layout": spec?.layout || "",
    });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }));

    ops.forEach((op, index) => {
      if (op.type === "shape") renderShape(svg, op, index);
      else if (op.type === "image") renderImage(svg, op, index);
      else if (op.type === "text") renderText(svg, op, index);
    });
    return svg;
  }

  function renderSlide(plan, index, options = {}) {
    const captured = captureSlide(plan, index);
    return renderOps(captured.ops, captured.spec, options);
  }

  PPTGen.previewRenderer = {
    captureSlide,
    renderSlide,
  };
})();
