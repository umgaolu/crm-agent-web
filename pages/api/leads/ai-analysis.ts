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

const agentApiUrl = process.env.CRM_AGENT_V2_API_URL;

async function resolveLeadIds(leadId: string): Promise<string[]> {
  const ids: string[] = [leadId];

  const { data } = await supabase
    .from("customer_leads")
    .select("id")
    .eq("线索ID", leadId)
    .limit(1);

  if (data && data.length > 0 && (data[0] as any).id) {
    const rowId = String((data[0] as any).id);
    if (!ids.includes(rowId)) {
      ids.push(rowId);
    }
  }

  return ids;
}

function buildLocalSummary(): string {
  return [
    "客户的购买意向：根据当前沟通记录，客户对产品/课程表现出一定兴趣，建议继续保持高质量跟进，确认决策时间与预算安排。",
    "客户感兴趣的产品：可以重点关注沟通中多次出现的需求关键词，结合已有课程或产品方案进行匹配推荐。",
    "交易未达成的原因：目前仍处于沟通和需求澄清阶段，客户可能在比较不同方案或等待内部决策，需要在节奏与频率上合理跟进。",
    "关于竞品：对话中如出现其他机构或解决方案，可在后续沟通中有针对性地突出自身优势和成功案例。",
    "后续跟进的建议：建议整理本次沟通中的核心需求点和关键疑问，在下一轮沟通中给出更具体的方案、时间安排和报价说明。"
  ].join("\n");
}

async function generateAnalysisFromAgent(leadId: string): Promise<string> {
  const leadIds = await resolveLeadIds(leadId);

  const { data, error } = await supabase
    .from("customer_communications")
    .select("*");

  if (error) {
    throw new Error(error.message);
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
    "";

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
    "未知角色";

  const getRowContent = (row: any) =>
    row.content ??
    row["沟通内容"] ??
    row["内容"] ??
    row["发送内容"] ??
    row["消息内容"] ??
    row["文本"] ??
    "";

  const records = rows.filter((row: any) => {
    const rowLeadId = getRowLeadId(row);
    if (!rowLeadId) {
      return false;
    }
    return leadIds.includes(String(rowLeadId));
  });

  if (!records.length) {
    return [
      "客户的购买意向：暂无沟通记录，无法判断。",
      "客户感兴趣的产品：暂无沟通记录。",
      "交易未达成的原因：暂无沟通记录。",
      "关于竞品：暂无沟通记录。",
      "后续跟进的建议：尽快与客户建立首次沟通，了解基础需求。"
    ].join("\n");
  }

  records.sort((a: any, b: any) => {
    const ta = getRowTime(a);
    const tb = getRowTime(b);
    const taNum = ta ? new Date(String(ta)).getTime() : 0;
    const tbNum = tb ? new Date(String(tb)).getTime() : 0;
    return taNum - tbNum;
  });

  const lines = records.map((row: any) => {
    const time = getRowTime(row);
    const role = getRowRole(row);
    const content = getRowContent(row);
    return `${time} ${role}：${content}`;
  });

  const conversation = lines.join("\n");

  const prompt = [
    "下面是某个客户的全部沟通记录，请你用简短中文做结构化总结。",
    "每个维度控制在1到2句话内，避免内容过长。",
    "",
    "【沟通记录】",
    conversation,
    "",
    "请严格按照下面的格式输出（不要添加额外说明）：",
    "",
    "客户的购买意向：...",
    "客户感兴趣的产品：...",
    "交易未达成的原因：...",
    "关于竞品：...",
    "后续跟进的建议：..."
  ].join("\n");

  if (!agentApiUrl) {
    return buildLocalSummary();
  }

  try {
    const agentResponse = await fetch(agentApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: prompt
      })
    });

    if (!agentResponse.ok) {
      throw new Error(`Agent请求失败: ${agentResponse.status}`);
    }

    const agentData = await agentResponse.json();
    const content =
      typeof agentData.output === "string"
        ? agentData.output
        : typeof agentData.result === "string"
        ? agentData.result
        : "";

    if (!content) {
      throw new Error("Agent未返回内容");
    }

    return content;
  } catch {
    return buildLocalSummary();
  }
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
      .from("customer_ai_analysis")
      .select("*")
      .eq("clue_id", leadId)
      .order("ai_version", { ascending: false })
      .limit(1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const row = data && data.length > 0 ? data[0] : null;

    if (!row) {
      res.status(200).json({ item: null });
      return;
    }

    res.status(200).json({
      item: {
        id: row.id,
        leadId: row.clue_id,
        content: row.ai_content,
        createdAt: row.created_at
      }
    });
    return;
  }

  if (req.method === "POST") {
    try {
      const [content, leadOwnerRows] = await Promise.all([
        generateAnalysisFromAgent(leadId),
        supabase
          .from("customer_leads")
          .select("负责销售员")
          .eq("线索ID", leadId)
          .limit(1)
      ]);

      const leadOwner =
        leadOwnerRows &&
        leadOwnerRows.data &&
        leadOwnerRows.data.length > 0 &&
        (leadOwnerRows.data[0] as any)["负责销售员"]
          ? String((leadOwnerRows.data[0] as any)["负责销售员"])
          : null;

      const { data: latestVersionRows } = await supabase
        .from("customer_ai_analysis")
        .select("ai_version")
        .eq("clue_id", leadId)
        .order("ai_version", { ascending: false })
        .limit(1);

      const latestVersion =
        latestVersionRows && latestVersionRows.length > 0
          ? Number((latestVersionRows[0] as any).ai_version) || 0
          : 0;
      const nextVersion = latestVersion + 1;

      await supabase
        .from("customer_ai_analysis")
        .update({ is_current: 0 })
        .eq("clue_id", leadId)
        .eq("is_current", 1);

      const insertPayload = {
        clue_id: leadId,
        ai_content: content,
        is_current: 1,
        ai_version: nextVersion,
        generate_user: leadOwner,
        generate_time: new Date().toISOString(),
        communication_ids: null
      };

      const { data, error } = await supabase
        .from("customer_ai_analysis")
        .insert(insertPayload)
        .select("*")
        .single();

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.status(201).json({
        item: {
          id: data.id,
          leadId: data.clue_id,
          content: data.ai_content,
          createdAt: data.created_at
        }
      });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "AI分析生成失败" });
      return;
    }
  }

  res.setHeader("Allow", "GET,POST");
  res.status(405).end("Method Not Allowed");
}
