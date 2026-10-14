/**
 * files.ts — handing a file to the patient.
 *
 * A browser downloads it. A phone writes it to the app's cache and opens the
 * system share sheet, so the patient chooses where it goes (Files, email, a
 * messaging app). An <a download> link does nothing inside an Android WebView.
 */

import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNative } from './platform'

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function deliverFile(filename: string, blob: Blob, shareTitle: string): Promise<void> {
  if (!isNative) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return
  }

  // Cache, not Documents: the copy exists only to be handed to the share sheet,
  // and the OS may clear it. Nothing health-related is left lying in shared storage.
  const written = await Filesystem.writeFile({
    path: filename,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  })
  await Share.share({ title: shareTitle, files: [written.uri], dialogTitle: shareTitle })
}
