import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";

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

const supabase = createClient(supabaseUrl, supabaseKey || "");

function toStringSafe(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function resolveTemplateFilesDir() {
  const envDir =
    process.env.DOCUMENT_TEMPLATE_FILES_DIR || process.env.TEMPLATE_FILES_DIR;
  return envDir && envDir.trim() ? envDir.trim() : "";
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function decodeFileUrlToPath(fileUrl: string) {
  try {
    const url = new URL(fileUrl);
    if (url.protocol !== "file:") {
      return "";
    }
    const decoded = decodeURIComponent(url.pathname || "");
    if (/^\/[a-zA-Z]:\//.test(decoded)) {
      return decoded.slice(1).replace(/\//g, "\\");
    }
    return decoded;
  } catch {
    return "";
  }
}

function normalizeToLocalPath(raw: string) {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.toLowerCase().startsWith("file://")) {
    return decodeFileUrlToPath(trimmed);
  }
  return trimmed;
}

function isDangerousSystemPath(absolutePath: string) {
  const normalized = absolutePath.replace(/\//g, "\\").toLowerCase();
  const forbidden = [
    "\\windows\\",
    "\\program files\\",
    "\\program files (x86)\\",
    "\\programdata\\"
  ];
  return forbidden.some((piece) => normalized.includes(piece));
}

function isAllowedExt(ext: string) {
  const allowed = [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".md",
    ".txt",
    ".html",
    ".htm"
  ];
  return allowed.includes(ext.toLowerCase());
}

function getContentTypeByExt(ext: string) {
  const lower = ext.toLowerCase();
  if (lower === ".pdf") {
    return "application/pdf";
  }
  if (lower === ".doc") {
    return "application/msword";
  }
  if (lower === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower === ".xls") {
    return "application/vnd.ms-excel";
  }
  if (lower === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower === ".md") {
    return "text/markdown; charset=utf-8";
  }
  if (lower === ".txt") {
    return "text/plain; charset=utf-8";
  }
  if (lower === ".html" || lower === ".htm") {
    return "text/html; charset=utf-8";
  }
  return "application/octet-stream";
}

function buildInlineDisposition(filename: string) {
  const safe = filename.replace(/[\r\n"]/g, "");
  return `inline; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

async function fetchTemplateById(templateId: string) {
  const idFields = ["id", "temp_id", "template_id"];
  let lastError: any = null;
  for (const idField of idFields) {
    const { data, error } = await (supabase as any)
      .from("document_templates")
      .select("*")
      .eq(idField, templateId)
      .maybeSingle();
    if (error) {
      const msg = error.message || "";
      if (/column .* does not exist/i.test(msg)) {
        continue;
      }
      lastError = error;
      continue;
    }

    if (data) {
      return data as Record<string, any>;
    }
  }
  if (lastError) {
    throw new Error(lastError.message || "查询失败");
  }
  return null;
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

  const { id } = req.query;
  const templateId = typeof id === "string" ? id : "";
  if (!templateId) {
    res.status(400).json({ error: "缺少模板ID" });
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end("Method Not Allowed");
    return;
  }

  try {
    const template = await fetchTemplateById(templateId);
    if (!template) {
      res.status(404).json({ error: "未找到模板" });
      return;
    }
    const rawPath =
      toStringSafe(template.temp_path) ||
      toStringSafe(template.path) ||
      toStringSafe(template.file_path) ||
      toStringSafe(template.filePath);

    if (!rawPath) {
      res.status(404).json({ error: "模板源文件路径为空" });
      return;
    }

    const suggestedName =
      toStringSafe(template.temp_name).trim() ||
      toStringSafe(template.name).trim() ||
      path.basename(rawPath);

    if (isHttpUrl(rawPath)) {
      const upstream = await fetch(rawPath);
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        const snippet = text.length > 200 ? text.slice(0, 200) : text;
        throw new Error(
          snippet
            ? `源文件请求失败: ${upstream.status} ${snippet}`
            : `源文件请求失败: ${upstream.status}`
        );
      }

      const ext = path.extname(new URL(rawPath).pathname || "").toLowerCase();
      if (ext && !isAllowedExt(ext)) {
        res.status(415).json({ error: "不支持的源文件类型" });
        return;
      }

      const contentType = upstream.headers.get("content-type") || (ext ? getContentTypeByExt(ext) : "");
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", buildInlineDisposition(suggestedName));
      res.status(200).send(buffer);
      return;
    }

    const localRaw = normalizeToLocalPath(rawPath);
    const resolved = path.resolve(localRaw);
    if (!path.isAbsolute(resolved)) {
      res.status(400).json({ error: "模板源文件路径不合法" });
      return;
    }

    if (isDangerousSystemPath(resolved)) {
      res.status(403).json({ error: "禁止访问该路径" });
      return;
    }

    const baseDir = resolveTemplateFilesDir();
    if (baseDir) {
      const baseResolved = path.resolve(baseDir);
      const prefix = baseResolved.endsWith(path.sep) ? baseResolved : `${baseResolved}${path.sep}`;
      if (resolved !== baseResolved && !resolved.startsWith(prefix)) {
        res.status(403).json({ error: "源文件不在允许目录中" });
        return;
      }
    }

    const ext = path.extname(resolved).toLowerCase();
    if (ext && !isAllowedExt(ext)) {
      res.status(415).json({ error: "不支持的源文件类型" });
      return;
    }

    let stat: fs.Stats;
    try {
      stat = await fsPromises.stat(resolved);
    } catch (statError: any) {
      const code = statError?.code ? String(statError.code) : "";
      if (code === "ENOENT" || code === "ENOTDIR") {
        res.status(404).json({ error: "源文件不存在" });
        return;
      }
      if (code === "EACCES" || code === "EPERM") {
        res.status(403).json({ error: "无权限访问源文件" });
        return;
      }
      throw statError;
    }
    if (!stat.isFile()) {
      res.status(404).json({ error: "源文件不存在" });
      return;
    }

    res.setHeader("Content-Type", ext ? getContentTypeByExt(ext) : "application/octet-stream");
    res.setHeader("Content-Disposition", buildInlineDisposition(suggestedName));
    res.setHeader("Content-Length", String(stat.size));

    const stream = fs.createReadStream(resolved);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(500).json({ error: "读取源文件失败" });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "打开失败" });
  }
}
