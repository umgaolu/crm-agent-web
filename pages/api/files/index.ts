import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

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

function normalizeFileRow(row: any) {
  const source = (row || {}) as Record<string, any>;
  return {
    id: source.id !== null && source.id !== undefined ? String(source.id) : "",
    name: source.file_name ? String(source.file_name) : "",
    type: source.file_type ? String(source.file_type) : "",
    creator: source.created_by ? String(source.created_by) : "",
    createdAt: source.created_at ? String(source.created_at) : "",
    updatedAt: source.modified_at ? String(source.modified_at) : ""
  };
}

function inferFileExtension(type: string) {
  const raw = (type || "").trim();
  if (raw === "周报") {
    return "md";
  }
  const lower = raw.toLowerCase();
  if (lower === "pdf") {
    return "pdf";
  }
  if (lower === "word") {
    return "docx";
  }
  if (lower === "excel") {
    return "xlsx";
  }
  if (lower === "markdown" || lower === "md") {
    return "md";
  }
  return "txt";
}

function toSafePathSegment(input: string) {
  const cleaned = (input || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!cleaned) {
    return "file";
  }
  return cleaned.slice(0, 80);
}

function buildGeneratedFilePath(name: string, type: string) {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const ext = inferFileExtension(type);
  const safeName = toSafePathSegment(name);
  const uniquePart = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return `generated/${datePart}/${safeName}-${uniquePart}.${ext}`;
}

async function insertGeneratedFile(params: {
  name: string;
  type: string;
  creator?: string;
  description?: string;
}) {
  const nowIso = new Date().toISOString();
  const creator = params.creator || "系统";

  const payload: Record<string, any> = {
    file_name: params.name,
    file_type: params.type,
    file_path: buildGeneratedFilePath(params.name, params.type),
    created_by: creator,
    created_at: nowIso,
    modified_at: nowIso
  };

  const description = params.description ? params.description.trim() : "";
  const payloadWithDescription = description
    ? { ...payload, file_description: description }
    : payload;

  const { data, error } = await supabase
    .from("generated_files")
    .insert(payloadWithDescription)
    .select("id,created_at,file_name,file_type,modified_at,created_by")
    .single();

  if (error) {
    if (description && /column .* does not exist/i.test(error.message)) {
      const retry = await supabase
        .from("generated_files")
        .insert(payload)
        .select("id,created_at,file_name,file_type,modified_at,created_by")
        .single();
      if (retry.error) {
        throw new Error(retry.error.message || "新增失败");
      }
      return retry.data;
    }
    throw new Error(error.message || "新增失败");
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

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "Supabase配置缺失" });
    return;
  }

  if (req.method === "GET") {
    const { keyword } = req.query;
    const keywordValue = typeof keyword === "string" ? keyword : "";

    try {
      let query = supabase
        .from("generated_files")
        .select("id,created_at,file_name,file_type,modified_at,created_by")
        .order("created_at", { ascending: false })
        .limit(200);

      if (keywordValue.trim()) {
        query = query.ilike("file_name", `%${keywordValue.trim()}%`);
      }

      const { data, error } = await query;
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      const rows = Array.isArray(data) ? data : [];
      const normalized = rows.map((row) => normalizeFileRow(row));

      res.status(200).json({ items: normalized });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "查询失败" });
      return;
    }
  }

  if (req.method === "POST") {
    const body = (req.body || {}) as Record<string, any>;
    const name = toStringSafe(body.name).trim();
    const type = toStringSafe(body.type).trim();
    const creator = toStringSafe(body.creator).trim();
    const description = toStringSafe(body.description).trim();

    if (!name) {
      res.status(400).json({ error: "文件名不能为空" });
      return;
    }
    if (!type) {
      res.status(400).json({ error: "文件类型不能为空" });
      return;
    }

    try {
      const data = await insertGeneratedFile({
        name,
        type,
        creator: creator || undefined,
        description: description || undefined
      });
      res.status(201).json({ item: normalizeFileRow(data) });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "新增失败" });
      return;
    }
  }

  res.setHeader("Allow", "GET,POST");
  res.status(405).end("Method Not Allowed");
}
