import { documentUrl, type DocumentFormat } from "@/lib/api";

/**
 * Fetch a rendered document and save it: the native Save dialog in the desktop
 * app, a normal browser download in the web build. Returns the saved path/name,
 * or null when the user cancels the dialog.
 */
export async function saveDocument(document: {
  id: string;
  format: DocumentFormat;
  filename: string;
}): Promise<string | null> {
  const response = await fetch(documentUrl(document.id, document.format));
  if (!response.ok) throw new Error(`Could not fetch the file (${response.status})`);
  const data = await response.arrayBuffer();
  const bridge = window.contextgit;
  if (bridge) {
    return await bridge.saveFile({ defaultName: document.filename, data });
  }
  const url = URL.createObjectURL(new Blob([data]));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = document.filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return document.filename;
}
