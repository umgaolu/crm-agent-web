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

function toOptionalString(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const raw = String(value).trim();
  return raw ? raw : undefined;
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

  if (req.method === "GET") {
    const { keyword, status } = req.query;
    let query = supabase.from("sales_orders").select("*");
    if (typeof keyword === "string" && keyword.trim()) {
      const trimmed = keyword.trim();
      const like = `%${trimmed}%`;
      if (/^\d+$/.test(trimmed)) {
        const orConditions = [
          `客户姓名.ilike.${like}`,
          `联系电话.eq.${Number(trimmed)}`
        ];
        query = query.or(orConditions.join(","));
      } else {
        query = query.ilike("客户姓名", like);
      }
    }
    if (typeof status === "string" && status) {
      query = query.eq("订单状态", status);
    }
    const { data, error } = await query
      .order("订单日期", { ascending: false })
      .limit(200);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({
      items: (data || []).map((row) => ({
        id: row["订单ID"],
        customerName: row["客户姓名"],
        phone: row["联系电话"] ? String(row["联系电话"]) : undefined,
        productName: row["商品名称"],
        unitPrice: row["单价"],
        quantity: row["数量"],
        totalAmount: row["总金额"],
        status: row["订单状态"],
        salesmanName: row["销售员姓名"],
        salesmanId: toOptionalString(row["销售员ID"]),
        leadId: toOptionalString(row["线索ID"]),
        orderDate: row["订单日期"],
        payDate: row["支付日期"],
        deliverDate: row["发货日期"]
      }))
    });
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const generatedId = body.id || `O${Date.now().toString(10)}`;
    const unitPrice =
      typeof body.unitPrice === "number" ? body.unitPrice : undefined;
    const quantity =
      typeof body.quantity === "number" ? body.quantity : undefined;
    const totalAmount =
      typeof body.totalAmount === "number"
        ? body.totalAmount
        : unitPrice && quantity
        ? unitPrice * quantity
        : null;
    const salesmanIdFromBody = toOptionalString(body.salesmanId);
    const salesmanNameFromBody = toOptionalString(body.salesmanName);
    const inferredSalesmanId =
      salesmanIdFromBody ||
      (salesmanNameFromBody && /^s\d+$/i.test(salesmanNameFromBody)
        ? salesmanNameFromBody
        : undefined);
    const leadId = toOptionalString(body.leadId ?? body.clueId);
    const payload = {
      订单ID: generatedId,
      客户姓名: body.customerName,
      联系电话: body.phone ? Number(body.phone) : null,
      商品名称: body.productName,
      单价: unitPrice ?? null,
      数量: quantity ?? null,
      总金额: totalAmount,
      订单状态: body.status,
      销售员姓名: body.salesmanName,
      销售员ID: inferredSalesmanId || null,
      线索ID: leadId || null,
      订单日期: body.orderDate || null,
      支付日期: body.payDate || null,
      发货日期: body.deliverDate || null
    };
    const { data, error } = await supabase
      .from("sales_orders")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({
      item: {
        id: data["订单ID"],
        customerName: data["客户姓名"],
        phone: data["联系电话"] ? String(data["联系电话"]) : undefined,
        productName: data["商品名称"],
        unitPrice: data["单价"],
        quantity: data["数量"],
        totalAmount: data["总金额"],
        status: data["订单状态"],
        salesmanName: data["销售员姓名"],
        salesmanId: toOptionalString(data["销售员ID"]),
        leadId: toOptionalString(data["线索ID"]),
        orderDate: data["订单日期"],
        payDate: data["支付日期"],
        deliverDate: data["发货日期"]
      }
    });
    return;
  }

  res.setHeader("Allow", "GET,POST");
  res.status(405).end("Method Not Allowed");
}
