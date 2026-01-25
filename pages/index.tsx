import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnsType } from "antd/es/table";
import {
  Layout,
  Menu,
  Card,
  Row,
  Col,
  Form,
  Input,
  Select,
  Button,
  Space,
  Table,
  DatePicker,
  message,
  Modal,
  InputNumber,
  Popover,
  Checkbox,
  Upload
} from "antd";
import { Line, Funnel, Pie, Bar } from "@ant-design/plots";
import {
  TeamOutlined,
  FileTextOutlined,
  DashboardOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  RobotOutlined,
  DownloadOutlined,
  UploadOutlined,
  ArrowLeftOutlined
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";

const { Header, Sider, Content } = Layout;
const { Option } = Select;

type LeadStatus =
  | "new"
  | "processing"
  | "won"
  | "lost"
  | "新建"
  | "跟进中"
  | "已转化"
  | "丢单";

interface LeadRecord {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status: LeadStatus;
  source?: string;
  owner?: string;
  createdAt?: string;
  nextFollowUp?: string;
  intentionProduct?: string;
  budgetRange?: string;
  remark?: string;
  position?: string;
  trainingNeed?: string;
  trialDuration?: number;
  communicationTimes?: number;
  aiScore?: number | null;
  aiPros?: string;
  aiCons?: string;
  aiSuggestions?: string;
  hasAiMark?: boolean;
}

interface CommunicationRecord {
  id: string;
  leadId: string;
  role?: string;
  content?: string;
  createdAt?: string;
}

interface AiAnalysisItem {
  id: string;
  leadId: string;
  content: string;
  createdAt?: string;
}

interface CustomerRecord {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  level?: string;
  owner?: string;
  createdAt?: string;
}

interface OrderRecord {
  id: string;
  customerName: string;
  phone?: string;
  productName?: string;
  unitPrice?: number;
  quantity?: number;
  totalAmount?: number;
  status?: string;
  salesmanName?: string;
  salesmanId?: string;
  leadId?: string;
  orderDate?: string;
  payDate?: string;
  deliverDate?: string;
}

interface GeneratedFileRecord {
  id: string;
  name: string;
  type: string;
  createdAt?: string;
  updatedAt?: string;
  creator?: string;
}

interface TemplateRecord {
  id: string;
  name: string;
  type: string;
  path: string;
  creator?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface TemplateAttachmentRecord {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  mimeType?: string;
  createdAt?: string;
  createdBy?: string;
}

interface TemplateDetailRecord extends TemplateRecord {
  text: string;
  reportTitle?: string;
  paramType?: string;
}

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

interface DashboardData {
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

type MainTabKey =
  | "dashboard"
  | "leads"
  | "orders"
  | "customers"
  | "filesList"
  | "fileTemplates"
  | "fileTemplateDetail"
  | "weeklyReportDetail";

interface AiAgentOption {
  key: string;
  name: string;
  url: string;
}

const CRM_TOKEN = process.env.NEXT_PUBLIC_CRM_TOKEN || "";

const aiAgents: AiAgentOption[] = [
  {
    key: "crm-v1",
    name: "CRM V1（查询&数据操作）",
    url: "http://8.148.202.246:3001/chat/LvMFum5PhpVUwTa8"
  },
  {
    key: "crm-v2",
    name: "CRM V2（数据解读&数据分析）",
    url: "http://8.148.202.246:3001/chat/XYmUmSDH6m7QDdtJ"
  },
  {
    key: "crm-v3",
    name: "CRM V3（文档处理&生成）",
    url: "http://8.148.202.246:3001/chat/OkP7M15kqv21zHAP"
  }
];

const weeklyReportDepartments = [
  "销售部",
  "市场部",
  "运营部",
  "产品部",
  "研发部",
  "客服部",
  "财务部",
  "人力资源部"
];

export default function HomePage() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MainTabKey>("leads");
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [aiAgentKey, setAiAgentKey] = useState<string>(aiAgents[0]?.key);
  const [aiLoading, setAiLoading] = useState(false);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [files, setFiles] = useState<GeneratedFileRecord[]>([]);
  const [leadForm] = Form.useForm();
  const [customerForm] = Form.useForm();
  const [leadFilterForm] = Form.useForm();
  const [orderForm] = Form.useForm();
  const [fileForm] = Form.useForm();
  const [editingLead, setEditingLead] = useState<LeadRecord | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);
  const [editingOrder, setEditingOrder] = useState<OrderRecord | null>(null);
  const [leadModalVisible, setLeadModalVisible] = useState(false);
  const [customerModalVisible, setCustomerModalVisible] = useState(false);
  const [orderModalVisible, setOrderModalVisible] = useState(false);
  const [fileModalVisible, setFileModalVisible] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadRecord | null>(null);
  const [leadPageSize, setLeadPageSize] = useState(20);
  const [customerPageSize, setCustomerPageSize] = useState(20);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const [filePageSize, setFilePageSize] = useState(20);
  const [orderKeyword, setOrderKeyword] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<string | undefined>(undefined);
  const [fileKeyword, setFileKeyword] = useState("");
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [templateKeyword, setTemplateKeyword] = useState("");
  const [templatePageSize, setTemplatePageSize] = useState(20);
  const [templateDetail, setTemplateDetail] = useState<TemplateDetailRecord | null>(null);
  const [templateAttachments, setTemplateAttachments] = useState<TemplateAttachmentRecord[]>([]);
  const [templateDetailLoading, setTemplateDetailLoading] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateText, setTemplateText] = useState("");
  const [templateDirty, setTemplateDirty] = useState(false);
  const [templatePreviewLoading, setTemplatePreviewLoading] = useState(false);
  const [templatePreviewHtml, setTemplatePreviewHtml] = useState("");
  const [weeklyReportTemplateId, setWeeklyReportTemplateId] = useState("");
  const [weeklyReportDate, setWeeklyReportDate] = useState<Dayjs | null>(dayjs());
  const [weeklyReportDepartment, setWeeklyReportDepartment] = useState("");
  const [weeklyReportGenerating, setWeeklyReportGenerating] = useState(false);
  const [weeklyReportHtml, setWeeklyReportHtml] = useState("");
  const [weeklyReportMarkdown, setWeeklyReportMarkdown] = useState("");
  const [weeklyReportSaving, setWeeklyReportSaving] = useState(false);
  const [weeklyReportSavedId, setWeeklyReportSavedId] = useState("");
  const templateTextAreaRef = useRef<any>(null);
  const templateDetailIdRef = useRef<string>("");
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [trendMetric, setTrendMetric] = useState<"sales" | "customers" | "orders">("sales");
  const dashboardDataRef = useRef<DashboardData | null>(null);
  const dashboardFetchSeqRef = useRef(0);
  const [communicationsModalVisible, setCommunicationsModalVisible] = useState(false);
  const [communicationsLoading, setCommunicationsLoading] = useState(false);
  const [communications, setCommunications] = useState<CommunicationRecord[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisItem, setAnalysisItem] = useState<AiAnalysisItem | null>(null);
  const [communicationsLead, setCommunicationsLead] = useState<LeadRecord | null>(null);
  const [leadAiLoadingMap, setLeadAiLoadingMap] = useState<Record<string, boolean>>({});
  const [leadAiErrorMap, setLeadAiErrorMap] = useState<Record<string, boolean>>({});

  const isCreateLead = !editingLead;

  const fileTypeValue = Form.useWatch("type", fileForm);

  const currentAgent = useMemo(
    () => aiAgents.find((a) => a.key === aiAgentKey),
    [aiAgentKey]
  );

  const safeLeadContext = useMemo(() => {
    if (!selectedLead) {
      return null;
    }
    const {
      id,
      name,
      status,
      source,
      owner,
      createdAt,
      intentionProduct,
      budgetRange,
      remark,
      position,
      trainingNeed,
      trialDuration,
      communicationTimes
    } = selectedLead;
    return {
      id,
      name,
      status,
      source,
      owner,
      createdAt,
      intentionProduct,
      budgetRange,
      remark,
      position,
      trainingNeed,
      trialDuration,
      communicationTimes
    };
  }, [selectedLead]);

  const aiIframeUrl = useMemo(() => {
    if (!currentAgent) {
      return "";
    }
    try {
      const url = new URL(currentAgent.url);
      if (safeLeadContext) {
        url.searchParams.set("crm_lead_context", JSON.stringify(safeLeadContext));
      }
      return url.toString();
    } catch {
      return currentAgent.url;
    }
  }, [currentAgent, safeLeadContext]);

  useEffect(() => {
    dashboardDataRef.current = dashboardData;
  }, [dashboardData]);

  const refreshDashboardData = async (options?: { silent?: boolean }) => {
    const silent = !!options?.silent;
    const seq = dashboardFetchSeqRef.current + 1;
    dashboardFetchSeqRef.current = seq;
    if (!silent) {
      setDashboardLoading(true);
    }
    try {
      const res = await fetch("/api/dashboard", {
        headers: {
          "x-crm-token": CRM_TOKEN
        },
        cache: "no-store"
      });
      if (!res.ok) {
        if (!silent) {
          try {
            const err = await res.json();
            if (err && err.error) {
              message.error(`加载数据看板失败: ${err.error}`);
            } else {
              message.error("加载数据看板失败");
            }
          } catch {
            message.error("加载数据看板失败");
          }
        }
        return;
      }
      const data = (await res.json()) as DashboardData;
      if (dashboardFetchSeqRef.current === seq) {
        setDashboardData(data);
      }
    } catch {
      if (!silent) {
        message.error("加载数据看板失败");
      }
    } finally {
      if (!silent && dashboardFetchSeqRef.current === seq) {
        setDashboardLoading(false);
      }
    }
  };

  useEffect(() => {
    if (aiDrawerOpen) {
      setAiLoading(true);
      const timer = setTimeout(() => setAiLoading(false), 800);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [aiDrawerOpen]);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setDashboardLoading(true);
        const [leadsRes, customersRes, ordersRes, dashboardRes, filesRes] = await Promise.all([
          fetch("/api/leads", {
            headers: {
              "x-crm-token": CRM_TOKEN
            }
          }),
          fetch("/api/customers", {
            headers: {
              "x-crm-token": CRM_TOKEN
            }
          }),
          fetch("/api/orders", {
            headers: {
              "x-crm-token": CRM_TOKEN
            }
          }),
          fetch("/api/dashboard", {
            headers: {
              "x-crm-token": CRM_TOKEN
            },
            cache: "no-store"
          }),
          fetch("/api/files", {
            headers: {
              "x-crm-token": CRM_TOKEN
            }
          })
        ]);
        if (leadsRes.ok) {
          const data = await leadsRes.json();
          setLeads(data.items || []);
        }
        if (customersRes.ok) {
          const data = await customersRes.json();
          setCustomers(data.items || []);
        }
        if (ordersRes.ok) {
          const data = await ordersRes.json();
          setOrders(data.items || []);
        } else {
          try {
            const err = await ordersRes.json();
            if (err && err.error) {
              message.error(`加载订单数据失败: ${err.error}`);
            } else {
              message.error("加载订单数据失败");
            }
          } catch {
            message.error("加载订单数据失败");
          }
        }
        if (dashboardRes.ok) {
          const data = await dashboardRes.json();
          setDashboardData(data);
        } else {
          try {
            const err = await dashboardRes.json();
            if (err && err.error) {
              message.error(`加载数据看板失败: ${err.error}`);
            } else {
              message.error("加载数据看板失败");
            }
          } catch {
            message.error("加载数据看板失败");
          }
        }
        if (filesRes.ok) {
          const data = await filesRes.json();
          setFiles(data.items || []);
        }
      } catch {
        message.error("加载数据失败");
      } finally {
        setDashboardLoading(false);
      }
    };
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (activeMenu === "dashboard") {
      void refreshDashboardData({ silent: !!dashboardDataRef.current });
    }
    if (activeMenu === "fileTemplates" || activeMenu === "weeklyReportDetail") {
      void fetchTemplates();
    }
  }, [activeMenu]);

  useEffect(() => {
    templateDetailIdRef.current = templateDetail?.id || "";
  }, [templateDetail]);

  useEffect(() => {
    if (selectedLead && !leads.some((item) => item.id === selectedLead.id)) {
      setSelectedLead(null);
    }
  }, [leads, selectedLead]);

  useEffect(() => {
    if (!leads.length) {
      return;
    }
    const pendingLeads = leads.filter(
      (lead) =>
        !lead.hasAiMark &&
        typeof lead.aiScore !== "number" &&
        !leadAiLoadingMap[lead.id] &&
        !leadAiErrorMap[lead.id]
    );
    const batch = pendingLeads.slice(0, 5);
    batch.forEach((lead) => {
      void handleGenerateLeadMark(lead);
    });
  }, [leads, leadAiLoadingMap, leadAiErrorMap]);

  const leadColumns: ColumnsType<LeadRecord> = [
    {
      title: "客户姓名",
      dataIndex: "name",
      key: "name",
      width: 160,
      fixed: "left"
    },
    {
      title: "联系电话",
      dataIndex: "phone",
      key: "phone",
      width: 140
    },
    {
      title: "邮箱",
      dataIndex: "email",
      key: "email",
      width: 200
    },
    {
      title: "来源渠道",
      dataIndex: "source",
      key: "source",
      width: 140
    },
    {
      title: "跟进状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (value: LeadStatus) => {
        if (!value) {
          return null;
        }
        if (value === "new" || value === "新建") {
          return "新建";
        }
        if (value === "processing" || value === "跟进中") {
          return "跟进中";
        }
        if (value === "won" || value === "已转化") {
          return "已转化";
        }
        if (value === "lost" || value === "丢单") {
          return "丢单";
        }
        return String(value);
      }
    },
    {
      title: "负责销售员",
      dataIndex: "owner",
      key: "owner",
      width: 120
    },
    {
      title: "创建日期",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (value?: string) =>
        value ? dayjs(value).format("YYYY-MM-DD HH:mm") : ""
    },
    {
      title: "最后跟进日期",
      dataIndex: "nextFollowUp",
      key: "nextFollowUp",
      width: 180
    },
    {
      title: "沟通记录",
      key: "communications",
      width: 120,
      render: (_, record) => (
        <Button
          size="small"
          type="link"
          onClick={() => handleOpenCommunications(record)}
        >
          查看
        </Button>
      )
    },
    {
      title: "AI打分",
      dataIndex: "aiScore",
      key: "aiScore",
      width: 140,
      render: (_: any, record: LeadRecord) => {
        const loading = !!leadAiLoadingMap[record.id];
        const hasError = !!leadAiErrorMap[record.id];
        const hasScore =
          typeof record.aiScore === "number" && !Number.isNaN(record.aiScore);
        if (loading) {
          return "生成中...";
        }
        if (!hasScore) {
          return (
            <Button
              size="small"
              type="link"
              onClick={() => handleGenerateLeadMark(record)}
            >
              {hasError ? "重新生成" : "生成评分"}
            </Button>
          );
        }
        const scoreText = record.aiScore?.toString() ?? "";
        const color =
          record.aiScore !== null && record.aiScore !== undefined
            ? record.aiScore >= 80
              ? "#52c41a"
              : record.aiScore >= 50
              ? "#faad14"
              : "#ff4d4f"
            : undefined;
        return (
          <Popover
            placement="top"
            overlayClassName="ai-score-popover"
            content={
              <div style={{ maxWidth: 320 }}>
                <div className="ai-score-popover-title">AI打分说明</div>
                <div className="ai-score-popover-section-content">
                  当前分数：{scoreText} 分
                </div>
                <div className="ai-score-popover-section-label positive">
                  加分项：
                </div>
                <div className="ai-score-popover-section-content">
                  {record.aiPros || "暂无内容"}
                </div>
                <div className="ai-score-popover-section-label negative">
                  减分项：
                </div>
                <div className="ai-score-popover-section-content">
                  {record.aiCons || "暂无内容"}
                </div>
                <div className="ai-score-popover-section-label suggestion">
                  跟进建议：
                </div>
                <div className="ai-score-popover-section-content">
                  {record.aiSuggestions || "暂无内容"}
                </div>
              </div>
            }
          >
            <span style={{ color, fontWeight: 700 }}>{scoreText}</span>
          </Popover>
        );
      }
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 140,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEditLead(record)}
          >
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteLead(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const customerColumns: ColumnsType<CustomerRecord> = [
    {
      title: "客户名称",
      dataIndex: "name",
      key: "name",
      width: 160,
      fixed: "left"
    },
    {
      title: "公司",
      dataIndex: "company",
      key: "company",
      width: 160
    },
    {
      title: "手机号码",
      dataIndex: "phone",
      key: "phone",
      width: 140
    },
    {
      title: "邮箱",
      dataIndex: "email",
      key: "email",
      width: 200
    },
    {
      title: "客户级别",
      dataIndex: "level",
      key: "level",
      width: 120
    },
    {
      title: "负责人",
      dataIndex: "owner",
      key: "owner",
      width: 120
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (value?: string) =>
        value ? dayjs(value).format("YYYY-MM-DD HH:mm") : ""
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 140,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEditCustomer(record)}
          >
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteCustomer(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const orderColumns: ColumnsType<OrderRecord> = [
    {
      title: "订单编号",
      dataIndex: "id",
      key: "id",
      width: 160,
      fixed: "left"
    },
    {
      title: "客户姓名",
      dataIndex: "customerName",
      key: "customerName",
      width: 160
    },
    {
      title: "联系电话",
      dataIndex: "phone",
      key: "phone",
      width: 140
    },
    {
      title: "产品名称",
      dataIndex: "productName",
      key: "productName",
      width: 180
    },
    {
      title: "单价",
      dataIndex: "unitPrice",
      key: "unitPrice",
      width: 120
    },
    {
      title: "数量",
      dataIndex: "quantity",
      key: "quantity",
      width: 100
    },
    {
      title: "总金额",
      dataIndex: "totalAmount",
      key: "totalAmount",
      width: 140
    },
    {
      title: "订单状态",
      dataIndex: "status",
      key: "status",
      width: 140
    },
    {
      title: "销售员",
      dataIndex: "salesmanName",
      key: "salesmanName",
      width: 140
    },
    {
      title: "下单日期",
      dataIndex: "orderDate",
      key: "orderDate",
      width: 160,
      render: (value?: string) =>
        value ? dayjs(value).format("YYYY-MM-DD") : ""
    },
    {
      title: "付款日期",
      dataIndex: "payDate",
      key: "payDate",
      width: 160,
      render: (value?: string) =>
        value ? dayjs(value).format("YYYY-MM-DD") : ""
    },
    {
      title: "发货日期",
      dataIndex: "deliverDate",
      key: "deliverDate",
      width: 160,
      render: (value?: string) =>
        value ? dayjs(value).format("YYYY-MM-DD") : ""
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 140,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEditOrder(record)}
          >
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteOrder(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const decodeFilenameFromContentDisposition = (value: string) => {
    const encoded = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (encoded && encoded[1]) {
      try {
        return decodeURIComponent(encoded[1]);
      } catch {}
    }
    const plain = value.match(/filename="?([^";]+)"?/i);
    if (plain && plain[1]) {
      return plain[1];
    }
    return "";
  };

  const handleDownloadFile = async (record: GeneratedFileRecord) => {
    try {
      const res = await fetch(
        `/api/files/${encodeURIComponent(record.id)}?action=download`,
        {
          headers: {
            "x-crm-token": CRM_TOKEN
          }
        }
      );
      if (!res.ok) {
        message.error("下载失败");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const filename =
        decodeFilenameFromContentDisposition(disposition) ||
        (record.name ? `${record.name}${record.type ? `.${record.type}` : ""}` : `file-${record.id}`);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error("下载失败");
    }
  };

  const handleDeleteFile = (record: GeneratedFileRecord) => {
    Modal.confirm({
      title: "确认删除该文件？",
      content: record.name ? `文件名：${record.name}` : undefined,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await fetch(`/api/files/${encodeURIComponent(record.id)}`, {
            method: "DELETE",
            headers: {
              "x-crm-token": CRM_TOKEN
            }
          });
          if (!res.ok) {
            message.error("删除失败");
            return;
          }
          setFiles((prev) => prev.filter((item) => item.id !== record.id));
          message.success("删除成功");
        } catch {
          message.error("删除失败");
        }
      }
    });
  };

  const handleDeleteTemplate = (record: TemplateRecord) => {
    Modal.confirm({
      title: "确认删除该模板？",
      content: record.name ? `模板名称：${record.name}` : undefined,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await fetch(`/api/templates/${encodeURIComponent(record.id)}`, {
            method: "DELETE",
            headers: {
              "x-crm-token": CRM_TOKEN
            }
          });
          if (!res.ok) {
            const err = await res.json().catch(() => null);
            message.error(err?.error ? `删除失败：${err.error}` : "删除失败");
            return;
          }
          setTemplates((prev) => prev.filter((item) => item.id !== record.id));
          message.success("删除成功");
        } catch {
          message.error("删除失败");
        }
      }
    });
  };

  const fileColumns: ColumnsType<GeneratedFileRecord> = [
    {
      title: "文件创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (value?: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "")
    },
    {
      title: "文件名",
      dataIndex: "name",
      key: "name",
      width: 220,
      ellipsis: true
    },
    {
      title: "文件类型",
      dataIndex: "type",
      key: "type",
      width: 120
    },
    {
      title: "文件修改时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (value?: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "")
    },
    {
      title: "文件创建人",
      dataIndex: "creator",
      key: "creator",
      width: 140
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 120,
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            type="text"
            icon={<DownloadOutlined />}
            onClick={() => void handleDownloadFile(record)}
          />
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteFile(record)}
          />
        </Space>
      )
    }
  ];

  const templateColumns: ColumnsType<TemplateRecord> = [
    {
      title: "模板文件名",
      dataIndex: "name",
      key: "name",
      width: 240,
      ellipsis: true,
      render: (value: string, record) => (
        <Button type="link" size="small" onClick={() => void openTemplateDetail(record.id)}>
          {value || "-"}
        </Button>
      )
    },
    {
      title: "文件类型",
      dataIndex: "type",
      key: "type",
      width: 140
    },
    {
      title: "文件路径",
      dataIndex: "path",
      key: "path",
      width: 260,
      ellipsis: true
    },
    {
      title: "模板创建人",
      dataIndex: "creator",
      key: "creator",
      width: 140
    },
    {
      title: "最后修改时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (value?: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "")
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 140,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={() => void openTemplateDetail(record.id)}
          >
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteTemplate(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const handleCreateLead = () => {
    setEditingLead(null);
    leadForm.resetFields();
    leadForm.setFieldsValue({
      status: "new"
    });
    setLeadModalVisible(true);
  };

  const handleEditLead = (record: LeadRecord) => {
    setEditingLead(record);
    leadForm.setFieldsValue({
      ...record,
      nextFollowUp: record.nextFollowUp ? dayjs(record.nextFollowUp) : undefined
    });
    setLeadModalVisible(true);
  };

  const handleDeleteLead = (record: LeadRecord) => {
    let deleteMarks = true;
    Modal.confirm({
      title: "确认删除该线索？",
      content: (
        <div>
          <Checkbox
            defaultChecked
            onChange={(e) => {
              deleteMarks = e.target.checked;
            }}
          >
            同时删除该线索的AI打分记录
          </Checkbox>
        </div>
      ),
      onOk: async () => {
        try {
          const res = await fetch(
            `/api/leads/${record.id}?deleteMarks=${deleteMarks ? "true" : "false"}`,
            {
              method: "DELETE",
              headers: {
                "x-crm-token": CRM_TOKEN
              }
            }
          );
          if (!res.ok) {
            message.error("删除失败");
            return;
          }
          setLeads((prev) => prev.filter((item) => item.id !== record.id));
          message.success("删除成功");
        } catch {
          message.error("删除失败");
        }
      }
    });
  };

  const handleOpenCommunications = async (record: LeadRecord) => {
    setCommunicationsLead(record);
    setCommunicationsModalVisible(true);
    setCommunications([]);
    setAnalysisItem(null);
    setCommunicationsLoading(true);
    setAnalysisLoading(true);
    try {
      const [communicationsRes, analysisRes] = await Promise.all([
        fetch(`/api/leads/communications?leadId=${encodeURIComponent(record.id)}`, {
          headers: {
            "x-crm-token": CRM_TOKEN
          }
        }),
        fetch(`/api/leads/ai-analysis?leadId=${encodeURIComponent(record.id)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          }
        })
      ]);
      if (communicationsRes.ok) {
        const data = await communicationsRes.json();
        setCommunications(data.items || []);
      } else {
        message.error("加载沟通记录失败");
      }
      if (analysisRes.ok) {
        const data = await analysisRes.json();
        setAnalysisItem(data.item || null);
      } else {
        try {
          const err = await analysisRes.json();
          if (err && err.error) {
            message.error(`AI总结加载失败：${err.error}`);
          }
        } catch {
        }
        setAnalysisItem(null);
      }
    } catch {
      message.error("加载沟通记录失败");
    } finally {
      setCommunicationsLoading(false);
      setAnalysisLoading(false);
    }
  };

  const handleRegenerateAnalysis = async () => {
    if (!communicationsLead) {
      return;
    }
    try {
      setAnalysisLoading(true);
      const res = await fetch(
        `/api/leads/ai-analysis?leadId=${encodeURIComponent(communicationsLead.id)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          }
        }
      );
      if (!res.ok) {
        try {
          const err = await res.json();
          if (err && err.error) {
            message.error(`重新生成失败：${err.error}`);
          } else {
            message.error("重新生成失败");
          }
        } catch {
          message.error("重新生成失败");
        }
        return;
      }
      const data = await res.json();
      setAnalysisItem(data.item || null);
      message.success("AI总结已更新");
    } catch {
      message.error("重新生成失败");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleGenerateLeadMark = async (record: LeadRecord) => {
    const leadId = record.id;
    setLeadAiLoadingMap((prev) => ({ ...prev, [leadId]: true }));
    setLeadAiErrorMap((prev) => ({ ...prev, [leadId]: false }));
    try {
      const res = await fetch(
        `/api/leads/marks?leadId=${encodeURIComponent(leadId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          }
        }
      );
      if (!res.ok) {
        try {
          const err = await res.json();
          if (err && err.error) {
            message.error(`AI打分生成失败：${err.error}`);
          } else {
            message.error("AI打分生成失败");
          }
        } catch {
          message.error("AI打分生成失败");
        }
        setLeadAiErrorMap((prev) => ({ ...prev, [leadId]: true }));
        return;
      }
      const data = await res.json();
      const item = data.item as
        | {
            score?: number;
            pros?: string;
            cons?: string;
            suggestions?: string;
          }
        | null;
      if (item) {
        setLeads((prev) =>
          prev.map((lead) =>
            lead.id === leadId
              ? {
                  ...lead,
                  aiScore:
                    typeof item.score === "number" ? item.score : lead.aiScore,
                  aiPros: item.pros ?? lead.aiPros,
                  aiCons: item.cons ?? lead.aiCons,
                  aiSuggestions: item.suggestions ?? lead.aiSuggestions,
                  hasAiMark: true
                }
              : lead
          )
        );
      }
      message.success("AI打分已生成");
    } catch {
      setLeadAiErrorMap((prev) => ({ ...prev, [leadId]: true }));
      message.error("AI打分生成失败");
    } finally {
      setLeadAiLoadingMap((prev) => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
    }
  };

  const handleCreateCustomer = () => {
    setEditingCustomer(null);
    customerForm.resetFields();
    setCustomerModalVisible(true);
  };

  const handleEditCustomer = (record: CustomerRecord) => {
    setEditingCustomer(record);
    customerForm.setFieldsValue(record);
    setCustomerModalVisible(true);
  };

  const handleDeleteCustomer = (record: CustomerRecord) => {
    Modal.confirm({
      title: "确认删除该客户？",
      onOk: async () => {
        try {
          const res = await fetch(`/api/customers/${record.id}`, {
            method: "DELETE",
            headers: {
              "x-crm-token": CRM_TOKEN
            }
          });
          if (!res.ok) {
            message.error("删除失败");
            return;
          }
          setCustomers((prev) => prev.filter((item) => item.id !== record.id));
          message.success("删除成功");
        } catch {
          message.error("删除失败");
        }
      }
    });
  };

  const handleConvertLeadToOrder = () => {
    if (!selectedLead) {
      message.error("请先选择需要转化的线索");
      return;
    }
    const leadOwner = (selectedLead.owner || "").trim();
    const ownerLooksLikeId = /^s\d+$/i.test(leadOwner);
    setActiveMenu("orders");
    setEditingOrder(null);
    orderForm.resetFields();
    orderForm.setFieldsValue({
      customerName: selectedLead.name,
      phone: selectedLead.phone,
      productName: selectedLead.intentionProduct || "",
      salesmanName: ownerLooksLikeId ? "" : leadOwner,
      salesmanId: ownerLooksLikeId ? leadOwner : "",
      leadId: selectedLead.id,
      status: "待付款",
      orderDate: dayjs()
    });
    setOrderModalVisible(true);
  };

  const handleCreateOrder = () => {
    setEditingOrder(null);
    orderForm.resetFields();
    orderForm.setFieldsValue({
      status: "待付款"
    });
    setOrderModalVisible(true);
  };

  const handleEditOrder = (record: OrderRecord) => {
    setEditingOrder(record);
    orderForm.setFieldsValue({
      ...record,
      orderDate: record.orderDate ? dayjs(record.orderDate) : undefined,
      payDate: record.payDate ? dayjs(record.payDate) : undefined,
      deliverDate: record.deliverDate ? dayjs(record.deliverDate) : undefined
    });
    setOrderModalVisible(true);
  };

  const handleDeleteOrder = (record: OrderRecord) => {
    Modal.confirm({
      title: "确认删除该订单？",
      onOk: async () => {
        try {
          const res = await fetch(`/api/orders/${record.id}`, {
            method: "DELETE",
            headers: {
              "x-crm-token": CRM_TOKEN
            }
          });
          if (!res.ok) {
            message.error("删除失败");
            return;
          }
          setOrders((prev) => prev.filter((item) => item.id !== record.id));
          message.success("删除成功");
          void refreshDashboardData({ silent: true });
        } catch {
          message.error("删除失败");
        }
      }
    });
  };

  const fetchFiles = async (keyword?: string) => {
    try {
      const params = new URLSearchParams();
      if (keyword && keyword.trim()) {
        params.set("keyword", keyword.trim());
      }
      const query = params.toString();
      const res = await fetch(query ? `/api/files?${query}` : "/api/files", {
        headers: {
          "x-crm-token": CRM_TOKEN
        }
      });
      if (!res.ok) {
        message.error("查询失败");
        return;
      }
      const data = await res.json();
      setFiles(data.items || []);
    } catch {
      message.error("查询失败");
    }
  };

  const fetchTemplates = async (keyword?: string) => {
    try {
      const params = new URLSearchParams();
      if (keyword && keyword.trim()) {
        params.set("keyword", keyword.trim());
      }
      const query = params.toString();
      const res = await fetch(query ? `/api/templates?${query}` : "/api/templates", {
        headers: {
          "x-crm-token": CRM_TOKEN
        }
      });
      if (!res.ok) {
        message.error("查询失败");
        return;
      }
      const data = await res.json();
      setTemplates(data.items || []);
    } catch {
      message.error("查询失败");
    }
  };

  const createNewTemplate = async () => {
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-crm-token": CRM_TOKEN
        },
        body: JSON.stringify({
          name: "新模板",
          type: "周报",
          createdBy: "系统"
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        message.error(err?.error ? `创建失败：${err.error}` : "创建失败");
        return;
      }
      const data = await res.json();
      const item = data.item as TemplateRecord | null;
      if (item?.id) {
        setTemplates((prev) => [item, ...prev]);
        await openTemplateDetail(item.id);
      } else {
        message.error("创建失败");
      }
    } catch {
      message.error("创建失败");
    }
  };

  const openTemplateDetail = async (templateId: string) => {
    setActiveMenu("fileTemplateDetail");
    setTemplateDetail(null);
    setTemplateAttachments([]);
    setTemplateText("");
    setTemplateDirty(false);
    setTemplatePreviewHtml("");
    setTemplateDetailLoading(true);
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
        headers: {
          "x-crm-token": CRM_TOKEN
        }
      });
      if (!res.ok) {
        message.error("加载失败");
        return;
      }
      const data = await res.json();
      const item = data.item as TemplateDetailRecord | null;
      const attachments = (data.attachments || []) as TemplateAttachmentRecord[];
      if (item) {
        setTemplateDetail(item);
        setTemplateText(item.text || "");
        setTemplateAttachments(attachments || []);
      }
    } catch {
      message.error("加载失败");
    } finally {
      setTemplateDetailLoading(false);
    }
  };

  const saveTemplateText = async () => {
    if (!templateDetail) {
      return;
    }
    setTemplateSaving(true);
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(templateDetail.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-crm-token": CRM_TOKEN
        },
        body: JSON.stringify({
          name: templateDetail.name,
          reportTitle: templateDetail.reportTitle,
          paramType: templateDetail.paramType,
          text: templateText
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        message.error(err?.error ? `保存失败：${err.error}` : "保存失败");
        return;
      }
      const data = await res.json();
      const item = data.item as TemplateDetailRecord | null;
      const attachments = (data.attachments || []) as TemplateAttachmentRecord[];
      if (item) {
        setTemplateDetail(item);
        setTemplateText(item.text || "");
      }
      setTemplateAttachments(attachments || []);
      setTemplateDirty(false);
      message.success("保存成功");
    } catch {
      message.error("保存失败");
    } finally {
      setTemplateSaving(false);
    }
  };

  const fileToBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("read error"));
      reader.readAsDataURL(file);
    });

  const normalizeTemplateAttachmentItem = (raw: any): TemplateAttachmentRecord => {
    const source = (raw || {}) as Record<string, any>;
    const fileSizeRaw =
      source.file_size !== null && source.file_size !== undefined
        ? source.file_size
        : source.fileSize !== null && source.fileSize !== undefined
        ? source.fileSize
        : null;
    return {
      id: source.id !== null && source.id !== undefined ? String(source.id) : "",
      fileName: source.file_name ? String(source.file_name) : source.fileName ? String(source.fileName) : "",
      filePath: source.file_path ? String(source.file_path) : source.filePath ? String(source.filePath) : "",
      fileSize: fileSizeRaw !== null ? Number(fileSizeRaw) : null,
      mimeType: source.mime_type ? String(source.mime_type) : source.mimeType ? String(source.mimeType) : "",
      createdAt: source.created_at ? String(source.created_at) : source.createdAt ? String(source.createdAt) : "",
      createdBy: source.created_by ? String(source.created_by) : source.createdBy ? String(source.createdBy) : ""
    };
  };

  const uploadTemplateAttachment = async (file: File) => {
    const templateId = templateDetailIdRef.current;
    if (!templateId) {
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch(
        `/api/templates/${encodeURIComponent(templateId)}/attachments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          },
          body: JSON.stringify({
            fileName: file.name,
            contentBase64: base64,
            mimeType: file.type,
            size: file.size,
            createdBy: "系统"
          })
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        message.error(err?.error ? `上传失败：${err.error}` : "上传失败");
        return;
      }
      const data = await res.json().catch(() => null);
      const inserted = data && data.item ? normalizeTemplateAttachmentItem(data.item) : null;
      if (inserted && inserted.id && templateDetailIdRef.current === templateId) {
        setTemplateAttachments((prev) => {
          const filtered = prev.filter((item) => item.id !== inserted.id);
          return [inserted, ...filtered];
        });
      }
      message.success("上传成功");
    } catch {
      message.error("上传失败");
    }
  };

  const deleteTemplateAttachment = async (attachmentId: string) => {
    if (!templateDetail) {
      return;
    }
    try {
      const res = await fetch(
        `/api/templates/${encodeURIComponent(templateDetail.id)}/attachments?attachmentId=${encodeURIComponent(
          attachmentId
        )}`,
        {
          method: "DELETE",
          headers: {
            "x-crm-token": CRM_TOKEN
          }
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        message.error(err?.error ? `删除失败：${err.error}` : "删除失败");
        return;
      }
      setTemplateAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
      message.success("删除成功");
    } catch {
      message.error("删除失败");
    }
  };

  const viewTemplateSourceFile = async () => {
    if (!templateDetail) {
      return;
    }
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(templateDetail.id)}/source`, {
        headers: {
          "x-crm-token": CRM_TOKEN
        }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        message.error(err?.error ? `打开失败：${err.error}` : "打开失败");
        return;
      }
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
      }, 60_000);
    } catch {
      message.error("打开失败");
    }
  };

  const testTemplate = async () => {
    if (!templateDetail) {
      return;
    }
    setTemplatePreviewLoading(true);
    setTemplatePreviewHtml("");
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(templateDetail.id)}/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-crm-token": CRM_TOKEN
        },
        body: JSON.stringify({
          text: templateText,
          attachmentIds: templateAttachments.map((item) => item.id),
          templateName: templateDetail.name,
          reportTitle: templateDetail.reportTitle || ""
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        message.error(err?.error ? `测试失败：${err.error}` : "测试失败");
        return;
      }
      const data = await res.json();
      setTemplatePreviewHtml(String(data.html || ""));
    } catch {
      message.error("测试失败");
    } finally {
      setTemplatePreviewLoading(false);
    }
  };

  const submitFile = async () => {
    try {
      const type = String(fileForm.getFieldValue("type") || "").trim();
      if (type === "周报") {
        await fileForm.validateFields(["type"]);
        setFileModalVisible(false);
        setWeeklyReportTemplateId("");
        setWeeklyReportDate(dayjs());
        setWeeklyReportDepartment("");
        setWeeklyReportHtml("");
        setWeeklyReportMarkdown("");
        setWeeklyReportSavedId("");
        setActiveMenu("weeklyReportDetail");
        return;
      }

      const values = await fileForm.validateFields();
      const res = await fetch("/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-crm-token": CRM_TOKEN
        },
        body: JSON.stringify(values)
      });
      if (!res.ok) {
        message.error("创建失败");
        return;
      }
      const data = await res.json();
      setFiles((prev) => [data.item, ...prev]);
      message.success("创建成功");
      setFileModalVisible(false);
    } catch {}
  };

  const submitLead = async () => {
    try {
      const values = await leadForm.validateFields();
      const payload = {
        ...values,
        createdAt: editingLead?.createdAt || dayjs().format("YYYY-MM-DD"),
        nextFollowUp: values.nextFollowUp
          ? values.nextFollowUp.format("YYYY-MM-DD")
          : null
      };
      if (editingLead) {
        const shouldRegenerateMark =
          editingLead.position !== values.position ||
          editingLead.trainingNeed !== values.trainingNeed ||
          editingLead.budgetRange !== values.budgetRange ||
          editingLead.trialDuration !== values.trialDuration ||
          editingLead.communicationTimes !== values.communicationTimes ||
          editingLead.source !== values.source;
        const res = await fetch(`/api/leads/${editingLead.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          message.error("更新失败");
          return;
        }
        const data = await res.json();
        setLeads((prev) =>
          prev.map((item) => (item.id === editingLead.id ? data.item : item))
        );
        if (shouldRegenerateMark) {
          void handleGenerateLeadMark(data.item);
        }
        message.success("更新成功");
      } else {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          message.error("创建失败");
          return;
        }
        const data = await res.json();
        setLeads((prev) => [data.item, ...prev]);
        void handleGenerateLeadMark(data.item);
        message.success("创建成功");
      }
      setLeadModalVisible(false);
    } catch {}
  };

  const submitCustomer = async () => {
    try {
      const values = await customerForm.validateFields();
      if (editingCustomer) {
        const res = await fetch(`/api/customers/${editingCustomer.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          },
          body: JSON.stringify(values)
        });
        if (!res.ok) {
          message.error("更新失败");
          return;
        }
        const data = await res.json();
        setCustomers((prev) =>
          prev.map((item) =>
            item.id === editingCustomer.id ? data.item : item
          )
        );
        message.success("更新成功");
      } else {
        const res = await fetch("/api/customers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          },
          body: JSON.stringify(values)
        });
        if (!res.ok) {
          message.error("创建失败");
          return;
        }
        const data = await res.json();
        setCustomers((prev) => [data.item, ...prev]);
        message.success("创建成功");
      }
      setCustomerModalVisible(false);
    } catch {}
  };

  const submitOrder = async () => {
    try {
      const values = await orderForm.validateFields();
      const payload = {
        ...values,
        orderDate: values.orderDate
          ? values.orderDate.format("YYYY-MM-DD")
          : null,
        payDate: values.payDate ? values.payDate.format("YYYY-MM-DD") : null,
        deliverDate: values.deliverDate
          ? values.deliverDate.format("YYYY-MM-DD")
          : null
      };
      if (editingOrder) {
        const res = await fetch(`/api/orders/${editingOrder.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          message.error("更新失败");
          return;
        }
        const data = await res.json();
        setOrders((prev) =>
          prev.map((item) => (item.id === editingOrder.id ? data.item : item))
        );
        message.success("更新成功");
        void refreshDashboardData({ silent: true });
      } else {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          message.error("创建失败");
          return;
        }
        const data = await res.json();
        setOrders((prev) => [data.item, ...prev]);
        message.success("创建成功");
        void refreshDashboardData({ silent: true });
      }
      setOrderModalVisible(false);
    } catch {}
  };

  const menuItems = [
    {
      key: "dashboard",
      icon: <DashboardOutlined />,
      label: "数据看板"
    },
    {
      key: "leads",
      icon: <TeamOutlined />,
      label: "线索管理"
    },
    {
      key: "orders",
      icon: <FileTextOutlined />,
      label: "订单管理"
    },
    {
      key: "customers",
      icon: <TeamOutlined />,
      label: "客户管理"
    },
    {
      key: "files",
      icon: <FileTextOutlined />,
      label: "生成文件",
      children: [
        {
          key: "filesList",
          label: "生成文件管理"
        },
        {
          key: "fileTemplates",
          label: "文件模板管理"
        }
      ]
    }
  ];

  const getPageTitle = () => {
    if (activeMenu === "dashboard") {
      return "数据看板";
    }
    if (activeMenu === "leads") {
      return "线索管理";
    }
    if (activeMenu === "orders") {
      return "订单管理";
    }
    if (activeMenu === "customers") {
      return "客户管理";
    }
    if (activeMenu === "filesList") {
      return "生成文件";
    }
    if (activeMenu === "fileTemplates") {
      return "生成文件";
    }
    if (activeMenu === "fileTemplateDetail") {
      return "生成文件";
    }
    if (activeMenu === "weeklyReportDetail") {
      return "生成文件";
    }
    return "CRM系统";
  };

  const renderDashboardContent = () => {
    if (!dashboardData) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 260,
            color: "#999"
          }}
        >
          {dashboardLoading ? "数据加载中..." : "暂无数据"}
        </div>
      );
    }

    const { summary, trend, funnel, products, channels } = dashboardData;

    const monthlySalesDisplay = summary.monthlySales || 0;
    const monthlyCustomersDisplay = summary.monthlyCustomers || 0;
    const monthlyOrdersDisplay = summary.monthlyOrders || 0;
    const performanceRatio =
      typeof summary.performance.ratio === "number" && summary.performance.ratio > 0
        ? Math.min(summary.performance.ratio, 1)
        : 0;
    const performancePercent = Math.round(performanceRatio * 100);

    const trendData = trend.dates.map((date, index) => {
      let value = 0;
      if (trendMetric === "sales") {
        value = trend.sales[index] || 0;
      } else if (trendMetric === "customers") {
        value = trend.customers[index] || 0;
      } else {
        value = trend.orders[index] || 0;
      }
      return {
        date,
        value
      };
    });

    const funnelData = funnel.stages.map((stage) => ({
      name: stage.name,
      value: stage.value
    }));

    const productsData = products.items.map((item) => ({
      type: item.name,
      value: item.value
    }));

    const channelsData = channels.items.map((item) => {
      const rawPercent = typeof item.percent === "number" ? item.percent : 0;
      const percentValue = Math.round(rawPercent * 100);
      return {
        channel: item.name,
        count: item.value,
        percent: percentValue
      };
    });

    const lineConfig = {
      data: trendData,
      xField: "date",
      yField: "value",
      smooth: true,
      autoFit: true,
      height: 260
    };

    const funnelConfig = {
      data: funnelData,
      xField: "name",
      yField: "value",
      height: 260
    };

    const pieConfig = {
      data: productsData,
      angleField: "value",
      colorField: "type",
      radius: 0.8,
      height: 260
    };

    const barConfig = {
      data: channelsData,
      xField: "channel",
      yField: "percent",
      height: 260,
      axis: {
        x: {
          title: null
        },
        y: {
          min: 0,
          max: 100,
          labelFormatter: (v: string | number) => `${v}%`
        }
      },
      legend: false,
      style: {
        fill: "#1677ff"
      },
      label: {
        position: "right",
        offset: 4,
        text: (datum: any) =>
          `${typeof datum.percent === "number" ? datum.percent : 0}%`
      },
      tooltip: {
        items: [
          (datum: any) => {
            const count =
              typeof datum.count === "number" ? datum.count : 0;
            const percent =
              typeof datum.percent === "number" ? datum.percent : 0;
            return {
              name: datum.channel,
              value: `${count}（${percent}%）`
            };
          }
        ]
      }
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Row gutter={16}>
          <Col span={6}>
            <Card>
              <div style={{ fontSize: 14, marginBottom: 8 }}>本月销售额</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {monthlySalesDisplay.toLocaleString("zh-CN", {
                  style: "currency",
                  currency: "CNY",
                  maximumFractionDigits: 0
                })}
              </div>
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <div style={{ fontSize: 14, marginBottom: 8 }}>本月客户数</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{monthlyCustomersDisplay}</div>
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <div style={{ fontSize: 14, marginBottom: 8 }}>本月成单数</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{monthlyOrdersDisplay}</div>
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <div style={{ fontSize: 14, marginBottom: 8 }}>本月业绩完成情况</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 8
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 10,
                    borderRadius: 999,
                    background: "rgba(22,119,255,0.15)",
                    overflow: "hidden"
                  }}
                >
                  <div
                    style={{
                      width: `${performancePercent}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: "#1677ff"
                    }}
                  />
                </div>
                <div style={{ minWidth: 60, textAlign: "right" }}>{performancePercent}%</div>
              </div>
            </Card>
          </Col>
        </Row>

        <Card
          title="近15天业绩趋势"
          extra={
            <Space size={8}>
              <Button
                type={trendMetric === "sales" ? "primary" : "default"}
                size="small"
                onClick={() => setTrendMetric("sales")}
              >
                销售额
              </Button>
              <Button
                type={trendMetric === "customers" ? "primary" : "default"}
                size="small"
                onClick={() => setTrendMetric("customers")}
              >
                客户数
              </Button>
              <Button
                type={trendMetric === "orders" ? "primary" : "default"}
                size="small"
                onClick={() => setTrendMetric("orders")}
              >
                订单数
              </Button>
            </Space>
          }
        >
          <div style={{ height: 260 }}>
            <Line {...lineConfig} />
          </div>
        </Card>

        <Row gutter={16}>
          <Col span={8}>
            <Card title="客户转化漏斗">
              <div style={{ height: 260 }}>
                <Funnel {...funnelConfig} />
              </div>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="售卖商品统计">
              <div style={{ height: 260 }}>
                <Pie {...pieConfig} />
              </div>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="售卖渠道top排行榜">
              <div style={{ height: 260 }}>
                <Bar {...barConfig} />
              </div>
            </Card>
          </Col>
        </Row>
      </div>
    );
  };

  const renderLeadsToolbar = () => (
    <div style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }}>
      <Form layout="inline" form={leadFilterForm}>
        <Form.Item label="关键字" name="keyword">
          <Input placeholder="线索名称/公司/联系人" allowClear />
        </Form.Item>
        <Form.Item label="线索状态" name="status">
          <Select style={{ width: 140 }} allowClear placeholder="全部">
            <Option value="new">新建</Option>
            <Option value="processing">跟进中</Option>
            <Option value="won">已转化</Option>
            <Option value="lost">丢单</Option>
          </Select>
        </Form.Item>
        <Form.Item label="负责人" name="owner">
          <Input style={{ width: 120 }} placeholder="负责人" allowClear />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button
              type="primary"
              onClick={async () => {
                try {
                  const values = leadFilterForm.getFieldsValue();
                  const params = new URLSearchParams();
                  if (values.keyword) {
                    params.set("keyword", String(values.keyword).trim());
                  }
                  if (values.status) {
                    params.set("status", values.status);
                  }
                  if (values.owner) {
                    params.set("owner", String(values.owner).trim());
                  }
                  const queryString = params.toString();
                  const res = await fetch(
                    queryString ? `/api/leads?${queryString}` : "/api/leads",
                    {
                      headers: {
                        "x-crm-token": CRM_TOKEN
                      }
                    }
                  );
                  if (!res.ok) {
                    message.error("查询失败");
                    return;
                  }
                  const data = await res.json();
                  setLeads(data.items || []);
                } catch {
                  message.error("查询失败");
                }
              }}
            >
              查询
            </Button>
            <Button
              onClick={async () => {
                leadFilterForm.resetFields();
                try {
                  const res = await fetch("/api/leads", {
                    headers: {
                      "x-crm-token": CRM_TOKEN
                    }
                  });
                  if (!res.ok) {
                    message.error("重置失败");
                    return;
                  }
                  const data = await res.json();
                  setLeads(data.items || []);
                } catch {
                  message.error("重置失败");
                }
              }}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>
      <Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateLead}>
          新建线索
        </Button>
        <Button
          type="primary"
          icon={<FileTextOutlined />}
          disabled={!selectedLead}
          onClick={handleConvertLeadToOrder}
        >
          转化成订单
        </Button>
      </Space>
    </div>
  );

  const renderCustomersToolbar = () => (
    <div style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }}>
      <Form layout="inline">
        <Form.Item label="关键字">
          <Input placeholder="客户名称/公司/联系人" allowClear />
        </Form.Item>
        <Form.Item label="客户级别">
          <Select style={{ width: 140 }} allowClear placeholder="全部">
            <Option value="A">A</Option>
            <Option value="B">B</Option>
            <Option value="C">C</Option>
          </Select>
        </Form.Item>
        <Form.Item label="负责人">
          <Input style={{ width: 120 }} placeholder="负责人" allowClear />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary">查询</Button>
            <Button>重置</Button>
          </Space>
        </Form.Item>
      </Form>
      <Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateCustomer}>
          新建客户
        </Button>
      </Space>
    </div>
  );

  const renderOrdersToolbar = () => (
    <div
      style={{
        marginBottom: 16,
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        justifyContent: "space-between"
      }}
    >
      <Space>
        <span>关键字：</span>
        <Input
          style={{ width: 220 }}
          placeholder="客户姓名/电话"
          allowClear
          value={orderKeyword}
          onChange={(e) => setOrderKeyword(e.target.value)}
        />
        <span>订单状态：</span>
        <Select
          style={{ width: 140 }}
          allowClear
          placeholder="全部"
          value={orderStatusFilter}
          onChange={(value) => setOrderStatusFilter(value)}
        >
          <Option value="待付款">待付款</Option>
          <Option value="已付款">已付款</Option>
          <Option value="已发货">已发货</Option>
          <Option value="已完成">已完成</Option>
          <Option value="已取消">已取消</Option>
        </Select>
        <Button
          type="primary"
          onClick={async () => {
            try {
              const params = new URLSearchParams();
              if (orderKeyword.trim()) {
                params.set("keyword", orderKeyword.trim());
              }
              if (orderStatusFilter) {
                params.set("status", orderStatusFilter);
              }
              const queryString = params.toString();
              const res = await fetch(
                queryString ? `/api/orders?${queryString}` : "/api/orders",
                {
                  headers: {
                    "x-crm-token": CRM_TOKEN
                  }
                }
              );
              if (!res.ok) {
                message.error("查询失败");
                return;
              }
              const data = await res.json();
              setOrders(data.items || []);
            } catch {
              message.error("查询失败");
            }
          }}
        >
          查询
        </Button>
        <Button
          onClick={async () => {
            setOrderKeyword("");
            setOrderStatusFilter(undefined);
            try {
              const res = await fetch("/api/orders", {
                headers: {
                  "x-crm-token": CRM_TOKEN
                }
              });
              if (!res.ok) {
                message.error("重置失败");
                return;
              }
              const data = await res.json();
              setOrders(data.items || []);
            } catch {
              message.error("重置失败");
            }
          }}
        >
          重置
        </Button>
      </Space>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={handleCreateOrder}
      >
        新建订单
      </Button>
    </div>
  );

  const renderFilesContent = () => (
    <>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          justifyContent: "space-between"
        }}
      >
        <Input.Search
          placeholder="搜索文件名"
          allowClear
          style={{ width: 260 }}
          value={fileKeyword}
          onChange={(e) => setFileKeyword(e.target.value)}
          onSearch={() => void fetchFiles(fileKeyword)}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            fileForm.resetFields();
            fileForm.setFieldsValue({
              type: "周报"
            });
            setFileModalVisible(true);
          }}
        >
          生成文件
        </Button>
      </div>
      <Table
        rowKey="id"
        columns={fileColumns}
        dataSource={files}
        scroll={{ x: 1100 }}
        pagination={{
          pageSize: filePageSize,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: (_, pageSize) => {
            setFilePageSize(pageSize);
          }
        }}
      />
    </>
  );

  const renderTemplatesContent = () => (
    <>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          justifyContent: "space-between"
        }}
      >
        <Input.Search
          placeholder="搜索模板名称"
          allowClear
          style={{ width: 260 }}
          value={templateKeyword}
          onChange={(e) => setTemplateKeyword(e.target.value)}
          onSearch={() => void fetchTemplates(templateKeyword)}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => void createNewTemplate()}>
          添加模板
        </Button>
      </div>
      <Table
        rowKey="id"
        columns={templateColumns}
        dataSource={templates}
        scroll={{ x: 1100 }}
        pagination={{
          pageSize: templatePageSize,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: (_, pageSize) => {
            setTemplatePageSize(pageSize);
          }
        }}
      />
    </>
  );

  const weeklyReportTemplates = useMemo(() => {
    const filtered = templates.filter((item) => item.type === "周报");
    return filtered.length ? filtered : templates;
  }, [templates]);

  const weeklyReportTitle = useMemo(() => {
    const dateText = weeklyReportDate ? weeklyReportDate.format("YYYY-MM-DD") : "";
    const deptText = (weeklyReportDepartment || "").trim();
    if (!dateText || !deptText) {
      return "";
    }
    return `${dateText} ${deptText} 周报`;
  }, [weeklyReportDate, weeklyReportDepartment]);

  const generateWeeklyReport = async () => {
    const templateId = (weeklyReportTemplateId || "").trim();
    const department = (weeklyReportDepartment || "").trim();
    if (!templateId) {
      message.error("请选择模板");
      return;
    }
    if (!weeklyReportDate) {
      message.error("请选择日期");
      return;
    }
    if (!department) {
      message.error("请选择部门");
      return;
    }
    if (!weeklyReportTitle) {
      message.error("周报标题不能为空");
      return;
    }

    setWeeklyReportGenerating(true);
    setWeeklyReportHtml("");
    setWeeklyReportMarkdown("");
    setWeeklyReportSavedId("");
    try {
      const detailRes = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
        headers: {
          "x-crm-token": CRM_TOKEN
        }
      });
      if (!detailRes.ok) {
        const err = await detailRes.json().catch(() => null);
        message.error(err?.error ? `加载模板失败：${err.error}` : "加载模板失败");
        return;
      }
      const detailData = await detailRes.json();
      const template = detailData.item as TemplateDetailRecord | null;
      const attachments = (detailData.attachments || []) as TemplateAttachmentRecord[];
      if (!template) {
        message.error("加载模板失败");
        return;
      }

      const previewRes = await fetch(
        `/api/templates/${encodeURIComponent(templateId)}/preview`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-crm-token": CRM_TOKEN
          },
          body: JSON.stringify({
            text: template.text || "",
            attachmentIds: attachments.map((item) => item.id),
            templateName: template.name,
            reportTitle: weeklyReportTitle,
            classification: 7,
            department,
            reportDate: weeklyReportDate.format("YYYY-MM-DD")
          })
        }
      );

      if (!previewRes.ok) {
        const err = await previewRes.json().catch(() => null);
        message.error(err?.error ? `生成失败：${err.error}` : "生成失败");
        return;
      }
      const previewData = await previewRes.json().catch(() => null);
      const html = previewData ? String(previewData.html || "") : "";
      const markdown = previewData ? String(previewData.markdown || "") : "";
      setWeeklyReportHtml(html);
      setWeeklyReportMarkdown(markdown);
    } catch {
      message.error("生成失败");
    } finally {
      setWeeklyReportGenerating(false);
    }
  };

  const saveWeeklyReport = async () => {
    if (!weeklyReportTitle) {
      message.error("周报标题不能为空");
      return;
    }
    const markdown = (weeklyReportMarkdown || "").trim();
    if (!markdown) {
      message.error("请先生成周报");
      return;
    }
    if (weeklyReportSavedId) {
      message.success("已保存");
      return;
    }

    setWeeklyReportSaving(true);
    try {
      const saveRes = await fetch("/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-crm-token": CRM_TOKEN
        },
        body: JSON.stringify({
          name: weeklyReportTitle,
          type: "周报",
          description: markdown
        })
      });
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => null);
        message.error(err?.error ? `保存失败：${err.error}` : "保存失败");
        return;
      }
      const saved = await saveRes.json().catch(() => null);
      if (saved?.item) {
        setFiles((prev) => [saved.item, ...prev]);
        setWeeklyReportSavedId(String(saved.item.id || ""));
      }
      message.success("保存成功");
    } catch {
      message.error("保存失败");
    } finally {
      setWeeklyReportSaving(false);
    }
  };

  const renderWeeklyReportDetailContent = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Space>
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              setActiveMenu("filesList");
            }}
          >
            返回
          </Button>
          <div style={{ fontWeight: 600, fontSize: 16 }}>周报详情</div>
        </Space>
      </div>

      <Card title="周报信息">
        <Form layout="vertical">
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="选择模板" required>
                <Select
                  placeholder="请选择模板"
                  value={weeklyReportTemplateId || undefined}
                  onChange={(value) => {
                    setWeeklyReportTemplateId(String(value || ""));
                    setWeeklyReportHtml("");
                    setWeeklyReportMarkdown("");
                    setWeeklyReportSavedId("");
                  }}
                  options={weeklyReportTemplates.map((item) => ({
                    label: item.name,
                    value: item.id
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="日期" required>
                <DatePicker
                  style={{ width: "100%" }}
                  format="YYYY-MM-DD"
                  value={weeklyReportDate}
                  onChange={(value) => {
                    setWeeklyReportDate(value);
                    setWeeklyReportHtml("");
                    setWeeklyReportMarkdown("");
                    setWeeklyReportSavedId("");
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="部门" required>
                <Select
                  placeholder="请选择部门"
                  value={weeklyReportDepartment || undefined}
                  onChange={(value) => {
                    setWeeklyReportDepartment(String(value || ""));
                    setWeeklyReportHtml("");
                    setWeeklyReportMarkdown("");
                    setWeeklyReportSavedId("");
                  }}
                  options={weeklyReportDepartments.map((item) => ({
                    label: item,
                    value: item
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="文件标题">
            <Input value={weeklyReportTitle} placeholder="选择日期和部门后自动生成" readOnly />
          </Form.Item>
        </Form>
      </Card>

      <Card
        title="文档正文"
        extra={
          <Space size={8}>
            <Button
              loading={weeklyReportSaving}
              disabled={!weeklyReportMarkdown.trim() || !!weeklyReportSavedId}
              onClick={() => void saveWeeklyReport()}
            >
              保存
            </Button>
            <Button
              type="primary"
              loading={weeklyReportGenerating}
              onClick={() => void generateWeeklyReport()}
            >
              生成周报
            </Button>
          </Space>
        }
      >
        {weeklyReportHtml ? (
          <iframe
            title="weekly-report-preview"
            style={{ width: "100%", height: 560, border: "1px solid #eee", borderRadius: 8 }}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            srcDoc={weeklyReportHtml}
          />
        ) : (
          <div style={{ color: "#999" }}>
            {weeklyReportGenerating ? "生成中..." : "点击“生成周报”生成内容"}
          </div>
        )}
      </Card>
    </div>
  );

  const renderTemplateDetailContent = () => {
    if (templateDetailLoading) {
      return (
        <div style={{ padding: 24, textAlign: "center", color: "#999" }}>
          模板详情加载中...
        </div>
      );
    }

    if (!templateDetail) {
      return (
        <div style={{ padding: 24, textAlign: "center", color: "#999" }}>
          未找到模板
        </div>
      );
    }

    const metaPieces = [
      templateDetail.createdAt
        ? `创建时间：${dayjs(templateDetail.createdAt).format("YYYY-MM-DD HH:mm")}`
        : "",
      templateDetail.creator ? `创建人：${templateDetail.creator}` : "",
      templateDetail.updatedAt
        ? `修改时间：${dayjs(templateDetail.updatedAt).format("YYYY-MM-DD HH:mm")}`
        : ""
    ].filter(Boolean);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Space size={8}>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => {
                setActiveMenu("fileTemplates");
                setTemplatePreviewHtml("");
              }}
            >
              返回
            </Button>
            <div style={{ fontSize: 18, fontWeight: 700 }}>模板编辑</div>
          </Space>
          <Space size={8}>
            {templateDetail.path ? (
              <Button type="link" onClick={() => void viewTemplateSourceFile()}>
                查看源文件
              </Button>
            ) : null}
            <Button
              type="primary"
              loading={templateSaving}
              disabled={!templateDirty}
              onClick={() => void saveTemplateText()}
            >
              保存
            </Button>
          </Space>
        </div>

        {metaPieces.length ? <div style={{ color: "#666", fontSize: 12 }}>{metaPieces.join(" ｜ ")}</div> : null}

        <Card title="模板基本信息">
          <Form layout="vertical">
            <Form.Item label="模板名称">
              <Input
                value={templateDetail.name}
                onChange={(e) => {
                  setTemplateDetail({ ...templateDetail, name: e.target.value });
                  setTemplateDirty(true);
                }}
              />
            </Form.Item>
            <Row gutter={16} align="bottom">
              <Col flex="auto">
                <Form.Item label="周报标题">
                  <Input
                    value={templateDetail.reportTitle}
                    onChange={(e) => {
                      setTemplateDetail({ ...templateDetail, reportTitle: e.target.value });
                      setTemplateDirty(true);
                    }}
                  />
                </Form.Item>
              </Col>
              <Col flex="160px">
                <Form.Item label="可选参数">
                  <Select
                    placeholder="请选择"
                    value={templateDetail.paramType}
                    options={[
                      { label: "日", value: "日" },
                      { label: "周", value: "周" },
                      { label: "月", value: "月" },
                      { label: "季度", value: "季度" }
                    ]}
                    onChange={(value) => {
                      setTemplateDetail({ ...templateDetail, paramType: value });
                      setTemplateDirty(true);
                    }}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Button
                  style={{ marginBottom: 24 }}
                  disabled={!templateDetail.paramType}
                  onClick={() => {
                    if (!templateDetail.paramType) {
                      return;
                    }
                    const insertText = `【${templateDetail.paramType}】`;
                    const textArea = templateTextAreaRef.current?.resizableTextArea?.textArea as
                      | HTMLTextAreaElement
                      | undefined;
                    if (textArea && typeof textArea.selectionStart === "number") {
                      const start = textArea.selectionStart || 0;
                      const end = textArea.selectionEnd || 0;
                      const nextValue = `${templateText.slice(0, start)}${insertText}${templateText.slice(end)}`;
                      setTemplateText(nextValue);
                      setTemplateDirty(true);
                      window.requestAnimationFrame(() => {
                        try {
                          textArea.focus();
                          const nextPos = start + insertText.length;
                          textArea.setSelectionRange(nextPos, nextPos);
                        } catch {}
                      });
                      return;
                    }
                    setTemplateText((prev) => `${prev}${insertText}`);
                    setTemplateDirty(true);
                  }}
                >
                  插入参数
                </Button>
              </Col>
            </Row>
          </Form>
        </Card>

        <Card title="模板文字描述">
          <Input.TextArea
            ref={templateTextAreaRef}
            value={templateText}
            rows={10}
            placeholder="请输入模板文字描述"
            onChange={(e) => {
              setTemplateText(e.target.value);
              setTemplateDirty(true);
            }}
          />
        </Card>

        <Card
          title="附件文件"
          extra={
            <Upload
              multiple
              showUploadList={false}
              beforeUpload={(file) => {
                void uploadTemplateAttachment(file as any);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>添加附件</Button>
            </Upload>
          }
        >
          {templateAttachments.length === 0 ? (
            <div style={{ color: "#999" }}>暂无附件</div>
          ) : (
            <Table
              rowKey="id"
              size="small"
              dataSource={templateAttachments}
              pagination={false}
              columns={[
                {
                  title: "文件名",
                  dataIndex: "fileName",
                  key: "fileName",
                  ellipsis: true
                },
                {
                  title: "大小",
                  dataIndex: "fileSize",
                  key: "fileSize",
                  width: 120,
                  render: (value: number | null) => {
                    if (typeof value !== "number" || value <= 0) {
                      return "";
                    }
                    if (value < 1024) {
                      return `${value} B`;
                    }
                    if (value < 1024 * 1024) {
                      return `${(value / 1024).toFixed(1)} KB`;
                    }
                    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
                  }
                },
                {
                  title: "添加时间",
                  dataIndex: "createdAt",
                  key: "createdAt",
                  width: 180,
                  render: (value?: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "")
                },
                {
                  title: "操作",
                  key: "actions",
                  width: 80,
                  render: (_: any, record: TemplateAttachmentRecord) => (
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => void deleteTemplateAttachment(record.id)}
                    />
                  )
                }
              ]}
            />
          )}
        </Card>

        <Card
          title="模板测试"
          extra={
            <Button type="primary" loading={templatePreviewLoading} onClick={() => void testTemplate()}>
              测试模板
            </Button>
          }
        >
          {templatePreviewHtml ? (
            <iframe
              title="template-preview"
              style={{ width: "100%", height: 480, border: "1px solid #eee", borderRadius: 8 }}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              srcDoc={templatePreviewHtml}
            />
          ) : (
            <div style={{ color: "#999" }}>
              {templatePreviewLoading ? "预览生成中..." : "点击“测试模板”生成预览"}
            </div>
          )}
        </Card>
      </div>
    );
  };

  const renderContent = () => {
    if (activeMenu === "dashboard") {
      return (
        <>{renderDashboardContent()}</>
      );
    }
    if (activeMenu === "orders") {
      return (
        <>
          {renderOrdersToolbar()}
          <Table
            rowKey="id"
            columns={orderColumns}
            dataSource={orders}
            scroll={{ x: 1300 }}
            pagination={{
              pageSize: orderPageSize,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              onChange: (_, pageSize) => {
                setOrderPageSize(pageSize);
              }
            }}
          />
        </>
      );
    }
    if (activeMenu === "leads") {
      return (
        <>
          {renderLeadsToolbar()}
          <Table
            rowKey="id"
            columns={leadColumns}
            dataSource={leads}
            rowSelection={{
              type: "radio",
              selectedRowKeys: selectedLead ? [selectedLead.id] : [],
              onChange: (_, rows) => {
                setSelectedLead(rows[0] || null);
              }
            }}
            scroll={{ x: 1200 }}
            pagination={{
              pageSize: leadPageSize,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              onChange: (_, pageSize) => {
                setLeadPageSize(pageSize);
              }
            }}
          />
        </>
      );
    }
    if (activeMenu === "customers") {
      return (
        <>
          {renderCustomersToolbar()}
          <Table
            rowKey="id"
            columns={customerColumns}
            dataSource={customers}
            scroll={{ x: 1000 }}
            pagination={{
              pageSize: customerPageSize,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              onChange: (_, pageSize) => {
                setCustomerPageSize(pageSize);
              }
            }}
          />
        </>
      );
    }
    if (activeMenu === "filesList") {
      return renderFilesContent();
    }
    if (activeMenu === "fileTemplates") {
      return renderTemplatesContent();
    }
    if (activeMenu === "fileTemplateDetail") {
      return renderTemplateDetailContent();
    }
    if (activeMenu === "weeklyReportDetail") {
      return renderWeeklyReportDetailContent();
    }
    return renderFilesContent();
  };

  return (
    <Layout style={{ minHeight: "100vh" }} className={aiDrawerOpen ? "ai-drawer-open" : ""}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        theme="dark"
      >
        <div className="sider-logo">
          {collapsed ? "CRM" : "CRM系统"}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[
            activeMenu === "fileTemplateDetail"
              ? "fileTemplates"
              : activeMenu === "weeklyReportDetail"
                ? "filesList"
                : activeMenu
          ]}
          items={menuItems}
          onClick={(info) => {
            if (info.key === "files") {
              return;
            }
            setActiveMenu(info.key as MainTabKey);
          }}
        />
      </Sider>
      <Layout>
        <Header className="header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 600, fontSize: 20 }}>{getPageTitle()}</div>
          <Space>
            <Select
              size="small"
              style={{ width: 200 }}
              value={aiAgentKey}
              onChange={setAiAgentKey}
              options={aiAgents.map((agent) => ({
                label: agent.name,
                value: agent.key
              }))}
            />
            <Button
              type="primary"
              icon={<RobotOutlined />}
              onClick={() => setAiDrawerOpen(true)}
            >
              AI助手
            </Button>
          </Space>
        </Header>
        <Content className="content">
          <Card className="card">{renderContent()}</Card>
          <div
            className={`dashboard-ai-mask ${aiDrawerOpen ? "visible" : ""}`}
            onClick={() => setAiDrawerOpen(false)}
          >
          <div
            className={`dashboard-ai-drawer ${aiDrawerOpen ? "open" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dashboard-ai-drawer-header">
                <Space style={{ flex: 1, justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 600 }}>
                    AI助手
                    {currentAgent ? ` - ${currentAgent.name}` : ""}
                  </div>
                  <Button
                    type="text"
                    size="small"
                    onClick={() => setAiDrawerOpen(false)}
                  >
                    关闭
                  </Button>
                </Space>
              </div>
              <div className="dashboard-ai-drawer-body">
                {aiLoading && (
                  <div className="dashboard-ai-loading">
                    <div className="dashboard-ai-spinner" />
                  </div>
                )}
                {currentAgent ? (
                  <iframe
                    className="dashboard-ai-iframe"
                    src={aiIframeUrl}
                    title="AI Agent"
                  />
                ) : (
                  <div style={{ padding: 16 }}>请在顶部选择一个Agent</div>
                )}
              </div>
            </div>
          </div>
          <Modal
            title="沟通记录"
            open={communicationsModalVisible}
            width={1100}
            destroyOnClose
            onCancel={() => {
              setCommunicationsModalVisible(false);
              setCommunicationsLead(null);
              setCommunications([]);
              setAnalysisItem(null);
            }}
            footer={null}
          >
            <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>沟通记录存档</div>
                <div
                  style={{
                    maxHeight: "70vh",
                    overflowY: "auto",
                    paddingRight: 8,
                    paddingTop: 4
                  }}
                >
                  {communicationsLoading ? (
                    <div>沟通记录加载中...</div>
                  ) : communications.length === 0 ? (
                    <div style={{ color: "#999" }}>暂无沟通记录</div>
                  ) : (
                    communications.map((item) => {
                      const isCustomerByName =
                        communicationsLead &&
                        item.role &&
                        String(item.role) === communicationsLead.name;
                      const isCustomer = isCustomerByName;

                      const alignStyle = isCustomer
                        ? {
                            alignItems: "flex-start"
                          }
                        : {
                            alignItems: "flex-end"
                          };

                      const bubbleStyle = isCustomer
                        ? {
                            backgroundColor: "#fff",
                            color: "#333",
                            borderRadius: 8,
                            padding: "8px 12px",
                            maxWidth: "80%",
                            alignSelf: "flex-start",
                            border: "1px solid #e5e6eb"
                          }
                        : {
                            backgroundColor: "#1677ff",
                            color: "#fff",
                            borderRadius: 8,
                            padding: "8px 12px",
                            maxWidth: "80%",
                            alignSelf: "flex-end"
                          };

                      return (
                        <div
                          key={item.id}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            marginBottom: 12,
                            ...alignStyle
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              marginBottom: 4,
                              gap: 8
                            }}
                          >
                            {isCustomer ? (
                              <>
                                <span style={{ fontWeight: 500 }}>
                                  {item.role || "客户"}
                                </span>
                                <span style={{ color: "#999", fontSize: 12 }}>
                                  {item.createdAt
                                    ? dayjs(item.createdAt).format(
                                        "YYYY-MM-DD HH:mm"
                                      )
                                    : ""}
                                </span>
                              </>
                            ) : (
                              <>
                                <span style={{ color: "#999", fontSize: 12 }}>
                                  {item.createdAt
                                    ? dayjs(item.createdAt).format(
                                        "YYYY-MM-DD HH:mm"
                                      )
                                    : ""}
                                </span>
                                <span style={{ fontWeight: 500 }}>
                                  {item.role || "销售"}
                                </span>
                              </>
                            )}
                          </div>
                          {item.content && (
                            <div style={bubbleStyle}>{item.content}</div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 600
                    }}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background:
                          "linear-gradient(135deg, #7367f0 0%, #9c6bff 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontSize: 14
                      }}
                    >
                      <FileTextOutlined />
                    </span>
                    <span>AI总结与建议</span>
                  </div>
                  <Button
                    type="link"
                    size="small"
                    onClick={handleRegenerateAnalysis}
                    disabled={analysisLoading || !communicationsLead}
                    loading={analysisLoading}
                  >
                    重新生成
                  </Button>
                </div>
                <div
                  style={{
                    maxHeight: "70vh",
                    overflowY: "auto"
                  }}
                >
                  {analysisLoading && <div>AI总结生成中...</div>}
                  {!analysisLoading && analysisItem?.content && (
                    <div
                      style={{
                        backgroundColor: "#f5f9ff",
                        borderRadius: 8,
                        padding: 16,
                        border: "1px solid #e1ecff",
                        fontSize: 15
                      }}
                    >
                      {analysisItem.content
                        .split(/\r?\n/)
                        .filter((line) => line.trim())
                        .map((line, index, arr) => {
                          const parts = line.split("：");
                          const title = parts[0] || "";
                          const body = parts.slice(1).join("：") || "";
                          const isLast = index === arr.length - 1;
                          return (
                            <div
                              key={index}
                              style={{
                                marginBottom: isLast ? 0 : 20
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 600,
                                  marginBottom: 4,
                                  fontSize: 16
                                }}
                              >
                                {title}：
                              </div>
                              <div
                                style={{
                                  lineHeight: 1.7
                                }}
                              >
                                {body}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  {!analysisLoading && !analysisItem?.content && (
                    <div style={{ color: "#999" }}>
                      暂无AI总结，请点击右上角“重新生成”获取。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Modal>
          <Modal
            title={editingLead ? "编辑线索" : "新建线索"}
            open={leadModalVisible}
            destroyOnClose
            onCancel={() => setLeadModalVisible(false)}
            onOk={submitLead}
          >
            <Form form={leadForm} layout="vertical">
              <Form.Item
                label="客户姓名"
                name="name"
                rules={
                  isCreateLead
                    ? [
                        {
                          required: true,
                          message: "客户姓名为必填项"
                        }
                      ]
                    : []
                }
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="联系电话"
                name="phone"
                rules={[
                  ...(isCreateLead
                    ? [
                        {
                          required: true,
                          message: "联系电话为必填项"
                        }
                      ]
                    : []),
                  {
                    validator: (_, value) => {
                      if (!value) {
                        return Promise.resolve();
                      }
                      if (/^\d{11}$/.test(value)) {
                        return Promise.resolve();
                      }
                      return Promise.reject(
                        new Error("手机号需要为11位数字")
                      );
                    }
                  }
                ]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="邮箱"
                name="email"
                rules={[
                  ...(isCreateLead
                    ? [
                        {
                          required: true,
                          message: "邮箱为必填项"
                        }
                      ]
                    : []),
                  {
                    validator: (_, value) => {
                      if (!value) {
                        return Promise.resolve();
                      }
                      if (/^[^@]+@[^@]+\.com$/.test(value)) {
                        return Promise.resolve();
                      }
                      return Promise.reject(
                        new Error("邮箱须为*@*.com格式")
                      );
                    }
                  }
                ]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="来源渠道"
                name="source"
                rules={
                  isCreateLead
                    ? [
                        {
                          required: true,
                          message: "来源渠道为必填项"
                        }
                      ]
                    : []
                }
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="负责销售员"
                name="owner"
                rules={
                  isCreateLead
                    ? [
                        {
                          required: true,
                          message: "负责销售员为必填项"
                        }
                      ]
                    : []
                }
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="跟进状态"
                name="status"
                rules={
                  isCreateLead
                    ? [
                        {
                          required: true,
                          message: "跟进状态为必填项"
                        }
                      ]
                    : []
                }
              >
                <Select placeholder="请选择跟进状态">
                  <Option value="new">新建</Option>
                  <Option value="processing">跟进中</Option>
                  <Option value="won">已转化</Option>
                  <Option value="lost">丢单</Option>
                </Select>
              </Form.Item>
              <Form.Item label="最后跟进日期" name="nextFollowUp">
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
              <Form.Item label="备注" name="remark">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Form>
          </Modal>
          <Modal
            title={editingCustomer ? "编辑客户" : "新建客户"}
            open={customerModalVisible}
            destroyOnClose
            onCancel={() => setCustomerModalVisible(false)}
            onOk={submitCustomer}
          >
            <Form form={customerForm} layout="vertical">
              <Form.Item
                label="客户名称"
                name="name"
                rules={[
                  {
                    required: true,
                    message: "客户名称为必填项"
                  }
                ]}
              >
                <Input />
              </Form.Item>
              <Form.Item label="公司" name="company">
                <Input />
              </Form.Item>
              <Form.Item label="手机号码" name="phone">
                <Input />
              </Form.Item>
              <Form.Item label="邮箱" name="email">
                <Input />
              </Form.Item>
              <Form.Item label="客户级别" name="level">
                <Select allowClear placeholder="请选择客户级别">
                  <Option value="A">A</Option>
                  <Option value="B">B</Option>
                  <Option value="C">C</Option>
                </Select>
              </Form.Item>
              <Form.Item label="负责人" name="owner">
                <Input />
              </Form.Item>
            </Form>
          </Modal>
          <Modal
            title={editingOrder ? "编辑订单" : "新建订单"}
            open={orderModalVisible}
            destroyOnClose
            onCancel={() => setOrderModalVisible(false)}
            onOk={submitOrder}
          >
            <Form form={orderForm} layout="vertical">
              <Form.Item name="salesmanId" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="leadId" hidden>
                <Input />
              </Form.Item>
              <Form.Item
                label="客户姓名"
                name="customerName"
                rules={[
                  {
                    required: true,
                    message: "客户姓名为必填项"
                  }
                ]}
              >
                <Input />
              </Form.Item>
              <Form.Item label="联系电话" name="phone">
                <Input />
              </Form.Item>
              <Form.Item
                label="产品名称"
                name="productName"
                rules={[
                  {
                    required: true,
                    message: "产品名称为必填项"
                  }
                ]}
              >
                <Input />
              </Form.Item>
              <Form.Item label="单价" name="unitPrice">
                <InputNumber
                  style={{ width: "100%" }}
                  min={0}
                  precision={2}
                />
              </Form.Item>
              <Form.Item label="数量" name="quantity">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
              <Form.Item label="订单状态" name="status">
                <Select allowClear placeholder="请选择订单状态">
                  <Option value="待付款">待付款</Option>
                  <Option value="已付款">已付款</Option>
                  <Option value="已发货">已发货</Option>
                  <Option value="已完成">已完成</Option>
                  <Option value="已取消">已取消</Option>
                </Select>
              </Form.Item>
              <Form.Item label="销售员" name="salesmanName">
                <Input />
              </Form.Item>
              <Form.Item label="下单日期" name="orderDate">
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
              <Form.Item label="付款日期" name="payDate">
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
              <Form.Item label="发货日期" name="deliverDate">
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
            </Form>
          </Modal>
          <Modal
            title="生成文件"
            open={fileModalVisible}
            destroyOnClose
            onCancel={() => setFileModalVisible(false)}
            onOk={submitFile}
          >
            <Form form={fileForm} layout="vertical">
              {fileTypeValue === "周报" ? null : (
                <Form.Item
                  label="文件名"
                  name="name"
                  rules={[
                    {
                      required: true,
                      message: "文件名为必填项"
                    }
                  ]}
                >
                  <Input placeholder="请输入文件名" />
                </Form.Item>
              )}
              <Form.Item
                label="文件类型"
                name="type"
                rules={[
                  {
                    required: true,
                    message: "文件类型为必填项"
                  }
                ]}
              >
                <Select placeholder="请选择文件类型">
                  <Option value="周报">周报</Option>
                  <Option value="月报">月报</Option>
                  <Option value="合同">合同</Option>
                </Select>
              </Form.Item>
              {fileTypeValue === "周报" ? null : (
                <Form.Item label="文件描述（可选）" name="description">
                  <Input.TextArea rows={4} placeholder="请输入文件描述" />
                </Form.Item>
              )}
            </Form>
          </Modal>
        </Content>
      </Layout>
    </Layout>
  );
}
