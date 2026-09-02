/* eslint-disable */
/**
 * The Talk push service worker.
 *
 * A web push is delivered to a WORKER, not to a tab — which is the whole point:
 * it arrives when every tab is closed. This file is served as a static asset, so
 * it never sees Vite's env substitution and never imports from `src/`. Its
 * Firebase config is handed to it in the QUERY STRING by
 * `src/lib/firebase-messaging.ts`, so there is exactly one copy of those values
 * in the project and it lives in `.env`.
 *
 * What it decides:
 *
 *  - LOUD vs SILENT. Every Talk event is pushed; only some interrupt. A silent
 *    one (`notification.body` is null — an edit, a receipt, a membership change)
 *    is forwarded to any open tab and NOTHING is drawn. Branch on the body being
 *    present, never on a hardcoded list of event names.
 *  - Which tab gets it, and whether one of them is LOOKING. The whole event
 *    rides in `data.payload`, byte-identical to what the socket publishes, so
 *    any open tab — hidden or focused — applies it through the same handlers it
 *    already has. A focused tab is forwarded the event and drawn NO banner.
 *  - That there is exactly ONE banner. Every push is taken on the raw `push`
 *    event, ahead of the FCM SDK's own listener, because that listener draws a
 *    banner of its own before it ever calls `onBackgroundMessage`.
 *  - Where a tap goes. `chat_id` is a record id, and this app never puts one in
 *    a path, so the worker opens `/chat` and hands the event to the page, which
 *    owns the encrypted `?data=` token.
 *  - Whose FACE is on the banner, and which way up. Every `photo` the API returns
 *    is a storage key, so `media_path` is handed over in the query string too and
 *    the worker joins the two itself (`mediaUrl`, `photoKeyOf`) — then DECODES
 *    the photo, because a notification icon is drawn outside the page's renderer
 *    and that is the only renderer that honours EXIF (`bannerIcon`).
 */

importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js')

/** Mirrors `PUSH_CLIENT_MESSAGES` in `features/notifications/constants.ts`. */
const PUSH_EVENT_MESSAGE = 'talk-push-event'
const PUSH_CLICK_MESSAGE = 'talk-push-click'
const PUSH_CLAIM_CLICK_MESSAGE = 'talk-push-claim-click'

/** Where a tap lands. The conversation is chosen by the page, not by the URL. */
const APP_PATH = new URL('./', self.location).pathname
const CHAT_PATH = `${APP_PATH}chat`

function readConfig() {
  const raw = new URL(self.location.href).searchParams.get('config')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && parsed.apiKey && parsed.projectId ? parsed : null
  } catch (error) {
    return null
  }
}

const firebaseConfig = readConfig()

/**
 * `media_path`, handed over in the query string beside the Firebase config by
 * `src/lib/firebase-messaging.ts`.
 *
 * The worker needs it because every `photo` the API returns is a storage KEY,
 * never a URL — and it cannot go and read `GET /config` for itself: a push
 * arrives with no tab, no store and no session to authenticate with.
 */
const mediaPath = readMediaPath()

function readMediaPath() {
  const raw = new URL(self.location.href).searchParams.get('media')
  return typeof raw === 'string' ? raw.replace(/\/+$/, '') : ''
}

/**
 * A storage key to something the browser can fetch.
 *
 * Mirrors `joinMediaPath` in `src/lib/config-mappers.ts` — including the empty
 * prefix meaning "the key IS the path", which is how a deployment serving media
 * from the app root works. The join is then resolved against the app root rather
 * than against this file, because the worker sits one directory deeper than the
 * page does and a bare key must land in the same place either way.
 */
function mediaUrl(key) {
  if (typeof key !== 'string' || key.length === 0) return ''
  const joined = /^(https?:)?\/\/|^(blob|data):/i.test(key)
    ? key
    : mediaPath
      ? `${mediaPath}/${key.replace(/^\/+/, '')}`
      : key
  try {
    return new URL(joined, new URL(APP_PATH, self.location.origin)).href
  } catch (error) {
    return ''
  }
}

/**
 * The person a banner is ABOUT, in the order the events name them.
 *
 * A loud push is always about somebody: `talk.message.new` about whoever wrote
 * it — which is exactly who the body names, "Test Employee: 12" — and
 * `talk.message.pinned` / `talk.chat.created` about whoever acted. So the icon
 * is their face, and the Talk mark is what is left when there isn't one.
 */
const PHOTO_KEYS = [
  'sender_photo',
  'by_photo',
  'pinned_by_photo',
  'created_by_photo',
  'counterpart_photo',
]

/**
 * The whole event, recovered from `data.payload`.
 *
 * The flat FCM map is no use here: it stringifies every value and drops nested
 * objects, and the photo lives on the `message` inside the event. `data.payload`
 * is the same event the socket published, byte for byte — see
 * `src/features/notifications/lib/push-payload.ts`, which does this for the page.
 */
function readEvent(data) {
  if (typeof data.payload !== 'string' || data.payload.length === 0) return null
  try {
    const parsed = JSON.parse(data.payload)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    return null
  }
}

/**
 * The banner's icon: the sender's photo, DECODED HERE rather than handed over as
 * a URL.
 *
 * A phone camera does not rotate the pixels it writes — it records which way up
 * the camera was in an EXIF tag and leaves the image on its side. Putting that
 * right is the renderer's job, and the PAGE's renderer does it: `<img>` has
 * defaulted to `image-orientation: from-image` for years, which is why the same
 * photo is upright in the account bar. A notification icon never goes through
 * that renderer — it is decoded by the browser's notification pipeline and
 * handed to the desktop, and that path reads no EXIF. Same bytes, same URL, face
 * on its side.
 *
 * There is no flag to ask for it, so the worker decodes the photo itself:
 * `createImageBitmap` with `imageOrientation: 'from-image'` applies the tag,
 * a canvas takes the upright pixels, and the banner is handed a `data:` PNG with
 * the rotation baked in and no EXIF left to misread.
 *
 * Two things come free with it. The photo is cropped and scaled to the shape a
 * banner actually draws — square, and circled to match the app's avatars — so a
 * four-megapixel portrait selfie is neither pushed whole into a 64-pixel corner
 * nor squashed to fit it; and a fetch that FAILS is now visible, which means a
 * photo whose record has gone falls back to the Talk mark instead of drawing
 * nothing.
 */

/** The cap on the icon's side. A smaller photo is never scaled UP to reach it. */
const ICON_SIZE = 192

/**
 * How long the face is chased before the banner is drawn without it.
 *
 * The banner waits on this, so it is deliberately tight: a push that does not
 * show its notification promptly gets the browser's own "this site was updated
 * in the background" banner instead. Over budget, the icon already in hand is
 * used and the photo is simply missed for that message — never the banner.
 *
 * In practice only the FIRST message from a person pays anything at all; see
 * `iconCache`.
 */
const ICON_BUDGET_MS = 1500

/**
 * Decoded icons, keyed by storage key.
 *
 * A conversation arrives in bursts, and every message in one is from the same
 * person: without this, each banner in a run of five pays its own fetch and its
 * own decode against the budget above. A photo at a given key never changes —
 * a new avatar is a new key — so there is nothing to invalidate.
 *
 * Best effort by nature. A worker is killed between pushes whenever the browser
 * feels like it, and the first message after that pays again, which is exactly
 * what the budget is sized for. Capped so a long-lived worker holding a hundred
 * base64 avatars is not a leak.
 */
const iconCache = new Map()
const ICON_CACHE_MAX = 24

function rememberIcon(key, icon) {
  if (iconCache.has(key)) iconCache.delete(key)
  iconCache.set(key, icon)
  // Oldest out first — `Map` iterates in insertion order, and the delete above
  // is what keeps a re-used key from ageing out while it is still in use.
  while (iconCache.size > ICON_CACHE_MAX) {
    iconCache.delete(iconCache.keys().next().value)
  }
}

/**
 * The same icons again, in the Cache API — the half that survives.
 *
 * The Map above lives as long as this worker does, and a worker is killed
 * whenever the browser feels like it: often between two messages in the same
 * conversation. On its own it would leave most pushes paying a full download of
 * the photo, which the network read above cannot avoid.
 *
 * So a decoded icon is written somewhere it outlives the process. What is stored
 * is the finished `data:` URL as plain text, not the photo — already upright,
 * cropped and circled, so a cache hit is a string read and no canvas work.
 *
 * Keyed by STORAGE KEY under a URL that cannot be requested, because a Cache
 * entry needs one and this is not a response to anything. Nothing invalidates
 * it: a photo at a given key never changes, a new avatar is a new key.
 */
const ICON_STORE = 'talk-icon-v1'
const ICON_STORE_MAX = 60

function iconStoreUrl(key) {
  return `https://talk-icon.invalid/${encodeURIComponent(key)}`
}

async function storedIcon(key) {
  try {
    const store = await caches.open(ICON_STORE)
    const hit = await store.match(iconStoreUrl(key))
    return hit ? await hit.text() : null
  } catch (error) {
    // No Cache API, or storage refused. The Map still works.
    return null
  }
}

async function storeIcon(key, icon) {
  try {
    const store = await caches.open(ICON_STORE)
    await store.put(iconStoreUrl(key), new Response(icon, {
      headers: { 'content-type': 'text/plain' },
    }))
    // `keys()` answers in insertion order, so the front of the list is the
    // oldest. Trimmed here rather than on a timer — this is the only writer.
    const keys = await store.keys()
    for (let i = 0; i < keys.length - ICON_STORE_MAX; i += 1) {
      await store.delete(keys[i])
    }
  } catch (error) {
    // Not being able to remember it is not a reason to fail the banner.
  }
}

async function bannerIcon(key, fallback) {
  const remembered = iconCache.get(key)
  if (remembered) return remembered
  const persisted = await storedIcon(key)
  if (persisted) {
    // Back into the Map, so the rest of this burst costs nothing at all.
    rememberIcon(key, persisted)
    return persisted
  }

  const url = mediaUrl(key)
  if (!url) return fallback
  // Over budget hands back the RAW URL, not the fallback: the decode is an
  // improvement on the icon, never the thing that decides there is one.
  const icon = await withBudget(uprightIcon(url, fallback), url)
  // Only a DECODED icon is worth keeping. The raw URL is what we fall back to
  // when the work did not finish, and caching that would make one slow fetch
  // permanent — for the worker's lifetime in the Map, and past it in the store.
  if (icon && icon.startsWith('data:')) {
    rememberIcon(key, icon)
    // AWAITED, deliberately. A worker may be terminated the moment the push
    // event's `waitUntil` settles, so a write left running in the background is
    // a write that often does not happen — and one that does not happen means
    // the next push downloads the photo again, which is the whole thing this is
    // here to avoid. It costs a few milliseconds against a 1.5 s budget, once
    // per person.
    await storeIcon(key, icon)
  }
  return icon
}

function withBudget(promise, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ICON_BUDGET_MS)),
  ])
}

/**
 * Fetch the photo and hand back the best icon this browser can be given.
 *
 * THE ASYMMETRY THIS TURNS ON, because getting it wrong costs the face
 * altogether: the browser loading a notification `icon` is doing an IMAGE load,
 * and an image load is not subject to CORS. `fetch()` from a worker is. So a
 * cross-origin media host that sends no `Access-Control-Allow-Origin` blocks
 * US and not the browser — and a blocked fetch is therefore no evidence at all
 * that the photo cannot be drawn.
 *
 * Hence three endings rather than one, ordered by what each actually proves:
 *
 *  - It THREW (CORS, DNS, offline). Proves nothing about the photo. Hand over
 *    the raw URL and let the browser fetch it as it always did — a sideways
 *    face is a far smaller regression than no face.
 *  - It ANSWERED, badly (404, 403). That is a real answer: the object is gone,
 *    so `fallback` wins — which for the icon upgrade is `null`, meaning the
 *    banner already on screen is left exactly as it was drawn.
 *  - It answered and would not DECODE (no `OffscreenCanvas`, a corrupt file).
 *    The raw URL again — the browser's own decoder may well manage it.
 */
async function uprightIcon(url, fallback) {
  let response = null
  try {
    // `cache: 'reload'` is not an optimisation — it is what makes this WORK
    // cross-origin, and the reason is the page's own avatars.
    //
    // An `<img src>` with no `crossorigin` attribute sends NO `Origin` header,
    // so the CDN answers it without `Access-Control-Allow-Origin` — and without
    // a `Vary` header to say the answer depends on having asked. The browser
    // files that copy under the URL. This fetch then asks for the SAME URL in
    // CORS mode, the browser answers it out of its own cache with the copy that
    // has no ACAO on it, and the CORS check fails on a response that never went
    // near the network: "No 'Access-Control-Allow-Origin' header is present",
    // for a CDN that returns one perfectly well when asked. Every avatar the
    // app has drawn poisons its own push icon.
    //
    // So this read goes to the network unconditionally, where the request does
    // carry `Origin` and the CDN does answer with ACAO. Cheap, because it
    // happens once per person — see `iconCache` and `storedIcon`.
    //
    // Credentials stay at the default, `same-origin`, which sends none
    // cross-origin: a CDN answering `Access-Control-Allow-Credentials` still
    // cannot be asked for a credentialled response under a wildcard, and an
    // avatar needs none.
    response = await fetch(url, { cache: 'reload', mode: 'cors' })
  } catch (error) {
    log('icon fetch blocked here — raw URL, orientation not applied', url, String(error))
    return url
  }

  if (!response.ok) {
    log('icon fetch refused — falling back to the mark', response.status, url)
    return fallback
  }

  let upright = null
  try {
    upright = await redraw(await response.blob())
  } catch (error) {
    upright = null
  }
  if (!upright) {
    log('icon could not be decoded — raw URL, orientation not applied', url)
    return url
  }
  return upright
}

/**
 * Apply the EXIF tag, cover-crop to a circle, hand back a `data:` PNG.
 *
 * The tag is read and applied BY HAND, and that is the whole reason this works.
 * The obvious way is `createImageBitmap(blob, { imageOrientation: 'from-image' })`
 * — one option, the browser does the rotation. But that option is newer than the
 * function, an unsupported enum value THROWS rather than being ignored, and the
 * throw landed in the catch below: `redraw` returned null, the caller fell back
 * to the raw URL, and the banner drew the untouched photo. Which looks exactly
 * like this code never running — no rotation, no square, no circle — while every
 * log line says the photo was found and fetched.
 *
 * So the bytes are parsed for the tag (`exifOrientation`) and the bitmap is
 * decoded with NO options, whose default is `'none'` everywhere and therefore
 * hands back the stored pixels on every browser. What the pixels need doing to
 * them is then a matrix, and a matrix cannot be unsupported.
 *
 * SQUARE is not cosmetic either. An icon slot is square and does not letterbox
 * what it is given — it stretches it to fill. So a portrait photo at its own
 * aspect ratio comes back as a squashed face, which is why this CROPS: the
 * shorter side of the upright image decides a centred square window, and that
 * window is what gets drawn. The same `object-fit: cover` the app's avatars use,
 * done with pixels because there is no stylesheet out here. Centred rather than
 * top-weighted — a `photo` is whatever the person uploaded, not a portrait crop.
 *
 * The circle is a `clip` before the draw, so the corners come out TRANSPARENT
 * rather than painted; a colour there would be a square of it on whatever
 * background the desktop uses. Drawn even though some platforms mask the icon
 * themselves — a circle inside a circle is still a circle, where trusting the
 * platform leaves a hard-edged square on the ones that don't.
 *
 * Never UPSCALED: a small avatar keeps its own resolution rather than being
 * blown up to the cap and going soft.
 */
async function redraw(blob) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    log('icon decode unavailable in this browser')
    return null
  }
  let bitmap = null
  try {
    const meta = await readJpegMeta(blob)
    bitmap = await createImageBitmap(blob)
    // NOT the file's tag — what is LEFT of it once the decoder has had its turn.
    // See `resolveOrientation`; getting this wrong rotates the icon twice.
    const orientation = resolveOrientation(meta, bitmap)

    // A quarter turn swaps the axes, so the UPRIGHT size is not the bitmap's —
    // and every measurement below is taken in upright space, because that is the
    // space the crop has to be centred in.
    const turned = swapsAxes(orientation)
    const uprightWidth = turned ? bitmap.height : bitmap.width
    const uprightHeight = turned ? bitmap.width : bitmap.height
    const crop = Math.min(uprightWidth, uprightHeight)
    if (crop <= 0) return null
    const cropX = (uprightWidth - crop) / 2
    const cropY = (uprightHeight - crop) / 2
    const side = Math.max(1, Math.round(Math.min(ICON_SIZE, crop)))

    const canvas = new OffscreenCanvas(side, side)
    const context = canvas.getContext('2d')
    if (!context) return null

    // Clipped FIRST, in plain canvas pixels. A clip is fixed in device space at
    // the moment it is set, so the transforms below move the IMAGE inside it and
    // never the circle.
    const radius = side / 2
    context.beginPath()
    context.arc(radius, radius, radius, 0, Math.PI * 2)
    context.clip()

    // Two matrices, applied innermost first: the stored pixels are put upright,
    // then the upright image's centre square is scaled into the canvas.
    const scale = side / crop
    context.setTransform(scale, 0, 0, scale, -cropX * scale, -cropY * scale)
    context.transform(...orientationMatrix(orientation, uprightWidth, uprightHeight))
    context.drawImage(bitmap, 0, 0)

    log('icon redrawn', {
      tag: meta.orientation,
      applied: orientation,
      decoderAppliesExif,
      stored: `${meta.storedWidth}x${meta.storedHeight}`,
      decoded: `${bitmap.width}x${bitmap.height}`,
      side,
    })
    return await toDataUrl(await canvas.convertToBlob({ type: 'image/png' }))
  } catch (error) {
    log('icon decode failed', String(error))
    return null
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close()
  }
}

/** Orientations 5–8 are quarter turns: they swap the image's axes. */
function swapsAxes(orientation) {
  return orientation >= 5 && orientation <= 8
}

/**
 * EXIF orientation as the matrix that maps STORED pixel coordinates onto upright
 * ones, in the upright image's own dimensions.
 *
 * The eight cases are the four rotations and their mirrors, exactly as the tag
 * defines them; `1` and anything unrecognised are the identity.
 */
function orientationMatrix(orientation, width, height) {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, width, 0]
    case 3:
      return [-1, 0, 0, -1, width, height]
    case 4:
      return [1, 0, 0, -1, 0, height]
    case 5:
      return [0, 1, 1, 0, 0, 0]
    case 6:
      return [0, 1, -1, 0, width, 0]
    case 7:
      return [0, -1, -1, 0, width, height]
    case 8:
      return [0, -1, 1, 0, 0, height]
    default:
      return [1, 0, 0, 1, 0, 0]
  }
}

/**
 * How much of the file is read looking at the header.
 *
 * EXIF lives in an APP1 segment near the front and the frame header is not far
 * behind it, so this never needs the whole photo — and must not read it, since
 * the point is to touch a few kilobytes rather than pull megapixels through a
 * DataView.
 */
const EXIF_SCAN_BYTES = 128 * 1024

/**
 * What the FILE says about itself: the orientation tag, and the dimensions of
 * the pixels as STORED.
 *
 * Both, from one walk of the markers, because neither is any use alone —
 * `resolveOrientation` needs to compare the stored shape against the decoded
 * one. `orientation: 1` with no dimensions is the honest answer for anything
 * that is not a JPEG (a PNG, a WebP): the stored pixels are already upright,
 * which is what 1 says, and there is nothing to compare.
 */
async function readJpegMeta(blob) {
  const meta = { orientation: 1, storedWidth: 0, storedHeight: 0 }
  try {
    const view = new DataView(await blob.slice(0, EXIF_SCAN_BYTES).arrayBuffer())
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return meta

    let offset = 2
    while (offset + 4 <= view.byteLength) {
      // Every marker starts with 0xFF. Anything else means we have lost the
      // frame and are reading pixels as headers, so stop.
      if (view.getUint8(offset) !== 0xff) break
      const marker = view.getUint8(offset + 1)
      // Start of scan, or end of image: the metadata is behind us.
      if (marker === 0xda || marker === 0xd9) break
      const size = view.getUint16(offset + 2)
      if (size < 2) break

      if (marker === 0xe1 && meta.orientation === 1) {
        // An APP1 segment can hold other things — XMP, for one — so the first
        // one is not necessarily the Exif one.
        const found = readOrientationTag(view, offset + 4)
        if (found) meta.orientation = found
      } else if (isFrameHeader(marker) && offset + 9 <= view.byteLength) {
        // SOFn: height then width, both 16-bit, after the precision byte.
        meta.storedHeight = view.getUint16(offset + 5)
        meta.storedWidth = view.getUint16(offset + 7)
      }

      offset += 2 + size
    }
  } catch (error) {
    // A header we cannot read is a header we do not act on.
  }
  return meta
}

/**
 * SOF0–SOF15, which is where a JPEG states its size — minus the three markers
 * in that range that mean something else (DHT, JPG, DAC).
 */
function isFrameHeader(marker) {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  )
}

/** Read tag 0x0112 out of one APP1 segment. 0 means "not in this one". */
function readOrientationTag(view, start) {
  if (start + 14 > view.byteLength) return 0
  // "Exif\0\0"
  if (view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return 0

  const tiff = start + 6
  const byteOrder = view.getUint16(tiff)
  const little = byteOrder === 0x4949
  if (!little && byteOrder !== 0x4d4d) return 0
  if (view.getUint16(tiff + 2, little) !== 0x002a) return 0

  const ifd = tiff + view.getUint32(tiff + 4, little)
  if (ifd + 2 > view.byteLength) return 0
  const entries = view.getUint16(ifd, little)
  for (let i = 0; i < entries; i += 1) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > view.byteLength) return 0
    if (view.getUint16(entry, little) !== 0x0112) continue
    const value = view.getUint16(entry + 8, little)
    return value >= 1 && value <= 8 ? value : 0
  }
  return 0
}

/**
 * Whether THIS browser's decoder has already applied the EXIF tag, learnt from
 * an image that could prove it. Null until one has.
 *
 * `createImageBitmap` used to default to `imageOrientation: 'none'` and now
 * defaults to `'from-image'` — the spec changed, and `'none'` became a
 * deprecated alias for the new default rather than a way back to the old
 * behaviour. So there is no option to ask for either answer reliably, and the
 * only honest thing to do is look at what came back.
 */
let decoderAppliesExif = null

/**
 * How much rotation is left to do, given what the file says and what the
 * decoder handed back.
 *
 * This is the whole bug that made a portrait-stored, EXIF-8 photo come out
 * sideways in the banner: the tag was read from the bytes and applied by hand ON
 * TOP of a decoder that had already applied it, so the icon was rotated twice.
 * A photo with no tag was untouched by both and looked perfectly fine, which is
 * why only some images were wrong.
 *
 * The measurement is the point. A quarter turn (tags 5–8) CHANGES THE SHAPE, so
 * for those the bitmap's own dimensions say plainly whether the decoder did it:
 * come back swapped against the stored size and it did, come back the same and
 * it did not. That answer is also remembered, because it is a property of the
 * browser and not of the photo.
 *
 * Tags 2, 3 and 4 — mirrors and a half turn — leave the shape alone and can
 * therefore not be measured at all. They fall back to what an earlier image
 * taught us, and failing that to `'from-image'`, which is what every current
 * browser does.
 */
function resolveOrientation(meta, bitmap) {
  const { orientation, storedWidth, storedHeight } = meta
  // The identity: nothing to apply, and nothing to get wrong.
  if (orientation === 1) return 1

  const measurable = storedWidth > 0 && storedHeight > 0 && storedWidth !== storedHeight
  if (measurable && swapsAxes(orientation)) {
    const applied = bitmap.width === storedHeight && bitmap.height === storedWidth
    decoderAppliesExif = applied
    return applied ? 1 : orientation
  }

  return decoderAppliesExif === false ? orientation : 1
}

/**
 * A blob as a `data:` URL.
 *
 * `URL.createObjectURL` is not available to a service worker, and a blob URL
 * would not outlive this handler anyway — the banner has to hold the bytes.
 */
async function toDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // A chunk at a time: `String.fromCharCode(...bytes)` blows the argument limit
  // on anything but a tiny image.
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`
}

/** The first photo key the event offers, from the event or the record inside it. */
function photoKeyOf(event) {
  if (!event) return null
  for (const scope of [event, event.message, event.chat]) {
    if (!scope || typeof scope !== 'object') continue
    for (const key of PHOTO_KEYS) {
      const value = scope[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  return null
}

/** Worker-side tracing. The worker has its own console — DevTools → Application
 *  → Service workers → inspect — so a push that never reaches a tab is still
 *  visible here. */
function log(...args) {
  console.log('[talk-sw]', ...args)
}

log(firebaseConfig ? 'firebase config loaded' : 'NO firebase config in worker URL')

/**
 * A tap that had to COLD-START the app has no page to hand the event to yet, so
 * it is held here until the new tab asks for it. Best effort by nature: a worker
 * may be killed between the tap and the page booting, and the app opens on its
 * last conversation instead, which is a fine place to land.
 */
let pendingClick = null

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/** Hand an event to every tab we have, hidden ones included. */
async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) client.postMessage(message)
  return clients
}

self.addEventListener('message', (event) => {
  // A freshly opened tab asking for the tap that started it.
  if (event.data && event.data.type === PUSH_CLAIM_CLICK_MESSAGE) {
    const claimed = pendingClick
    pendingClick = null
    event.source?.postMessage({ type: PUSH_CLICK_MESSAGE, payload: claimed })
  }
})

/**
 * The banner icon of LAST resort — a nameless sender, a record whose master row
 * is gone, or a push with no `payload` to read a photo out of. Without a
 * fallback here the browser draws ITS OWN logo, so the banner would read as
 * Chrome rather than as Talk. A static asset, because the worker cannot import
 * the lucide mark the app draws in the page.
 */
const ICON_PATH = `${APP_PATH}talk-icon-192.png`

/** A tab that is being LOOKED AT — the case that draws no banner. */
function hasVisibleClient(clients) {
  return clients.some(
    (client) =>
      client.visibilityState === 'visible' &&
      // Extension background pages report themselves visible, always.
      !client.url.startsWith('chrome-extension://'),
  )
}

/**
 * The push, handled HERE and nowhere else.
 *
 * `onBackgroundMessage` is the wrong hook to draw a banner from, and this is
 * why: the SDK's own `push` handler shows a notification whenever the payload
 * carries a `notification` block, and only THEN calls the background hook (see
 * `onPush` in `@firebase/messaging/dist/index.sw.cjs`). So a `showNotification`
 * in that hook draws the SECOND banner, not the first — two identical banners
 * per message, and they do not collapse into one, because the SDK's carries no
 * tag for ours to collapse against.
 *
 * So this listener is registered BEFORE `firebase.messaging()` creates the
 * SDK's, and stops the event dead. Everything the SDK's handler did happens
 * here instead: forward to every tab, then draw at most ONE banner. The SDK is
 * still initialised below, for `pushsubscriptionchange`.
 */
self.addEventListener('push', (event) => {
  // Synchronous and FIRST — `stopImmediatePropagation` only counts before the
  // other listener on this target runs, and `waitUntil` would be too late.
  event.stopImmediatePropagation()
  event.waitUntil(onPush(event))
})

async function onPush(event) {
  let payload = null
  try {
    payload = event.data ? event.data.json() : null
  } catch (error) {
    // Not JSON, so not one of ours. Nothing to apply and nothing to draw.
  }
  if (!payload) {
    log('push with no readable body — ignored')
    return
  }

  const data = payload.data || {}
  const notification = payload.notification || {}
  log('push', {
    type: data.type || null,
    chat_id: data.chat_id || null,
    loud: Boolean(notification.body),
    data,
  })

  // Forward FIRST, and unconditionally. A tab holds the live stores whether or
  // not it is visible, and applying the event matters more than the banner.
  const clients = await broadcast({ type: PUSH_EVENT_MESSAGE, data })

  // A tab being looked at draws nothing: the thread may already be open, and
  // the forward above has applied the event. This is the branch the SDK used to
  // route to `onMessage` in the page.
  if (hasVisibleClient(clients)) {
    log('visible tab — forwarded, no banner')
    return
  }

  // SILENT: the event exists to keep a backgrounded client correct, not to
  // buzz. `notification` absent, or present with a null body.
  if (!notification.body) {
    log('silent push — forwarded, no banner')
    return
  }

  const chatId = data.chat_id ? String(data.chat_id) : 'talk'
  const title = notification.title || 'Talk'

  // ONE `showNotification`, with the icon settled before it.
  //
  // This drew the banner first and swapped the face in afterwards for a while,
  // on the theory that the icon must never be able to cost the notification.
  // The theory was right and the mechanism was wrong: a second call on the same
  // TAG replaces the notification, and a replacement that is `silent` with no
  // `renotify` is not re-popped — it lands straight in the tray. So the banner
  // appeared and was whipped away a moment later, which is worse than any icon.
  //
  // What made the two-step unnecessary is that `bannerIcon` cannot fail. Every
  // branch of it resolves to a string, nothing in it rejects, and `withBudget`
  // caps the whole thing — so awaiting it delays the banner by a bounded moment
  // at worst and can never lose it.
  const photoKey = photoKeyOf(readEvent(data))
  const icon = photoKey
    ? await bannerIcon(photoKey, notification.icon || ICON_PATH)
    : notification.icon || ICON_PATH

  await self.registration.showNotification(title, {
    body: notification.body,
    icon,
    // One conversation collapses into one banner rather than stacking a
    // notification per message; `renotify` still alerts on the newer one.
    tag: `talk-chat-${chatId}`,
    renotify: true,
    data: { talkData: data },
  })
  log('banner shown', title, notification.body, {
    photo: photoKey || null,
    // A `data:` URL is thousands of characters — log only which kind we drew.
    icon: icon.startsWith('data:') ? 'decoded, upright, circular' : icon,
  })
}

if (firebaseConfig) {
  firebase.initializeApp(firebaseConfig)
  // Initialised for what it still owns — `pushsubscriptionchange`, which
  // re-registers this browser when the browser rotates the subscription keys
  // underneath us. Its `push` listener is added right here, AFTER ours, and
  // never runs.
  firebase.messaging()
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  log('banner tapped')
  const data = (event.notification.data && event.notification.data.talkData) || null

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const open = clients.find((client) => client.url.includes(APP_PATH))
      if (open) {
        await open.focus()
        open.postMessage({ type: PUSH_CLICK_MESSAGE, payload: data })
        return
      }
      // Cold start: nothing to hand it to yet, so it waits to be claimed.
      pendingClick = data
      await self.clients.openWindow(CHAT_PATH)
    })(),
  )
})
