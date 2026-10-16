export const scannerSupported = false;

export async function scanPages(): Promise<string[] | null> {
  throw new Error('Document scanning is only available in the Android app.');
}

export async function pagesToPdf(_pageUris: string[]): Promise<string> {
  throw new Error('Document scanning is only available in the Android app.');
}
