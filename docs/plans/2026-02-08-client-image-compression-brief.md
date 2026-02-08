# Brief: Client Receipt Image Compression (~200KB, Soft Target)

Date: 2026-02-08

Status: Approved (user acknowledged)

## Goal

Reduce receipt image upload size to improve:

- Upload speed (mobile networks)
- Storage + egress cost
- Dify latency (smaller input)

Target: **~200KB** per receipt image (soft target).

## Non-Goals

- Server-side transcoding/resizing
- WebP-first pipeline (needs end-to-end compatibility validation)
- HEIC/HEIF conversion (client-side decoding is not reliable without extra deps)

## Decision (Option 3 + B)

Implement **adaptive client-side compression** before presigned PUT upload:

- Output format: **JPEG** (`image/jpeg`)
- Strategy: downscale to a reasonable long-edge first, then quality-search to hit target bytes
- Soft target (B): try to fit within `targetBytes`, but do not degrade below guardrails

Guardrails (v1):

- `targetBytes`: `200 * 1024`
- `maxLongEdge`: `1600`
- `minLongEdge`: `1024`
- `initialQuality`: `0.82`
- `minQuality`: `0.60`

Fallback:

- If the browser cannot decode the file into a canvas (e.g. HEIC), **skip compression and upload original**.

## UI Behavior

Add a new phase during upload:

- `compressing` (label: `OPTIMIZING…`) before `uploading`

## Verification Plan

Automated:

- Web: ensure `/submissions/init` uses **compressed** `content_type` and PUT body

Manual:

- Upload receipts from iOS/Android:
  - Upload completes successfully
  - Dify still extracts and scores as expected
  - Observe upload payload size is significantly smaller than before (typical: ~1-4MB)

