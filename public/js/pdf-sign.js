// Client-side PDF signing for engagement letters. Uses pdf-lib (loaded via CDN as a global
// `PDFLib` in index.html -- no build step, same pattern as the qrcodejs library used by mfa.js)
// to stamp a signature image + an audit line onto the last page of the original PDF. The
// stamped, flattened PDF this produces -- not a separate metadata row -- is what gets uploaded
// as the signed record (see letters.js's signLetter).

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
