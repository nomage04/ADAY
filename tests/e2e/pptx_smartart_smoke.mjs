// Unit test for B: validates that extractShapesFromDrawingXml returns
// rich style info (fontSize/textColor/bold/fontFace/align/preset), and
// that classifySlideAsLayout explodes a smart frame into primitive
// decorative shapes at the right absolute slide-% positions.

import { chromium } from "playwright";
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = pathToFileURL(join(__dirname, "..", "..", "web", "index.html")).toString();

// Forged SmartArt drawing XML — a 4-step timeline with colored circles.
const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <dsp:spTree>
    <dsp:sp>
      <dsp:spPr>
        <a:xfrm>
          <a:off x="0" y="500000"/>
          <a:ext cx="6000000" cy="30000"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="228B22"/></a:solidFill>
      </dsp:spPr>
    </dsp:sp>
    <dsp:sp>
      <dsp:spPr>
        <a:xfrm><a:off x="300000" y="300000"/><a:ext cx="400000" cy="400000"/></a:xfrm>
        <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="2E7D32"/></a:solidFill>
      </dsp:spPr>
      <dsp:txBody>
        <a:p>
          <a:pPr algn="ctr"><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr>
          <a:r><a:t>T1</a:t></a:r>
        </a:p>
      </dsp:txBody>
    </dsp:sp>
    <dsp:sp>
      <dsp:spPr>
        <a:xfrm><a:off x="1800000" y="300000"/><a:ext cx="400000" cy="400000"/></a:xfrm>
        <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="EF6C00"/></a:solidFill>
      </dsp:spPr>
      <dsp:txBody>
        <a:p>
          <a:pPr algn="ctr"><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr>
          <a:r><a:t>T2</a:t></a:r>
        </a:p>
      </dsp:txBody>
    </dsp:sp>
    <dsp:sp>
      <dsp:spPr>
        <a:xfrm><a:off x="3300000" y="300000"/><a:ext cx="400000" cy="400000"/></a:xfrm>
        <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="2E7D32"/></a:solidFill>
      </dsp:spPr>
      <dsp:txBody>
        <a:p>
          <a:pPr algn="ctr"><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr>
          <a:r><a:t>T3</a:t></a:r>
        </a:p>
      </dsp:txBody>
    </dsp:sp>
    <dsp:sp>
      <dsp:spPr>
        <a:xfrm><a:off x="4800000" y="300000"/><a:ext cx="400000" cy="400000"/></a:xfrm>
        <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="C62828"/></a:solidFill>
      </dsp:spPr>
      <dsp:txBody>
        <a:p>
          <a:pPr algn="ctr"><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr>
          <a:r><a:t>T4</a:t></a:r>
        </a:p>
      </dsp:txBody>
    </dsp:sp>
  </dsp:spTree>
</dsp:drawing>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("[pageerror]", e.message));
  await page.goto(INDEX);

  await page.waitForFunction(() =>
    typeof window.extractShapesFromDrawingXml === "function"
    && typeof window.classifySlideAsLayout === "function",
    { timeout: 10_000 });

  // --- Test 1: extractShapesFromDrawingXml returns enriched style fields
  const subShapes = await page.evaluate(xml => {
    return window.extractShapesFromDrawingXml(xml);
  }, DRAWING_XML);

  console.log("=== extractShapesFromDrawingXml");
  console.log("count:", subShapes.length);
  for (const s of subShapes) {
    console.log("  ", {
      preset: s.preset,
      fill: s.fill,
      text: s.text,
      fontSize: s.fontSize,
      textColor: s.textColor,
      bold: s.bold,
      fontFace: s.fontFace,
      align: s.align,
    });
  }

  // --- Test 2: classifySlideAsLayout explodes smart into decoratives
  const { zones, decorativeShapes } = await page.evaluate(xml => {
    const fakeSlideShapes = [
      // A big title shape → zone
      { kind: "text", text: "Feuille de route 2026",
        x_pct: 5, y_pct: 5, w_pct: 60, h_pct: 10,
        fontSize: 3200, textColor: "1A3C34", bold: true, fontFace: "Calibri", align: "left",
        name: "Title" },
      // A smart frame — drawingXml attached
      { kind: "smart", drawingXml: xml,
        x_pct: 10, y_pct: 40, w_pct: 80, h_pct: 20,
        name: "Diagram 1" },
    ];
    return window.classifySlideAsLayout(fakeSlideShapes);
  }, DRAWING_XML);

  console.log("\n=== classifySlideAsLayout(fake smart frame)");
  console.log("zones:", zones.length);
  for (const z of zones) console.log("  z:", z.type, z.label, "@", z.x_pct.toFixed(1), z.y_pct.toFixed(1), "style:", z.style);
  console.log("decorativeShapes:", decorativeShapes.length);
  for (const d of decorativeShapes) {
    const box = `(${d.x_pct.toFixed(1)}, ${d.y_pct.toFixed(1)}, ${d.w_pct.toFixed(1)}×${d.h_pct.toFixed(1)})`;
    const tail = d.kind === "text" ? `"${d.text}" sz=${d.fontSize} color=${d.color} font=${d.fontFace}`
              : `fill=${d.fill}`;
    console.log("  ", d.kind, box, tail);
  }

  // --- Assertions
  let failed = 0;
  function check(label, cond) {
    console.log(cond ? `  [OK] ${label}` : `  [FAIL] ${label}`);
    if (!cond) failed++;
  }
  console.log("\n=== assertions");
  check("5 sub-shapes extracted (1 bar + 4 circles)", subShapes.length === 5);
  check("first sub-shape is rect (bar)", subShapes[0]?.preset === "rect");
  check("circle sub-shapes preset=ellipse", subShapes.slice(1).every(s => s.preset === "ellipse"));
  check("T2 text extracted", subShapes[2]?.text === "T2");
  check("defRPr fontSize read on T2", subShapes[2]?.fontSize === 1400);
  check("defRPr textColor read on T2", subShapes[2]?.textColor === "FFFFFF");
  check("defRPr bold read on T2", subShapes[2]?.bold === true);
  check("defRPr fontFace read on T2", subShapes[2]?.fontFace === "Calibri");
  check("classify produced decorative shapes", decorativeShapes.length > 0);
  check("oval shapes in decoratives", decorativeShapes.some(d => d.kind === "oval"));
  check("text shapes for T1..T4", decorativeShapes.filter(d => d.kind === "text").length >= 4);
  const ovalShapes = decorativeShapes.filter(d => d.kind === "oval");
  // Ovals should lie inside the smart frame bounds (10..90 x, 40..60 y)
  check("ovals within frame x-range", ovalShapes.every(d => d.x_pct >= 10 && d.x_pct + d.w_pct <= 90.01));
  check("ovals within frame y-range", ovalShapes.every(d => d.y_pct >= 40 && d.y_pct + d.h_pct <= 60.01));

  // --- Test 3: hand-drawn ellipses (preset=ellipse) with text must stay
  //             decorative — fill preserved + text kept verbatim.
  const manual = await page.evaluate(() => {
    const shapes = [
      // A fillable title (classic rect)
      { kind: "text", text: "Mise en forme conditionnelle",
        x_pct: 5, y_pct: 5, w_pct: 60, h_pct: 8,
        preset: "rect", fontSize: 2800, textColor: "000000", bold: true,
        fontFace: "Calibri", align: "left", name: "Title 1" },
      // 3 circles with labels — these are the "Sélection / Nouvelle règle / Style"
      { kind: "text", text: "Sélection",
        x_pct: 10, y_pct: 40, w_pct: 20, h_pct: 20,
        preset: "ellipse", fill: "#4A90E2", fontSize: 1600, textColor: "FFFFFF",
        bold: true, align: "center", name: "Oval 1" },
      { kind: "text", text: "Nouvelle règle",
        x_pct: 40, y_pct: 40, w_pct: 20, h_pct: 20,
        preset: "ellipse", fill: "#F5A623", fontSize: 1600, textColor: "FFFFFF",
        bold: true, align: "center", name: "Oval 2" },
      { kind: "text", text: "Style",
        x_pct: 70, y_pct: 40, w_pct: 20, h_pct: 20,
        preset: "ellipse", fill: "#7ED321", fontSize: 1600, textColor: "FFFFFF",
        bold: true, align: "center", name: "Oval 3" },
      // Big labels under each circle — should become fillable zones
      { kind: "text", text: "Choisir la plage de cellules",
        x_pct: 8, y_pct: 65, w_pct: 24, h_pct: 8,
        preset: "rect", fontSize: 1600, textColor: "333333", align: "center" },
    ];
    return window.classifySlideAsLayout(shapes);
  });

  console.log("\n=== hand-drawn ellipses (problem 2)");
  console.log("zones:", manual.zones.length);
  for (const z of manual.zones) console.log("  z:", z.label, z.type);
  console.log("decoratives:", manual.decorativeShapes.length);
  for (const d of manual.decorativeShapes) {
    const tail = d.kind === "text" ? `"${d.text}" color=${d.color}` : `fill=${d.fill}`;
    console.log("  ", d.kind, tail);
  }

  console.log("\n=== problem-2 assertions");
  const ovalDecos = manual.decorativeShapes.filter(d => d.kind === "oval");
  const ovalTexts = manual.decorativeShapes.filter(d => d.kind === "text" && ["Sélection", "Nouvelle règle", "Style"].includes(d.text));
  check("3 ovals preserved as decorative", ovalDecos.length === 3);
  check("oval fills preserved", ovalDecos.every(d => d.fill && /^#/.test(d.fill)));
  check("circle texts kept decorative (not blanked)", ovalTexts.length === 3);
  check("circle texts have original color", ovalTexts.every(d => d.color === "FFFFFF"));
  check("title and bottom label remain fillable zones", manual.zones.length === 2);
  check("zone labels are descriptive (not 'zone N')",
    manual.zones.every(z => !/^zone\s+\d+$/.test(z.label)));

  // --- Test 4: shape group (<p:grpSp>) positions composed correctly
  //             Inject a synthetic slide XML, parse it via parsePptxFile
  //             by building a minimal .pptx on the fly.
  const groupResult = await page.evaluate(async () => {
    // Forge a minimal .pptx in memory using JSZip — a real parser round-trip.
    const zip = new JSZip();
    const CT = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`;
    const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;
    const PRES = `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>`;
    const PRES_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`;
    // A group at (2000000, 1000000) of size 4000000 x 2000000 with its
    // children addressed in local coords (chOff=0,0, chExt=1000 x 500).
    // The inner ellipse sits at local (500, 100) of size 200 x 200.
    // Expected global: x = 2000000 + (500-0)*4000 = 4000000
    //                  w = 200 * 4000 = 800000
    //                  (scaleX = 4000000 / 1000 = 4000)
    const SLIDE = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    <p:grpSp>
      <p:nvGrpSpPr><p:cNvPr id="2" name="Group 1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="2000000" y="1000000"/>
          <a:ext cx="4000000" cy="2000000"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="1000" cy="500"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Oval 1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="500" y="100"/><a:ext cx="200" cy="200"/></a:xfrm>
          <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="4A90E2"/></a:solidFill>
        </p:spPr>
        <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Group Item</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:grpSp>
  </p:spTree></p:cSld>
</p:sld>`;
    zip.file("[Content_Types].xml", CT);
    zip.file("_rels/.rels", RELS);
    zip.file("ppt/presentation.xml", PRES);
    zip.file("ppt/_rels/presentation.xml.rels", PRES_RELS);
    zip.file("ppt/slides/slide1.xml", SLIDE);
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "forged.pptx");
    const parsed = await window.parsePptxFile(file);
    return parsed.slides[0].shapes;
  });

  console.log("\n=== shape group composition");
  for (const s of groupResult) {
    console.log("  ", s.kind, `${s.x_pct.toFixed(2)}%, ${s.y_pct.toFixed(2)}%, ${s.w_pct.toFixed(2)}×${s.h_pct.toFixed(2)}% preset=${s.preset} text="${s.text || ""}"`);
  }
  console.log("\n=== group composition assertions");
  // Expected for the oval: x_pct ≈ 4000000 / 12192000 * 100 = 32.81
  //                        y_pct ≈ 1400000 / 6858000  * 100 = 20.41
  //                        w_pct ≈ 800000  / 12192000 * 100 = 6.56
  //                        h_pct ≈ 800000  / 6858000  * 100 = 11.66
  const oval = groupResult.find(s => s.preset === "ellipse");
  check("oval found inside the group", !!oval);
  if (oval) {
    const close = (a, b, tol = 0.5) => Math.abs(a - b) < tol;
    check(`oval x_pct ≈ 32.81 (got ${oval.x_pct.toFixed(2)})`, close(oval.x_pct, 32.81));
    check(`oval y_pct ≈ 20.41 (got ${oval.y_pct.toFixed(2)})`, close(oval.y_pct, 20.41));
    check(`oval w_pct ≈ 6.56 (got ${oval.w_pct.toFixed(2)})`,  close(oval.w_pct, 6.56));
    check(`oval h_pct ≈ 11.66 (got ${oval.h_pct.toFixed(2)})`, close(oval.h_pct, 11.66));
    check("oval text preserved", oval.text === "Group Item");
    check("oval fill resolved",  oval.fill === "#4A90E2");
    check("oval textColor read", oval.textColor === "FFFFFF");
  }

  await browser.close();
  console.log(failed === 0 ? "\n✓ all assertions passed" : `\n✗ ${failed} assertion(s) failed`);
  if (failed) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
