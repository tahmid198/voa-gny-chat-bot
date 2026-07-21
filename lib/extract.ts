import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** File extensions we know how to read. */
export const SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".log",
  ".json",
  ".csv",
  ".tsv",
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
  ".xlsm",
] as const;

export function isSupported(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

/** Collapse runaway whitespace so chunks stay information-dense. */
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(filePath: string): Promise<string> {
  // unpdf wraps a current build of pdf.js. (The older `pdf-parse` package
  // bundles pdf.js 1.x, which rejects plenty of valid PDFs with "bad XRef
  // entry".) It's ESM-only, hence the dynamic import.
  const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await getDocumentProxy(data);
  const { text } = await extractPdfText(pdf, { mergePages: true });
  return text;
}

async function extractDocx(filePath: string): Promise<string> {
  const mammoth = require("mammoth") as {
    extractRawText(input: { path: string }): Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function extractSheet(filePath: string): Promise<string> {
  const XLSX = require("xlsx") as typeof import("xlsx");
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const parts: string[] = [];

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) parts.push(`## Sheet: ${name}\n${csv}`);
  }

  return parts.join("\n\n");
}

/**
 * Read a single file and return its plain-text content.
 * Returns null when the file type is unsupported or unreadable.
 */
export async function extractText(filePath: string): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();

  try {
    switch (ext) {
      case ".pdf":
        return normalize(await extractPdf(filePath));
      case ".docx":
        return normalize(await extractDocx(filePath));
      case ".xlsx":
      case ".xls":
      case ".xlsm":
        return normalize(await extractSheet(filePath));
      case ".txt":
      case ".md":
      case ".markdown":
      case ".log":
      case ".json":
      case ".csv":
      case ".tsv":
        return normalize(await fs.readFile(filePath, "utf8"));
      default:
        return null;
    }
  } catch (error) {
    console.warn(`[extract] failed to read ${filePath}:`, error);
    return null;
  }
}
