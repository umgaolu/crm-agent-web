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
  const rawPath =
    source.temp_path ?? source.path ?? source.file_path ?? source.filePath ?? "";
  const text =
    source.temp_content ??
    source.temp_text ??
    source.temp_desc ??
    source.description ??
    source.content ??
    source.text ??
    "";
  const reportTitle = source.report_title ?? source.reportTitle ?? "";
  const paramType = source.param_type ?? source.paramType ?? "";
  return {
    id: getTemplateId(source),
    name: source.temp_name ? String(source.temp_name) : source.name ? String(source.name) : "",
    type: source.temp_type ? String(source.temp_type) : source.type ? String(source.type) : "",
    path: rawPath ? String(rawPath) : "",
    creator: source.created_by ? String(source.created_by) : "",
    createdAt: source.created_at ? String(source.created_at) : "",
    updatedAt: source.updated_at ? String(source.updated_at) : "",
    text: typeof text === "string" ? text : String(text || ""),
    reportTitle: reportTitle ? String(reportTitle) : "",
    paramType: paramType ? String(paramType) : ""
  };
}

function normalizeAttachmentRow(row: any) {
  const source = (row || {}) as Record<string, any>;
  return {
    id: source.id !== null && source.id !== undefined ? String(source.id) : "",
    fileName: source.file_name ? String(source.file_name) : "",
    filePath: source.file_path ? String(source.file_path) : "",
    fileSize:
      source.file_size !== null && source.file_size !== undefined
        ? Number(source.file_size)
        : null,
    mimeType: source.mime_type ? String(source.mime_type) : "",
    createdAt: source.created_at ? String(source.created_at) : "",
    createdBy: source.created_by ? String(source.created_by) : ""
  };
}

let cachedTemplateIdField: string | null = null;
let cachedAttachmentTemplateField: string | null = null;
let cachedAttachmentOrderByCreatedAt: boolean | null = null;

async function fetchAttachmentsByTemplateId(templateId: string) {
  const selectColumns = "id,file_name,file_path,file_size,mime_type,created_at,created_by";
  const orderedFields = cachedAttachmentTemplateField
    ? [cachedAttachmentTemplateField, ...(cachedAttachmentTemplateField === "template_id" ? ["temp_id"] : ["template_id"])]
    : ["template_id", "temp_id"];
  let lastError: any = null;

  for (const field of orderedFields) {
    const buildQuery = () =>
      (adminSupabase as any)
        .from("document_template_attachments")
        .select(selectColumns)
        .eq(field, templateId);

    const shouldOrder = cachedAttachmentOrderByCreatedAt !== false;
    const attempt = shouldOrder
      ? await buildQuery().order("created_at", { ascending: false })
      : await buildQuery();

    if (!attempt.error) {
      cachedAttachmentTemplateField = field;
      return Array.isArray(attempt.data) ? attempt.data : [];
    }

    const msg = attempt.error?.message || "";
    lastError = attempt.error;

    const createdAtMissing =
      /column .*created_at.* does not exist/i.test(msg) ||
      /could not find the 'created_at' column of 'document_template_attachments' in the schema cache/i.test(msg);

    if (createdAtMissing && shouldOrder) {
      const retry = await buildQuery();
      if (!retry.error) {
        cachedAttachmentOrderByCreatedAt = false;
        cachedAttachmentTemplateField = field;
        return Array.isArray(retry.data) ? retry.data : [];
      }
      lastError = retry.error;
      continue;
    }

    if (/column .* does not exist/i.test(msg)) {
      continue;
    }

    if (
      /could not find the 'document_template_attachments' table in the schema cache/i.test(msg)
    ) {
      throw new Error(
        "Supabase中未找到document_template_attachments表（schema cache），请确认数据库表名或权限"
      );
    }

    break;
  }

  if (lastError) {
    throw new Error(lastError.message || "查询附件失败");
  }
  return [];
}

function toStringSafe(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

async function updateTemplate(params: {
  id: string;
  text: string;
  name?: string;
  reportTitle?: string;
  paramType?: string;
}) {
  const nowIso = new Date().toISOString();
  const idFields = ["id", "temp_id", "template_id"];

  let lastError: any = null;

  const isSchemaCacheMissing = (msg: string) => {
    const value = (msg || "").toLowerCase();
    if (!value.includes("schema cache")) {
      return false;
    }
    return (
      /could not find the '.+?' column of '.+?' in the schema cache/i.test(msg) ||
      /could not find the '.+?' table in the schema cache/i.test(msg)
    );
  };

  const getMissingColumnName = (msg: string) => {
    const fromDoesNotExist = msg.match(/column ['"]?([a-z0-9_]+)['"]? does not exist/i);
    if (fromDoesNotExist && fromDoesNotExist[1]) {
      return fromDoesNotExist[1];
    }
    const fromSchemaCache = msg.match(/could not find the '([^']+?)' column of 'document_templates' in the schema cache/i);
    if (fromSchemaCache && fromSchemaCache[1]) {
      return fromSchemaCache[1];
    }
    return "";
  };

  const textCandidates = ["temp_content", "temp_text", "temp_desc", "description", "content", "text"];
  const nameCandidates = params.name !== undefined ? ["temp_name", "name", ""] : [""];
  const reportTitleCandidates =
    params.reportTitle !== undefined ? ["report_title", "reportTitle", ""] : [""];
  const paramTypeCandidates = params.paramType !== undefined ? ["param_type", "paramType", ""] : [""];

  for (const idField of idFields) {
    for (const textColumn of textCandidates) {
      let updatedAtEnabled = true;
      let nameIndex = 0;
      let reportTitleIndex = 0;
      let paramTypeIndex = 0;

      for (let attempts = 0; attempts < 12; attempts += 1) {
        const payload: Record<string, any> = {
          [textColumn]: params.text
        };
        if (updatedAtEnabled) {
          payload.updated_at = nowIso;
        }

        const nameColumn = nameCandidates[nameIndex] || "";
        const reportTitleColumn = reportTitleCandidates[reportTitleIndex] || "";
        const paramTypeColumn = paramTypeCandidates[paramTypeIndex] || "";

        if (params.name !== undefined && nameColumn) {
          payload[nameColumn] = params.name;
        }
        if (params.reportTitle !== undefined && reportTitleColumn) {
          payload[reportTitleColumn] = params.reportTitle;
        }
        if (params.paramType !== undefined && paramTypeColumn) {
          payload[paramTypeColumn] = params.paramType;
        }

        const attempt = await (supabase as any)
          .from("document_templates")
          .update(payload)
          .eq(idField, params.id)
          .select("*")
          .maybeSingle();

        if (!attempt.error && attempt.data) {
          return attempt.data;
        }

        if (!attempt.error && !attempt.data) {
          lastError = new Error("未找到模板");
          break;
        }

        lastError = attempt.error;
        const msg = attempt.error?.message || "";
        if (/could not find the 'document_templates' table in the schema cache/i.test(msg)) {
          throw new Error("Supabase中未找到document_templates表（schema cache），请确认数据库表名或权限");
        }

        const missingColumn = getMissingColumnName(msg);
        const updatedAtMissing =
          missingColumn === "updated_at" ||
          /column .*updated_at.* does not exist/i.test(msg) ||
          /could not find the 'updated_at' column of 'document_templates' in the schema cache/i.test(msg);
        if (updatedAtMissing) {
          updatedAtEnabled = false;
          continue;
        }

        if (missingColumn === textColumn || isSchemaCacheMissing(msg) || /column .* does not exist/i.test(msg)) {
          if (missingColumn && missingColumn === nameColumn && nameIndex + 1 < nameCandidates.length) {
            nameIndex += 1;
            continue;
          }
          if (
            missingColumn &&
            missingColumn === reportTitleColumn &&
            reportTitleIndex + 1 < reportTitleCandidates.length
          ) {
            reportTitleIndex += 1;
            continue;
          }
          if (
            missingColumn &&
            missingColumn === paramTypeColumn &&
            paramTypeIndex + 1 < paramTypeCandidates.length
          ) {
            paramTypeIndex += 1;
            continue;
          }
          if (missingColumn && missingColumn === textColumn) {
            break;
          }
          if (!missingColumn) {
            break;
          }
          continue;
        }

        break;
      }
    }
  }

  throw new Error(lastError?.message || "保存失败");
}

async function fetchTemplateById(templateId: string) {
  const idFields = cachedTemplateIdField
    ? [
        cachedTemplateIdField,
        ...(cachedTemplateIdField === "id"
          ? ["temp_id", "template_id"]
          : cachedTemplateIdField === "temp_id"
          ? ["id", "template_id"]
          : ["id", "temp_id"])
      ]
    : ["id", "temp_id", "template_id"];

  for (const idField of idFields) {
    const { data, error } = await (supabase as any)
      .from("document_templates")
      .select("*")
      .eq(idField, templateId)
      .maybeSingle();
    if (!error) {
      if (data) {
        cachedTemplateIdField = idField;
        return data;
      }
      continue;
    }
    const msg = error.message || "";
    if (/column .* does not exist/i.test(msg)) {
      continue;
    }
    throw new Error(msg || "查询失败");
  }
  return null;
}

async function deleteTemplateById(templateId: string) {
  const idFields = ["id", "temp_id", "template_id"];
  let lastError: any = null;

  for (const idField of idFields) {
    const { error } = await (adminSupabase as any)
      .from("document_templates")
      .delete()
      .eq(idField, templateId);
    if (!error) {
      return;
    }
    lastError = error;
    const msg = error.message || "";
    if (/column .* does not exist/i.test(msg)) {
      continue;
    }
    if (/could not find the 'document_templates' table in the schema cache/i.test(msg)) {
      throw new Error("Supabase中未找到document_templates表（schema cache），请确认数据库表名或权限");
    }
    break;
  }

  if (lastError) {
    throw new Error(lastError.message || "删除失败");
  }
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

  if (req.method === "GET") {
    try {
      const [data, attachmentsRows] = await Promise.all([
        fetchTemplateById(templateId),
        fetchAttachmentsByTemplateId(templateId)
      ]);
      res.status(200).json({
        item: data ? normalizeTemplateRow(data) : null,
        attachments: attachmentsRows.map((row: any) => normalizeAttachmentRow(row))
      });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "查询失败" });
      return;
    }
  }

  if (req.method === "PUT") {
    const body = (req.body || {}) as Record<string, any>;
    const text = toStringSafe(body.text);
    const name = body.name !== undefined ? toStringSafe(body.name) : undefined;
    const reportTitle =
      body.reportTitle !== undefined ? toStringSafe(body.reportTitle) : undefined;
    const paramType =
      body.paramType !== undefined ? toStringSafe(body.paramType) : undefined;
    try {
      const updated = await updateTemplate({
        id: templateId,
        text,
        name,
        reportTitle,
        paramType
      });
      const attachmentsRows = await fetchAttachmentsByTemplateId(templateId);
      res.status(200).json({
        item: normalizeTemplateRow(updated),
        attachments: attachmentsRows.map((row: any) => normalizeAttachmentRow(row))
      });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "保存失败" });
      return;
    }
  }

  if (req.method === "DELETE") {
    try {
      await deleteTemplateById(templateId);
      res.status(204).end();
      return;
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "删除失败" });
      return;
    }
  }

  res.setHeader("Allow", "GET,PUT,DELETE");
  res.status(405).end("Method Not Allowed");
}
