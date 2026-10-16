import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';

export const scannerSupported = true;

/**
 * Opens Google's on-device document scanner (edge detection, crop, enhance).
 * Returns page image URIs, or null if the user cancelled.
 */
export async function scanPages(): Promise<string[] | null> {
  let result;
  try {
    result = await DocumentScanner.scanDocument({ maxNumDocuments: 24, responseType: ResponseType.ImageFilePath });
  } catch {
    throw new Error('The document scanner is not available. It needs Google Play services — try again in a moment.');
  }
  if (result.status === ScanDocumentResponseStatus.Cancel || !result.scannedImages?.length) return null;
  return result.scannedImages.map((p) => (p.startsWith('file://') || p.startsWith('content://') ? p : `file://${p}`));
}

/** Combines page images into an A4 PDF (images are embedded as data URIs). */
export async function pagesToPdf(pageUris: string[]): Promise<string> {
  const pages = await Promise.all(pageUris.map(async (uri) => new File(uri).base64()));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; } body { margin: 0; }
    .page { width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
  </style></head><body>${pages
    .map((b64) => `<div class="page"><img src="data:image/jpeg;base64,${b64}"/></div>`)
    .join('')}</body></html>`;
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  return uri;
}
