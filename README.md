# Platen engine

The scan engine behind [platen.page](https://platen.page). It takes a rendered page and makes it look scanned, photocopied, faxed or photographed with a phone.

It runs entirely in the browser, in plain JavaScript with no dependencies. It makes no network requests, so the documents you process never leave the device. It is the same code that runs on platen.page; you can compare it with `/assets/engine.js` on the live site.

## Quick start

```html
<script src="jpeg-encoder.js"></script>
<script src="platen-engine.js"></script>
<script>
  const { scan, encodeJPEG, PRESETS } = PlatenEngine;

  // `page` is a canvas with your page drawn on white, at the preset's resolution.
  const settings = PRESETS.office;          // or flatbed, copier, fax, phone
  const dpi = +settings.dpi;
  const seed = 12345;                       // same seed, same result
  const scanned = scan(page, settings, seed, dpi, seed % 3);

  const jpegBytes = encodeJPEG(scanned, settings.jpeg);   // Uint8Array
</script>
```

Open [`example/index.html`](example/index.html) for a working demo with image input. For PDFs, render each page to a canvas first, for example with [pdf.js](https://mozilla.github.io/pdf.js/), at `dpi / 72` scale.

## API

`PlatenEngine.scan(canvas, settings, seed, dpi, side)` returns a new canvas of the same size.

| Argument | Meaning |
|---|---|
| `canvas` | The clean page, drawn on a white background. Its size in pixels should be the page size at `dpi`. |
| `settings` | A preset from `PRESETS`, or your own object with the fields below. |
| `seed` | Integer. Every random choice (skew, dust, streak positions) comes from it, so a seed always reproduces the same output. For multi-page documents, give each page its own seed; Platen uses `baseSeed + pageIndex * 7919`. |
| `dpi` | The resolution the canvas was rendered at. Physical sizes (shadows, dust, blur) scale with it. |
| `side` | Which edge the scanner-lid shadow falls on: `0` left, `1` top, `2` right. Keep it the same for every page of one document. |

`PlatenEngine.encodeJPEG(canvas, quality)` returns the JPEG as a `Uint8Array`, with `quality` from 0 to 1. It uses the bundled encoder instead of `canvas.toBlob()`, because browsers handle the quality setting differently: iOS Safari saves about quality 93 when asked for 75. With the bundled encoder, the same input gives the same bytes on every device.

## Settings

| Field | Values | What it does |
|---|---|---|
| `mode` | `"color"`, `"gray"`, `"bw"` | Colour, greyscale, or 1-bit black and white |
| `dpi` | `"100"` to `"300"` | Resolution (used by Platen's UI to pick the render size) |
| `rotation` | 0–3 | Maximum skew in degrees |
| `keystone` | 0–1 | Phone-photo perspective. Above 0 it also adds off-centre framing, depth-of-field blur toward the far edge and a slight white-balance cast |
| `edge` | 0–1 | How much of the paper edge, offset and contact shadow shows |
| `surround` | `"lid"`, `"dark"`, `"desk"` | What is visible around the page |
| `contrast`, `black`, `bleed` | 0–1 | Tone curve, depth of blacks, ink spread |
| `brightness` | −1–1 | Overall exposure |
| `paper` | `"white"`, `"ivory"`, `"recycled"`, `"grey"` | Paper tint |
| `texture` | 0–1 | Paper fibre mottle and grain |
| `lighting`, `vignette` | 0–1 | Lid shadow and light falloff |
| `noise`, `streaks`, `dust`, `speckle` | 0–1 | Sensor noise, vertical streaks, dust and hairs, toner speckle |
| `jpeg` | 0.5–0.95 | JPEG quality for export |

## How it works

For each page, in order:

1. **Geometry.** Skew, offset and perspective are combined into one projective transform (a homography). Every output pixel is mapped back to the source and sampled bilinearly, with an anti-aliased page edge and a soft contact shadow. This is done per pixel in JavaScript rather than with canvas transforms, because browsers round canvas drawing differently. Safari, for example, snaps to whole pixels, which gives serrated page edges.
2. **Optics and ink.** Desaturation, then a separable blur that stands in for lens softness and ink spreading into paper.
3. **Tone.** A lookup-table tone curve sets contrast, black depth and how much thin strokes thicken.
4. **Paper.** Multi-scale value noise for fibre mottle, plus fine grain.
5. **Light.** A lid shadow along one edge, consistent across a document, plus gradient and vignette. Phone photos get an off-centre hotspot instead.
6. **Sensor.** Gaussian noise and full-height vertical streaks, as from a dirty scanner bar or copier drum.
7. **Debris.** Dust specks, the occasional hair, toner speckle.
8. **Encoding.** JPEG at the preset's quality, so a preview is exactly what gets exported.

The randomness comes from a seeded PRNG (mulberry32) and a precomputed Gaussian table, so results are reproducible.

## Responsible use

Platen exists for the many forms and portals that will only accept a "scanned copy" of a document you could otherwise only send digitally. Don't use it to pass off a document as something it isn't.

## Licence

MIT, see [LICENSE](LICENSE). `jpeg-encoder.js` is a modified copy of the [jpeg-js](https://github.com/jpeg-js/jpeg-js) encoder and keeps its BSD licences, included at the top of that file.
