// Client-side PDF signing for engagement letters. Two libraries split the work: pdf.js (loaded
// here as an ES module -- recent versions ship .mjs only, no UMD global, so this is a plain
// import rather than the CDN <script> + window.* pattern used for pdf-lib/qrcodejs) renders
// pages to a <canvas> so staff can place signature/date boxes on the real document and clients
// can see exactly where they'll sign; pdf-lib (loaded via CDN as a global `PDFLib` in
// index.html) does the actual stamping, producing the flattened, signed PDF that gets uploaded
// as the record of record (see letters.js's signLetter).
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs";

// Fixed sizes for newly-placed fields (percentages of page width/height) -- no drag-resize in
// v1, staff places at a sensible default size and can delete + re-place if it's in the way of
// existing document content.
export const FIELD_DEFAULT_SIZE = {
  signature: { widthPct: 0.3, heightPct: 0.07 },
  date: { widthPct: 0.16, heightPct: 0.05 },
};

export async function loadPdfDocument(pdfBytes) {
  // pdf.js wants its own copy of the buffer -- pdf-lib's PDFDocument.load below (called
  // separately at stamp time) would otherwise be handed an already-detached ArrayBuffer.
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
  return loadingTask.promise;
}

// Renders one page (1-indexed, matching pdf.js's own convention) at a CSS pixel width the
// caller chooses, so the same document renders consistently regardless of the viewer's actual
// screen size -- field positions are stored as percentages specifically so staff's placement
// screen and a client's signing screen can each pick their own render width and still agree on
// exactly where a box lands.
export async function renderPdfPageToCanvas(pdfDoc, pageNumber, canvas, targetWidth) {
  const page = await pdfDoc.getPage(pageNumber);
  const unscaledViewport = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / unscaledViewport.width });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return { width: viewport.width, height: viewport.height };
}

// field: { type: "signature"|"date", page (0-indexed, matching pdf-lib's getPages()),
// xPct, yPct, widthPct, heightPct } -- xPct/yPct are the box's top-left corner, matching how a
// browser click position translates to a percentage of the rendered canvas.
function fieldToPdfRect(field, pageWidthPts, pageHeightPts) {
  const width = field.widthPct * pageWidthPts;
  const height = field.heightPct * pageHeightPts;
  const x = field.xPct * pageWidthPts;
  // pdf-lib's y is the box's BOTTOM edge measured from the page's bottom (points origin is
  // bottom-left); field.yPct is the box's TOP edge measured from the page's top (screen/canvas
  // origin is top-left) -- has to flip both the axis and which edge is being measured.
  const y = pageHeightPts - field.yPct * pageHeightPts - height;
  return { x, y, width, height };
}

// Stamps the client's one captured signature into every "signature" field and today's date
// into every "date" field, at each field's real position on its real page -- plus the same
// audit line stampSignature (below) always adds. Used when the letter has staff-placed fields;
// falls back to stampSignature for older letters sent before fields existed (see
// openSignLetterModal in app.js).
export async function stampFields(pdfBytes, { fields, signatureImageDataUrl, signerName, ip }) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const needsSignatureImage = fields.some((f) => f.type === "signature");
  const pngImage = needsSignatureImage ? await pdfDoc.embedPng(dataUrlToBytes(signatureImageDataUrl)) : null;
  const dateText = new Date().toLocaleDateString();

  for (const field of fields) {
    const page = pages[field.page];
    if (!page) continue;
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const rect = fieldToPdfRect(field, pageWidth, pageHeight);

    if (field.type === "signature" && pngImage) {
      const imgDims = pngImage.scaleToFit(rect.width, rect.height);
      page.drawImage(pngImage, {
        x: rect.x + (rect.width - imgDims.width) / 2,
        y: rect.y + (rect.height - imgDims.height) / 2,
        width: imgDims.width,
        height: imgDims.height,
      });
    } else if (field.type === "date") {
      page.drawText(dateText, {
        x: rect.x + 4,
        y: rect.y + rect.height / 2 - 5,
        size: 11,
        font,
        color: rgb(0.1, 0.12, 0.16),
      });
    }
  }

  drawAuditLine(pages[pages.length - 1], font, rgb, signerName, dateText, ip);
  return pdfDoc.save();
}

function drawAuditLine(page, font, rgb, signerName, dateText, ip) {
  page.drawText(`Signed by ${signerName} on ${dateText}${ip ? ` from IP ${ip}` : ""}`, {
    x: 48,
    y: 30,
    size: 8,
    font,
    color: rgb(0.45, 0.48, 0.54),
  });
}

// Fallback for letters sent before staff-placed fields existed: same single fixed-location
// stamp this always did, on the last page.
export async function stampSignature(pdfBytes, { signatureImageDataUrl, signerName, signedAtText, ip }) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const page = pages[pages.length - 1];

  const pngImage = await pdfDoc.embedPng(dataUrlToBytes(signatureImageDataUrl));
  const imgDims = pngImage.scaleToFit(220, 70);
  const marginX = 48;
  const marginY = 60;

  page.drawImage(pngImage, {
    x: marginX,
    y: marginY + 24,
    width: imgDims.width,
    height: imgDims.height,
  });

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText(`Signed by ${signerName} on ${signedAtText}${ip ? ` from IP ${ip}` : ""}`, {
    x: marginX,
    y: marginY,
    size: 9,
    font,
    color: rgb(0.35, 0.38, 0.44),
  });

  return pdfDoc.save();
}

function dataUrlToBytes(dataUrl) {
  const binary = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Renders a typed name in a cursive font onto a transparent PNG, so "type your signature" can
// reuse the exact same embed/stamp path as a drawn one -- stampSignature above never needs to
// know which mode produced the image.
export function renderTypedSignature(name) {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 140;
  const ctx = canvas.getContext("2d");
  ctx.font = "56px 'Dancing Script', cursive";
  ctx.fillStyle = "#1a1d23";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 10, canvas.height / 2);
  return canvas.toDataURL("image/png");
}

// Wires pointer/touch drawing onto a <canvas> for the "draw your signature" mode. Returns
// controls the caller uses; call destroy() when the modal containing the canvas closes, since
// the move/end listeners are attached to `window` (needed so a drag that leaves the canvas
// bounds still ends the stroke cleanly) and would otherwise outlive the canvas itself.
export function wireSignatureCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#1a1d23";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let drawing = false;
  let hasDrawn = false;

  function posFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    const { x, y } = posFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const { x, y } = posFromEvent(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasDrawn = true;
  }
  function end() {
    drawing = false;
  }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);

  return {
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
    },
    isEmpty() {
      return !hasDrawn;
    },
    toDataUrl() {
      return canvas.toDataURL("image/png");
    },
    destroy() {
      canvas.removeEventListener("mousedown", start);
      canvas.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      canvas.removeEventListener("touchstart", start);
      canvas.removeEventListener("touchmove", move);
      canvas.removeEventListener("touchend", end);
    },
  };
}

// Best-effort public IP for the audit line -- if this fails (network hiccup, ad blocker), signing
// still proceeds without it rather than blocking someone from signing a document.
export async function fetchPublicIp() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    return data.ip || null;
  } catch {
    return null;
  }
}
