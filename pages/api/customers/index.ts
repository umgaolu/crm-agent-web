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
    const { data, error } = await supabase
      .from("customer_leads")
      .select("*")
      .order("创建日期", { ascending: false })
      .limit(200);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({
      items: (data || []).map((row: any) => ({
        id: row.id,
        name: row["客户姓名"],
        company: row["意向产品"] ?? null,
        phone: row["联系电话"] ? String(row["联系电话"]) : undefined,
        email: row["邮箱"],
        level: row["跟进状态"],
        owner: row["负责销售员"],
        createdAt: row["创建日期"]
      }))
    });
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const payload = {
      name: body.name,
      company: body.company,
      phone: body.phone,
      email: body.email,
      level: body.level,
      owner: body.owner
    };
    const { data, error } = await supabase
      .from("customer_leads")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({
      item: {
        id: data.id,
        name: data.name,
        company: data.company,
        phone: data.phone,
        email: data.email,
        level: data.level,
        owner: data.owner,
        createdAt: data.created_at
      }
    });
    return;
  }

  res.setHeader("Allow", "GET,POST");
  res.status(405).end("Method Not Allowed");
}
