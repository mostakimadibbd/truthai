// Server-side PDF text extraction (Phase 7).
//
// PDFs attached to a chat are NEVER handed to a paid parsing plugin
// and their text is never trusted from the client: the server
// downloads the stored Cloudinary asset through the authenticated
// access path (see chat-attachments.ts), verifies the "%PDF-"
// signature, and extracts the text layer here with unpdf — a
// pure-JS, pdf.js-based extractor (free OSS, no per-page fees, no
// external calls). Extracted text then joins the same prompt path
// and the same truncation budget as TXT/MD/CSV files
// (MAX_EXTRACTED_TEXT in chat-attachments.ts: 60,000 characters of
// extracted text per request across all attachments).
//
// Limits: PDFs over MAX_PDF_BYTES are refused before parsing, and
// extraction is capped at MAX_PDF_PAGES pages. A PDF with no text
// layer (a scan of images) yields no text — the caller turns that
// into a clear user-facing error rather than sending an empty file
// to the model.

export const MAX_PDF_BYTES = 10 * 1024 * 1024; // matches the upload cap
export const MAX_PDF_PAGES = 100;

export async function extractPdfText(bytes: Buffer): Promise<string> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("An attached PDF is larger than the 10 MB limit.");
  }
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("An attached PDF failed file-signature validation.");
  }
  // Imported lazily so the pdf.js bundle is only loaded on requests
  // that actually carry a PDF.
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new Error("An attached PDF couldn’t be read. It may be corrupt or password-protected.");
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `An attached PDF has ${pdf.numPages} pages; PDFs over ${MAX_PDF_PAGES} pages can’t be analysed.`,
      );
    }
    const { text } = await extractText(pdf, { mergePages: true });
    return typeof text === "string" ? text : "";
  } finally {
    // pdf.js documents hold worker resources; destroy when the
    // runtime exposes it (unpdf's typings don't declare it).
    const destroyable = pdf as unknown as {
      destroy?: () => Promise<void>;
    };
    await destroyable.destroy?.().catch(() => undefined);
  }
}
