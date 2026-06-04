import mammoth from "mammoth";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";

const SUMMARIZE_THRESHOLD = 8_000;
const SUMMARY_MAX_CHARS = 4_000;

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]);

function isSupportedByExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext === "pdf" || ext === "docx" || ext === "txt" || ext === "md";
}

async function extractText(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (mimeType === "application/pdf" || ext === "pdf") {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // txt / md / plain text
  return buffer.toString("utf-8");
}

async function summarize(text: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  if (!apiKey) return text.slice(0, SUMMARY_MAX_CHARS);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content:
            "Summarize the following document into a dense, information-preserving summary. Preserve all key facts, figures, procedures, names, and entities. Output only the summary with no preamble.",
        },
        { role: "user", content: text.slice(0, 60_000) },
      ],
    }),
  });

  if (!res.ok) return text.slice(0, SUMMARY_MAX_CHARS);

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const summary = json.choices?.[0]?.message?.content?.trim() ?? "";
  return summary || text.slice(0, SUMMARY_MAX_CHARS);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file_missing" }, { status: 400 });
  }

  const filename = file.name;
  const mimeType = file.type;

  if (!SUPPORTED_MIME_TYPES.has(mimeType) && !isSupportedByExtension(filename)) {
    return NextResponse.json(
      { error: "unsupported_file_type" },
      { status: 400 },
    );
  }

  let rawText: string;
  try {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    rawText = await extractText(buffer, filename, mimeType);
  } catch (err) {
    console.error("[kb/extract] extraction failed:", err);
    return NextResponse.json({ error: "extraction_failed" }, { status: 500 });
  }

  // Collapse runs of whitespace/blank lines so the injection stays compact
  const cleaned = rawText.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  let text = cleaned;
  let summarized = false;
  if (cleaned.length > SUMMARIZE_THRESHOLD) {
    text = await summarize(cleaned);
    summarized = true;
  }

  return NextResponse.json({ filename, text, charCount: text.length, summarized });
}
