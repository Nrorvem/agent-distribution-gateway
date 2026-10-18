import { NextResponse } from "next/server";

/**
 * GET /favicon.ico
 * Dynamically generates and serves a standards-compliant 32x32 32-bit RGBA .ico
 * depicting a high-intent B2B Person Enrichment & Verified Work Email badge:
 * - Deep navy rounded-square background (#0B1221) with subtle border (#1E293B)
 * - Glowing cyan/blue identity node ring (#38BDF8 -> #2563EB)
 * - Bright emerald verified checkmark badge (#10B981) in the lower-right quadrant
 */
function buildHighIntentFaviconIco(): Buffer {
  const width = 32;
  const height = 32;
  const pixelBytes = width * height * 4; // BGRA 32-bit
  const andMaskRowBytes = Math.ceil(width / 32) * 4; // 4 bytes per row
  const andMaskBytes = andMaskRowBytes * height; // 128 bytes
  const bihSize = 40;
  const imageSize = bihSize + pixelBytes + andMaskBytes;
  const icoHeaderSize = 6 + 16; // ICONDIR (6) + ICONDIRENTRY (16)
  const buf = Buffer.alloc(icoHeaderSize + imageSize, 0);

  // 1. ICONDIR header
  buf.writeUInt16LE(0, 0); // Reserved
  buf.writeUInt16LE(1, 2); // Type: 1 = ICO
  buf.writeUInt16LE(1, 4); // Count: 1 image

  // 2. ICONDIRENTRY
  buf.writeUInt8(width, 6); // Width (32)
  buf.writeUInt8(height, 7); // Height (32)
  buf.writeUInt8(0, 8); // Color count (0 = >=8bpp)
  buf.writeUInt8(0, 9); // Reserved
  buf.writeUInt16LE(1, 10); // Color planes
  buf.writeUInt16LE(32, 12); // Bits per pixel (32-bit RGBA)
  buf.writeUInt32LE(imageSize, 14); // Size of image data
  buf.writeUInt32LE(icoHeaderSize, 18); // Offset of image data

  // 3. BITMAPINFOHEADER (40 bytes)
  const bihOffset = icoHeaderSize;
  buf.writeUInt32LE(bihSize, bihOffset); // biSize
  buf.writeInt32LE(width, bihOffset + 4); // biWidth
  buf.writeInt32LE(height * 2, bihOffset + 8); // biHeight (doubled for XOR + AND mask)
  buf.writeUInt16LE(1, bihOffset + 12); // biPlanes
  buf.writeUInt16LE(32, bihOffset + 14); // biBitCount
  buf.writeUInt32LE(0, bihOffset + 16); // biCompression (BI_RGB = 0)
  buf.writeUInt32LE(pixelBytes + andMaskBytes, bihOffset + 20); // biSizeImage

  const pixelsOffset = bihOffset + bihSize;

  // Helper to set pixel in bottom-up DIB coordinate space (top-down y -> bottom-up row)
  const setPixel = (
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a = 255
  ) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const dibRow = height - 1 - y;
    const idx = pixelsOffset + (dibRow * width + x) * 4;
    buf[idx] = b;
    buf[idx + 1] = g;
    buf[idx + 2] = r;
    buf[idx + 3] = a;
  };

  // Distance from rounded rectangle helper
  const cornerRadius = 7;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Rounded rect bounds [1..30]
      const minB = 1;
      const maxB = 30;
      let dx = 0;
      let dy = 0;
      if (x < minB + cornerRadius) dx = minB + cornerRadius - x;
      else if (x > maxB - cornerRadius) dx = x - (maxB - cornerRadius);
      if (y < minB + cornerRadius) dy = minB + cornerRadius - y;
      else if (y > maxB - cornerRadius) dy = y - (maxB - cornerRadius);

      const distCorner = Math.hypot(dx, dy);
      if (
        x < minB ||
        x > maxB ||
        y < minB ||
        y > maxB ||
        distCorner > cornerRadius + 0.5
      ) {
        // Transparent outside rounded rect
        setPixel(x, y, 0, 0, 0, 0);
        continue;
      }

      // Subtle glowing border on edge of rounded rect
      const isBorder =
        x === minB ||
        x === maxB ||
        y === minB ||
        y === maxB ||
        distCorner > cornerRadius - 0.8;

      if (isBorder) {
        setPixel(x, y, 30, 58, 138, 255); // Deep electric blue border (#1E3A8A)
      } else {
        // Subtle radial gradient dark navy background
        const centerDist = Math.hypot(x - 14, y - 14);
        const glow = Math.max(0, 1 - centerDist / 20);
        const r = Math.round(10 + glow * 12);
        const g = Math.round(15 + glow * 25);
        const b = Math.round(28 + glow * 45);
        setPixel(x, y, r, g, b, 255);
      }

      // Draw B2B Person Node Silhouette + Radar Ring around (13.5, 13.5)
      const cx = 13.5;
      const cy = 13.5;
      const distRing = Math.hypot(x - cx, y - cy);

      // Outer cyan-blue orbital ring (radius ~9.5..11.2)
      if (distRing >= 9.0 && distRing <= 11.2) {
        setPixel(x, y, 56, 189, 248, 255); // Sky cyan (#38BDF8)
      }

      // Person head (circle centered at 13.5, 10.0, radius 3.2)
      const distHead = Math.hypot(x - 13.5, y - 10.0);
      if (distHead <= 3.2) {
        setPixel(x, y, 248, 250, 252, 255); // Crisp white-slate (#F8FAFC)
      }

      // Person shoulders (ellipse centered at 13.5, 18.2)
      const normShoulder =
        Math.pow((x - 13.5) / 5.8, 2) + Math.pow((y - 18.2) / 3.8, 2);
      if (y >= 14 && y <= 19 && normShoulder <= 1.0 && distRing <= 9.2) {
        setPixel(x, y, 226, 232, 240, 255); // Crisp slate (#E2E8F0)
      }

      // Verified Work Email Checkmark Badge in bottom-right (center 22.5, 22.5, radius 6.5)
      const bx = 22.5;
      const by = 22.5;
      const distBadge = Math.hypot(x - bx, y - by);
      if (distBadge <= 6.8) {
        if (distBadge >= 5.6) {
          // Dark cutout rim around badge
          setPixel(x, y, 10, 15, 28, 255);
        } else {
          // Emerald green badge fill (#10B981)
          setPixel(x, y, 16, 185, 129, 255);
        }
      }
    }
  }

  // Draw crisp white checkmark inside the emerald badge (around 22.5, 22.5)
  const checkCoords: Array<[number, number]> = [
    [19, 22],
    [20, 23],
    [21, 24],
    [22, 23],
    [23, 22],
    [24, 21],
    [25, 20],
    // Thicken checkmark stroke by 1px vertically
    [19, 23],
    [20, 24],
    [21, 25],
    [22, 24],
    [23, 23],
    [24, 22],
    [25, 21],
  ];
  for (const [cx, cy] of checkCoords) {
    setPixel(cx, cy, 255, 255, 255, 255);
  }

  return buf;
}

const CACHED_FAVICON = buildHighIntentFaviconIco();

export async function GET() {
  return new NextResponse(new Uint8Array(CACHED_FAVICON), {
    status: 200,
    headers: {
      "Content-Type": "image/x-icon",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
