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
const supabaseServiceKey = readEnv(process.env.SUPABASE_SERVICE_KEY);

const supabase = createClient(supabaseUrl, supabaseKey || "");
const adminSupabase = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseKey || ""
);

function getTemplateId(source: Record<string, any>) {
  const value =
    source.id ??
    source.temp_id ??
    source.template_id ??
    source.tempId ??
    source.templateId ??
    source.uuid ??
    "";
  return value !== null && value !== undefined ? String(value) : "";
}

function normalizeTemplateRow(row: any) {
  const source = (row || {}) as Record<string, any>;
  return {
    id: getTemplateId(source),
    name: source.temp_name ? String(source.temp_name) : source.name ? String(source.name) : "",
    type: source.temp_type ? String(source.temp_type) : source.type ? String(source.type) : "",
    path: source.temp_path
      ? String(source.temp_path)
      : source.path
        ? String(source.path)
        : "",
    creator: source.created_by ? String(source.created_by) : "",
    createdAt: source.created_at ? String(source.created_at) : "",
    updatedAt: source.updated_at ? String(source.updated_at) : ""
  };
}

async function queryTemplates(params: { keyword: string }) {
  const keyword = params.keyword.trim();
  const idFields = ["id", "temp_id", "template_id"];
  const orderFields = ["updated_at", "modified_at", "created_at"];
  const baseFields = "temp_name,temp_type,temp_path,created_by,created_at,updated_at";

  let lastError: any = null;

  for (const idField of idFields) {
    for (const orderField of orderFields) {
      let query = (supabase as any)
        .from("document_templates")
        .select(`${idField},${baseFields}`)
        .limit(200);

      if (keyword) {
        query = query.ilike("temp_name", `%${keyword}%`);
      }

      const { data, error } = await query.order(orderField, { ascending: false });
      if (!error) {
        return Array.isArray(data) ? data : [];
      }

      lastError = error;
      const msg = error.message || "";
      if (/column .* does not exist/i.test(msg)) {
        continue;
      }
      throw new Error(msg || "查询失败");
    }
  }

  if (lastError) {
    throw new Error(lastError.message || "查询失败");
  }
  return [];
}

function toStringSafe(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

async function insertTemplate(params: { name: string; type: string; createdBy: string }) {
  const nowIso = new Date().toISOString();
  const name = params.name.trim() || "新模板";
  const type = params.type.trim() || "周报";
  const createdBy = params.createdBy.trim() || "系统";

  const reportTitle = (params as any).reportTitle ? String((params as any).reportTitle) : undefined;
  const paramType = (params as any).paramType ? String((params as any).paramType) : undefined;
  const text = (params as any).text ? String((params as any).text) : undefined;
  const inputPath = (params as any).path !== undefined ? String((params as any).path) : "";
  const safePath = inputPath;

  const baseExtra: Record<string, any> = {};
  if (reportTitle !== undefined) {
    baseExtra.report_title = reportTitle;
  }
  if (paramType !== undefined) {
    baseExtra.param_type = paramType;
  }

  const payloadCandidates: Record<string, any>[] = [
    {
      temp_name: name,
      temp_type: type,
      temp_path: safePath,
      ...(text !== undefined ? { temp_text: text } : {}),
      ...baseExtra,
      created_by: createdBy,
      created_at: nowIso,
      updated_at: nowIso
    },
    {
      temp_name: name,
      temp_type: type,
      temp_path: safePath,
      ...(text !== undefined ? { temp_text: text } : {}),
      ...baseExtra,
      created_by: createdBy,
      created_at: nowIso
    },
    {
      temp_name: name,
      temp_type: type,
      temp_path: safePath,
      ...(text !== undefined ? { temp_text: text } : {}),
      ...baseExtra,
      created_by: createdBy
    },
    {
      name,
      type,
      path: safePath,
      ...(text !== undefined ? { text } : {}),
      ...baseExtra,
      created_by: createdBy,
      created_at: nowIso,
      updated_at: nowIso
    },
    {
      name,
      type,
      path: safePath,
      ...(text !== undefined ? { text } : {}),
      ...baseExtra,
      created_by: createdBy,
      created_at: nowIso
    },
    {
      name,
      type,
      path: safePath,
      ...(text !== undefined ? { text } : {}),
      ...baseExtra,
      created_by: createdBy
    }
  ];

  let lastError: any = null;
  for (const payload of payloadCandidates) {
    const { data, error } = await (adminSupabase as any)
      .from("document_templates")
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
    const msg = error.message || "";
    if (/column .* does not exist/i.test(msg)) {
      continue;
    }
    break;
  }
  throw new Error(lastError?.message || "创建失败");
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
    const keywordValue = typeof keyword === "string" ? keyword.trim() : "";

    try {
      const rows = await queryTemplates({ keyword: keywordValue });
      res.status(200).json({
        items: rows.map((row) => normalizeTemplateRow(row))
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "查询失败" });
    }
    return;
  }

  if (req.method === "POST") {
    const body = (req.body || {}) as Record<string, any>;
    const name = toStringSafe(body.name);
    const type = toStringSafe(body.type);
    const createdBy = toStringSafe(body.createdBy);
    const reportTitle = toStringSafe(body.reportTitle);
    const paramType = toStringSafe(body.paramType);
    const text = toStringSafe(body.text);
    const path = toStringSafe(body.path);

    try {
      const row = await insertTemplate({
        name,
        type,
        createdBy,
        ...(reportTitle ? { reportTitle } : {}),
        ...(paramType ? { paramType } : {}),
        ...(text ? { text } : {}),
        ...(path ? { path } : {})
      } as any);
      res.status(201).json({ item: normalizeTemplateRow(row) });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "创建失败" });
      return;
    }
  }

  res.setHeader("Allow", "GET,POST");
  res.status(405).end("Method Not Allowed");
}
