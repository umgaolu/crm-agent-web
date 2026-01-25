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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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

  const { leadId } = req.query;

  if (!leadId || typeof leadId !== "string") {
    res.status(400).json({ error: "缺少leadId" });
    return;
  }

  if (req.method === "GET") {
    const leadIds: string[] = [leadId];

    const { data: leadRows } = await supabase
      .from("customer_leads")
      .select("id")
      .eq("线索ID", leadId)
      .limit(1);

    if (leadRows && leadRows.length > 0 && (leadRows[0] as any).id) {
      const rowId = String((leadRows[0] as any).id);
      if (!leadIds.includes(rowId)) {
        leadIds.push(rowId);
      }
    }

    const { data, error } = await supabase
      .from("customer_communications")
      .select("*");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const rows = data || [];

    const getRowLeadId = (row: any) =>
      row.lead_id ??
      row["线索ID"] ??
      row["客户线索ID"] ??
      row.leadId ??
      null;

    const getRowTime = (row: any) =>
      row["发送时间"] ??
      row.created_at ??
      row["创建时间"] ??
      row["createdAt"] ??
      row["时间"] ??
      null;

    const getRowRole = (row: any) =>
      row.role ??
      row["角色"] ??
      row["身份"] ??
      row["说话方"] ??
      row["说话人"] ??
      row["发送人"] ??
      row["发送方"] ??
      row["sender"] ??
      row["author"] ??
      null;

    const filtered = rows.filter((row: any) => {
      const rowLeadId = getRowLeadId(row);
      if (!rowLeadId) {
        return false;
      }
      return leadIds.includes(String(rowLeadId));
    });

    filtered.sort((a: any, b: any) => {
      const ta = getRowTime(a);
      const tb = getRowTime(b);
      const taNum = ta ? new Date(String(ta)).getTime() : 0;
      const tbNum = tb ? new Date(String(tb)).getTime() : 0;
      return taNum - tbNum;
    });

    const items = filtered.map((row: any) => {
      const rowLeadId = getRowLeadId(row);
      const rowTime = getRowTime(row);
      const rowRole = getRowRole(row);
      const rowContent =
        row.content ??
        row["沟通内容"] ??
        row["内容"] ??
        row["发送内容"] ??
        row["消息内容"] ??
        row["文本"] ??
        null;
      return {
        id: row.id ?? String(row["id"]),
        leadId: rowLeadId ? String(rowLeadId) : "",
        role: rowRole,
        content: rowContent,
        createdAt: rowTime
      };
    });

    res.status(200).json({ items });
    return;
  }

  res.setHeader("Allow", "GET");
  res.status(405).end("Method Not Allowed");
}
