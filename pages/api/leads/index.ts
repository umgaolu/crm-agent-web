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
    const { keyword, status, owner } = req.query;
    let query = supabase.from("customer_leads").select("*");
    if (typeof keyword === "string" && keyword.trim()) {
      const trimmed = keyword.trim();
      const like = `%${trimmed}%`;
      const orConditions = [
        `客户姓名.ilike.${like}`,
        `邮箱.ilike.${like}`
      ];
      if (/^\d+$/.test(trimmed)) {
        orConditions.push(`联系电话.eq.${Number(trimmed)}`);
      }
      query = query.or(orConditions.join(","));
    }
    if (typeof status === "string" && status) {
      query = query.eq("跟进状态", status);
    }
    if (typeof owner === "string" && owner) {
      query = query.eq("负责销售员", owner);
    }
    const { data, error } = await query.order("创建日期", { ascending: false }).limit(200);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const rows = data || [];
    const leadIds = rows
      .map((row: any) => row["线索ID"])
      .filter((id: any) => id !== null && id !== undefined)
      .map((id: any) => String(id));

    let leadMarksByLeadId: Record<string, any> = {};

    if (leadIds.length > 0) {
      const { data: marks } = await supabase
        .from("lead_marks")
        .select("*")
        .in("线索ID", leadIds);

      if (marks && Array.isArray(marks)) {
        leadMarksByLeadId = {};
        for (const row of marks) {
          const leadId = (row as any)["线索ID"];
          if (leadId === null || leadId === undefined) {
            continue;
          }
          const key = String(leadId);
          if (!leadMarksByLeadId[key]) {
            leadMarksByLeadId[key] = row;
          }
        }
      }
    }

    res.status(200).json({
      items: rows.map((row: any) => {
        const leadId = String(row["线索ID"]);
        const markRow = leadMarksByLeadId[leadId];
        const scoreValue =
          markRow && typeof markRow["线索分数"] === "number"
            ? markRow["线索分数"]
            : markRow && typeof markRow.score === "number"
            ? markRow.score
            : null;
        const hasMark = Boolean(markRow);

        return {
          id: leadId,
          name: row["客户姓名"],
          phone: row["联系电话"] ? String(row["联系电话"]) : undefined,
          email: row["邮箱"],
          status: row["跟进状态"],
          source: row["来源渠道"],
          owner: row["负责销售员"],
          createdAt: row["创建日期"],
          nextFollowUp: row["最后跟进日期"],
          intentionProduct: row["意向产品"],
          budgetRange: row["预算范围"],
          remark: row["备注"],
          position: row["客户岗位"],
          trainingNeed: row["参加培训的需求强弱"],
          trialDuration: row["试听课收听时长"],
          communicationTimes: row["与客户沟通次数"],
          aiScore: typeof scoreValue === "number" ? scoreValue : null,
          aiPros: markRow ? markRow["有利因素"] ?? markRow.pros ?? "" : "",
          aiCons: markRow ? markRow["不利因素"] ?? markRow.cons ?? "" : "",
          aiSuggestions: markRow
            ? markRow["后续建议"] ?? markRow.suggestions ?? ""
            : "",
          hasAiMark: hasMark
        };
      })
    });
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const statusMap: Record<string, string> = {
      new: "新建",
      processing: "跟进中",
      won: "已转化",
      lost: "丢单"
    };
    const mappedStatus =
      (body.status && statusMap[body.status]) || body.status || "新建";
    const generatedId = body.id || `L${Date.now().toString(10)}`;
    const payload = {
      线索ID: generatedId,
      客户姓名: body.name,
      联系电话: body.phone ? Number(body.phone) : null,
      邮箱: body.email,
      来源渠道: body.source,
      跟进状态: mappedStatus,
      负责销售员: body.owner,
      创建日期: body.createdAt,
      最后跟进日期: body.nextFollowUp || null,
      意向产品: body.intentionProduct || null,
      预算范围: body.budgetRange || null,
      备注: body.remark || null,
      客户岗位: body.position || null,
      试听课收听时长: body.trialDuration || null,
      与客户沟通次数: body.communicationTimes || null
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
        id: data["线索ID"],
        name: data["客户姓名"],
        phone: data["联系电话"] ? String(data["联系电话"]) : undefined,
        email: data["邮箱"],
        status: data["跟进状态"],
        source: data["来源渠道"],
        owner: data["负责销售员"],
        createdAt: data["创建日期"],
        nextFollowUp: data["最后跟进日期"],
        intentionProduct: data["意向产品"],
        budgetRange: data["预算范围"],
        remark: data["备注"],
        position: data["客户岗位"],
        trainingNeed: data["参加培训的需求强弱"],
        trialDuration: data["试听课收听时长"],
        communicationTimes: data["与客户沟通次数"]
      }
    });
    return;
  }

  res.setHeader("Allow", "GET,POST");
  res.status(405).end("Method Not Allowed");
}
