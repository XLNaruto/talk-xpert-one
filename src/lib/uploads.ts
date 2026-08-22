import axios from 'axios'
import { apiClient } from './api-client'
import { toApiError } from './api-error'
import { fileSignatureProblem } from './file-signature'

/**
 * Presigned direct-to-storage uploads — the three-step send from §7.
 *
 *   1. POST .../presign  → { upload_url, key }
 *   2. PUT  upload_url    with the exact Content-Type and byte count
 *   3. POST .../messages  carrying the `key` as `file_url`
 *
 * Bytes never pass through the API, and nothing is written to the database by
 * the handshake — an abandoned upload leaves a stray object and no half-saved
 * row. Only the object KEY is stored on the message; prefix it with the
 * server's `media_path` to display it.
 */

/** A signed PUT target plus the key to store once the bytes are up. */
export interface PresignedUpload {
  uploadUrl: string
  key: string
}

interface PresignResponseDto {
  upload_url: string
  key: string
}

/** Talk's own cap, enforced before a URL is issued (a 400 past it). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * Every content type the attachment presign will sign for, straight from the
 * OpenAPI enum. Anything a browser would execute — `.html`, `.svg`, an
 * executable — is deliberately absent.
 */
export const ATTACHMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-rar-compressed',
] as const

/** The group picture presign takes images only, and no size field. */
export const AVATAR_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

/**
 * Ask for a signed PUT.
 *
 * `size_bytes` is signed INTO the url for an attachment, so under-reporting it
 * does not buy a bigger upload — storage rejects a body of any other length.
 * The avatar presign takes no size at all, so it is omitted rather than sent as
 * a zero the server would reject.
 */
export async function presignUpload(
  endpoint: string,
  file: File,
  { withSize = true }: { withSize?: boolean } = {},
): Promise<PresignedUpload> {
  const res = await apiClient.post<PresignResponseDto>(endpoint, {
    content_type: file.type,
    file_name: file.name,
    ...(withSize ? { size_bytes: file.size } : {}),
  })
  return { uploadUrl: res.data.upload_url, key: res.data.key }
}

/**
 * Presign, PUT the bytes, and answer the key to store on the message.
 *
 * `onProgress` reports 0–1 across the PUT, which is the only slow step — the
 * composer shows it so a 20 MB video doesn't look like a frozen send.
 */
export async function uploadFile(
  endpoint: string,
  file: File,
  {
    allowed,
    withSize = true,
    onProgress,
  }: {
    allowed?: readonly string[]
    withSize?: boolean
    onProgress?: (fraction: number) => void
  } = {},
): Promise<string> {
  if (allowed && !allowed.includes(file.type)) {
    throw new Error(`${file.type || 'That file type'} can't be attached.`)
  }
  if (withSize && file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachments must be under 25 MB.')
  }
  // The backstop for the check the pickers already ran: `type` comes from the
  // extension, so it agrees with a renamed file and the bytes do not. Nothing
  // reaches the presign without this, whichever screen chose the file.
  const misnamed = await fileSignatureProblem(file)
  if (misnamed) throw new Error(`${misnamed}.`)

  const { uploadUrl, key } = await presignUpload(endpoint, file, { withSize })

  try {
    // Bare axios, not `apiClient`: the presigned URL carries its own signature
    // and storage rejects a request that also arrives with our bearer header.
    // Content-Type must be byte-identical to what was signed for.
    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': file.type },
      onUploadProgress: onProgress
        ? (event) => onProgress(event.total ? event.loaded / event.total : 0)
        : undefined,
    })
  } catch (error) {
    throw new Error(toApiError(error, "The upload didn't finish. Try again.").message)
  }

  return key
}
