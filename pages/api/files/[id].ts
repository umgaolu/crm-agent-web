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

function pickFirstValue(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== null && row[key] !== undefined) {
      return row[key];
    }
  }
  return undefined;
}

function encodeFilename(filename: string) {
  return encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, "%2A");
}

async function findFileRowById(fileId: string) {
  const idColumns = ["id", "file_id", "uuid", "文件ID", "文件Id", "文件id"];
  for (const col of idColumns) {
    try {
      const { data, error } = await supabase
        .from("generated_files")
        .select("*")
        .eq(col, fileId)
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        return { row: data as any, idColumn: col };
      }
      if (error && /column .* does not exist/i.test(error.message)) {
        continue;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function getDownloadFilename(row: Record<string, any>, fallback: string) {
  const nameValue = pickFirstValue(row, ["file_name", "name", "title", "文件名"]);
  const typeValue = pickFirstValue(row, ["file_type", "type", "文件类型"]);
  const name = nameValue ? String(nameValue) : fallback;
  const type = typeValue ? String(typeValue) : "";

  if (!type) {
    return name;
  }

  const lower = type.toLowerCase();
  const ext =
    lower === "pdf"
      ? "pdf"
      : lower === "word"
      ? "docx"
      : lower === "excel"
      ? "xlsx"
      : type === "周报"
      ? "md"
      : lower === "markdown"
      ? "md"
      : "";

  if (!ext) {
    return name;
  }

  if (name.toLowerCase().endsWith(`.${ext}`)) {
    return name;
  }
  return `${name}.${ext}`;
}

function getInlineTextContentType(row: Record<string, any>) {
  const typeValue = pickFirstValue(row, ["file_type", "type", "文件类型"]);
  const type = typeValue ? String(typeValue) : "";
  if (type === "周报" || type.toLowerCase() === "markdown" || type.toLowerCase() === "md") {
    return "text/markdown; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
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

  const { id, action } = req.query;
  const fileId = Array.isArray(id) ? id[0] : id;
  const actionValue = Array.isArray(action) ? action[0] : action;

  if (!fileId) {
    res.status(400).json({ error: "缺少文件ID" });
    return;
  }

  const located = await findFileRowById(fileId);
  if (!located) {
    res.status(404).json({ error: "未找到文件" });
    return;
  }

  if (req.method === "DELETE") {
    const { error } = await supabase
      .from("generated_files")
      .delete()
      .eq(located.idColumn, fileId);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === "GET" && actionValue === "download") {
    const row = (located.row || {}) as Record<string, any>;
    const filename = getDownloadFilename(row, `file-${fileId}`);
    const urlValue = pickFirstValue(row, [
      "url",
      "file_url",
      "download_url",
      "downloadUrl",
      "附件链接",
      "文件链接"
    ]);
    const contentValue = pickFirstValue(row, [
      "content",
      "file_content",
      "fileContent",
      "file_description",
      "description",
      "text",
      "html",
      "markdown",
      "文件内容"
    ]);

    if (urlValue) {
      try {
        const upstream = await fetch(String(urlValue));
        if (!upstream.ok) {
          res.status(502).json({ error: `下载失败: ${upstream.status}` });
          return;
        }
        const arrayBuffer = await upstream.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType =
          upstream.headers.get("content-type") || "application/octet-stream";
        res.setHeader("Content-Type", contentType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeFilename(filename)}`
        );
        res.status(200).send(buffer);
        return;
      } catch (e: any) {
        res.status(502).json({ error: e?.message || "下载失败" });
        return;
      }
    }

    if (contentValue !== undefined && contentValue !== null) {
      const text = String(contentValue);
      res.setHeader("Content-Type", getInlineTextContentType(row));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeFilename(filename)}`
      );
      res.status(200).send(text);
      return;
    }

    res.status(404).json({ error: "该文件没有可下载内容" });
    return;
  }

  res.setHeader("Allow", "GET,DELETE");
  res.status(405).end("Method Not Allowed");
}
