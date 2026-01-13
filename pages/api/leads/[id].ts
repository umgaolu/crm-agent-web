import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "缺少id" });
    return;
  }

  if (req.method === "PUT") {
    const body = req.body || {};
    const statusMap: Record<string, string> = {
      new: "新建",
      processing: "跟进中",
      won: "已转化",
      lost: "丢单"
    };
    const mappedStatus =
      (body.status && statusMap[body.status]) || body.status || "新建";
    const payload = {
      客户姓名: body.name,
      联系电话: body.phone ? Number(body.phone) : null,
      邮箱: body.email,
      来源渠道: body.source,
      跟进状态: mappedStatus,
      负责销售员: body.owner,
      创建日期: body.createdAt,
      最后跟进日期: body.nextFollowUp,
      意向产品: body.intentionProduct,
      预算范围: body.budgetRange,
      备注: body.remark,
      客户岗位: body.position,
      试听课收听时长: body.trialDuration,
      与客户沟通次数: body.communicationTimes
    };
    const { data, error } = await supabase
      .from("customer_leads")
      .update(payload)
      .eq("线索ID", id)
      .select("*")
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({
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
        trainingNeed: data["参加培训的需求弱弱"],
        trialDuration: data["试听课收听时长"],
        communicationTimes: data["与客户沟通次数"]
      }
    });
    return;
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("customer_leads").delete().eq("线索ID", id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).end();
    return;
  }

  res.setHeader("Allow", "PUT,DELETE");
  res.status(405).end("Method Not Allowed");
}
