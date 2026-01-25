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

const leadMarkAgentApiUrl = process.env.CRM_LEAD_MARK_AGENT_API_URL;
const leadMarkAgentApiKey = process.env.CRM_LEAD_MARK_AGENT_API_KEY;

interface LeadMarkResult {
  score: number;
  pros: string;
  cons: string;
  suggestions: string;
  raw: string;
}

async function fetchLeadMarkFromAgent(leadId: string): Promise<LeadMarkResult> {
  const { data, error } = await supabase
    .from("customer_leads")
    .select(
      [
        "线索ID",
        "客户岗位",
        "参加培训的需求强弱",
        "预算范围",
        "试听课收听时长",
        "与客户沟通次数",
        "来源渠道"
      ].join(",")
    )
    .eq("线索ID", leadId)
    .limit(1)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("未找到对应线索");
  }

  const position = (data as any)["客户岗位"] ?? "";
  const demand = (data as any)["参加培训的需求强弱"] ?? "";
  const budget = (data as any)["预算范围"] ?? "";
  const trialDuration = (data as any)["试听课收听时长"] ?? "";
  const communications = (data as any)["与客户沟通次数"] ?? "";
  const source = (data as any)["来源渠道"] ?? "";

  if (!leadMarkAgentApiUrl) {
    throw new Error("Lead Mark Agent未配置");
  }

  if (!leadMarkAgentApiKey) {
    throw new Error("Lead Mark Agent密钥未配置");
  }

  const promptLines = [
    "你是销售线索评分助手，请根据给定的线索信息，对该线索进行0到100分的打分，并给出结构化分析结果。",
    "",
    `线索ID：${leadId}`,
    `客户岗位：${position || "未填写"}`,
    `当前培训需求强弱：${demand || "未填写"}`,
    `预算范围：${budget || "未填写"}`,
    `试听课收听时长：${trialDuration || "未填写"}`,
    `与客户沟通次数：${communications || "未填写"}`,
    `来源渠道：${source || "未填写"}`,
    "",
    "请你输出一个JSON对象，字段包括：",
    "score：数字，0到100之间的整数，代表线索综合评分；",
    "pros：数组或字符串，描述有利于成交的因素；",
    "cons：数组或字符串，描述不利于成交的因素；",
    "suggestions：数组或字符串，给销售跟进的具体建议。",
    "",
    "请只输出JSON，不要输出任何多余的说明文字。"
  ];

  const prompt = promptLines.join("\n");

  const agentResponse = await fetch(leadMarkAgentApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${leadMarkAgentApiKey}`
    },
    body: JSON.stringify({
      inputs: {},
      query: prompt,
      response_mode: "blocking",
      conversation_id: "",
      user: `lead-${leadId}`
    })
  });

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
    throw new Error("Agent未返回有效JSON");
  }

  const contentRaw =
    typeof agentData.answer === "string"
      ? agentData.answer
      : typeof agentData.output === "string"
      ? agentData.output
      : typeof agentData.result === "string"
      ? agentData.result
      : "";

  const content = contentRaw ? String(contentRaw) : "";

  if (!content) {
    throw new Error("Agent未返回内容");
  }

  let parsed: any;

  try {
    let text = content.trim();
    if (text.startsWith("```")) {
      const lines = text.split("\n");
      if (lines.length > 1) {
        lines.shift();
        if (lines[lines.length - 1].trim().startsWith("```")) {
          lines.pop();
        }
        text = lines.join("\n").trim();
      }
    }
    const match = text.match(/\{[\s\S]*\}/);
    const jsonText = match ? match[0] : text;
    parsed = JSON.parse(jsonText);
  } catch {
    const snippet = content.length > 200 ? content.slice(0, 200) : content;
    throw new Error(
      snippet
        ? `Agent返回内容不是有效JSON，前200字符为: ${snippet}`
        : "Agent返回内容不是有效JSON"
    );
  }

  const rawScore = parsed.score;
  const scoreNumber = Number(rawScore);

  if (!Number.isFinite(scoreNumber)) {
    throw new Error("评分字段缺失或不是数字");
  }

  const normalizedScore = Math.min(100, Math.max(0, Math.round(scoreNumber)));

  const normalizeText = (value: any): string => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join("\n");
    }
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  };

  const prosText = normalizeText(parsed.pros);
  const consText = normalizeText(parsed.cons);
  const suggestionsText = normalizeText(parsed.suggestions);

  return {
    score: normalizedScore,
    pros: prosText,
    cons: consText,
    suggestions: suggestionsText,
    raw: content
  };
}

function mapLeadMarkRow(row: any, fallbackLeadId: string): any {
  if (!row) {
    return null;
  }
  const leadId =
    row.lead_id ??
    row["线索ID"] ??
    row.leadId ??
    row["lead_id"] ??
    fallbackLeadId;
  return {
    id: row.id ?? row["id"] ?? null,
    leadId: String(leadId),
    score:
      typeof row["线索分数"] === "number"
        ? row["线索分数"]
        : typeof row.score === "number"
        ? row.score
        : null,
    pros: row["有利因素"] ?? row.pros ?? "",
    cons: row["不利因素"] ?? row.cons ?? "",
    suggestions: row["后续建议"] ?? row.suggestions ?? "",
    content: row.ai_gen_content ?? row["ai_gen_content"] ?? null
  };
}

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
    const { data, error } = await supabase
      .from("lead_marks")
      .select("*")
      .eq("线索ID", leadId)
      .limit(1)
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    if (!data) {
      res.status(200).json({ item: null });
      return;
    }

    res.status(200).json({ item: mapLeadMarkRow(data, leadId) });
    return;
  }

  if (req.method === "POST") {
    try {
      const agentResult = await fetchLeadMarkFromAgent(leadId);

      const upsertPayload: any = {
        "线索ID": leadId,
        "线索分数": agentResult.score,
        "有利因素": agentResult.pros,
        "不利因素": agentResult.cons,
        "后续建议": agentResult.suggestions,
        ai_gen_content: agentResult.raw
      };

      const { data, error } = await supabase
        .from("lead_marks")
        .upsert(upsertPayload, {
          onConflict: "线索ID"
        })
        .select("*")
        .limit(1)
        .single();

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.status(201).json({
        item: mapLeadMarkRow(data, leadId)
      });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "AI打分生成失败" });
      return;
    }
  }

  res.setHeader("Allow", "GET,POST");
  res.status(405).end("Method Not Allowed");
}
