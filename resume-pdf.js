/**
 * Builds a real, text-based PDF of the resume straight from the DOM.
 *
 * Why hand-rolled: the browser's print dialog is the only *built-in* PDF writer,
 * and rasterising libraries (html2canvas et al.) produce a picture of text that
 * resume parsers cannot read. PDF's 14 standard fonts need no embedding, so a
 * small generator can emit genuinely selectable text with no dependencies.
 *
 * Because it walks #resumePrintable at click time, the download always matches
 * whatever the page currently says.
 */
(function () {
  "use strict";

  /* ── Standard-14 Helvetica metrics (units per 1000 em) ─────────────────── */
  const ASCII = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

  const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
    667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    278,278,278,469,556,333,
    556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
    334,260,334,584];

  const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
    722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    333,278,333,584,556,333,
    556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
    389,280,389,584];

  // Typographic characters the resume actually uses, mapped to WinAnsi bytes.
  const WINANSI = {
    "—": [151, 1000, 1000], // em dash
    "–": [150, 556, 556],   // en dash
    "‘": [145, 222, 278],
    "’": [146, 222, 278],
    "“": [147, 333, 500],
    "”": [148, 333, 500],
    "•": [149, 350, 350],   // bullet
    "…": [133, 1000, 1000], // ellipsis
    " ": [32, 278, 278]     // nbsp -> space
  };

  function charWidth(ch, bold) {
    const i = ASCII.indexOf(ch);
    if (i !== -1) return (bold ? BOLD : REG)[i];
    const w = WINANSI[ch];
    if (w) return bold ? w[2] : w[1];
    const code = ch.charCodeAt(0);
    if (code < 256) return bold ? BOLD[36] : REG[36]; // fall back to "A"-ish
    return 0;
  }

  function measure(text, bold, size) {
    let total = 0;
    for (let i = 0; i < text.length; i++) total += charWidth(text[i], bold);
    return (total * size) / 1000;
  }

  /* ── PDF string escaping ──────────────────────────────────────────────── */
  function pdfText(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const mapped = WINANSI[ch];
      if (mapped) {
        out += "\\" + mapped[0].toString(8);
        continue;
      }
      const code = ch.charCodeAt(0);
      if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
      else if (code < 32 || code > 255) out += "?";
      else if (code > 126) out += "\\" + code.toString(8);
      else out += ch;
    }
    return out;
  }

  /* ── Inline runs: keeps <strong> bold inside a paragraph ──────────────── */
  function runsFrom(node, bold) {
    let runs = [];
    node.childNodes.forEach(function (child) {
      if (child.nodeType === 3) {
        const t = child.textContent.replace(/\s+/g, " ");
        if (t) runs.push({ text: t, bold: bold });
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        if (tag === "br") runs.push({ text: " ", bold: bold });
        else if (tag === "ul" || tag === "ol") return;
        else runs = runs.concat(runsFrom(child, bold || tag === "strong" || tag === "b"));
      }
    });
    return runs;
  }

  function trimRuns(runs) {
    const out = runs.filter(function (r) { return r.text.length; });
    if (out.length) {
      out[0] = { text: out[0].text.replace(/^\s+/, ""), bold: out[0].bold };
      const last = out.length - 1;
      out[last] = { text: out[last].text.replace(/\s+$/, ""), bold: out[last].bold };
    }
    return out.filter(function (r) { return r.text.length; });
  }

  // Greedy word wrap across styled runs.
  function wrapRuns(runs, size, maxWidth) {
    const lines = [];
    let line = [];
    let width = 0;

    runs.forEach(function (run) {
      const tokens = run.text.split(/(\s+)/);
      tokens.forEach(function (tok) {
        if (!tok) return;
        const w = measure(tok, run.bold, size);
        const isSpace = /^\s+$/.test(tok);
        if (width + w > maxWidth && !isSpace && line.length) {
          lines.push(line);
          line = [];
          width = 0;
        }
        if (isSpace && !line.length) return; // no leading space on a fresh line
        line.push({ text: tok, bold: run.bold, width: w });
        width += w;
      });
    });

    if (line.length) lines.push(line);
    return lines;
  }

  /* ── Document model built from the printable resume ───────────────────── */
  function collectBlocks(root) {
    const blocks = [];
    const name = root.querySelector(".resume-name");
    const headline = root.querySelector(".resume-headline");
    const contact = root.querySelector(".resume-contact");

    if (name) blocks.push({ type: "name", text: name.textContent.trim() });
    if (headline) blocks.push({ type: "headline", text: headline.textContent.trim() });
    if (contact) {
      blocks.push({
        type: "contact",
        text: contact.textContent.replace(/\s*\|\s*/g, "  |  ").replace(/\s+/g, " ").trim()
      });
    }

    root.querySelectorAll(".resume-block").forEach(function (section) {
      const h2 = section.querySelector("h2");
      if (h2) blocks.push({ type: "h2", text: h2.textContent.trim() });

      section.childNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        const tag = node.tagName.toLowerCase();

        if (tag === "p") {
          blocks.push({ type: "p", runs: trimRuns(runsFrom(node, false)) });
        } else if (tag === "ul") {
          node.querySelectorAll(":scope > li").forEach(function (li) {
            blocks.push({ type: "li", depth: 0, runs: trimRuns(runsFrom(li, false)) });
            li.querySelectorAll(":scope > ul > li").forEach(function (sub) {
              blocks.push({ type: "li", depth: 1, runs: trimRuns(runsFrom(sub, false)) });
            });
          });
        } else if (node.classList.contains("resume-entry")) {
          const h3 = node.querySelector(".resume-entry-header h3");
          const meta = node.querySelector(".resume-entry-header span");
          if (h3) {
            blocks.push({
              type: "entry",
              text: h3.textContent.trim(),
              meta: meta ? meta.textContent.trim() : ""
            });
          }
          node.querySelectorAll(":scope > p").forEach(function (p) {
            blocks.push({ type: "p", runs: trimRuns(runsFrom(p, false)) });
          });
          node.querySelectorAll(":scope > ul > li").forEach(function (li) {
            blocks.push({ type: "li", depth: 0, runs: trimRuns(runsFrom(li, false)) });
            li.querySelectorAll(":scope > ul > li").forEach(function (sub) {
              blocks.push({ type: "li", depth: 1, runs: trimRuns(runsFrom(sub, false)) });
            });
          });
        }
      });
    });

    return blocks;
  }

  /* ── Layout + emit ────────────────────────────────────────────────────── */
  const PAGE_W = 612;
  const PAGE_H = 792;
  const M = 50;
  const BOTTOM = 52;

  async function loadPhoto(root) {
    const img = root.querySelector(".resume-photo");
    if (!img || !img.getAttribute("src")) return null;
    try {
      const res = await fetch(img.getAttribute("src"));
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] !== 0xff || buf[1] !== 0xd8) return null; // not a JPEG
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m === 0xc0 || m === 0xc1) {
          return { bytes: buf, h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
        }
        if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
      }
    } catch (err) { /* photo is optional */ }
    return null;
  }

  async function build(root) {
    const blocks = collectBlocks(root);
    const photo = await loadPhoto(root);

    const pages = [];
    let ops = [];
    let y = PAGE_H - M;

    function newPage() {
      pages.push(ops);
      ops = [];
      y = PAGE_H - M;
    }
    function need(h) {
      if (y - h < BOTTOM) newPage();
    }
    function text(str, x, yy, size, bold) {
      ops.push(
        "BT /" + (bold ? "F2" : "F1") + " " + size + " Tf " +
        x.toFixed(2) + " " + yy.toFixed(2) + " Td (" + pdfText(str) + ") Tj ET"
      );
    }
    function rule(yy, thickness) {
      ops.push(
        (thickness || 0.6).toFixed(2) + " w " + M + " " + yy.toFixed(2) + " m " +
        (PAGE_W - M) + " " + yy.toFixed(2) + " l S"
      );
    }
    function paragraph(runs, x, size, lead, maxWidth) {
      wrapRuns(runs, size, maxWidth).forEach(function (line) {
        need(lead);
        let cx = x;
        line.forEach(function (seg) {
          if (seg.text.trim()) text(seg.text, cx, y, size, seg.bold);
          cx += seg.width;
        });
        y -= lead;
      });
    }

    // ── Header ──
    let headerRight = PAGE_W - M;
    let photoBottom = y;
    if (photo) {
      const pw = 74;
      const ph = (photo.h / photo.w) * pw;
      const px = PAGE_W - M - pw;
      const py = y - ph;
      ops.push("q " + pw + " 0 0 " + ph.toFixed(2) + " " + px + " " + py.toFixed(2) + " cm /Im0 Do Q");
      headerRight = px - 14;
      photoBottom = py;
    }

    // Header lines are positioned by baseline: advance y *before* drawing, by
    // the full leading for that line, so consecutive lines can never collide.
    const headerWidth = headerRight - M;
    blocks.forEach(function (b) {
      if (b.type === "name") {
        y -= 23;
        text(b.text, M, y, 22, true);
      } else if (b.type === "headline") {
        y -= 17;
        text(b.text, M, y, 11, false);
      } else if (b.type === "contact") {
        wrapRuns([{ text: b.text, bold: false }], 9, headerWidth).forEach(function (line, idx) {
          y -= idx === 0 ? 15 : 11;
          let cx = M;
          line.forEach(function (seg) {
            if (seg.text.trim()) text(seg.text, cx, y, 9, false);
            cx += seg.width;
          });
        });
      }
    });

    y = Math.min(y, photoBottom) - 8;
    rule(y, 1.2);
    y -= 18;

    // ── Body ──
    blocks.forEach(function (b) {
      if (b.type === "name" || b.type === "headline" || b.type === "contact") return;

      if (b.type === "h2") {
        need(34);
        y -= 4;
        text(b.text.toUpperCase(), M, y, 11, true);
        y -= 5;
        rule(y, 0.6);
        y -= 13;
      } else if (b.type === "entry") {
        need(24);
        const size = 10.5;
        let title = b.text;
        const metaW = b.meta ? measure(b.meta, false, 9) : 0;
        const room = PAGE_W - M - M - metaW - 12;
        while (title && measure(title, true, size) > room) title = title.slice(0, -2);
        text(title, M, y, size, true);
        if (b.meta) text(b.meta, PAGE_W - M - metaW, y, 9, false);
        y -= 13;
      } else if (b.type === "p") {
        if (!b.runs.length) return;
        paragraph(b.runs, M, 9.5, 12, PAGE_W - 2 * M);
        y -= 2;
      } else if (b.type === "li") {
        if (!b.runs.length) return;
        const indent = M + 12 + b.depth * 14;
        need(12);
        text(b.depth ? "–" : "•", indent - 10, y, 9.5, false);
        paragraph(b.runs, indent, 9.5, 12, PAGE_W - M - indent);
        y -= 2;
      }
    });

    pages.push(ops);
    return serialize(pages, photo);
  }

  /* ── PDF file assembly ────────────────────────────────────────────────── */
  function serialize(pages, photo) {
    const chunks = [];
    let length = 0;
    function put(data) {
      let bytes;
      if (typeof data === "string") {
        bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
      } else {
        bytes = data;
      }
      chunks.push(bytes);
      length += bytes.length;
    }

    const objects = [];   // body writers, index 0 => object 1
    const pageIds = [];
    const nPages = pages.length;
    // 1 catalog, 2 pages, 3 F1, 4 F2, [5 image], then page + content pairs
    const imageId = photo ? 5 : 0;
    const firstPage = photo ? 6 : 5;

    for (let i = 0; i < nPages; i++) pageIds.push(firstPage + i * 2);

    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(
      "<< /Type /Pages /Count " + nPages + " /Kids [" +
      pageIds.map(function (id) { return id + " 0 R"; }).join(" ") + "] >>"
    );
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    if (photo) {
      objects.push({
        dict: "<< /Type /XObject /Subtype /Image /Width " + photo.w + " /Height " + photo.h +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
          photo.bytes.length + " >>",
        stream: photo.bytes
      });
    }

    pages.forEach(function (ops, i) {
      const contentId = pageIds[i] + 1;
      objects.push(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "] " +
        "/Resources << /Font << /F1 3 0 R /F2 4 0 R >>" +
        (photo ? " /XObject << /Im0 " + imageId + " 0 R >>" : "") + " >> " +
        "/Contents " + contentId + " 0 R >>"
      );
      const body = ops.join("\n");
      objects.push({ dict: "<< /Length " + body.length + " >>", stream: body });
    });

    put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    const offsets = [];
    objects.forEach(function (obj, idx) {
      offsets.push(length);
      put(idx + 1 + " 0 obj\n");
      if (typeof obj === "string") {
        put(obj + "\nendobj\n");
      } else {
        put(obj.dict + "\nstream\n");
        put(obj.stream);
        put("\nendstream\nendobj\n");
      }
    });

    const xref = length;
    let table = "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    offsets.forEach(function (off) {
      table += String(off).padStart(10, "0") + " 00000 n \n";
    });
    put(table);
    put(
      "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" +
      xref + "\n%%EOF\n"
    );

    const out = new Uint8Array(length);
    let at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return new Blob([out], { type: "application/pdf" });
  }

  window.buildResumePdf = build;
})();
