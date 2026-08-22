/**
 * What a file IS, read from its first bytes — not from what it is called.
 *
 * A browser decides `File.type` from the EXTENSION, so renaming `payload.exe`
 * to `photo.png` is enough to satisfy an `accept=` attribute, a `type` check and
 * the presign's content-type enum all at once. The bytes are the only part of
 * the pick an attacker cannot rewrite for free, so every upload is read here
 * before it is presigned: the declared type has to match the container actually
 * on disk, or the file never leaves the machine.
 *
 * This is a client-side gate and it is worth exactly what a client-side gate is
 * worth — the server still validates. What it buys is the rejection happening
 * on `change`, before a 25 MB body goes up to be refused.
 */

/** Enough for every signature below — the longest reach is an `ftyp` brand at 8. */
const HEADER_BYTES = 64

const bytesAt = (b: Uint8Array, at: number, ...seq: number[]) =>
  seq.every((byte, i) => b[at + i] === byte)

const starts = (b: Uint8Array, ...seq: number[]) => bytesAt(b, 0, ...seq)

const ascii = (b: Uint8Array, at: number, text: string) =>
  [...text].every((ch, i) => b[at + i] === ch.charCodeAt(0))

/** An ISO-BMFF box header — MP4, MOV, M4A and HEIC all wear one. */
const ftypBrand = (b: Uint8Array): string | null => {
  if (!ascii(b, 4, 'ftyp')) return null
  let brand = ''
  for (let i = 8; i < 12; i += 1) brand += String.fromCharCode(b[i] ?? 0)
  return brand
}

const isZip = (b: Uint8Array) =>
  starts(b, 0x50, 0x4b, 0x03, 0x04) || // a normal archive
  starts(b, 0x50, 0x4b, 0x05, 0x06) || // an empty one
  starts(b, 0x50, 0x4b, 0x07, 0x08) //  a spanned one

/** The OLE compound file the pre-2007 Office formats are stored in. */
const isOleCompound = (b: Uint8Array) =>
  starts(b, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)

const isRiff = (b: Uint8Array, form: string) => ascii(b, 0, 'RIFF') && ascii(b, 8, form)

const isEbml = (b: Uint8Array) => starts(b, 0x1a, 0x45, 0xdf, 0xa3)

/**
 * Things no upload here may ever be, whatever it claims.
 *
 * Checked before the per-type table so the message can say what the file really
 * is — "that is a program" is a different problem from "that is the wrong kind
 * of picture", and only the first is worth naming plainly.
 */
const EXECUTABLE_SIGNATURES: ReadonlyArray<{ what: string; test: (b: Uint8Array) => boolean }> = [
  { what: 'a Windows program', test: (b) => starts(b, 0x4d, 0x5a) },
  { what: 'a Linux program', test: (b) => starts(b, 0x7f, 0x45, 0x4c, 0x46) },
  {
    what: 'a macOS program',
    test: (b) =>
      starts(b, 0xfe, 0xed, 0xfa, 0xce) ||
      starts(b, 0xfe, 0xed, 0xfa, 0xcf) ||
      starts(b, 0xcf, 0xfa, 0xed, 0xfe) ||
      starts(b, 0xce, 0xfa, 0xed, 0xfe) ||
      starts(b, 0xca, 0xfe, 0xba, 0xbe),
  },
  { what: 'a WebAssembly module', test: (b) => starts(b, 0x00, 0x61, 0x73, 0x6d) },
  { what: 'a shell script', test: (b) => starts(b, 0x23, 0x21) },
]

/** Markup a browser would run if it were ever served back. */
const MARKUP_PREFIXES = ['<!doctype html', '<html', '<svg', '<?xml', '<?php', '<script']

const looksLikeMarkup = (b: Uint8Array) => {
  let head = ''
  for (let i = 0; i < Math.min(b.length, HEADER_BYTES); i += 1) head += String.fromCharCode(b[i])
  const trimmed = head.trimStart().toLowerCase()
  return MARKUP_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

/**
 * One test per content type the presign will sign for.
 *
 * A type absent from the table is not checked — but every entry in
 * `ATTACHMENT_CONTENT_TYPES` and `AVATAR_CONTENT_TYPES` is present, so in
 * practice the only unchecked files are the two text types, which go through
 * `isPlainText` below instead.
 */
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => starts(b, 0xff, 0xd8, 0xff),
  'image/png': (b) => starts(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  'image/gif': (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'),
  'image/webp': (b) => isRiff(b, 'WEBP'),
  // An iPhone photo: HEIC, HEIF and the burst/sequence brands all count.
  'image/heic': (b) =>
    ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(ftypBrand(b) ?? ''),

  // Any ISO-BMFF brand passes for MP4: the list of registered ones is long and
  // growing, and the container is what matters here.
  'video/mp4': (b) => ftypBrand(b) !== null,
  'video/quicktime': (b) =>
    ftypBrand(b) !== null ||
    ['moov', 'mdat', 'free', 'skip', 'wide', 'pnot'].some((box) => ascii(b, 4, box)),
  'video/webm': isEbml,

  // ID3-tagged, or a bare frame sync: 11 set bits.
  'audio/mpeg': (b) => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  'audio/mp4': (b) => ftypBrand(b) !== null,
  // ADTS or ADIF, and .aac files are routinely just an MP4 or MP3 stream.
  'audio/aac': (b) =>
    (b[0] === 0xff && (b[1] & 0xf0) === 0xf0) ||
    ascii(b, 0, 'ADIF') ||
    ascii(b, 0, 'ID3') ||
    ftypBrand(b) !== null,
  'audio/ogg': (b) => ascii(b, 0, 'OggS'),
  'audio/wav': (b) => isRiff(b, 'WAVE'),
  'audio/webm': isEbml,

  'application/pdf': (b) => ascii(b, 0, '%PDF-'),

  // OOXML is a zip; the legacy formats are OLE — but a .docx handed over under
  // the old extension is common enough that both are allowed for both.
  'application/msword': (b) => isOleCompound(b) || isZip(b),
  'application/vnd.ms-excel': (b) => isOleCompound(b) || isZip(b),
  'application/vnd.ms-powerpoint': (b) => isOleCompound(b) || isZip(b),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isZip,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': isZip,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': isZip,

  'application/zip': isZip,
  'application/x-rar-compressed': (b) =>
    ascii(b, 0, 'Rar!') && b[4] === 0x1a && b[5] === 0x07,
}

/** The two types with no signature of their own, checked by exclusion instead. */
const TEXT_TYPES = new Set(['text/plain', 'text/csv'])

/**
 * Text has no magic number, so it is recognised by what it is NOT: a NUL byte
 * inside the first block means a binary file wearing a `.txt`, and the
 * signature tables catch the rest.
 */
const isPlainText = (b: Uint8Array) => {
  for (let i = 0; i < b.length; i += 1) if (b[i] === 0x00) return false
  return !Object.values(SIGNATURES).some((test) => test(b)) && !looksLikeMarkup(b)
}

/**
 * Read the head of a file and say what is wrong with it, or `null` if the bytes
 * agree with the declared type.
 *
 * The message names the file, because a batch of fifteen is rejected item by
 * item and "that file is not really an image" would not say which.
 */
export async function fileSignatureProblem(file: File): Promise<string | null> {
  if (file.size === 0) return `${file.name} is empty`

  const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())

  const executable = EXECUTABLE_SIGNATURES.find((entry) => entry.test(head))
  if (executable) return `${file.name} is ${executable.what}, whatever it is named`

  const check = SIGNATURES[file.type]
  if (check) {
    return check(head)
      ? null
      : `${file.name} isn't really a ${describe(file.type)} — renaming a file doesn't change what it is`
  }

  if (TEXT_TYPES.has(file.type)) {
    return isPlainText(head)
      ? null
      : `${file.name} isn't really text — renaming a file doesn't change what it is`
  }

  return null
}

/** Reject a whole batch in parallel; answers one line per file that failed. */
export async function fileSignatureProblems(files: readonly File[]): Promise<Map<File, string>> {
  const problems = new Map<File, string>()
  const checked = await Promise.all(
    files.map(async (file) => [file, await fileSignatureProblem(file)] as const),
  )
  for (const [file, problem] of checked) if (problem) problems.set(file, problem)
  return problems
}

/** A content type as a person would say it, for the message above. */
function describe(type: string): string {
  if (type.startsWith('image/')) return `${type.slice(6).toUpperCase()} image`
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio file'
  if (type === 'application/pdf') return 'PDF'
  if (type === 'application/zip') return 'ZIP archive'
  if (type === 'application/x-rar-compressed') return 'RAR archive'
  return 'document'
}
