// Bridges file-save operations to the native save dialog when running
// inside Electron (window.motorlens, exposed by electron/preload.ts) and
// falls back to the browser anchor-click download otherwise. This is the
// only renderer-side awareness of Electron in the whole app.

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface MotorlensBridge {
  appInfo(): Promise<{ version: string; platform: string }>
  saveFile(req: {
    defaultName: string
    data: ArrayBuffer
    filters?: FileFilter[]
  }): Promise<{ saved: boolean; path?: string }>
  openFile(filters?: FileFilter[]): Promise<{ name: string; data: ArrayBuffer } | null>
}

declare global {
  interface Window {
    motorlens?: MotorlensBridge
  }
}

function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** True when running inside the Electron shell (preload bridge present). */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.motorlens != null
}

/**
 * Saves a Blob to disk: a native save dialog under Electron, or the
 * browser's anchor-click download otherwise. Never throws — a cancelled
 * native dialog just means the file wasn't saved.
 */
export async function savePlatformFile(
  blob: Blob,
  filename: string,
  filters?: FileFilter[],
): Promise<void> {
  const bridge = window.motorlens
  if (!bridge) {
    anchorDownload(blob, filename)
    return
  }
  const data = await blob.arrayBuffer()
  await bridge.saveFile({ defaultName: filename, data, filters })
}
