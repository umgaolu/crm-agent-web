import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import * as XLSX from "xlsx";

function readEnv(value: unknown) {
  const raw = value !== null && value !== undefined ? String(value).trim() : "";
  if (!raw) {
    return "";
  }
  return raw.replace(/^['"`]/, "").replace(/['"`]$/, "").trim();
}

const supabaseUrl = readEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseKey = readEnv(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY
);
const supabaseServiceKey = readEnv(process.env.SUPABASE_SERVICE_KEY);
const adminSupabase = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseKey || ""
);

const agentApiUrl = readEnv(process.env.CRM_V3_AGENT_API_URL);
const agentApiKey = readEnv(process.env.CRM_V3_AGENT_API_KEY);

type UploadedFileCacheItem = {
  uploadFileId: string;
  extracted: string;
  size: number;
  mtimeMs: number;
  createdAt: number;
};

const uploadedFileCache = new Map<string, UploadedFileCacheItem>();
const uploadingFilePromises = new Map<
  string,
  Promise<{ uploadFileId: string; extracted: string }>
>();

function toStringSafe(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

async function fetchTemplateMetaById(templateId: string) {
  const selectColumnsCandidates = [
    "id,temp_id,template_id,temp_name,name,report_title,reportTitle",
    "id,temp_id,template_id,temp_name,name,report_title",
    "id,temp_id,template_id,temp_name,name"
  ];
  const idFields = ["id", "temp_id", "template_id"];
  let lastError: any = null;

  for (const selectColumns of selectColumnsCandidates) {
    for (const idField of idFields) {
      const { data, error } = await (adminSupabase as any)
        .from("document_templates")
        .select(selectColumns)
        .eq(idField, templateId)
        .maybeSingle();
      if (!error) {
        return data ? (data as any) : null;
      }
      lastError = error;
      if (!/column .* does not exist/i.test(error.message || "")) {
        break;
      }
    }
  }

  if (lastError) {
    throw new Error(lastError.message || "查询模板信息失败");
  }
  return null;
}

function normalizeTargetFile(raw: string, templateId: string) {
  let value = (raw || "").trim();
  if (!value) {
    value = `template-${templateId.slice(0, 12)}.html`;
  }
  value = value.replace(/[\\/]/g, "-");
  if (!/\.[a-z0-9]+$/i.test(value)) {
    value = `${value}.html`;
  }
  if (!value.toLowerCase().endsWith(".html")) {
    value = `${value}.html`;
  }
  if (value.length > 48) {
    const ext = ".html";
    const baseMax = Math.max(1, 48 - ext.length);
    value = `${value.slice(0, baseMax)}${ext}`;
  }
  return value;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripThinkTags(text: string) {
  let value = (text || "").replace(/\r\n/g, "\n");
  value = value.replace(/<think>[\s\S]*?<\/think>/gi, "");
  value = value.replace(/<\/?think>/gi, "");
  value = value.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "");
  value = value.replace(/<\/?analysis>/gi, "");
  return value.trim();
}

function inlineMarkdownToHtml(escapedText: string) {
  let value = escapedText;
  value = value.replace(/!\[([^\]]*?)\]\(([^)]+?)\)/g, (_m, altRaw, urlRaw) => {
    const alt = (altRaw || "").trim();
    let url = (urlRaw || "").trim();
    if (url.startsWith("<") && url.endsWith(">")) {
      url = url.slice(1, -1).trim();
    }
    const urlFirst = url.split(/\s+/)[0] || "";
    if (!urlFirst) {
      return alt ? `<span>${alt}</span>` : "";
    }
    return `<img src="${urlFirst}" alt="${alt}" />`;
  });
  value = value.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (_m, textRaw, urlRaw) => {
    const text = (textRaw || "").trim();
    let url = (urlRaw || "").trim();
    if (url.startsWith("<") && url.endsWith(">")) {
      url = url.slice(1, -1).trim();
    }
    const urlFirst = url.split(/\s+/)[0] || "";
    if (!urlFirst) {
      return text;
    }
    return `<a href="${urlFirst}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  value = value.replace(
    /(^|[\s(])((https?:\/\/)[^\s)]+)(?=$|[\s)])/g,
    (_m, prefix, url) =>
      `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  value = value.replace(/`([^`]+?)`/g, "<code>$1</code>");
  value = value.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  return value;
}

function markdownToHtml(markdown: string) {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inBlockquote = false;

  const closeList = () => {
    if (listType) {
      html.push(listType === "ul" ? "</ul>" : "</ol>");
      listType = null;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push("</blockquote>");
      inBlockquote = false;
    }
  };

  const flushCode = () => {
    if (!inCode) {
      return;
    }
    const code = escapeHtml(codeLines.join("\n"));
    html.push(`<pre><code>${code}</code></pre>`);
    codeLines = [];
    inCode = false;
  };

  const isTableSeparatorLine = (line: string) => {
    const trimmed = (line || "").trim();
    if (!trimmed) {
      return false;
    }
    if (!trimmed.includes("|")) {
      return false;
    }
    const withoutOuter = trimmed.replace(/^\|/, "").replace(/\|$/, "");
    const cells = withoutOuter.split("|").map((part) => part.trim());
    if (cells.length < 2) {
      return false;
    }
    return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  };

  const splitTableRow = (line: string) => {
    const trimmed = (line || "").trim();
    const withoutOuter = trimmed.replace(/^\|/, "").replace(/\|$/, "");
    return withoutOuter.split("|").map((part) => part.trim());
  };

  const getTableAlignments = (separatorLine: string) => {
    const cells = splitTableRow(separatorLine);
    return cells.map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) {
        return "center";
      }
      if (right) {
        return "right";
      }
      if (left) {
        return "left";
      }
      return "";
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    if (inCode) {
      if (/^\s*```/.test(line)) {
        flushCode();
        continue;
      }
      codeLines.push(line);
      continue;
    }

    if (/^\s*```/.test(line)) {
      closeList();
      closeBlockquote();
      inCode = true;
      codeLines = [];
      continue;
    }

    if (/^\s*$/.test(line)) {
      closeList();
      closeBlockquote();
      continue;
    }

    const nextLine = i + 1 < lines.length ? String(lines[i + 1] ?? "") : "";
    const canStartTable =
      line.trim().includes("|") && isTableSeparatorLine(nextLine) && !/^\s*>/.test(line);
    if (canStartTable) {
      closeList();
      closeBlockquote();
      const headerCells = splitTableRow(line);
      const alignments = getTableAlignments(nextLine);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const rowLine = String(lines[i] ?? "");
        if (!rowLine.trim()) {
          break;
        }
        if (!rowLine.includes("|")) {
          break;
        }
        rows.push(splitTableRow(rowLine));
        i += 1;
      }
      i -= 1;

      const width = Math.max(
        headerCells.length,
        alignments.length,
        rows.reduce((max, row) => Math.max(max, row.length), 0)
      );
      while (headerCells.length < width) {
        headerCells.push("");
      }
      while (alignments.length < width) {
        alignments.push("");
      }
      for (const row of rows) {
        while (row.length < width) {
          row.push("");
        }
      }

      html.push("<table><thead><tr>");
      for (let c = 0; c < width; c += 1) {
        const content = inlineMarkdownToHtml(escapeHtml(headerCells[c] || ""));
        const align = alignments[c] ? ` style="text-align:${alignments[c]}"` : "";
        html.push(`<th${align}>${content}</th>`);
      }
      html.push("</tr></thead><tbody>");
      for (const row of rows) {
        html.push("<tr>");
        for (let c = 0; c < width; c += 1) {
          const content = inlineMarkdownToHtml(escapeHtml(row[c] || ""));
          const align = alignments[c] ? ` style="text-align:${alignments[c]}"` : "";
          html.push(`<td${align}>${content}</td>`);
        }
        html.push("</tr>");
      }
      html.push("</tbody></table>");
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeList();
      closeBlockquote();
      const level = headingMatch[1].length;
      const content = inlineMarkdownToHtml(escapeHtml(headingMatch[2] || ""));
      html.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    if (/^(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/.test(line.trim())) {
      closeList();
      closeBlockquote();
      html.push("<hr />");
      continue;
    }

    const blockquoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (blockquoteMatch) {
      closeList();
      if (!inBlockquote) {
        html.push("<blockquote>");
        inBlockquote = true;
      }
      const content = inlineMarkdownToHtml(escapeHtml(blockquoteMatch[1] || ""));
      html.push(`<p>${content}</p>`);
      continue;
    }

    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olMatch) {
      closeBlockquote();
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      const content = inlineMarkdownToHtml(escapeHtml(olMatch[1] || ""));
      html.push(`<li>${content}</li>`);
      continue;
    }

    const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulMatch) {
      closeBlockquote();
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      const content = inlineMarkdownToHtml(escapeHtml(ulMatch[1] || ""));
      html.push(`<li>${content}</li>`);
      continue;
    }

    closeList();
    closeBlockquote();
    const content = inlineMarkdownToHtml(escapeHtml(line));
    html.push(`<p>${content}</p>`);
  }

  flushCode();
  closeList();
  closeBlockquote();
  return html.join("\n");
}

function wrapAsMarkdownDocument(markdown: string) {
  const bodyHtml = markdownToHtml(markdown);
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Template Preview</title><style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,\"Apple Color Emoji\",\"Segoe UI Emoji\";padding:16px;line-height:1.7;color:#111827;background:#fff;}h1,h2,h3,h4,h5,h6{margin:16px 0 10px;line-height:1.25;}p{margin:10px 0;}ul,ol{margin:10px 0 10px 24px;}li{margin:6px 0;}hr{border:none;border-top:1px solid #e5e7eb;margin:16px 0;}blockquote{margin:12px 0;padding:8px 12px;border-left:4px solid #e5e7eb;background:#f9fafb;color:#374151;border-radius:6px;}a{color:#2563eb;text-decoration:underline;}img{max-width:100%;height:auto;display:block;border-radius:8px;border:1px solid #e5e7eb;background:#fff;margin:10px 0;}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;}th,td{border:1px solid #e5e7eb;padding:8px 10px;vertical-align:top;}th{background:#f9fafb;font-weight:600;}tbody tr:nth-child(even){background:#fcfcfd;}code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace;font-size:.95em;background:#f3f4f6;border-radius:4px;padding:2px 6px;}pre{white-space:pre-wrap;word-break:break-word;background:#0b1220;color:#e5e7eb;border-radius:8px;padding:12px;overflow:auto;}pre code{background:transparent;padding:0;color:inherit;}</style></head><body>${bodyHtml}</body></html>`;
}

function looksLikeHtml(text: string) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<")) {
    return true;
  }
  return /<body[\s>]/i.test(trimmed) || /<\/[a-z][\s>]/i.test(trimmed);
}

function extractAgentOutput(agentData: any) {
  const candidates = [
    agentData?.answer,
    agentData?.output,
    agentData?.result,
    agentData?.data?.answer,
    agentData?.data?.output,
    agentData?.data?.result,
    agentData?.data?.outputs?.text,
    agentData?.data?.outputs?.output,
    agentData?.data?.outputs?.result,
    agentData?.outputs?.text,
    agentData?.outputs?.output,
    agentData?.outputs?.result,
    agentData?.message?.content
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function isExcelAttachment(params: { fileName: string; mimeType: string }) {
  const name = (params.fileName || "").toLowerCase();
  const mime = (params.mimeType || "").toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return true;
  }
  if (mime.includes("spreadsheet") || mime.includes("excel")) {
    return true;
  }
  return false;
}

function sanitizeSheetName(name: string) {
  const value = (name || "").trim();
  if (!value) {
    return "Sheet";
  }
  return value.length > 80 ? value.slice(0, 80) : value;
}

function extractExcelMarkdownFromBuffer(buffer: Buffer, fileName: string) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellText: false });
  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  const outputs: string[] = [];
  const maxRowsPerSheet = 200;

  for (const name of sheetNames) {
    const sheet = workbook.Sheets ? (workbook.Sheets as any)[name] : null;
    if (!sheet) {
      continue;
    }
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      blankrows: false,
      defval: ""
    }) as any[][];
    const sliced = Array.isArray(matrix) ? matrix.slice(0, maxRowsPerSheet) : [];
    if (!sliced.length) {
      continue;
    }
    outputs.push(
      `### ${sanitizeSheetName(name)}\n\n\`\`\`json\n${JSON.stringify(sliced)}\n\`\`\``
    );
  }

  if (!outputs.length) {
    return "";
  }
  return `## 附件Excel解析结果：${fileName}\n\n${outputs.join("\n\n")}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getFetchCauseInfo(error: any) {
  const cause = error && typeof error === "object" ? (error as any).cause : null;
  const code = cause && typeof cause.code === "string" ? cause.code : "";
  const message = cause && typeof cause.message === "string" ? cause.message : "";
  return { code, message };
}

function formatFetchError(error: any) {
  const name = error && typeof error.name === "string" ? error.name : "";
  const message = error && typeof error.message === "string" ? error.message : "";
  const { code, message: causeMessage } = getFetchCauseInfo(error);
  const parts = [message || name || "请求失败"];
  if (code) {
    parts.push(`code=${code}`);
  }
  if (causeMessage && causeMessage !== message) {
    parts.push(causeMessage);
  }
  return parts.join(" | ");
}

function isRetryableFetchError(error: any) {
  const message = error && typeof error.message === "string" ? error.message : "";
  const lower = message.toLowerCase();
  const { code } = getFetchCauseInfo(error);
  if (lower.includes("fetch failed")) {
    return true;
  }
  if (lower.includes("socket hang up")) {
    return true;
  }
  if (lower.includes("the operation was aborted")) {
    return true;
  }
  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "ENETUNREACH"
  ]);
  if (code && retryableCodes.has(code)) {
    return true;
  }
  return false;
}

async function fetchWithTimeoutRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  retries: number
) {
  let lastError: any = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs);
    } catch (e: any) {
      lastError = e;
      if (attempt >= retries || !isRetryableFetchError(e)) {
        throw new Error(formatFetchError(e));
      }
      const delay = 500 * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw new Error(formatFetchError(lastError));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const current = items[cursor];
      cursor += 1;
      results.push(await fn(current));
    }
  };
  const count = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

async function callAgentStreaming(params: {
  url: string;
  apiKey: string;
  payload: Record<string, any>;
}) {
  const retries = 1;
  let lastError: any = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutMs = 180_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(params.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`
        },
        body: JSON.stringify({ ...params.payload, response_mode: "streaming" }),
        signal: controller.signal
      });

      if (!response.ok) {
        const rawText = await response.text();
        let agentData: any = null;
        try {
          agentData = rawText ? JSON.parse(rawText) : null;
        } catch {
          agentData = null;
        }
        const rawMessage = (agentData && (agentData.error || agentData.message)) || rawText || "";
        const trimmedMessage =
          typeof rawMessage === "string"
            ? rawMessage.slice(0, 300)
            : String(rawMessage).slice(0, 300);
        throw new Error(
          trimmedMessage
            ? `Agent请求失败: ${response.status} ${trimmedMessage}`
            : `Agent请求失败: ${response.status}`
        );
      }

      if (!response.body) {
        const rawText = await response.text();
        const trimmed = (rawText || "").trim();
        if (trimmed.startsWith("<")) {
          throw new Error(
            "Agent返回非JSON（疑似HTML页面），请检查CRM_V3_AGENT_API_URL是否为/v1/chat-messages接口"
          );
        }
        const chunks = rawText.split("\n\n");
        let output = "";
        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith("data:")) {
              continue;
            }
            const dataPart = trimmedLine.slice(5).trim();
            if (!dataPart || dataPart === "[DONE]") {
              continue;
            }
            let json: any = null;
            try {
              json = JSON.parse(dataPart);
            } catch {
              json = null;
            }
            if (!json) {
              continue;
            }
            const piece = extractAgentOutput(json);
            if (piece) {
              output += piece;
            }
          }
        }
        return output.trim();
      }

      const decoder = new TextDecoder("utf-8");
      const reader = (response.body as any).getReader();

      let output = "";
      let buffer = "";
      let finished = false;

      const processBlock = (block: string) => {
        const lines = block.split("\n");
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith("data:")) {
            continue;
          }
          const dataPart = trimmedLine.slice(5).trim();
          if (!dataPart || dataPart === "[DONE]") {
            continue;
          }
          let json: any = null;
          try {
            json = JSON.parse(dataPart);
          } catch {
            json = null;
          }
          if (!json) {
            continue;
          }
          const piece = extractAgentOutput(json);
          if (piece) {
            if (json.event === "message_end") {
              if (piece.length > output.length) {
                output = piece;
              }
            } else {
              output += piece;
            }
          }
          if (
            json.event === "message_end" ||
            json.event === "workflow_finished" ||
            json.event === "conversation_end"
          ) {
            finished = true;
            return;
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          processBlock(block);
          if (finished) {
            break;
          }
          index = buffer.indexOf("\n\n");
        }
        if (finished) {
          break;
        }
      }

      if (!finished && buffer.trim()) {
        processBlock(buffer);
      }

      return output.trim();
    } catch (e: any) {
      lastError = e;
      if (attempt >= retries || !isRetryableFetchError(e)) {
        throw new Error(formatFetchError(e));
      }
      await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(formatFetchError(lastError));
}

async function fetchAttachmentsByTemplateId(templateId: string) {
  const selectColumnsCandidates = [
    "id,file_name,file_path,file_size,mime_type,created_at,created_by,template_id",
    "id,file_name,file_path,file_size,mime_type,created_at,created_by,temp_id"
  ];
  const tryFields = ["template_id", "temp_id"];
  let lastError: any = null;

  for (const selectColumns of selectColumnsCandidates) {
    for (const field of tryFields) {
      const { data, error } = await (adminSupabase as any)
        .from("document_template_attachments")
        .select(selectColumns)
        .eq(field, templateId)
        .order("created_at", { ascending: false });
      if (!error) {
        return Array.isArray(data) ? data : [];
      }
      lastError = error;
      if (!/column .* does not exist/i.test(error.message || "")) {
        break;
      }
    }
  }

  if (lastError) {
    throw new Error(lastError.message || "查询附件失败");
  }
  return [];
}

function buildUploadUrl(chatMessagesUrl: string) {
  const url = new URL(chatMessagesUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const chatIndex = parts.lastIndexOf("chat-messages");
  const partsBeforeChat = chatIndex >= 0 ? parts.slice(0, chatIndex) : parts;
  const v1Index = partsBeforeChat.lastIndexOf("v1");

  if (v1Index >= 0) {
    const baseParts = partsBeforeChat.slice(0, v1Index + 1);
    url.pathname = `/${baseParts.join("/")}/files/upload`;
    return url.toString();
  }

  url.pathname = "/files/upload";
  return url.toString();
}

async function uploadFileToDify(params: {
  uploadUrl: string;
  apiKey: string;
  user: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const retries = 1;
  let lastError: any = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const form = new FormData();
      const blobPart = new Uint8Array(params.buffer);
      const blob = new Blob([blobPart], {
        type: params.mimeType || "application/octet-stream"
      });
      form.append("file", blob, params.fileName);
      form.append("user", params.user);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      const uploadRes = await fetch(params.uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`
        },
        body: form as any,
        signal: controller.signal
      }).finally(() => clearTimeout(timer));

      const uploadText = await uploadRes.text();
      let uploadJson: any = null;
      try {
        uploadJson = uploadText ? JSON.parse(uploadText) : null;
      } catch {
        uploadJson = null;
      }

      if (!uploadRes.ok) {
        const rawMessage =
          (uploadJson && (uploadJson.error || uploadJson.message)) || uploadText || "";
        const trimmedMessage =
          typeof rawMessage === "string"
            ? rawMessage.slice(0, 300)
            : String(rawMessage).slice(0, 300);
        throw new Error(
          trimmedMessage
            ? `附件上传失败: ${uploadRes.status} ${trimmedMessage}`
            : `附件上传失败: ${uploadRes.status}`
        );
      }

      const uploadFileId =
        (uploadJson && (uploadJson.id || uploadJson.file_id || uploadJson.fileId)) || "";
      if (!uploadFileId) {
        throw new Error("附件上传未返回文件ID");
      }

      return String(uploadFileId);
    } catch (e: any) {
      lastError = e;
      if (attempt >= retries || !isRetryableFetchError(e)) {
        throw new Error(formatFetchError(e));
      }
      await sleep(600 * (attempt + 1));
    }
  }

  throw new Error(formatFetchError(lastError));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const expectedToken = process.env.CRM_API_TOKEN;
  const headerToken = req.headers["x-crm-token"];
  const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (expectedToken && token !== expectedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "Supabase配置缺失" });
    return;
  }

  if (!agentApiUrl) {
    res
      .status(500)
      .json({ error: "CRM V3 Agent未配置（缺少CRM_V3_AGENT_API_URL）" });
    return;
  }

  if (!agentApiKey) {
    res
      .status(500)
      .json({ error: "CRM V3 Agent密钥未配置（缺少CRM_V3_AGENT_API_KEY）" });
    return;
  }

  const { id } = req.query;
  const templateId = typeof id === "string" ? id : "";
  if (!templateId) {
    res.status(400).json({ error: "缺少模板ID" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end("Method Not Allowed");
    return;
  }

  const body = (req.body || {}) as Record<string, any>;
  const text = toStringSafe(body.text);
  const targetFileRaw = toStringSafe(body.targetFile);
  const targetFile = normalizeTargetFile(targetFileRaw, templateId);
  let templateName = toStringSafe(body.templateName);
  let reportTitle = toStringSafe(body.reportTitle);
  const department = toStringSafe(body.department);
  const reportDate = toStringSafe(body.reportDate);
  const classificationRaw = body.classification;
  const classification =
    typeof classificationRaw === "number"
      ? classificationRaw
      : typeof classificationRaw === "string"
        ? Number(classificationRaw)
        : NaN;
  const classificationValue = Number.isFinite(classification) ? classification : 6;
  const attachmentIdsRaw = Array.isArray(body.attachmentIds) ? body.attachmentIds : [];
  const attachmentIds = attachmentIdsRaw
    .map((item: any) => toStringSafe(item))
    .filter((value) => value);

  try {
    const attachmentRows = await fetchAttachmentsByTemplateId(templateId);
    const selectedRows = attachmentIds.length
      ? attachmentRows.filter((row: any) => attachmentIds.includes(String(row.id)))
      : attachmentRows;

    const user = `template-${templateId}`;

    const files: any[] = [];
    const attachmentExtracts: string[] = [];

    if (selectedRows.length) {
      const uploadUrl = buildUploadUrl(agentApiUrl);
      const uploaded = await mapWithConcurrency(selectedRows, 3, async (row: any) => {
        const filePath = row && row.file_path ? String(row.file_path) : "";
        const fileName = row && row.file_name ? String(row.file_name) : "";
        if (!filePath || !fileName) {
          return null;
        }
        let stat: any = null;
        try {
          stat = await fs.stat(filePath);
        } catch {
          stat = null;
        }
        const size = stat && typeof stat.size === "number" ? Number(stat.size) : -1;
        const mtimeMs = stat && typeof stat.mtimeMs === "number" ? Number(stat.mtimeMs) : -1;
        const cacheKey = `${user}::${filePath}::${size}::${mtimeMs}`;
        const cached = uploadedFileCache.get(cacheKey);
        if (cached && cached.uploadFileId) {
          if (cached.extracted) {
            attachmentExtracts.push(cached.extracted);
          }
          return {
            type: "document",
            transfer_method: "local_file",
            upload_file_id: cached.uploadFileId
          };
        }
        const existing = uploadingFilePromises.get(cacheKey);
        if (existing) {
          const { uploadFileId, extracted } = await existing;
          if (extracted) {
            attachmentExtracts.push(extracted);
          }
          return {
            type: "document",
            transfer_method: "local_file",
            upload_file_id: uploadFileId
          };
        }
        const promise = (async () => {
          const buffer = await fs.readFile(filePath);
          const mimeType =
            row && row.mime_type ? String(row.mime_type) : "application/octet-stream";
          let extracted = "";
          if (isExcelAttachment({ fileName, mimeType })) {
            try {
              extracted = extractExcelMarkdownFromBuffer(buffer, fileName);
              extracted = extracted ? String(extracted).trim() : "";
            } catch {
              extracted = "";
            }
          }
          const uploadFileId = await uploadFileToDify({
            uploadUrl,
            apiKey: agentApiKey,
            user,
            fileName,
            mimeType,
            buffer
          });
          uploadedFileCache.set(cacheKey, {
            uploadFileId,
            extracted,
            size,
            mtimeMs,
            createdAt: Date.now()
          });
          return { uploadFileId, extracted };
        })().finally(() => uploadingFilePromises.delete(cacheKey));
        uploadingFilePromises.set(cacheKey, promise);
        const { uploadFileId, extracted } = await promise;
        if (extracted) {
          attachmentExtracts.push(extracted);
        }
        return {
          type: "document",
          transfer_method: "local_file",
          upload_file_id: uploadFileId
        };
      });

      for (const item of uploaded) {
        if (item) {
          files.push(item);
        }
      }
    }

    const templateMetaNeeded =
      !(templateName && templateName.trim()) || !(reportTitle && reportTitle.trim());
    if (templateMetaNeeded) {
      try {
        const templateRow = await fetchTemplateMetaById(templateId);
        if (templateRow) {
          if (!(templateName && templateName.trim())) {
            templateName = templateRow.temp_name
              ? String(templateRow.temp_name)
              : templateRow.name
                ? String(templateRow.name)
                : templateName;
          }
          if (!(reportTitle && reportTitle.trim())) {
            reportTitle = templateRow.report_title
              ? String(templateRow.report_title)
              : templateRow.reportTitle
                ? String(templateRow.reportTitle)
                : reportTitle;
          }
        }
      } catch {}
    }

    const templatePrompt = text && text.trim() ? text.trim() : "";
    const templateNameTrimmed = (templateName || "").trim();
    const reportTitleTrimmed = (reportTitle || "").trim();
    const departmentTrimmed = (department || "").trim();
    const reportDateTrimmed = (reportDate || "").trim();
    const attachmentExtractText = attachmentExtracts
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("\n\n");
    const promptPieces = [
      classificationValue === 7
        ? "任务类型：周报生成类任务（分类7）"
        : "任务类型：模板周报生成类任务（分类6）",
      "请仅输出最终内容，不要输出推理过程、不要输出<think>或<analysis>标签内容。",
      "输出格式要求：Markdown。",
      templateNameTrimmed ? `模板名称：${templateNameTrimmed}` : "",
      reportTitleTrimmed ? `周报标题：${reportTitleTrimmed}` : "",
      reportDateTrimmed ? `日期：${reportDateTrimmed}` : "",
      departmentTrimmed ? `部门：${departmentTrimmed}` : "",
      templatePrompt
        ? `模板文字描述（template_text）：\n${templatePrompt}`
        : "",
      attachmentExtractText
        ? `附件内容（已从Excel解析，必须严格使用以下真实数据，禁止编造）：\n\n${attachmentExtractText}`
        : "",
      files.length
        ? "附件：已上传，请结合附件内容生成对应的周报内容。"
        : "附件：无。",
      "请直接输出周报正文内容。"
    ].filter(Boolean);
    const prompt = promptPieces.join("\n\n");

    const inputs: Record<string, any> = {
      target_file: targetFile,
      template_text: text,
      classification: classificationValue
    };
    if (templateNameTrimmed) {
      inputs.template_name = templateNameTrimmed;
    }
    if (reportTitleTrimmed) {
      inputs.report_title = reportTitleTrimmed;
    }
    if (reportDateTrimmed) {
      inputs.report_date = reportDateTrimmed;
    }
    if (departmentTrimmed) {
      inputs.department = departmentTrimmed;
    }
    if (attachmentExtractText) {
      inputs.attachment_excel_markdown = attachmentExtractText;
    }

    const agentPayload = {
      inputs,
      query: prompt,
      response_mode: "blocking",
      user,
      files: files.length ? files : undefined
    };

    let normalizedOutput = "";
    try {
      const agentResponse = await fetchWithTimeoutRetry(
        agentApiUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${agentApiKey}`
          },
          body: JSON.stringify(agentPayload)
        },
        240_000
        ,
        1
      );

      const agentText = await agentResponse.text();
      let agentData: any = null;
      try {
        agentData = agentText ? JSON.parse(agentText) : null;
      } catch {
        agentData = null;
      }

      if (!agentResponse.ok) {
        const rawMessage =
          (agentData && (agentData.error || agentData.message)) || agentText || "";
        const trimmedMessage =
          typeof rawMessage === "string"
            ? rawMessage.slice(0, 300)
            : String(rawMessage).slice(0, 300);
        throw new Error(
          trimmedMessage
            ? `Agent请求失败: ${agentResponse.status} ${trimmedMessage}`
            : `Agent请求失败: ${agentResponse.status}`
        );
      }

      if (!agentData) {
        const trimmed = (agentText || "").trim();
        if (trimmed.startsWith("<")) {
          throw new Error(
            "Agent返回非JSON（疑似HTML页面），请检查CRM_V3_AGENT_API_URL是否为/v1/chat-messages接口"
          );
        }
        const snippet = trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
        throw new Error(
          snippet
            ? `Agent返回非JSON，前200字符为: ${snippet}`
            : "Agent返回非JSON"
        );
      }

      normalizedOutput = extractAgentOutput(agentData);
      normalizedOutput = normalizedOutput ? String(normalizedOutput).trim() : "";
    } catch (e: any) {
      normalizedOutput = await callAgentStreaming({
        url: agentApiUrl,
        apiKey: agentApiKey,
        payload: agentPayload
      });
      normalizedOutput = normalizedOutput ? String(normalizedOutput).trim() : "";
      if (!normalizedOutput) {
        throw e;
      }
    }
    if (!normalizedOutput && files.length) {
      const retryPayload = {
        inputs: agentPayload.inputs,
        query: agentPayload.query,
        response_mode: "blocking",
        user: agentPayload.user
      };

      try {
        const retryRes = await fetchWithTimeoutRetry(
          agentApiUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agentApiKey}`
            },
            body: JSON.stringify(retryPayload)
          },
          240_000
          ,
          1
        );

        const retryText = await retryRes.text();
        let retryData: any = null;
        try {
          retryData = retryText ? JSON.parse(retryText) : null;
        } catch {
          retryData = null;
        }

        if (retryRes.ok && retryData) {
          normalizedOutput = extractAgentOutput(retryData);
          normalizedOutput = normalizedOutput ? String(normalizedOutput).trim() : "";
        }
      } catch {
        normalizedOutput = "";
      }

      if (!normalizedOutput) {
        normalizedOutput = await callAgentStreaming({
          url: agentApiUrl,
          apiKey: agentApiKey,
          payload: retryPayload
        });
        normalizedOutput = normalizedOutput ? String(normalizedOutput).trim() : "";
      }
    }

    if (!normalizedOutput) {
      const attachmentNames = selectedRows
        .map((row: any) => (row && row.file_name ? String(row.file_name) : ""))
        .filter(Boolean)
        .join("、");
      const fallbackText = [
        "（Agent返回空内容）",
        "",
        "提示词：",
        prompt || "（空）",
        "",
        "附件：",
        attachmentNames || "（无）"
      ].join("\n");
      const html = wrapAsMarkdownDocument(fallbackText);
      res.status(200).json({ html, markdown: fallbackText });
      return;
    }

    const cleaned = stripThinkTags(normalizedOutput);
    const markdown = looksLikeHtml(cleaned) ? "" : String(cleaned || normalizedOutput);
    const html = looksLikeHtml(cleaned) ? cleaned : wrapAsMarkdownDocument(markdown);
    res.status(200).json({ html, markdown });
    return;
  } catch (e: any) {
    const fallbackText = `（测试失败）\n\n${formatFetchError(e)}`;
    res.status(200).json({ html: wrapAsMarkdownDocument(fallbackText), markdown: fallbackText });
    return;
  }
}
