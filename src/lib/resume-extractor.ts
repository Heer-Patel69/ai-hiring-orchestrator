import * as fflate from "fflate";

export interface ExtractedResumeText {
  text: string;
  fileName: string;
  fileType: "pdf" | "docx" | "text" | "unknown";
  pageCount?: number;
}

/**
 * Configure PDF.js worker in browser environment
 */
let pdfjsLib: any = null;

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  const pdfjs = await import("pdfjs-dist");
  // Set worker source to CDN or local fallback
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version || "3.11.174"}/pdf.worker.min.js`;
  }
  pdfjsLib = pdfjs;
  return pdfjs;
}

/**
 * Extracts plain text from DOCX file by reading word/document.xml
 */
export function extractTextFromDocx(arrayBuffer: ArrayBuffer): string {
  try {
    const uint8 = new Uint8Array(arrayBuffer);
    const unzipped = fflate.unzipSync(uint8);

    // Look for word/document.xml
    const docXmlKey = Object.keys(unzipped).find((k) =>
      k.toLowerCase().endsWith("word/document.xml")
    );

    if (!docXmlKey || !unzipped[docXmlKey]) {
      throw new Error("Invalid DOCX format: word/document.xml missing");
    }

    const xmlBytes = unzipped[docXmlKey];
    const xmlText = new TextDecoder("utf-8").decode(xmlBytes);

    // Extract text inside <w:t> tags
    const paragraphs = xmlText.split(/<\/w:p>/);
    const textLines: string[] = [];

    for (const p of paragraphs) {
      const textMatches = p.match(/<w:t[^>]*>(.*?)<\/w:t>/g);
      if (textMatches) {
        const line = textMatches
          .map((t) => t.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
          .join("")
          .trim();
        if (line) textLines.push(line);
      }
    }

    const fullText = textLines.join("\n");
    if (!fullText.trim()) {
      throw new Error("No readable text found in Word document.");
    }

    return fullText;
  } catch (err: any) {
    console.error("DOCX extraction error:", err);
    throw new Error(err.message || "Failed to extract text from DOCX");
  }
}

/**
 * Extracts plain text from PDF using PDF.js
 */
export async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  try {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: true,
      isEvalSupported: false,
    });

    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages;
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str || "")
        .join(" ");
      if (pageText.trim()) {
        pageTexts.push(pageText);
      }
    }

    const fullText = pageTexts.join("\n\n").trim();
    if (!fullText) {
      throw new Error(
        "This PDF appears to be a scanned image or contains no selectable text. Please upload a PDF with selectable text or a DOCX document."
      );
    }

    return { text: fullText, pageCount };
  } catch (err: any) {
    if (err.name === "PasswordException") {
      throw new Error("This PDF is password protected. Please upload an unprotected resume.");
    }
    console.error("PDF extraction error:", err);
    throw new Error(err.message || "Failed to extract text from PDF");
  }
}

/**
 * Universal text extraction from resume file
 */
export async function extractResumeText(file: File): Promise<ExtractedResumeText> {
  // Validate file size (10MB limit)
  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error("File exceeds 10MB limit. Please upload a smaller file.");
  }

  const fileName = file.name;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const arrayBuffer = await file.arrayBuffer();

  if (ext === "pdf" || file.type === "application/pdf") {
    const { text, pageCount } = await extractTextFromPdf(arrayBuffer);
    return {
      text,
      fileName,
      fileType: "pdf",
      pageCount,
    };
  }

  if (
    ext === "docx" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const text = extractTextFromDocx(arrayBuffer);
    return {
      text,
      fileName,
      fileType: "docx",
    };
  }

  if (ext === "txt" || ext === "md" || file.type.startsWith("text/")) {
    const text = new TextDecoder("utf-8").decode(new Uint8Array(arrayBuffer));
    return {
      text,
      fileName,
      fileType: "text",
    };
  }

  throw new Error("Unsupported file format. Please upload a PDF or DOCX resume.");
}
