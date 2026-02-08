export type ReceiptImageCompressionOptions = {
  targetBytes: number;
  outputType: 'image/jpeg';
  maxLongEdge: number;
  minLongEdge: number;
  initialQuality: number;
  minQuality: number;
  maxQualitySearchSteps: number;
};

export type ReceiptImageCompressionReport = {
  skipped: boolean;
  reason: string;
  originalBytes: number;
  outputBytes: number;
  outputType: string;
  width: number | null;
  height: number | null;
  quality: number | null;
  hitTarget: boolean;
};

export type ReceiptImageCompressionResult = {
  file: File;
  report: ReceiptImageCompressionReport;
};

const DEFAULT_OPTIONS: ReceiptImageCompressionOptions = {
  targetBytes: 200 * 1024,
  outputType: 'image/jpeg',
  // Receipts are text-heavy; downscaling to ~1600px long-edge is typically sufficient for OCR while cutting size.
  maxLongEdge: 1600,
  minLongEdge: 1024,
  // Start fairly high; we will reduce via search if needed.
  initialQuality: 0.82,
  // Guardrail: don't destroy text clarity.
  minQuality: 0.60,
  maxQualitySearchSteps: 7
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function longEdge(w: number, h: number): number {
  return Math.max(w, h);
}

function toBlobAsync(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('toBlob_failed'));
        resolve(blob);
      },
      type,
      quality
    );
  });
}

async function decodeImage(file: File): Promise<{
  image: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Prefer honoring EXIF orientation when supported.
      const bitmap = await (createImageBitmap as any)(file, { imageOrientation: 'from-image' });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close()
      };
    } catch {
      // Fall back to <img> decoding (some formats like HEIC may fail here and should be handled upstream).
    }
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  if (typeof img.decode === 'function') {
    await img.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('img_decode_failed'));
    });
  }
  return {
    image: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    cleanup: () => URL.revokeObjectURL(url)
  };
}

function buildCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas_2d_unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

async function encodeJpegWithQualitySearch(input: {
  source: CanvasImageSource;
  width: number;
  height: number;
  targetBytes: number;
  qualityHi: number;
  qualityLo: number;
  steps: number;
}): Promise<{ blob: Blob; quality: number; hitTarget: boolean }> {
  const { canvas, ctx } = buildCanvas(input.width, input.height);
  // Fill white background to avoid black pixels when the input has transparency.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, input.width, input.height);
  ctx.drawImage(input.source, 0, 0, input.width, input.height);

  const qHi = clampNumber(input.qualityHi, 0, 1);
  const qLo = clampNumber(input.qualityLo, 0, 1);

  const hiBlob = await toBlobAsync(canvas, 'image/jpeg', qHi);
  if (hiBlob.size <= input.targetBytes) {
    return { blob: hiBlob, quality: qHi, hitTarget: true };
  }

  const loBlob = await toBlobAsync(canvas, 'image/jpeg', qLo);
  if (loBlob.size > input.targetBytes) {
    return { blob: loBlob, quality: qLo, hitTarget: false };
  }

  // Binary search for the highest quality that still fits within targetBytes.
  let bestBlob = loBlob;
  let bestQ = qLo;
  let lo = qLo;
  let hi = qHi;

  for (let i = 0; i < input.steps; i += 1) {
    const mid = (lo + hi) / 2;
    const midBlob = await toBlobAsync(canvas, 'image/jpeg', mid);
    if (midBlob.size <= input.targetBytes) {
      bestBlob = midBlob;
      bestQ = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return { blob: bestBlob, quality: bestQ, hitTarget: true };
}

export async function compressReceiptImage(
  originalFile: File,
  partial?: Partial<ReceiptImageCompressionOptions>
): Promise<ReceiptImageCompressionResult> {
  const options: ReceiptImageCompressionOptions = { ...DEFAULT_OPTIONS, ...partial };

  // Fast-path: already small enough.
  if (originalFile.size > 0 && originalFile.size <= options.targetBytes) {
    return {
      file: originalFile,
      report: {
        skipped: true,
        reason: 'already_small_enough',
        originalBytes: originalFile.size,
        outputBytes: originalFile.size,
        outputType: originalFile.type || 'application/octet-stream',
        width: null,
        height: null,
        quality: null,
        hitTarget: true
      }
    };
  }

  // If the browser can't decode the image into a canvas (e.g., HEIC), fall back to original upload.
  let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null;
  try {
    decoded = await decodeImage(originalFile);
  } catch {
    return {
      file: originalFile,
      report: {
        skipped: true,
        reason: 'decode_failed_fallback_to_original',
        originalBytes: originalFile.size,
        outputBytes: originalFile.size,
        outputType: originalFile.type || 'application/octet-stream',
        width: null,
        height: null,
        quality: null,
        hitTarget: originalFile.size <= options.targetBytes
      }
    };
  }

  try {
    const srcW = decoded.width;
    const srcH = decoded.height;
    const srcLong = longEdge(srcW, srcH);

    const maxLongEdge = Math.max(1, Math.floor(options.maxLongEdge));
    const minLongEdge = Math.max(1, Math.floor(options.minLongEdge));
    const longStart = Math.min(srcLong, maxLongEdge);

    const initialQuality = clampNumber(options.initialQuality, 0.1, 1);
    const minQuality = clampNumber(options.minQuality, 0.1, initialQuality);

    // We reduce long-edge first (downscale), then find the best JPEG quality for target bytes.
    let currentLong = longStart;
    let best: { blob: Blob; quality: number; hitTarget: boolean; w: number; h: number } | null = null;

    // Ensure at least one attempt.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const scale = srcLong > 0 ? currentLong / srcLong : 1;
      const w = Math.max(1, Math.round(srcW * scale));
      const h = Math.max(1, Math.round(srcH * scale));

      const encoded = await encodeJpegWithQualitySearch({
        source: decoded.image,
        width: w,
        height: h,
        targetBytes: options.targetBytes,
        qualityHi: initialQuality,
        qualityLo: minQuality,
        steps: options.maxQualitySearchSteps
      });

      best = { ...encoded, w, h };
      if (encoded.hitTarget) break;

      // Can't hit target at minQuality for this dimension. If we are at (or below) minLongEdge, stop in soft mode.
      if (currentLong <= minLongEdge) break;

      // Shrink further and retry.
      const nextLong = Math.max(minLongEdge, Math.floor(currentLong * 0.85));
      if (nextLong === currentLong) break;
      currentLong = nextLong;
    }

    if (!best) {
      return {
        file: originalFile,
        report: {
          skipped: true,
          reason: 'unexpected_no_best_fallback_to_original',
          originalBytes: originalFile.size,
          outputBytes: originalFile.size,
          outputType: originalFile.type || 'application/octet-stream',
          width: null,
          height: null,
          quality: null,
          hitTarget: originalFile.size <= options.targetBytes
        }
      };
    }

    const outBlob = best.blob;
    const outFile = new File([outBlob], 'receipt.jpg', { type: options.outputType });
    return {
      file: outFile,
      report: {
        skipped: false,
        reason: best.hitTarget ? 'compressed_hit_target' : 'compressed_best_effort_over_target',
        originalBytes: originalFile.size,
        outputBytes: outFile.size,
        outputType: outFile.type,
        width: best.w,
        height: best.h,
        quality: best.quality,
        hitTarget: best.hitTarget
      }
    };
  } finally {
    decoded.cleanup();
  }
}
