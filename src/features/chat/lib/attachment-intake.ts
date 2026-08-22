import { fileSignatureProblems } from '@/lib/file-signature'
import { ATTACHMENT_CONTENT_TYPES, MAX_ATTACHMENT_BYTES } from '@/lib/uploads'
import { MAX_ATTACHMENTS } from '../constants'

/** HEIC/HEIF by name, for the photos a browser hands over with no MIME type. */
const HEIC_NAME = /\.(heic|heif)$/i

export interface AttachmentIntake {
  /** The files that may be sent, already capped to the room left. */
  accepted: File[]
  /** One line per file that was left out, saying why. */
  rejected: string[]
}

/**
 * Decide which of a picked or dropped batch can actually be sent.
 *
 * Shared, because both the file picker and the thread-wide drop target run it
 * and neither should own the rules. The presign signs a content type from a
 * fixed enum and caps the size, so both checks happen here rather than as a 400
 * after the upload wait.
 *
 * Async only because of the last check: the name and the `type` a browser
 * derives from it are both free to lie, so the HEAD of each file is read and
 * matched against the container it claims to be. That is a `File.slice()` read,
 * so it is cheap even for a 25 MB video — the bytes past the first 64 are never
 * touched.
 */
export async function intakeAttachments(
  picked: FileList | File[] | null,
  heldCount: number,
): Promise<AttachmentIntake> {
  if (!picked) return { accepted: [], rejected: [] }

  // An iPhone photo often arrives with an empty `type`, which would then be
  // presigned as "" and rejected. Stamp it before anything else looks at it —
  // the PUT header has to match what was signed, so guessing once, here, keeps
  // the two ends agreeing.
  const incoming = [...picked].map((file) =>
    file.type === '' && HEIC_NAME.test(file.name)
      ? new File([file], file.name, { type: 'image/heic', lastModified: file.lastModified })
      : file,
  )
  if (incoming.length === 0) return { accepted: [], rejected: [] }

  // One bad file in a selection of fifteen does not throw the other fourteen
  // away: keep everything that can be sent, then say what was left out and why.
  const rejected: string[] = []
  const sendable = incoming.filter((file) => {
    if (!(ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      rejected.push(`${file.name} isn't a file type this chat accepts`)
      return false
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      rejected.push(`${file.name} is over 25 MB`)
      return false
    }
    return true
  })

  // Only now, on the files that got past the cheap checks: what the bytes say.
  // A `.exe` renamed to `.png` arrives here as a perfectly valid `image/png`
  // pick, and this is the only test it fails.
  const misnamed = await fileSignatureProblems(sendable)
  const genuine = sendable.filter((file) => {
    const problem = misnamed.get(file)
    if (problem) rejected.push(problem)
    return !problem
  })

  // Each file is a separate presign and PUT, so the cap is a real limit on how
  // long the send takes. The first ones in fill the room that is left and the
  // rest are named, never dropped silently.
  const room = Math.max(0, MAX_ATTACHMENTS - heldCount)
  const accepted = genuine.slice(0, room)
  const overflow = genuine.length - accepted.length
  if (overflow > 0) {
    rejected.push(
      `${overflow} more didn't fit — ${MAX_ATTACHMENTS} files is the most one message can carry`,
    )
  }

  return { accepted, rejected }
}
