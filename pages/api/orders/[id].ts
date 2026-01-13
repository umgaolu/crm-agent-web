import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

  const { id } = req.query;

  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "缺少id" });
    return;
  }

  if (req.method === "PUT") {
    const body = req.body || {};
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
    const payload = {
      客户姓名: body.customerName,
      联系电话: body.phone ? Number(body.phone) : null,
      商品名称: body.productName,
      单价: unitPrice ?? null,
      数量: quantity ?? null,
      总金额: totalAmount,
      订单状态: body.status,
      销售员姓名: body.salesmanName,
      订单日期: body.orderDate || null,
      支付日期: body.payDate || null,
      发货日期: body.deliverDate || null
    };
    const { data, error } = await supabase
      .from("sales_orders")
      .update(payload)
      .eq("订单ID", id)
      .select("*")
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({
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
        orderDate: data["订单日期"],
        payDate: data["支付日期"],
        deliverDate: data["发货日期"]
      }
    });
    return;
  }

  if (req.method === "DELETE") {
    const { error } = await supabase
      .from("sales_orders")
      .delete()
      .eq("订单ID", id);
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
