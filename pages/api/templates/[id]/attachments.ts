import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import crypto from "crypto";
import fs from "fs/promises";

function readEnv(value: unknown) {
  const raw = value !== null && value !== undefined ? String(value).trim() : "";
  if (!raw) {
    return "";
  }
  return raw.replace(/^['"`]/, "").replace(/['"`]$/, "").trim();
}

const supabaseUrl = readEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseServiceKey = readEnv(process.env.SUPABASE_SERVICE_KEY);

function toStringSafe(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function toNumberSafe(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveAttachmentsDir() {
  const envDir =
    process.env.DOCUMENT_TEMPLATE_ATTACHMENTS_DIR ||
    process.env.TEMPLATE_ATTACHMENTS_DIR;
  if (envDir && envDir.trim()) {
    return envDir.trim();
  }
  return path.join(process.cwd(), "template_attachments");
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const json = decodeBase64Url(parts[1]);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getSupabaseProjectRefFromUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname || "";
    const marker = ".supabase.co";
    if (host.endsWith(marker)) {
      return host.slice(0, -marker.length);
    }
    return "";
  } catch {
    return "";
  }
}

async function insertAttachmentRow(params: {
  client: any;
  templateId: string;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  mimeType: string;
  createdBy: string;
}) {
  const nowIso = new Date().toISOString();
  const basePayload: Record<string, any> = {
    file_name: params.fileName,
    file_path: params.filePath,
    file_size: params.fileSize,
    mime_type: params.mimeType,
    created_by: params.createdBy || "系统",
    created_at: nowIso
  };

  const tryFields = ["template_id", "temp_id"];
  let lastError: any = null;

  for (const field of tryFields) {
    const payload = { ...basePayload, [field]: params.templateId };
    const { data, error } = await params.client
      .from("document_template_attachments")
      .insert(payload)
      .select("*")
      .maybeSingle();

    if (!error && data) {
      return data;
    }

    lastError = error;
    if (!error) {
      continue;
    }
    if (!/column .* does not exist/i.test(error.message || "")) {
      break;
    }
  }

  throw new Error(lastError?.message || "新增附件失败");
}

async function deleteAttachmentRow(params: { client: any; templateId: string; attachmentId: string }) {
  const { data, error } = await params.client
    .from("document_template_attachments")
    .delete()
    .eq("id", params.attachmentId)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(error.message || "删除附件失败");
  }
  return data;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const expectedToken = process.env.CRM_API_TOKEN;
  const headerToken = req.headers["x-crm-token"];
  const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (expectedToken && token !== expectedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!supabaseUrl) {
    res.status(500).json({ error: "Supabase配置缺失" });
    return;
  }

  const { id } = req.query;
  const templateId = typeof id === "string" ? id : "";
  if (!templateId) {
    res.status(400).json({ error: "缺少模板ID" });
    return;
  }

  if (req.method === "POST" || req.method === "DELETE") {
    if (!supabaseServiceKey) {
      res.status(500).json({
        error:
          '缺少服务端环境变量 SUPABASE_SERVICE_KEY（service_role），当前使用 anon key 会触发 RLS 拒绝写入 document_template_attachments'
      });
      return;
    }
    const expectedRef = getSupabaseProjectRefFromUrl(supabaseUrl);
    const payload = parseJwtPayload(supabaseServiceKey);
    const keyRef = payload && typeof payload.ref === "string" ? payload.ref : "";
    if (expectedRef && keyRef && expectedRef !== keyRef) {
      res.status(500).json({
        error: `SUPABASE_SERVICE_KEY 与 NEXT_PUBLIC_SUPABASE_URL 不匹配（url_ref=${expectedRef}，key_ref=${keyRef}），请换成同一 Supabase 项目的 service_role key`
      });
      return;
    }
  }

  if (req.method === "POST") {
    const body = (req.body || {}) as Record<string, any>;
    const fileNameRaw = toStringSafe(body.fileName).trim();
    const base64 = toStringSafe(body.contentBase64).trim();
    const mimeType = toStringSafe(body.mimeType).trim() || "application/octet-stream";
    const fileSize = toNumberSafe(body.size);
    const createdBy = toStringSafe(body.createdBy).trim() || "系统";

    if (!fileNameRaw) {
      res.status(400).json({ error: "缺少文件名" });
      return;
    }
    if (!base64) {
      res.status(400).json({ error: "缺少文件内容" });
      return;
    }

    try {
      const dir = resolveAttachmentsDir();
      await fs.mkdir(dir, { recursive: true });

      const safeName = path.basename(fileNameRaw);
      const ext = path.extname(safeName);
      const baseName = path.basename(safeName, ext);
      const random = crypto.randomBytes(6).toString("hex");
      const storedName = `${baseName}-${Date.now()}-${random}${ext}`;
      const storedPath = path.join(dir, storedName);

      const commaIndex = base64.indexOf(",");
      const pureBase64 = commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
      const buffer = Buffer.from(pureBase64, "base64");
      await fs.writeFile(storedPath, buffer);

      const admin = createClient(supabaseUrl, supabaseServiceKey || "");
      const inserted = await insertAttachmentRow({
        client: admin,
        templateId,
        fileName: safeName,
        filePath: storedPath,
        fileSize: fileSize ?? buffer.byteLength,
        mimeType,
        createdBy
      });

      res.status(201).json({ item: inserted });
      return;
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e?.message || "上传失败" });
      return;
    }
  }

  if (req.method === "DELETE") {
    const { attachmentId } = req.query;
    const attachmentIdValue = typeof attachmentId === "string" ? attachmentId : "";
    if (!attachmentIdValue) {
      res.status(400).json({ error: "缺少attachmentId" });
      return;
    }

    try {
      const admin = createClient(supabaseUrl, supabaseServiceKey || "");
      const deleted = await deleteAttachmentRow({
        client: admin,
        templateId,
        attachmentId: attachmentIdValue
      });

      const filePath = deleted && (deleted as any).file_path ? String((deleted as any).file_path) : "";
      if (filePath) {
        try {
          await fs.unlink(filePath);
        } catch {}
      }

      res.status(200).json({ ok: true });
      return;
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e?.message || "删除失败" });
      return;
    }
  }

  res.setHeader("Allow", "POST,DELETE");
  res.status(405).end("Method Not Allowed");
}
