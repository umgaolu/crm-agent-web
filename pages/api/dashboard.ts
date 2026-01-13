import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import dayjs from "dayjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey || "");

interface DashboardSummary {
  monthlySales: number;
  monthlyCustomers: number;
  monthlyOrders: number;
  performance: {
    current: number;
    target: number | null;
    ratio: number | null;
  };
}

interface DashboardTrend {
  dates: string[];
  sales: number[];
  customers: number[];
  orders: number[];
}

interface DashboardFunnelStage {
  key: string;
  name: string;
  value: number;
  percent: number;
}

interface DashboardProductsItem {
  key: string;
  name: string;
  value: number;
  percent: number;
}

interface DashboardChannelItem {
  key: string;
  name: string;
  value: number;
  percent: number;
}

interface DashboardResponse {
  summary: DashboardSummary;
  trend: DashboardTrend;
  funnel: {
    stages: DashboardFunnelStage[];
  };
  products: {
    items: DashboardProductsItem[];
  };
  channels: {
    items: DashboardChannelItem[];
  };
}

function getMonthRange() {
  const now = dayjs();
  const start = now.startOf("month");
  const end = now.endOf("month");
  return {
    start,
    end,
    startStr: start.format("YYYY-MM-DD HH:mm:ss"),
    endStr: end.format("YYYY-MM-DD HH:mm:ss")
  };
}

function getLastNDaysRange(days: number) {
  const today = dayjs().startOf("day");
  const start = today.subtract(days - 1, "day");
  return {
    start,
    end: today,
    startStr: start.format("YYYY-MM-DD 00:00:00"),
    endStr: today.format("YYYY-MM-DD 23:59:59")
  };
}

function buildDateList(start: dayjs.Dayjs, end: dayjs.Dayjs) {
  const dates: string[] = [];
  let cur = start.startOf("day");
  const last = end.startOf("day");
  while (cur.isBefore(last) || cur.isSame(last)) {
    dates.push(cur.format("YYYY-MM-DD"));
    cur = cur.add(1, "day");
  }
  return dates;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DashboardResponse | { error: string }>
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

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end("Method Not Allowed");
    return;
  }

  try {
    const monthRange = getMonthRange();
    const last15Range = getLastNDaysRange(15);

    const [ordersResult, leadsResult, staffResult] = await Promise.all([
      supabase
        .from("sales_orders")
        .select("*")
        .gte("订单日期", last15Range.startStr)
        .lte("订单日期", last15Range.endStr)
        .in("订单状态", ["已付款", "已发货", "已完成"]),
      supabase
        .from("customer_leads")
        .select("*")
        .gte("创建日期", monthRange.startStr)
        .lte("创建日期", monthRange.endStr),
      supabase.from("sales_staff").select("*")
    ]);

    if (ordersResult.error) {
      res.status(500).json({ error: ordersResult.error.message });
      return;
    }
    if (leadsResult.error) {
      res.status(500).json({ error: leadsResult.error.message });
      return;
    }
    if (staffResult.error) {
      res.status(500).json({ error: staffResult.error.message });
      return;
    }

    const ordersData = ordersResult.data || [];
    const leadsData = leadsResult.data || [];
    const staffData = staffResult.data || [];

    const monthlyOrders = ordersData.filter((row) => {
      const dateStr = row["订单日期"];
      if (!dateStr) {
        return false;
      }
      const d = dayjs(dateStr);
      return d.isAfter(monthRange.start) || d.isSame(monthRange.start)
        ? d.isBefore(monthRange.end) || d.isSame(monthRange.end)
        : false;
    });

    let monthlySales = 0;
    const monthlyCustomerSet = new Set<string>();
    for (const row of monthlyOrders) {
      const amount = typeof row["总金额"] === "number" ? row["总金额"] : 0;
      monthlySales += amount || 0;
      const customerName =
        typeof row["客户姓名"] === "string" ? row["客户姓名"] : "";
      if (customerName) {
        monthlyCustomerSet.add(customerName);
      }
    }
    const monthlyCustomers = monthlyCustomerSet.size;
    const monthlyOrdersCount = monthlyOrders.length;

    let targetValue = 0;
    for (const row of staffData) {
      const value =
        typeof row["销售目标"] === "number" ? row["销售目标"] : 0;
      if (value > 0) {
        targetValue += value;
      }
    }
    const performanceRatio =
      targetValue > 0 ? monthlySales / targetValue : 0;

    const dates = buildDateList(last15Range.start, last15Range.end);
    const salesByDate: Record<string, number> = {};
    const customersByDate: Record<string, Set<string>> = {};
    const ordersByDate: Record<string, number> = {};

    for (const date of dates) {
      salesByDate[date] = 0;
      customersByDate[date] = new Set<string>();
      ordersByDate[date] = 0;
    }

    for (const row of ordersData) {
      const dateStr = row["订单日期"];
      if (!dateStr) {
        continue;
      }
      const d = dayjs(dateStr).format("YYYY-MM-DD");
      if (!salesByDate[d]) {
        salesByDate[d] = 0;
        customersByDate[d] = new Set<string>();
        ordersByDate[d] = 0;
      }
      const amount = typeof row["总金额"] === "number" ? row["总金额"] : 0;
      salesByDate[d] += amount || 0;
      const customerName =
        typeof row["客户姓名"] === "string" ? row["客户姓名"] : "";
      if (customerName) {
        customersByDate[d].add(customerName);
      }
      ordersByDate[d] += 1;
    }

    const trendSales: number[] = [];
    const trendCustomers: number[] = [];
    const trendOrders: number[] = [];
    for (const date of dates) {
      trendSales.push(salesByDate[date] || 0);
      trendCustomers.push(customersByDate[date]?.size || 0);
      trendOrders.push(ordersByDate[date] || 0);
    }

    const totalLeads = leadsData.length;
    const statusNew = ["新建"];
    const statusInProgress = ["跟进中"];
    const statusWon = ["已转化"];
    const statusLost = ["丢单"];

    let leadsNeed = 0;
    let leadsProposal = 0;

    for (const row of leadsData) {
      const status = row["跟进状态"];
      if (status && !statusNew.includes(status)) {
        leadsNeed += 1;
      }
      if (status && (statusInProgress.includes(status) || statusWon.includes(status))) {
        leadsProposal += 1;
      }
    }

    const dealCount = monthlyOrdersCount;

    const funnelStages: DashboardFunnelStage[] = [];
    const base = totalLeads || 1;

    funnelStages.push({
      key: "leads",
      name: "线索获取",
      value: totalLeads,
      percent: totalLeads / base
    });
    funnelStages.push({
      key: "needs",
      name: "需求确认",
      value: leadsNeed,
      percent: leadsNeed / base
    });
    funnelStages.push({
      key: "proposal",
      name: "推产品",
      value: leadsProposal,
      percent: leadsProposal / base
    });
    funnelStages.push({
      key: "deal",
      name: "成交",
      value: dealCount,
      percent: dealCount / base
    });

    const productTotals: Record<string, number> = {
      ai: 0,
      b2b: 0,
      c2c: 0,
      intro: 0
    };

    for (const row of monthlyOrders) {
      const name =
        typeof row["商品名称"] === "string" ? row["商品名称"] : "";
      const amount = typeof row["总金额"] === "number" ? row["总金额"] : 0;
      const normalized = name.toLowerCase();
      if (!normalized) {
        continue;
      }
      if (normalized.includes("ai")) {
        productTotals.ai += amount || 0;
      } else if (normalized.includes("b") && normalized.includes("端")) {
        productTotals.b2b += amount || 0;
      } else if (normalized.includes("c") && normalized.includes("端")) {
        productTotals.c2c += amount || 0;
      } else if (normalized.includes("入门")) {
        productTotals.intro += amount || 0;
      }
    }

    const productSum =
      productTotals.ai +
      productTotals.b2b +
      productTotals.c2c +
      productTotals.intro || 1;

    const productsItems: DashboardProductsItem[] = [
      {
        key: "ai",
        name: "AI课",
        value: productTotals.ai,
        percent: productTotals.ai / productSum
      },
      {
        key: "b2b",
        name: "B端课",
        value: productTotals.b2b,
        percent: productTotals.b2b / productSum
      },
      {
        key: "c2c",
        name: "C端课",
        value: productTotals.c2c,
        percent: productTotals.c2c / productSum
      },
      {
        key: "intro",
        name: "入门课",
        value: productTotals.intro,
        percent: productTotals.intro / productSum
      }
    ];

    const channelTotals: Record<string, number> = {
      douyin: 0,
      moments: 0,
      search: 0,
      offline: 0,
      other: 0
    };

    for (const row of leadsData) {
      const source =
        typeof row["来源渠道"] === "string" ? row["来源渠道"] : "";
      if (!source) {
        channelTotals.other += 1;
        continue;
      }
      if (source.includes("抖音")) {
        channelTotals.douyin += 1;
      } else if (source.includes("朋友圈")) {
        channelTotals.moments += 1;
      } else if (source.includes("搜索")) {
        channelTotals.search += 1;
      } else if (source.includes("线下") || source.includes("门店")) {
        channelTotals.offline += 1;
      } else {
        channelTotals.other += 1;
      }
    }

    const channelTotalValue =
      channelTotals.douyin +
      channelTotals.moments +
      channelTotals.search +
      channelTotals.offline +
      channelTotals.other || 1;

    const channelItems: DashboardChannelItem[] = [
      {
        key: "douyin",
        name: "抖音",
        value: channelTotals.douyin,
        percent: channelTotals.douyin / channelTotalValue
      },
      {
        key: "moments",
        name: "朋友圈",
        value: channelTotals.moments,
        percent: channelTotals.moments / channelTotalValue
      },
      {
        key: "search",
        name: "搜索引擎",
        value: channelTotals.search,
        percent: channelTotals.search / channelTotalValue
      },
      {
        key: "offline",
        name: "线下门店",
        value: channelTotals.offline,
        percent: channelTotals.offline / channelTotalValue
      },
      {
        key: "other",
        name: "其他",
        value: channelTotals.other,
        percent: channelTotals.other / channelTotalValue
      }
    ];

    const response: DashboardResponse = {
      summary: {
        monthlySales: monthlySales,
        monthlyCustomers,
        monthlyOrders: monthlyOrdersCount,
        performance: {
          current: monthlySales,
          target: targetValue,
          ratio: performanceRatio
        }
      },
      trend: {
        dates,
        sales: trendSales,
        customers: trendCustomers,
        orders: trendOrders
      },
      funnel: {
        stages: funnelStages
      },
      products: {
        items: productsItems
      },
      channels: {
        items: channelItems
      }
    };

    res.status(200).json(response);
  } catch (e) {
    res.status(500).json({ error: "Dashboard统计失败" });
  }
}
