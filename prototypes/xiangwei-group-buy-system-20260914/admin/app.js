(() => {
  "use strict";

  const NOW = Date.parse("2026-09-09T10:28:00+08:00");
  const ROLES = [
    { id: "SUPER_ADMIN", label: "超级管理员" },
    { id: "OPERATOR", label: "运营" },
    { id: "CUSTOMER_SERVICE", label: "客服" },
    { id: "FINANCE", label: "财务" },
    { id: "PICKUP_MANAGER", label: "点位负责人" },
  ];
  const DEFAULT_PAGE = {
    SUPER_ADMIN: "staff",
    OPERATOR: "workbench",
    CUSTOMER_SERVICE: "quality",
    FINANCE: "finance-todo",
    PICKUP_MANAGER: "point-arrival",
  };
  const ICONS = {
    grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M4 21V4"/><path d="M4 4h10l-1.5 4L20 8v8H4"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
    route: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 7.8C11 11 13 13 18 15.2"/><path d="M6 9v6a3 3 0 0 0 3 3h3"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
    shop: '<svg viewBox="0 0 24 24"><path d="M4 9l1.2-4h13.6L20 9"/><path d="M4 9h16v10H4z"/><path d="M9 19v-6h6v6"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5"/><circle cx="17" cy="9" r="2.2"/><path d="M16 14.2c2 .4 3.6 1.8 4.2 4.3"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M5 18l-1 3 3.4-1.5A8.5 8.5 0 1 0 5 18z"/></svg>',
    coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.2c.6-.8 1.5-1.2 2.5-1.2s2 .4 2.5 1.2c.4.6.4 1.4 0 2-.5.8-1.5 1.2-2.5 1.2s-2 .4-2.5 1.2"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6z"/></svg>',
    fold: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    unfold: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  };
  // 区域开通意向 (interests) 是遗留页，不是登录未成交用户；已从默认菜单隐藏，避免做成假 CRM。未成交见「用户管理」筛选。
  const POINT_PAGES = ["point-arrival", "point-pickup", "point-pickup-records", "point-campaigns"];
  const NAV = [
    { key: "workbench", label: "工作台", icon: "grid", page: "workbench" },
    {
      key: "products",
      label: "商品",
      icon: "box",
      items: [
        { key: "products", label: "商品列表" },
        { key: "categories", label: "分类管理" },
      ],
    },
    { key: "campaigns", label: "团期", icon: "flag", page: "campaigns" },
    {
      key: "orders",
      label: "订单",
      icon: "doc",
      items: [
        { key: "orders", label: "订单列表" },
        { key: "cancellations", label: "取消管理" },
      ],
    },
    {
      key: "fulfillment-hq",
      label: "履约管理",
      icon: "route",
      items: [
        { key: "delivery", label: "发货管理", hint: "全部自提点，不按当前自提点过滤" },
        { key: "refund-confirm", label: "确认退款订单", hint: "全部自提点的短少/破损订单" },
      ],
    },
    {
      key: "fulfillment-point",
      label: "点位工作台",
      icon: "shop",
      items: [
        { key: "point-arrival", label: "到货确认", hint: "仅当前自提点" },
        { key: "point-pickup", label: "领取核销", hint: "仅当前自提点" },
        { key: "point-pickup-records", label: "领取核销记录", hint: "仅当前自提点" },
        { key: "point-campaigns", label: "本点团期", hint: "仅当前自提点" },
      ],
    },
    {
      key: "sites",
      label: "区域与自提点",
      icon: "pin",
      items: [
        { key: "areas", label: "区域管理" },
        { key: "points", label: "自提点管理" },
      ],
    },
    { key: "consumers", label: "用户管理", icon: "people", page: "consumers" },
    { key: "quality", label: "售后", icon: "chat", page: "quality" },
    {
      key: "finance",
      label: "财务",
      icon: "coin",
      items: [
        { key: "finance-todo", label: "退款待办" },
        { key: "finance-refunds", label: "退款记录" },
        { key: "finance-ledger", label: "账务流水" },
      ],
    },
    { key: "governance", label: "运营治理", icon: "chat", items: [
      { key: "interests", label: "区域开通意向" },
      { key: "notifications", label: "通知处理", hint: "微信订阅通知的人工处理" },
    ] },
    {
      key: "system",
      label: "系统",
      icon: "shield",
      items: [
        { key: "staff", label: "员工管理" },
        { key: "permissions", label: "权限管理" },
        { key: "audit", label: "操作日志" },
      ],
    },
  ];
  function collectMenuKeys() {
    const keys = [];
    NAV.forEach((g) => {
      if (g.page) keys.push(g.page);
      (g.items || []).forEach((i) => keys.push(i.key));
    });
    return keys;
  }
  const ALL_MENU_KEYS = collectMenuKeys();
  const HQ_MENU_KEYS = ALL_MENU_KEYS.filter((k) => !POINT_PAGES.includes(k));
  function defaultRolePermissions() {
    return {
      SUPER_ADMIN: ALL_MENU_KEYS.slice(),
      OPERATOR: [
        "workbench", "products", "categories", "campaigns",
        "orders", "cancellations",
        "delivery", "refund-confirm",
        "areas", "points",
        "quality", "interests", "notifications",
      ],
      CUSTOMER_SERVICE: [
        "orders", "cancellations",
        "consumers",
        "quality", "notifications", "interests",
      ],
      FINANCE: ["orders", "finance-todo", "finance-refunds", "finance-ledger"],
      PICKUP_MANAGER: POINT_PAGES.slice(),
    };
  }

  const LABELS = {
    SUPER_ADMIN: "超级管理员",
    OPERATOR: "运营",
    CUSTOMER_SERVICE: "客服",
    FINANCE: "财务",
    PICKUP_MANAGER: "点位负责人",
    ACTIVE: "启用",
    INACTIVE: "停用",
    SUSPENDED: "停用",
    PASSWORD_SETUP_REQUIRED: "待首次改密",
    BLOCKED: "已封禁",
    DRAFT: "待开始",
    OPEN: "报名中",
    LOCKED: "已成团",
    FULFILLING: "履约中",
    COMPLETED: "已完成",
    NOT_FORMED: "未成团",
    CANCELLED: "已取消",
    PENDING_PAYMENT: "待支付",
    PAID: "已支付",
    READY_FOR_PICKUP: "待领取",
    PARTIAL_PICKED: "部分领取",
    CANCELLING: "取消中",
    REFUNDING: "退款中",
    REFUNDED: "退款成功",
    REFUND_HOLD: "退款失败/挂起",
    PACKING: "待装袋",
    DISPATCHED: "已发车",
    PENDING: "待确认",
    CONFIRMED: "已确认",
    LINE_OK: "正常",
    SHORT_RECEIPT: "短少",
    PACKAGE_DAMAGED: "破损",
    PENDING_CONFIRM: "待确认",
    PENDING_EXECUTE: "待执行",
    EXECUTING: "执行中",
    SUCCEEDED: "成功",
    FAILED_HOLD: "失败挂起",
    PENDING_ACCEPT: "待受理",
    PENDING_OPERATOR: "待运营决定",
    PENDING_FINANCE: "待财务退款",
    REJECTED: "已驳回",
    OVERDUE: "逾期未领",
    ENABLED: "启用",
    DISABLED: "停用",
    MANUAL_REQUIRED: "需人工处理",
    SUBMISSION_UNKNOWN: "结果核验中",
    MANUAL_COMPLETED: "已人工完成",
    NEW: "待处理",
    CONTACTED: "已联系",
    CLOSED: "已关闭",
    QUALITY_CLAIM: "品质投诉",
    PICKUP_EXPIRED: "领取已过期",
    PAYMENT_SUCCEEDED: "支付成功",
    STAFF_CREATED: "创建员工",
    STAFF_UPDATED: "更新员工",
    COMMUNITY_CAMPAIGN_CREATED: "创建团期",
    ORDER: "订单",
    CAMPAIGN: "团期",
    INTERNAL_STAFF: "内部员工",
    SERVICE_AREA: "服务区域",
    PAID_WAITING_CLOSE: "已支付",
    ALLOCATING: "已支付",
    IN_TRANSIT: "已支付",
    PICKED_UP: "已完成",
    AUTO_REFUNDED: "退款成功",
    PENDING_REVIEW: "取消中",
    APPROVED_WAITING_FINANCE: "退款中",
    REFUND_CONFIRMED: "待执行",
    REFUND_PENDING: "退款中",
    MANUAL_HOLD: "失败挂起",
    FAILED: "失败挂起",
    REGISTERED: "待受理",
    ACCEPTED: "待运营决定",
    RESOLVED: "已完成",
    SITE_CONFIRMED: "待装袋",
    VEHICLE_BOOKED: "待装袋",
    VEHICLE_DISPATCHED: "已发车",
    PENDING_OPERATOR_CONFIRMATION: "已确认",
    EXPIRED_PENDING: "待领取",
    LOSS_RECORDED: "已取消",
    EXTENDED: "待领取",
  };

  const TONE = {
    LOCKED: "green", COMPLETED: "green", ACTIVE: "green", ENABLED: "green",
    REFUNDED: "green", SUCCEEDED: "green", CONFIRMED: "green", LINE_OK: "green",
    AUTO_REFUNDED: "green", MANUAL_COMPLETED: "green", PICKED_UP: "green", RESOLVED: "green",
    OPEN: "brand", FULFILLING: "brand", REFUNDING: "brand", READY_FOR_PICKUP: "brand",
    PACKING: "brand", DISPATCHED: "brand", PAID: "blue", PAID_WAITING_CLOSE: "blue",
    ALLOCATING: "blue", IN_TRANSIT: "blue", EXECUTING: "brand", PENDING_EXECUTE: "brand",
    PENDING_FINANCE: "brand", APPROVED_WAITING_FINANCE: "brand", REFUND_PENDING: "brand",
    DRAFT: "wait", PENDING: "wait", PENDING_PAYMENT: "wait", INACTIVE: "wait", DISABLED: "wait",
    SUSPENDED: "wait", PENDING_CONFIRM: "wait", PENDING_ACCEPT: "wait", REGISTERED: "wait",
    PASSWORD_SETUP_REQUIRED: "wait", CLOSED: "wait",
    NOT_FORMED: "amber", PARTIAL_PICKED: "amber", CANCELLING: "amber", PENDING_OPERATOR: "amber",
    PENDING_REVIEW: "amber", ACCEPTED: "amber", OVERDUE: "amber", SHORT_RECEIPT: "amber",
    PACKAGE_DAMAGED: "amber", MANUAL_REQUIRED: "amber", NEW: "amber", CONTACTED: "amber",
    REFUND_CONFIRMED: "amber",
    CANCELLED: "red", REJECTED: "red", REFUND_HOLD: "red", FAILED_HOLD: "red",
    MANUAL_HOLD: "red", FAILED: "red", SUBMISSION_UNKNOWN: "red", BLOCKED: "red",
  };

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
  const label = (v) => LABELS[v] || v || "—";
  const money = (cents) => `¥${(Number(cents) / 100).toFixed(2)}`;
  const maskPhone = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length === 11 ? `${digits.slice(0, 3)}****${digits.slice(7)}` : (value || "—");
  };
  const boundPhone = (value) => String(value || "").replace(/\D/g, "").length === 11;
  const displayListPhone = (value) => boundPhone(value) ? maskPhone(value) : (value || "未绑定");
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (ts) => {
    if (!ts) return "—";
    const d = new Date(ts);
    const t = new Date(NOW);
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()) {
      return `今天 ${hm}`;
    }
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  };
  const ago = (h) => NOW - h * 3600 * 1000;
  const badge = (status) => `<span class="badge ${TONE[status] || "wait"}">${esc(label(status))}</span>`;
  const productBadge = (status) => `<span class="badge ${status === "ACTIVE" ? "green" : "wait"}">${esc(status === "ACTIVE" ? "上架" : "下架")}</span>`;
  const dealBadge = (orders) => Number(orders) > 0
    ? `<span class="badge green">已成交</span>`
    : `<span class="badge wait">未成交</span>`;
  const skuLineBadge = (item) => {
    if ((item.damaged || 0) > 0) return badge("PACKAGE_DAMAGED");
    if ((item.short || 0) > 0) return badge("SHORT_RECEIPT");
    return badge("LINE_OK");
  };
  const isArrivalPending = (a) => !!(a && a.status === "PENDING");
  const isPacking = (d) => !!(d && (d.status === "PACKING" || d.status === "SITE_CONFIRMED" || d.status === "VEHICLE_BOOKED"));
  const isDispatched = (d) => !!(d && (d.status === "DISPATCHED" || d.status === "IN_TRANSIT" || d.status === "VEHICLE_DISPATCHED"));
  const hasRole = (...ids) => ids.includes(state.role);
  const canSeeFullConsumerPhone = () => hasRole("OPERATOR", "CUSTOMER_SERVICE", "SUPER_ADMIN");
  const isSuper = () => state.role === "SUPER_ADMIN";
  const isPointOnly = () => state.role === "PICKUP_MANAGER";
  function rolePermKeys(role = state.role) {
    if (role === "SUPER_ADMIN") return HQ_MENU_KEYS.slice();
    const stored = (DB.rolePermissions && DB.rolePermissions[role]) || [];
    return stored.slice();
  }
  function allowMenuKey(key, role = state.role) {
    if (!key) return false;
    const stored = new Set(rolePermKeys(role));
    if (role === "PICKUP_MANAGER") return POINT_PAGES.includes(key) && stored.has(key);
    if (POINT_PAGES.includes(key)) return false;
    return stored.has(key);
  }
  function canAccess(page) {
    return allowMenuKey(page);
  }
  const canSeePickupRecords = () => canAccess("point-pickup-records");
  function visibleNav() {
    return NAV.map((g) => {
      if (g.page) return allowMenuKey(g.page) ? { ...g } : null;
      const items = (g.items || []).filter((i) => allowMenuKey(i.key)).map((i) => ({ ...i }));
      return items.length ? { ...g, items } : null;
    }).filter(Boolean);
  }
  function pageAllowed(page) {
    if (page === "change-password") return state.session;
    if (page === "login" || page === "password-setup") return true;
    return visibleNav().some((g) => g.page === page || (g.items || []).some((i) => i.key === page));
  }
  function findNav(page) {
    for (const g of [...visibleNav(), ...NAV]) {
      if (g.page === page) return { group: g.label, title: "", groupKey: g.key };
      const item = (g.items || []).find((i) => i.key === page);
      if (item) return { group: g.label, title: item.label, groupKey: g.key };
    }
    return { group: "", title: "", groupKey: "" };
  }
  function pageTitle(page) {
    const n = findNav(page);
    return n.title || n.group || "";
  }
  function isGroupOpen(key) {
    if (Object.prototype.hasOwnProperty.call(state.openGroups, key)) return !!state.openGroups[key];
    return findNav(state.page).groupKey === key;
  }

  const COLORS = { 蔬菜: "#5b8c5a", 蛋品: "#c4a35a", 粮油: "#b5834a", 水果: "#c45c4a", 日用: "#6a7d8a" };
  const thumb = (name, cat) =>
    `<span class="thumb" style="background:${COLORS[cat] || "#7a8f80"}">${esc((name || "商").slice(0, 1))}</span>`;

  const DB = {
    categories: [
      { id: "cat1", name: "蔬菜", sortOrder: 10, status: "ACTIVE", createdAt: ago(80) },
      { id: "cat2", name: "蛋品", sortOrder: 20, status: "ACTIVE", createdAt: ago(70) },
      { id: "cat3", name: "粮油", sortOrder: 30, status: "ACTIVE", createdAt: ago(60) },
      { id: "cat4", name: "水果", sortOrder: 40, status: "ACTIVE", createdAt: ago(20) },
      { id: "cat5", name: "日用", sortOrder: 90, status: "INACTIVE", createdAt: ago(12) },
    ],
    products: [
      { id: "p1", title: "黄心土豆", sku: "500克/袋", category: "蔬菜", origin: "本地协作点", price: 680, stock: 200, status: "ACTIVE", updatedAt: ago(2), createdAt: ago(40) },
      { id: "p2", title: "散养鲜蛋", sku: "12枚/盒", category: "蛋品", origin: "周边养殖户", price: 1890, stock: 80, status: "ACTIVE", updatedAt: ago(5), createdAt: ago(36) },
      { id: "p3", title: "鲜玉米", sku: "4根/份", category: "蔬菜", origin: "田间直发", price: 990, stock: 120, status: "ACTIVE", updatedAt: ago(8), createdAt: ago(30) },
      { id: "p4", title: "花生物油", sku: "5升/桶", category: "粮油", origin: "县域压榨", price: 8900, stock: 40, status: "INACTIVE", updatedAt: ago(26), createdAt: ago(50) },
      { id: "p5", title: "秋日苹果", sku: "5斤/箱", category: "水果", origin: "冷库直发", price: 3280, stock: 60, status: "ACTIVE", updatedAt: ago(1.2), createdAt: ago(9) },
    ],
    areas: [
      { id: "a1", name: "城区服务区", path: "河北省 / 某市 / 某县 / 城区", orderEnabled: true, createdAt: ago(90), updatedAt: ago(6) },
      { id: "a2", name: "城南片区", path: "河北省 / 某市 / 某县 / 城南", orderEnabled: false, createdAt: ago(18), updatedAt: ago(3) },
    ],
    points: [
      { id: "pt1", name: "幸福路自提点", areaId: "a1", address: "幸福路社区门口东侧", hours: "每日 09:00–20:00", instruction: "到店出示领取码", status: "ACTIVE", contact: "周点位 139****2201", managerId: "s5", managerName: "周点位", createdAt: ago(70), updatedAt: ago(4) },
      { id: "pt2", name: "车站东点", areaId: "a1", address: "车站东出口便民点", hours: "每日 08:30–19:30", instruction: "到店出示领取码", status: "ACTIVE", contact: "周点位 139****2201", managerId: "s5", managerName: "周点位", createdAt: ago(22), updatedAt: ago(10) },
      { id: "pt3", name: "园中社区点", areaId: "a2", address: "园中社区物业旁", hours: "每日 09:00–21:00", instruction: "到店出示领取码", status: "INACTIVE", contact: "未关联负责人", managerId: "", managerName: "", createdAt: ago(8), updatedAt: ago(8) },
    ],
    campaigns: [
      { id: "c1", title: "周末时蔬团", status: "OPEN", items: 3, cutoff: ago(-52), arrival: "9月12日–9月13日", point: "幸福路自提点", updatedAt: ago(1), createdAt: ago(6), minQty: 20, fail: "CANCEL_AND_REFUND" },
      { id: "c2", title: "鲜蛋加团", status: "DRAFT", items: 1, cutoff: ago(-80), arrival: "9月13日–9月14日", point: "车站东点", updatedAt: ago(3), createdAt: ago(3), minQty: 8, fail: "CANCEL_AND_REFUND" },
      { id: "c3", title: "秋日水果团", status: "FULFILLING", items: 2, cutoff: ago(30), arrival: "9月9日–9月10日", point: "幸福路自提点", updatedAt: ago(4), createdAt: ago(48), minQty: 20, fail: "CANCEL_AND_REFUND" },
      { id: "c4", title: "玉米尝鲜", status: "OPEN", items: 1, cutoff: ago(-20), arrival: "9月13日–9月14日", point: "幸福路自提点", updatedAt: ago(7), createdAt: ago(20), minQty: 8, fail: "POSTPONE" },
      { id: "c5", title: "粮油补货", status: "CANCELLED", items: 1, cutoff: ago(60), arrival: "已取消", point: "车站东点", updatedAt: ago(14), createdAt: ago(28), minQty: 20, fail: "CANCEL_AND_REFUND" },
      { id: "c6", title: "日常蛋品", status: "LOCKED", items: 1, cutoff: ago(8), arrival: "9月10日–9月11日", point: "幸福路自提点", updatedAt: ago(2.5), createdAt: ago(16), minQty: 20, fail: "CANCEL_AND_REFUND" },
      { id: "c7", title: "上周时蔬", status: "COMPLETED", items: 4, cutoff: ago(120), arrival: "已完成领取", point: "幸福路自提点", updatedAt: ago(40), createdAt: ago(160), minQty: 20, fail: "CANCEL_AND_REFUND" },
      { id: "c8", title: "城南时蔬", status: "NOT_FORMED", items: 1, cutoff: ago(6), arrival: "未成团待处理", point: "车站东点", updatedAt: ago(5), createdAt: ago(40), minQty: 20, fail: "POSTPONE" },
    ],
    orders: [],
    deliveries: [
      { id: "d1", campaign: "周末时蔬团", point: "幸福路自提点", vehicle: "未登记", status: "PACKING", next: "按已付件数装袋发车", due: "今天 16:00 前", owner: "待分配", createdAt: ago(2), updatedAt: ago(2) },
      { id: "d2", campaign: "日常蛋品", point: "幸福路自提点", vehicle: "冀F·8A21K", status: "PACKING", next: "装袋发车", due: "今天 14:00 前", owner: "王运营", createdAt: ago(9), updatedAt: ago(4) },
      { id: "d3", campaign: "秋日水果团", point: "幸福路自提点", vehicle: "冀F·66213", status: "DISPATCHED", next: "等待点位确认到货", due: "今天 18:00 前", owner: "周点位", createdAt: ago(20), updatedAt: ago(6) },
    ],
    arrivals: [
      {
        id: "ar1", campaign: "秋日水果团", point: "幸福路自提点", pointId: "pt1", batch: "B09",
        status: "PENDING", next: "对照实物确认到货", due: "今天 18:00 前", diff: "未上报",
        createdAt: ago(6), updatedAt: ago(6), lastFingerprint: null,
        items: [
          { skuId: "p5", title: "秋日苹果", sku: "5斤/箱", expected: 12, received: 12, short: 0, damaged: 0, note: "" },
          { skuId: "p1", title: "黄心土豆", sku: "500克/袋", expected: 8, received: 8, short: 0, damaged: 0, note: "" },
        ],
      },
      {
        id: "ar2", campaign: "日常蛋品", point: "幸福路自提点", pointId: "pt1", batch: "B08",
        status: "CONFIRMED", next: "确认退款订单", due: "已超时 2 小时", diff: "鲜蛋短少 2 盒",
        createdAt: ago(11), updatedAt: ago(2), lastFingerprint: "p2:38:2:0:实到短少 2 盒",
        items: [
          { skuId: "p2", title: "散养鲜蛋", sku: "12枚/盒", expected: 40, received: 38, short: 2, damaged: 0, note: "实到短少 2 盒" },
        ],
      },
      {
        id: "ar3", campaign: "上周时蔬", point: "车站东点", pointId: "pt2", batch: "B03",
        status: "CONFIRMED", next: "无需处理", due: "—", diff: "无",
        createdAt: ago(50), updatedAt: ago(44), lastFingerprint: "p1:16:0:0:|p3:10:0:0:",
        items: [
          { skuId: "p1", title: "黄心土豆", sku: "500克/袋", expected: 16, received: 16, short: 0, damaged: 0, note: "" },
          { skuId: "p3", title: "鲜玉米", sku: "4根/份", expected: 10, received: 10, short: 0, damaged: 0, note: "" },
        ],
      },
      {
        id: "ar4", campaign: "上周时蔬", point: "幸福路自提点", pointId: "pt1", batch: "B02",
        status: "CONFIRMED", next: "无需处理", due: "—", diff: "无",
        createdAt: ago(52), updatedAt: ago(46), lastFingerprint: "p1:16:0:0:|p3:10:0:0:",
        items: [
          { skuId: "p1", title: "黄心土豆", sku: "500克/袋", expected: 16, received: 16, short: 0, damaged: 0, note: "" },
          { skuId: "p3", title: "鲜玉米", sku: "4根/份", expected: 10, received: 10, short: 0, damaged: 0, note: "" },
        ],
      },
    ],
    pickupOrders: [
      {
        id: "po1", orderNo: "HT17888610027177043022D", user: "王小美", pointId: "pt1",
        arrivalId: "ar4", campaign: "上周时蔬", code: "482917", status: "PARTIAL_PICKED",
        items: [
          { skuId: "p1", title: "黄心土豆", sku: "500克/袋", ordered: 2, ready: 2, picked: 1, blocked: 0, pendingArrival: false, blockReason: "" },
        ],
      },
      {
        id: "po2", orderNo: "HT17888610027177043018A", user: "李思", pointId: "pt1",
        arrivalId: "ar2", campaign: "日常蛋品", code: "193746", status: "PAID",
        items: [
          { skuId: "p2", title: "散养鲜蛋", sku: "12枚/盒", ordered: 2, ready: 0, picked: 0, blocked: 2, pendingArrival: false, blockReason: "到货异常待运营确认退款订单，受影响数量暂不可领取" },
        ],
      },
      {
        id: "po3", orderNo: "HT17888610027177043010F", user: "李思", pointId: "pt1",
        arrivalId: "ar1", campaign: "秋日水果团", code: "560128", status: "PAID",
        items: [
          { skuId: "p5", title: "秋日苹果", sku: "5斤/箱", ordered: 1, ready: 0, picked: 0, blocked: 0, pendingArrival: true, blockReason: "" },
        ],
      },
      {
        id: "po4", orderNo: "HT17888610027177042888A", user: "赵姐", pointId: "pt1",
        arrivalId: "ar4", campaign: "上周时蔬", code: "771204", status: "COMPLETED",
        items: [
          { skuId: "p3", title: "鲜玉米", sku: "4根/份", ordered: 2, ready: 2, picked: 2, blocked: 0, pendingArrival: false, blockReason: "" },
        ],
      },
      {
        id: "po5", orderNo: "HT17888610027177042940B", user: "吴师傅", pointId: "pt2",
        arrivalId: "ar3", campaign: "上周时蔬", code: "339180", status: "COMPLETED",
        items: [
          { skuId: "p3", title: "鲜玉米", sku: "4根/份", ordered: 1, ready: 1, picked: 1, blocked: 0, pendingArrival: false, blockReason: "" },
        ],
      },
    ],
    pickupReceipts: [
      {
        id: "pr1", pickupOrderId: "po1", orderNo: "HT17888610027177043022D", user: "王小美",
        pointId: "pt1", campaign: "上周时蔬", title: "黄心土豆", sku: "500克/袋",
        qty: 1, unit: "袋", operator: "周点位", at: ago(0.15),
      },
      {
        id: "pr2", pickupOrderId: "po4", orderNo: "HT17888610027177042888A", user: "赵姐",
        pointId: "pt1", campaign: "上周时蔬", title: "鲜玉米", sku: "4根/份",
        qty: 2, unit: "份", operator: "周点位", at: ago(38),
      },
      {
        id: "pr3", pickupOrderId: "po5", orderNo: "HT17888610027177042940B", user: "吴师傅",
        pointId: "pt2", campaign: "上周时蔬", title: "鲜玉米", sku: "4根/份",
        qty: 1, unit: "份", operator: "周点位", at: ago(2.1),
      },
    ],
    exceptions: [
      { id: "ex1", orderNo: "HT17888610027177043018A", point: "幸福路自提点", type: "SHORT_RECEIPT", item: "散养鲜蛋 × 2", amount: 3780, status: "PENDING_CONFIRM", note: "实到短少 2 盒", createdAt: ago(5), updatedAt: ago(2) },
      { id: "ex2", orderNo: "HT17888610027177043010F", point: "幸福路自提点", type: "PACKAGE_DAMAGED", item: "秋日苹果 × 1", amount: 3280, status: "FAILED_HOLD", note: "破损已确认，微信退款结果不明", createdAt: ago(1.5), updatedAt: ago(1.5) },
    ],
    overdue: [
      { id: "od1", orderNo: "HT17888610027177042980C", user: "陈阿姨", point: "车站东点", deadline: ago(26), status: "READY_FOR_PICKUP", next: "运营", createdAt: ago(30), updatedAt: ago(26) },
      { id: "od2", orderNo: "HT17888610027177042961B", user: "刘师傅", point: "幸福路自提点", deadline: ago(50), status: "REFUNDING", next: "财务", createdAt: ago(70), updatedAt: ago(8) },
    ],
    consumers: [
      { id: "u21", phone: "19122087685", status: "ACTIVE", verified: true, orders: 8, createdAt: ago(200) },
      { id: "u22", phone: "13822089123", status: "ACTIVE", verified: true, orders: 3, createdAt: ago(90) },
      { id: "u23", phone: "", status: "ACTIVE", verified: false, orders: 1, createdAt: ago(12) },
      { id: "u24", phone: "15922084410", status: "BLOCKED", verified: true, orders: 2, createdAt: ago(40) },
      { id: "u25", phone: "13622080011", status: "ACTIVE", verified: true, orders: 0, createdAt: ago(5) },
      { id: "u26", phone: "", status: "ACTIVE", verified: false, orders: 0, createdAt: ago(1.5) },
    ],
    quality: [
      { id: "q1", orderNo: "HT17888610027177043010F", user: "李思", item: "秋日苹果 × 1：果面碰伤", status: "PENDING_ACCEPT", createdAt: ago(4), accept: "", decide: "" },
      { id: "q2", orderNo: "HT17888610027177043010F", user: "李思", item: "秋日苹果 × 1：个别碰伤", status: "PENDING_OPERATOR", createdAt: ago(18), accept: "已核对照片", decide: "" },
      { id: "q3", orderNo: "HT17888610027177042888A", user: "赵姐", item: "鲜玉米 × 2：部分干瘪", status: "PENDING_FINANCE", createdAt: ago(40), accept: "客服已受理", decide: "批准退款 2 根" },
      { id: "q4", orderNo: "HT17888610027177042940B", user: "吴师傅", item: "鲜玉米 × 1：口感不符", status: "REJECTED", createdAt: ago(36), accept: "客服已受理", decide: "属口感偏好，不退款" },
      { id: "q5", orderNo: "HT17888610027177042801D", user: "王小美", item: "秋日苹果 × 1：个别碰伤已退", status: "COMPLETED", createdAt: ago(70), accept: "客服已受理", decide: "批准退款" },
    ],
    cancellations: [
      { id: "ca1", orderNo: "HT17888610027177043017D", user: "李思", reason: "无法按时领取", status: "CANCELLING", phase: "AFTER_CUTOFF", createdAt: ago(3), updatedAt: ago(3) },
      { id: "ca2", orderNo: "HT17888610027177042990E", user: "周先生", reason: "重复下单", status: "REFUNDING", phase: "AFTER_CUTOFF", createdAt: ago(10), updatedAt: ago(6) },
      { id: "ca3", orderNo: "HT17888610027177042801D", user: "王小美", reason: "截单前改变主意", status: "REFUNDED", phase: "BEFORE_CUTOFF", createdAt: ago(48), updatedAt: ago(40) },
      { id: "ca-auto", orderNo: "HT17888610027177042770C", user: "孙阿姨", reason: "截单前取消", status: "REFUNDED", phase: "BEFORE_CUTOFF", createdAt: ago(22), updatedAt: ago(20) },
    ],
    notifications: [
      { id: "n1", type: "PICKUP_EXPIRED", orderNo: "HT17888610027177042980C", user: "U-00031", error: "用户未授权订阅消息", attempts: 3, status: "MANUAL_REQUIRED", createdAt: ago(20), updatedAt: ago(2) },
      { id: "n2", type: "PARTIAL_REFUND", orderNo: "HT17888610027177043018A", user: "U-00022", error: "微信接口超时", attempts: 2, status: "SUBMISSION_UNKNOWN", createdAt: ago(8), updatedAt: ago(7) },
    ],
    interests: [
      { id: "i1", region: "城西未覆盖片区", contact: "张师傅", phone: "186****2209", status: "NEW", note: "", createdAt: ago(15), updatedAt: ago(15) },
      { id: "i2", region: "北部乡镇", contact: "吴姐", phone: "133****8812", status: "CONTACTED", note: "已通过既有渠道联系，待评估运力", createdAt: ago(40), updatedAt: ago(12) },
    ],
    refunds: [
      { id: "rf1", no: "RF-20260909-018", orderNo: "HT17888610027177042888A", amount: 1980, status: "SUCCEEDED", createdAt: ago(16) },
      { id: "rf2", no: "RF-20260908-004", orderNo: "HT17888610027177042801D", amount: 3280, status: "SUCCEEDED", createdAt: ago(40) },
      { id: "rf3", no: "RF-20260909-021", orderNo: "HT17888610027177043010F", amount: 3280, status: "FAILED_HOLD", createdAt: ago(3) },
    ],
    ledger: [
      { id: "l1", event: "PAYMENT_SUCCEEDED", ref: "HT17888610027177043022D", debit: 1360, credit: 1360, balanced: true, createdAt: ago(10) },
      { id: "l2", event: "PARTIAL_REFUND_SUCCEEDED", ref: "RF-20260909-018", debit: 1980, credit: 1980, balanced: true, createdAt: ago(16) },
      { id: "l3", event: "REFUND_SUCCEEDED", ref: "RF-20260908-004", debit: 3280, credit: 3280, balanced: true, createdAt: ago(40) },
    ],
    audits: [
      { id: "au1", actor: "王运营", action: "COMMUNITY_CAMPAIGN_CREATED", resource: "团期", resourceId: "周末时蔬团", requestId: "req-9f3a2c18e1", createdAt: ago(6) },
      { id: "au2", actor: "陈超管", action: "STAFF_CREATED", resource: "内部员工", resourceId: "周点位", requestId: "req-77c10ab4d2", createdAt: ago(70) },
      { id: "au3", actor: "李客服", action: "ORDER_NOTIFICATION_MANUAL_COMPLETED", resource: "订单通知", resourceId: "n-hist-01", requestId: "req-12bb90aa01", createdAt: ago(28) },
    ],
    staff: [
      { id: "s1", name: "陈超管", staffNo: "ST-0001", phone: "138****1001", role: "SUPER_ADMIN", points: "全部", status: "ACTIVE", me: true, createdAt: ago(200) },
      { id: "s2", name: "王运营", staffNo: "ST-0002", phone: "139****2208", role: "OPERATOR", points: "不适用", status: "ACTIVE", createdAt: ago(80) },
      { id: "s3", name: "李客服", staffNo: "ST-0003", phone: "136****4412", role: "CUSTOMER_SERVICE", points: "不适用", status: "ACTIVE", createdAt: ago(60) },
      { id: "s4", name: "赵财务", staffNo: "ST-0004", phone: "150****7781", role: "FINANCE", points: "不适用", status: "ACTIVE", createdAt: ago(50) },
      { id: "s5", name: "周点位", staffNo: "ST-0005", phone: "139****2201", role: "PICKUP_MANAGER", points: "幸福路自提点、车站东点", status: "ACTIVE", createdAt: ago(40) },
      { id: "s8", name: "吴点位", staffNo: "ST-0008", phone: "137****6610", role: "PICKUP_MANAGER", points: "未关联", status: "ACTIVE", createdAt: ago(12) },
      { id: "s6", name: "孙停用", staffNo: "ST-0006", phone: "187****0091", role: "OPERATOR", points: "不适用", status: "INACTIVE", createdAt: ago(30) },
      { id: "s7", name: "钱新员", staffNo: "ST-0007", phone: "158****3344", role: "CUSTOMER_SERVICE", points: "不适用", status: "PASSWORD_SETUP_REQUIRED", createdAt: ago(2) },
    ],
    rolePermissions: defaultRolePermissions(),
  };

  const moreGoods = ["小白菜", "西红柿", "黄瓜", "青椒", "茄子", "大蒜", "香菇", "豆腐"];
  moreGoods.forEach((title, i) => {
    DB.products.push({
      id: "p" + (10 + i),
      title,
      sku: i % 2 ? "1斤/份" : "2斤/份",
      category: "蔬菜",
      origin: "本地协作点",
      price: 500 + i * 80,
      stock: 50 + i * 10,
      status: "ACTIVE",
      updatedAt: ago(i + 12),
      createdAt: ago(i + 12),
    });
  });
  const orderGoods = ["黄心土豆 × 2", "秋日苹果 × 1", "散养鲜蛋 × 1", "鲜玉米 × 1"];
  const orderStatus = ["PAID", "PAID", "READY_FOR_PICKUP", "PARTIAL_PICKED", "REFUNDING", "COMPLETED"];
  for (let i = 0; i < 42; i += 1) {
    DB.orders.push({
      id: "o" + i,
      orderNo: "HT1788861002717704" + String(3022 - i).padStart(4, "0") + "D",
      user: ["王小美", "李思", "陈阿姨", "刘师傅"][i % 4],
      campaign: ["周末时蔬团", "秋日水果团", "日常蛋品", "上周时蔬"][i % 4],
      goods: orderGoods[i % 4],
      amount: [1360, 3280, 1890, 990][i % 4],
      status: i === 0 ? "PARTIAL_PICKED" : orderStatus[i % 6],
      paidAt: ago(i * 1.7 + 0.4),
      createdAt: ago(i * 1.7 + 0.2),
      point: i % 3 === 0 ? "车站东点" : "幸福路自提点",
      pickup: i % 5 === 0 ? "1 / 2 件" : "0 / 1 件",
      logs: [{ at: ago(i * 1.7 + 0.4), actor: "系统", text: "支付成功，金额以支付时为准" }],
    });
  }
  [
    { id: "od-o0", orderNo: "HT17888610027177042980C", user: "陈阿姨", point: "车站东点", status: "READY_FOR_PICKUP", overdue: true, deadline: ago(26), pickup: "0 / 2 件" },
    { id: "od-o1", orderNo: "HT17888610027177042961B", user: "刘师傅", point: "幸福路自提点", status: "REFUNDING", overdue: true, deadline: ago(50), pickup: "0 / 1 件" },
  ].forEach((s) => {
    DB.orders.unshift({
      campaign: "上周时蔬",
      goods: "黄心土豆 × 2",
      amount: 1360,
      paidAt: ago(80),
      createdAt: ago(80),
      logs: [
        { at: s.deadline, actor: "系统", text: "领取窗口已截止（到货确认后第 3 个自然日 23:59:59）" },
        { at: ago(80), actor: "系统", text: "支付成功，金额以支付时为准 ¥13.60" },
      ],
      ...s,
    });
  });
  function upsertOrder(patch) {
    const idx = DB.orders.findIndex((o) => o.orderNo === patch.orderNo);
    const paidAt = patch.paidAt || ago(8);
    const createdAt = patch.createdAt || paidAt;
    const next = {
      logs: [{ at: paidAt, actor: "系统", text: "支付成功，金额以支付时为准" }],
      pickup: patch.pickup || "0 / 1 件",
      paidAt,
      createdAt,
      ...patch,
    };
    const candidate = { ...(idx >= 0 ? DB.orders[idx] : {}), ...next };
    const required = ["id", "orderNo", "user", "campaign", "goods", "status", "point"];
    if (required.some((key) => typeof candidate[key] !== "string" || !candidate[key].trim()) || !Number.isSafeInteger(candidate.amount) || candidate.amount < 0) {
      throw new Error("原型订单数据不完整或金额不是合法的整数分：" + (patch.orderNo || "缺少订单号"));
    }
    if (idx >= 0) Object.assign(DB.orders[idx], candidate);
    else DB.orders.unshift(candidate);
  }
  upsertOrder({
    id: "o0",
    orderNo: "HT17888610027177043022D",
    user: "王小美",
    campaign: "上周时蔬",
    goods: "黄心土豆 × 2",
    amount: 1360,
    status: "PARTIAL_PICKED",
    point: "幸福路自提点",
    pickup: "1 / 2 件",
    paidAt: ago(0.4),
    createdAt: ago(0.2),
    logs: [
      { at: ago(0.15), actor: "周点位", text: "核销黄心土豆 1 袋，领取进度 1 / 2 件" },
      { at: ago(0.4), actor: "系统", text: "支付成功，金额以支付时为准" },
    ],
  });
  upsertOrder({
    id: "story-43018A",
    orderNo: "HT17888610027177043018A",
    user: "李思",
    campaign: "日常蛋品",
    goods: "散养鲜蛋 × 2",
    amount: 3780,
    status: "PAID",
    point: "幸福路自提点",
    pickup: "0 / 2 件",
    paidAt: ago(8),
    createdAt: ago(8.2),
    logs: [
      { at: ago(2), actor: "王运营", text: "到货短少已登记，待确认退款订单" },
      { at: ago(8), actor: "系统", text: "支付成功，金额以支付时为准" },
    ],
  });
  upsertOrder({
    id: "story-43010F",
    orderNo: "HT17888610027177043010F",
    user: "李思",
    campaign: "秋日水果团",
    goods: "秋日苹果 × 1",
    amount: 3280,
    status: "REFUND_HOLD",
    point: "幸福路自提点",
    pickup: "0 / 1 件",
    paidAt: ago(20),
    createdAt: ago(20.2),
  });
  upsertOrder({
    id: "story-42888A",
    orderNo: "HT17888610027177042888A",
    user: "赵姐",
    campaign: "上周时蔬",
    goods: "鲜玉米 × 2",
    amount: 1980,
    status: "REFUNDING",
    point: "幸福路自提点",
    pickup: "2 / 2 件",
    paidAt: ago(40),
    createdAt: ago(40.2),
    logs: [
      { at: ago(16), actor: "李客服", text: "品质售后已受理，退款处理中" },
      { at: ago(38), actor: "周点位", text: "核销鲜玉米 2 份，领取进度 2 / 2 件" },
      { at: ago(40.2), actor: "系统", text: "支付成功，金额以支付时为准" },
    ],
  });
  upsertOrder({
    id: "story-42940B",
    orderNo: "HT17888610027177042940B",
    user: "吴师傅",
    campaign: "上周时蔬",
    goods: "鲜玉米 × 1",
    amount: 990,
    status: "COMPLETED",
    point: "车站东点",
    pickup: "1 / 1 件",
    paidAt: ago(50),
    createdAt: ago(50.2),
    logs: [
      { at: ago(2.1), actor: "周点位", text: "核销鲜玉米 1 份，领取进度 1 / 1 件" },
      { at: ago(50), actor: "系统", text: "支付成功，金额以支付时为准" },
    ],
  });
  upsertOrder({
    id: "story-42990E",
    orderNo: "HT17888610027177042990E",
    user: "周先生",
    campaign: "周末时蔬团",
    goods: "鲜玉米 × 1",
    amount: 990,
    status: "REFUNDING",
    point: "幸福路自提点",
    pickup: "0 / 1 件",
    paidAt: ago(10),
    createdAt: ago(10.2),
  });
  upsertOrder({
    id: "story-42801D",
    orderNo: "HT17888610027177042801D",
    user: "王小美",
    campaign: "秋日水果团",
    goods: "秋日苹果 × 1",
    amount: 3280,
    status: "REFUNDED",
    point: "幸福路自提点",
    pickup: "0 / 1 件",
    paidAt: ago(48),
    createdAt: ago(48.2),
    logs: [
      { at: ago(40), actor: "系统", text: "取消已退款" },
      { at: ago(48), actor: "系统", text: "支付成功，金额以支付时为准" },
    ],
  });
  // Complete mock order for cancellation ca1; amount is integer cents (2 × ¥18.90).
  upsertOrder({
    id: "story-43017D",
    orderNo: "HT17888610027177043017D",
    user: "李思",
    campaign: "日常蛋品",
    goods: "散养鲜蛋 × 2",
    amount: 3780,
    status: "CANCELLING",
    point: "幸福路自提点",
    pickup: "0 / 2 件",
    paidAt: ago(8.9),
    createdAt: ago(8.7),
  });
  upsertOrder({
    id: "od-o0",
    orderNo: "HT17888610027177042980C",
    user: "陈阿姨",
    campaign: "上周时蔬",
    goods: "黄心土豆 × 2",
    amount: 1360,
    status: "READY_FOR_PICKUP",
    point: "车站东点",
    pickup: "0 / 2 件",
    deadline: ago(26),
    overdue: true,
    paidAt: ago(80),
    createdAt: ago(80),
    logs: [
      { at: ago(26), actor: "系统", text: "领取窗口已截止（到货确认后第 3 个自然日 23:59:59）" },
      { at: ago(80), actor: "系统", text: "支付成功，金额以支付时为准 ¥13.60" },
    ],
  });
  upsertOrder({
    id: "od-o1",
    orderNo: "HT17888610027177042961B",
    user: "刘师傅",
    campaign: "上周时蔬",
    goods: "黄心土豆 × 2",
    amount: 1360,
    status: "REFUNDING",
    point: "幸福路自提点",
    pickup: "0 / 2 件",
    deadline: ago(50),
    overdue: true,
    paidAt: ago(80),
    createdAt: ago(80),
    logs: [
      { at: ago(50), actor: "系统", text: "领取窗口已截止，已登记逾期退款" },
      { at: ago(80), actor: "系统", text: "支付成功，金额以支付时为准 ¥13.60" },
    ],
  });
  (function seedPointCampaignOrders() {
    const specs = [
      { title: "秋日水果团", point: "幸福路自提点", min: 15, goods: "秋日苹果 × 1", amount: 3280, statuses: ["PAID", "READY_FOR_PICKUP", "COMPLETED", "REFUNDED", "PAID"] },
      { title: "周末时蔬团", point: "幸福路自提点", min: 10, goods: "黄心土豆 × 2", amount: 1360, statuses: ["PAID", "PAID", "REFUNDING"] },
      { title: "上周时蔬", point: "幸福路自提点", min: 12, goods: "鲜玉米 × 1", amount: 990, statuses: ["COMPLETED", "COMPLETED", "READY_FOR_PICKUP", "PARTIAL_PICKED"] },
    ];
    const users = ["王小美", "李思", "陈阿姨", "刘师傅", "赵姐", "周先生", "吴师傅", "孙阿姨"];
    let seq = 5600;
    specs.forEach((spec) => {
      while (DB.orders.filter((o) => o.campaign === spec.title && o.point === spec.point).length < spec.min) {
        const n = DB.orders.filter((o) => o.campaign === spec.title && o.point === spec.point).length;
        const status = spec.statuses[n % spec.statuses.length];
        seq += 1;
        DB.orders.push({
          id: "pad-" + spec.title.replace(/\s+/g, "") + "-" + n,
          orderNo: "HT1788861002717705" + String(seq).padStart(4, "0") + "K",
          user: users[n % users.length],
          campaign: spec.title,
          goods: spec.goods,
          amount: spec.amount,
          status,
          paidAt: ago(n * 2.2 + 3),
          createdAt: ago(n * 2.2 + 2.8),
          point: spec.point,
          pickup: status === "PARTIAL_PICKED" || status === "COMPLETED" ? "1 / 1 件" : "0 / 1 件",
          logs: [{ at: ago(n * 2.2 + 3), actor: "系统", text: "支付成功，金额以支付时为准" }],
        });
      }
    });
  })();
  for (let i = 3; i < 26; i += 1) {
    DB.deliveries.push({
      id: "d" + i,
      campaign: ["周末时蔬团", "鲜蛋加团", "玉米尝鲜"][i % 3] + " · " + (i + 1),
      point: ["幸福路自提点", "车站东点"][i % 2],
      vehicle: i % 4 === 0 ? "未登记" : "133****" + (1300 + i),
      status: i % 5 === 1 ? "PACKING" : i % 7 === 0 ? "DISPATCHED" : "PACKING",
      next: i % 5 === 1 ? "按已付件数装袋发车" : "装袋发车",
      due: "按截单后履约",
      owner: "王运营",
      createdAt: ago(i * 5 + 3),
      updatedAt: ago(i * 5 + 1),
    });
  }
  for (let i = 3; i < 18; i += 1) {
    DB.cancellations.push({
      id: "ca" + i,
      orderNo: "HT1788861002717704" + String(2800 + i).padStart(4, "0") + "A",
      user: "消费者 " + (20 + i),
      reason: i % 5 === 0 ? "截单前取消" : i % 3 === 0 ? "重复下单" : "无法按时领取",
      status: i % 8 === 0 ? "CANCELLING" : "REFUNDED",
      phase: i % 8 === 0 ? "AFTER_CUTOFF" : (i % 5 === 0 ? "BEFORE_CUTOFF" : "AFTER_CUTOFF"),
      createdAt: ago(i * 3 + 2),
      updatedAt: ago(i * 3 + 1),
    });
  }
  DB.financeTodos = [
    { id: "ft1", source: "品质售后", orderNo: "HT17888610027177042888A", amount: 1980, status: "EXECUTING", kind: "quality", createdAt: ago(16), updatedAt: ago(3) },
    { id: "ft2", source: "截单后取消", orderNo: "HT17888610027177042990E", amount: 990, status: "PENDING_EXECUTE", kind: "cancel", createdAt: ago(10), updatedAt: ago(6) },
    { id: "ft3", source: "到货异常", orderNo: "HT17888610027177043018A", amount: 3780, status: "PENDING_EXECUTE", kind: "ex", createdAt: ago(5), updatedAt: ago(2) },
    { id: "ft4", source: "逾期未领", orderNo: "HT17888610027177042961B", amount: 1360, status: "PENDING_EXECUTE", kind: "overdue", createdAt: ago(8), updatedAt: ago(8) },
    { id: "ft5", source: "截单后取消", orderNo: "HT17888610027177042770C", amount: 990, status: "PENDING_EXECUTE", kind: "cancel-fail", demoOutcome: "FAILED", createdAt: ago(4), updatedAt: ago(4) },
    { id: "ft6", source: "到货异常", orderNo: "HT17888610027177043010F", amount: 3280, status: "FAILED_HOLD", kind: "ex-hold", createdAt: ago(3), updatedAt: ago(3) },
  ];
  for (let i = 3; i < 16; i += 1) {
    DB.audits.push({
      id: "au" + i,
      actor: ["王运营", "李客服", "赵财务"][i % 3],
      action: ["STAFF_UPDATED", "PAYMENT_SUCCEEDED", "COMMUNITY_CAMPAIGN_CREATED"][i % 3],
      resource: ["内部员工", "订单", "团期"][i % 3],
      resourceId: "对象-" + i,
      requestId: "req-" + (1000 + i),
      createdAt: ago(i * 6 + 1),
    });
  }

  const ACTOR = {
    SUPER_ADMIN: { name: "陈超管", sub: "超级管理员" },
    OPERATOR: { name: "王运营", sub: "运营" },
    CUSTOMER_SERVICE: { name: "李客服", sub: "客服" },
    FINANCE: { name: "赵财务", sub: "财务" },
    PICKUP_MANAGER: { name: "周点位", sub: "幸福路自提点、车站东点" },
  };

  const state = {
    session: false,
    role: "OPERATOR",
    page: "login",
    view: "list",
    id: null,
    formKind: "create",
    pageNum: 1,
    pageSize: 20,
    draft: { q: "", status: "ALL", from: "", to: "", window: "ALL", range: "TODAY", campaign: "", deal: "ALL" },
    applied: {},
    listMode: "data",
    modal: null,
    banner: null,
    openGroups: {},
    accountOpen: false,
    loginError: "",
    loginUser: "",
    pickupLookup: null,
    pickupQuery: "",
    pickupCode: "",
    pickupError: "",
    pickupQtys: {},
    pointId: "pt1",
    replayArrivalId: null,
    arrivalError: "",
    arrivalDrafts: {},
    arrivalExceptionForm: null,
    saved: false,
    sidebarCollapsed: window.innerWidth <= 1023,
    mobileNav: false,
    flyout: null,
    pointDraft: null,
    permRole: null,
    permDraft: [],
  };

  const root = document.getElementById("app");

  function normalizeRoute(page, view = "list", id = null, extra = {}) {
    extra = extra || {};
    if (page === "point-workbench") return { page: "point-arrival", view: "list", id: null, extra };
    if (page === "exceptions") return { page: "refund-confirm", view: view === "list" ? "list" : "detail", id, extra };
    if (page === "overdue") {
      const rec = id ? byId("overdue", id) : null;
      const order = rec
        ? DB.orders.find((o) => o.orderNo === rec.orderNo)
        : (id ? byId("orders", id) : null);
      if (order && view !== "list") {
        return { page: "orders", view: "detail", id: order.id, extra };
      }
      return {
        page: "orders",
        view: "list",
        id: null,
        extra: {
          ...extra,
          applied: { status: "OVERDUE", ...(extra.applied || {}) },
          draft: { q: "", status: "OVERDUE", from: "", to: "", ...(extra.draft || {}) },
        },
      };
    }
    return { page, view, id, extra };
  }
  function go(page, view = "list", id = null, extra = {}) {
    const returnToMobileMenu = state.mobileNav;
    const route = normalizeRoute(page, view, id, extra);
    page = route.page;
    view = route.view || "list";
    id = route.id;
    extra = route.extra || {};
    if (extra.formKind) state.formKind = extra.formKind;
    if (view === "list") {
      state.pageNum = 1;
      state.draft = { q: "", status: "ALL", from: "", to: "", window: "ALL", range: "TODAY", campaign: "", deal: "ALL" };
      state.applied = {};
      state.banner = null;
      state.saved = false;
    }
    if (extra.draft) state.draft = { ...state.draft, ...extra.draft };
    if (extra.applied) state.applied = { ...state.applied, ...extra.applied };
    state.page = page;
    state.view = view;
    state.id = id;
    state.accountOpen = false;
    state.mobileNav = false;
    state.flyout = null;
    if (page !== "points" || view !== "form") state.pointDraft = null;
    state.modal = extra.modal || null;
    const hash = view === "list" || !view ? `#/${page}` : `#/${page}/${view}/${id || "new"}`;
    if (location.hash !== hash) location.hash = hash;
    render();
    // The next hashchange render preserves this control through focusDescriptor.
    if (returnToMobileMenu) root.querySelector('[data-act="open-nav"]')?.focus();
  }

  function byId(list, id) {
    return (DB[list] || []).find((x) => x.id === id) || null;
  }
  function newest(list) {
    return list.slice().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  }
  function applyQuery(rows, keys) {
    const q = (state.applied.q || "").trim();
    const status = state.applied.status;
    let out = rows;
    if (q) {
      const n = q.toLocaleLowerCase();
      out = out.filter((row) => keys.some((k) => String(row[k] ?? "").toLocaleLowerCase().includes(n)));
    }
    if (status && status !== "ALL") out = out.filter((row) => row.status === status);
    return out;
  }
  function pageSlice(rows) {
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize) || 1);
    const page = Math.min(state.pageNum, pages);
    const start = (page - 1) * state.pageSize;
    return { rows: rows.slice(start, start + state.pageSize), total, page, pages, start };
  }

  function pager(total) {
    const { page, pages, start } = pageSlice(Array.from({ length: total }));
    const from = total ? start + 1 : 0;
    const to = Math.min(start + state.pageSize, total);
    const nums = [];
    const s = Math.max(1, page - 2);
    const e = Math.min(pages, s + 4);
    for (let n = s; n <= e; n += 1) nums.push(n);
    return `<div class="pagination">
      <span>共 ${total} 条 · 显示 ${from}–${to} 条</span>
      <div class="pages">
        <select data-act="page-size">${[20, 50, 100].map((n) => `<option${n === state.pageSize ? " selected" : ""}>${n} 条/页</option>`).join("")}</select>
        <button class="page" data-act="page" data-to="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>
        ${nums.map((n) => `<button class="page${n === page ? " active" : ""}" data-act="page" data-to="${n}">${n}</button>`).join("")}
        ${pages > e ? "<span>…</span>" : ""}
        <button class="page" data-act="page" data-to="${page + 1}" ${page >= pages ? "disabled" : ""}>›</button>
      </div>
    </div>`;
  }

  function toolbar(placeholder, statuses) {
    return `<div class="toolbar">
      <input data-filter="q" value="${esc(state.draft.q)}" placeholder="${esc(placeholder)}" aria-label="关键字">
      <select data-filter="status" aria-label="状态">${statuses.map(([v, t]) => `<option value="${v}"${state.draft.status === v ? " selected" : ""}>${t}</option>`).join("")}</select>
      <button class="secondary" data-act="time">时间范围</button>
      <button class="primary" data-act="search">查询</button>
      <button class="secondary" data-act="reset">重置</button>
      <span class="push"></span>
    </div>`;
  }
  function appliedBar() {
    const chips = [];
    if (state.applied.q) chips.push(["q", `关键字：${state.applied.q}`]);
    if (state.applied.status && state.applied.status !== "ALL") chips.push(["status", `状态：${label(state.applied.status)}`]);
    if (state.applied.deal && state.applied.deal !== "ALL") chips.push(["deal", `成交：${state.applied.deal === "PAID" ? "已成交" : "未成交"}`]);
    if (state.applied.window && state.applied.window !== "ALL") chips.push(["window", `领取窗口：${state.applied.window}`]);
    if (state.applied.range === "ALL") chips.push(["range", "日期：全部"]);
    if (state.applied.from) chips.push(["from", `开始：${state.applied.from}`]);
    if (state.applied.to) chips.push(["to", `结束：${state.applied.to}`]);
    if (state.applied.campaign) chips.push(["campaign", `团期：${state.applied.campaign}`]);
    if (!chips.length) return "";
    return `<div class="applied">已应用筛选${chips.map(([k, t]) => `<button class="chip" data-act="clear-chip" data-chip="${k}">${esc(t)} ×</button>`).join("")}<button class="text-action" data-act="reset">全部重置</button></div>`;
  }

  function table(columns, rows, kind, emptyText) {
    if (!rows.length) {
      return `<div class="table-wrap"><div class="table-shell"><div class="empty" style="margin:0;border:0">${esc(emptyText)}</div></div></div>`;
    }
    return `<div class="table-wrap"><div class="table-shell"><table><thead><tr>${columns.map((c) => `<th>${c}</th>`).join("")}<th>操作</th></tr></thead><tbody>${rows.map((row) => `<tr${row.clickView ? ` class="is-link" data-act="view" data-id="${esc(row.id)}"` : ""}>${row.cells.map((c) => `<td>${c}</td>`).join("")}<td>${rowActions(kind, row)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function rowActions(kind, row) {
    if (kind === "view") return `<div class="row-actions"><button class="text-action" data-act="view" data-id="${row.id}">查看</button></div>`;
    if (kind === "resource") {
      const edit = row.canEdit === false ? "" : `<button class="text-action" data-act="edit" data-id="${row.id}">编辑</button>`;
      return `<div class="row-actions"><button class="text-action" data-act="view" data-id="${row.id}">查看</button>${edit}</div>`;
    }
    if (kind === "action") {
      return `<div class="row-actions"><button class="text-action" data-act="${esc(row.handleAct || "handle")}" data-id="${row.id}">${esc(row.handleLabel || "处理")}</button></div>`;
    }
    const handle = row.canHandle === false
      ? `<span class="sub">${esc(row.handleHint || "当前无需处理")}</span>`
      : `<button class="text-action" data-act="${esc(row.handleAct || "handle")}" data-id="${row.id}">${esc(row.handleLabel || "处理")}</button>`;
    return `<div class="row-actions"><button class="text-action" data-act="view" data-id="${row.id}">查看</button>${handle}</div>`;
  }

  function objectCell(title, sub) {
    return `<div class="object">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ""}`;
  }
  function listStates(build) {
    if (state.listMode === "loading") {
      return `<div class="skeleton"><div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div></div>`;
    }
    if (state.listMode === "error") {
      return `<div class="state-card solid"><h2>数据加载失败</h2><p>后台服务暂时无法连接，已保留本页筛选条件。</p><button class="primary" data-act="retry">重试</button></div>`;
    }
    if (state.listMode === "empty") {
      return build([]);
    }
    return build("data");
  }
  function headline(title, primary, note) {
    return `<div class="headline"><div><h1>${esc(title)}</h1>${note ? `<p class="note">${note}</p>` : ""}</div>${primary || ""}</div>`;
  }

  function crumbHtml() {
    const path = findNav(state.page);
    const parts = [];
    if (path.group) parts.push(path.group);
    if (path.title) parts.push(path.title);
    if (state.view === "form") parts.push(state.formKind === "edit" ? "编辑" : (state.formKind === "postpone" ? "顺延团期" : "新建"));
    if (state.view === "detail" || state.view === "handle") parts.push("详情");
    if (!parts.length) return "";
    return `<nav class="crumb">${parts.map((p, i) => (
      i === parts.length - 1 ? `<b>${esc(p)}</b>` : `<span>${esc(p)}</span><span class="sep">/</span>`
    )).join("")}</nav>`;
  }
  function shell(mainHtml) {
    const nav = visibleNav();
    const me = ACTOR[state.role] || { name: label(state.role), sub: "" };
    const collapsed = !!state.sidebarCollapsed && window.innerWidth > 767;
    return `<div class="shell${collapsed ? " is-collapsed" : ""}${state.mobileNav ? " mobile-open" : ""}">
      <button class="nav-overlay" data-act="close-nav" aria-label="关闭导航" tabindex="-1"></button>
      <aside id="primary-sidebar" aria-label="后台导航">
        <div class="brand">
          <span class="brand-mark">乡</span>
          <div class="brand-copy"><strong>乡味集</strong><span>管理后台</span></div>
        </div>
        <nav class="nav" aria-label="后台主导航">${nav.map((g) => g.page
          ? `<div class="nav-group leaf" data-group="${g.key}">
            <button class="group-toggle leaf-link${state.page === g.page ? " active" : ""}" data-page="${g.page}" aria-label="${esc(g.label)}" ${state.page === g.page ? 'aria-current="page"' : ""} title="${esc(g.label)}">
              <span class="nav-icon">${ICONS[g.icon] || ""}</span><span class="nav-label">${esc(g.label)}</span>
            </button>
          </div>`
          : `<div class="nav-group${isGroupOpen(g.key) ? " open" : ""}" data-group="${g.key}">
            <button class="group-toggle${g.items.some((i) => i.key === state.page) ? " active-parent" : ""}" data-group-toggle="${g.key}" aria-label="${esc(g.label)}" aria-controls="${collapsed ? "nav-flyout" : "subnav-" + g.key}" aria-expanded="${collapsed ? state.flyout === g.key : isGroupOpen(g.key)}" title="${esc(g.label)}">
              <span class="nav-icon">${ICONS[g.icon] || ""}</span><span class="nav-label">${esc(g.label)}</span><span class="chev">›</span>
            </button>
            <div class="subnav" id="subnav-${g.key}">${(g.items || []).map((i) => `<button data-page="${i.key}" ${state.page === i.key ? 'aria-current="page"' : ""} class="${state.page === i.key ? "active" : ""}">${esc(i.label)}</button>`).join("")}</div>
          </div>`).join("")}</nav>
        <div class="aside-foot">
          <button class="collapse-btn" data-act="collapse-nav" aria-label="${collapsed ? "展开菜单" : "收起菜单"}">${collapsed ? ICONS.unfold : ICONS.fold}<span>${collapsed ? "展开" : "收起菜单"}</span></button>
          <div class="account">
            <button class="account-btn" data-act="account" aria-label="${esc(me.name)}，账户菜单" aria-expanded="${state.accountOpen}">
              <span class="avatar">${esc(me.name.slice(0, 1))}</span>
              <span class="account-meta"><strong>${esc(me.name)}</strong><small>${esc(me.sub)}</small></span>
            </button>
            <div class="account-menu${state.accountOpen ? " open" : ""}">
              <button data-page="change-password">修改我的密码</button>
              <button class="danger" data-act="logout">退出登录</button>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <div class="top">
          <button class="mobile-menu secondary" data-act="open-nav" aria-label="打开导航" aria-controls="primary-sidebar" aria-expanded="${state.mobileNav}">☰ 菜单</button>
          ${crumbHtml()}
          <div class="top-tools">
            <label>预览角色
              <select data-act="role">${ROLES.map((r) => `<option value="${r.id}"${state.role === r.id ? " selected" : ""}>${r.label}</option>`).join("")}</select>
            </label>
            <label>列表状态
              <select data-act="list-mode">
                ${[["data", "正常数据"], ["empty", "空数据"], ["loading", "加载中"], ["error", "加载失败"]].map(([v, t]) => `<option value="${v}"${state.listMode === v ? " selected" : ""}>${t}</option>`).join("")}
              </select>
            </label>
            <button class="refresh" data-act="refresh">刷新</button>
          </div>
        </div>
        <div class="content">${mainHtml}</div>
      </main>
    </div>${flyoutHtml()}${modalHtml()}`;
  }

  function actorName() {
    return (ACTOR[state.role] || {}).name || label(state.role);
  }
  function addLog(target, text) {
    if (!target) return;
    target.logs = target.logs || [];
    target.logs.unshift({ at: NOW, actor: actorName(), text });
    target.updatedAt = NOW;
    DB.audits.unshift({
      id: "au-" + Date.now(),
      actor: actorName(),
      action: text,
      resource: target.orderNo || target.title || target.id || "对象",
      resourceId: target.id || "",
      requestId: "req-" + Math.random().toString(16).slice(2, 10),
      createdAt: NOW,
    });
  }
  function logsTimeline(obj, extras) {
    const fromLogs = (obj.logs || []).map((l) => [l.text, `${fmt(l.at)} · ${l.actor}`]);
    return timeline([...(extras || []), ...fromLogs]);
  }
  function modalHtml() {
    const m = state.modal;
    if (!m) return "";
    return `<div class="backdrop" data-act="backdrop">
      <div class="modal${m.wide ? " wide" : ""} form-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1" data-stop="1">
        <div class="modal-head">
          <h2 id="dialog-title">${esc(m.title)}</h2>
          <button class="modal-x" data-act="close-modal" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">${m.body}</div>
        <div class="modal-actions">
          ${m.hideCancel ? "" : `<button class="secondary" data-act="close-modal">${esc(m.cancel || "取消")}</button>`}
          ${m.confirm ? `<button class="${m.danger ? "danger" : "primary"}" data-act="modal-ok">${esc(m.confirm)}</button>` : ""}
        </div>
      </div>
    </div>`;
  }
  function modalFacts(items) {
    return `<table class="form-table">${items.map(([k, v, req]) => `<tr><th class="${req ? "req" : ""}">${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>`;
  }
  function readReason(id = "task-reason") {
    return (document.getElementById(id)?.value || "").trim();
  }
  function showFormDialog(cfg) {
    const paint = (err) => {
      showModal({
        title: cfg.title,
        confirm: cfg.confirm || "确认",
        cancel: cfg.cancel || "取消",
        danger: !!cfg.danger,
        wide: !!cfg.wide,
        hideCancel: !!cfg.hideCancel,
        body: `${err ? `<div class="inline-result bad">${esc(err)}</div>` : ""}${typeof cfg.body === "function" ? cfg.body() : cfg.body}`,
        onOk: () => {
          const result = cfg.submit ? cfg.submit() : { ok: true };
          if (result && result.error) {
            paint(result.error);
            return;
          }
          if (result && result.ok === false) return;
          if (!state.modal) render();
        },
      });
    };
    paint();
  }
  function deliveryForCampaign(c) {
    if (!c) return null;
    return DB.deliveries.find((d) => d.campaign === c.title)
      || DB.deliveries.find((d) => String(d.campaign).startsWith(c.title + " ") || String(d.campaign).startsWith(c.title + " ·"));
  }
  function ordersForCampaign(title, pointName) {
    return DB.orders.filter((o) => o.campaign === title && (!pointName || o.point === pointName));
  }
  function campaignOrderCount(c, pointName) {
    return c ? ordersForCampaign(c.title, pointName).length : 0;
  }
  function arrivalForCampaignAtPoint(title, pointName) {
    return DB.arrivals.find((a) => a.campaign === title && a.point === pointName) || null;
  }
  function shipStatusText(d, a) {
    if (a && a.status === "CONFIRMED") return "已到货";
    if (isDispatched(d) || (a && isArrivalPending(a))) return "运输中";
    return "未发车";
  }
  function arrivalStatusText(a, d) {
    if (a) {
      if (a.status === "CONFIRMED") return "已确认";
      if (isArrivalPending(a)) return "待确认";
      return label(a.status);
    }
    if (!d || isPacking(d)) return "待确认";
    return "待确认";
  }
  function campaignNextStep(c, pointName) {
    if (!c) return { text: "—", page: null };
    if (c.status === "DRAFT") return { text: "等待开始报名", page: null };
    if (c.status === "CANCELLED") return { text: "已取消", page: null };
    if (c.status === "NOT_FORMED") return { text: "未成团待处理", page: null };
    if (c.status === "OPEN") return { text: "等待截单", page: null };
    const d = deliveryForCampaign(c);
    const a = arrivalForCampaignAtPoint(c.title, pointName || c.point);
    if (a && isArrivalPending(a)) return { text: "到货确认", page: "point-arrival" };
    if (a && a.status === "CONFIRMED") {
      const pendingRefund = DB.exceptions.some((e) => e.status === "PENDING_CONFIRM" && DB.pickupOrders.some((p) => p.orderNo === e.orderNo && p.arrivalId === a.id));
      if (pendingRefund) return { text: "等待确认退款订单", page: null };
      const pending = ordersForCampaign(c.title, pointName).some((o) =>
        ["READY_FOR_PICKUP", "PARTIAL_PICKED", "PAID"].includes(o.status));
      if (pending) return { text: "领取核销", page: "point-pickup" };
      if (c.status === "COMPLETED") return { text: "已完成", page: null };
      return { text: "领取已完成", page: "point-pickup-records" };
    }
    if (c.status === "COMPLETED") return { text: "已完成", page: null };
    if (!d || isPacking(d)) return { text: "等待发车", page: null };
    if (d && isDispatched(d)) return { text: "到货确认", page: "point-arrival" };
    return { text: "查看本团", page: null };
  }
  function campaignOrdersSheet(title, pointName, opts) {
    const canOpen = !!(opts && opts.openOrders);
    const orders = newest(ordersForCampaign(title, pointName));
    const countNote = `${orders.length} 单`;
    if (!orders.length) {
      return sheet(opts && opts.sheetTitle ? opts.sheetTitle : "本团订单", `<p class="hint">本团${pointName ? "本点" : ""}暂无订单。</p>`);
    }
    const head = canOpen
      ? `<p class="hint">本团共 ${esc(countNote)}。<button class="text-action" data-act="campaign-orders" data-title="${esc(title)}">在订单列表查看</button></p>`
      : `<p class="hint source-note">只看本点本团 ${esc(countNote)}，不进入平台订单管理。</p>`;
    const rows = orders.map((o) => `<tr>
      <td><span class="mono">${esc(o.orderNo)}</span></td>
      <td>${esc(o.user)}</td>
      <td>${money(o.amount)}</td>
      <td>${badge(o.status)}</td>
      <td>${esc(o.pickup || "—")}</td>
      ${canOpen ? `<td><button class="text-action" data-act="open-order" data-id="${esc(o.id)}">查看</button></td>` : ""}
    </tr>`).join("");
    return sheet(opts && opts.sheetTitle ? opts.sheetTitle : "本团订单", `${head}
      <table class="form-table data-table"><thead><tr><th>订单号</th><th>消费者</th><th>金额</th><th>状态</th><th>领取进度</th>${canOpen ? "<th>操作</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>`);
  }
  function resolveFulfillmentTarget(targetId) {
    const fromCampaign = byId("campaigns", targetId);
    const d = deliveryForCampaign(fromCampaign) || byId("deliveries", targetId);
    const c = fromCampaign || (d && DB.campaigns.find((x) => x.title === d.campaign)) || null;
    return { c, d };
  }
  function enqueueFinanceTodo(todo) {
    if (DB.financeTodos.some((t) => t.orderNo === todo.orderNo && t.kind === todo.kind && !["SUCCEEDED", "REFUNDED", "FAILED_HOLD"].includes(t.status))) return;
    DB.financeTodos.unshift({
      id: "ft-" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6),
      createdAt: NOW,
      updatedAt: NOW,
      ...todo,
    });
  }
  function campaignMinQty(c) {
    const n = Number(c && c.minQty);
    return Number.isFinite(n) && n > 0 ? n : 20;
  }
  function campaignFailAction(c) {
    return (c && c.fail) || "CANCEL_AND_REFUND";
  }
  function parseOrderGoods(goods) {
    const raw = String(goods || "").trim();
    const m = raw.match(/^(.*?)\s*×\s*(\d+)/);
    if (!m) return { title: raw || "商品", qty: 1 };
    return { title: m[1].trim() || "商品", qty: Math.max(1, Number(m[2]) || 1) };
  }
  function orderLineQty(o) {
    return parseOrderGoods(o && o.goods).qty;
  }
  function isUnpaidOrder(o) {
    return !!(o && o.status === "PENDING_PAYMENT");
  }
  function isCancelledOrClosed(o) {
    return !!(o && ["CANCELLED", "CLOSED", "REFUNDED", "REFUND_HOLD"].includes(o.status));
  }
  function isPaidOpenOrder(o) {
    return !!(o && !isUnpaidOrder(o) && !isCancelledOrClosed(o) && o.status !== "REFUNDING");
  }
  function campaignPaidOrders(c, pointName) {
    return ordersForCampaign(c && c.title, pointName).filter(isPaidOpenOrder);
  }
  function campaignPaidQty(c, pointName) {
    return campaignPaidOrders(c, pointName).reduce((n, o) => n + orderLineQty(o), 0);
  }
  function campaignUnpaidOrders(c) {
    return ordersForCampaign(c && c.title).filter(isUnpaidOrder);
  }
  function campaignPaidQtyLabel(c, pointName) {
    return `${campaignPaidQty(c, pointName)} / ${campaignMinQty(c)}`;
  }
  function productByTitle(title) {
    return DB.products.find((p) => p.title === title) || null;
  }
  function pickupManagerStaff() {
    const rows = DB.staff.filter((s) => s.role === "PICKUP_MANAGER" && s.status === "ACTIVE");
    if (rows.length) return rows;
    return [{ id: "actor-zhou", name: (ACTOR.PICKUP_MANAGER || {}).name || "周点位", phone: "", role: "PICKUP_MANAGER", status: "ACTIVE" }];
  }
  function pointManagerLabel(p) {
    if (!p) return "未关联负责人";
    if (p.managerName) return p.managerName;
    const s = DB.staff.find((x) => x.id === p.managerId);
    return (s && s.name) || "未关联负责人";
  }
  function syncStaffAssignedPoints() {
    DB.staff.forEach((s) => {
      if (s.role !== "PICKUP_MANAGER") return;
      const names = DB.points.filter((p) => p.managerId === s.id).map((p) => p.name);
      s.points = names.length ? names.join("、") : "未关联";
    });
    const me = DB.staff.find((s) => s.role === "PICKUP_MANAGER" && s.name === (ACTOR.PICKUP_MANAGER || {}).name);
    if (me && ACTOR.PICKUP_MANAGER) ACTOR.PICKUP_MANAGER.sub = me.points;
  }
  function parseLocalDateTime(s) {
    const m = String(s || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    if (!m) return NaN;
    return Date.parse(`${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:00+08:00`);
  }
  function toLocalDateTimeValue(ts) {
    const d = new Date(ts || NOW);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function arrivalRangeLabel(startTs, endTs) {
    const a = new Date(startTs);
    const b = new Date(endTs);
    return `${a.getMonth() + 1}月${a.getDate()}日–${b.getMonth() + 1}月${b.getDate()}日`;
  }
  function nextArrivalBatch() {
    const nums = DB.arrivals.map((a) => Number(String(a.batch || "").replace(/\D/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
    return "B" + String(Math.max(9, ...nums, 0) + 1).padStart(2, "0");
  }
  function expectedArrivalItems(title, pointName) {
    const map = new Map();
    campaignPaidOrders({ title }, pointName).forEach((o) => {
      const g = parseOrderGoods(o.goods);
      const p = productByTitle(g.title);
      const key = (p && p.id) || g.title;
      const prev = map.get(key) || {
        skuId: (p && p.id) || ("sku-" + g.title),
        title: g.title,
        sku: (p && p.sku) || "",
        expected: 0,
        received: 0,
        short: 0,
        damaged: 0,
        note: "",
      };
      prev.expected += g.qty;
      map.set(key, prev);
    });
    if (map.size) {
      return Array.from(map.values()).map((it) => ({ ...it, received: it.expected }));
    }
    const c = DB.campaigns.find((x) => x.title === title);
    const n = Math.max(1, (c && c.items) || 1);
    return DB.products.filter((p) => p.status === "ACTIVE").slice(0, n).map((p) => ({
      skuId: p.id,
      title: p.title,
      sku: p.sku,
      expected: 6,
      received: 6,
      short: 0,
      damaged: 0,
      note: "",
    }));
  }
  function ensureDispatchArrival(c, d) {
    const title = (c && c.title) || (d && d.campaign) || "";
    const pointName = (c && c.point) || (d && d.point) || "";
    const existing = DB.arrivals.find((a) => a.campaign === title && a.point === pointName);
    if (existing) return { arrival: existing, created: false };
    const point = DB.points.find((p) => p.name === pointName);
    const arrival = {
      id: "ar-" + Date.now().toString(36),
      campaign: title,
      point: pointName,
      pointId: (point && point.id) || "",
      batch: nextArrivalBatch(),
      status: "PENDING",
      next: "对照实物确认到货",
      due: "今天 18:00 前",
      diff: "未上报",
      createdAt: NOW,
      updatedAt: NOW,
      lastFingerprint: null,
      items: expectedArrivalItems(title, pointName),
    };
    DB.arrivals.unshift(arrival);
    return { arrival, created: true };
  }
  function campaignCancelImpact(c) {
    const unpaid = campaignUnpaidOrders(c);
    const paid = campaignPaidOrders(c);
    const amount = paid.reduce((n, o) => n + (Number(o.amount) || 0), 0);
    return { unpaid, paid, amount };
  }
  function campaignImpactHtml(c) {
    const { unpaid, paid, amount } = campaignCancelImpact(c);
    return `影响范围：待付款 ${unpaid.length} 笔将释放；已付款 ${paid.length} 笔进入退款义务，预计退款 ${money(amount)}。该操作不可恢复为报名中。`;
  }
  function applyCampaignCancelRefund(c, reason, source) {
    const { unpaid, paid } = campaignCancelImpact(c);
    c.status = "CANCELLED";
    addLog(c, (source || "取消团期") + (reason ? "：" + reason : ""));
    unpaid.forEach((o) => {
      o.status = "CANCELLED";
      addLog(o, "团期已取消，待支付订单已关闭并释放");
    });
    paid.forEach((o) => {
      o.status = "REFUNDING";
      addLog(o, (source || "取消团期") + "，已付款订单进入退款义务");
      enqueueFinanceTodo({
        source: source || "取消团期",
        orderNo: o.orderNo,
        amount: o.amount,
        status: "PENDING_EXECUTE",
        kind: "campaign-cancel",
      });
    });
    return { unpaid: unpaid.length, paid: paid.length };
  }
  function labels(c) {
    const campaign = c || byId("campaigns", state.id);
    const orders = campaignPaidOrders(campaign);
    if (!orders.length) return "";
    return `<pre style="white-space:pre-wrap">${orders.map((o, i) => {
      const g = parseOrderGoods(o.goods);
      return `标签 ${i + 1}\n订单号：${o.orderNo}\n自提点：${o.point || campaign.point || "—"}\n${g.title} × ${g.qty}`;
    }).join("\n\n")}</pre>`;
  }
  function closeUnpaidOnLock(c) {
    campaignUnpaidOrders(c).forEach((o) => {
      o.status = "CANCELLED";
      addLog(o, "截单后未支付订单已关闭");
    });
  }
  function inputVal(id) {
    return (document.getElementById(id)?.value || "").trim();
  }
  function savePointForm() {
    capturePointDraft();
    if (!hasRole("OPERATOR", "SUPER_ADMIN")) return { ok: false, error: "当前角色不能保存点位" };
    const locationError = pointValidation();
    if (locationError) return { ok: false, error: locationError };
    const name = inputVal("pt-name");
    if (name.length < 2) return { ok: false, error: "请填写自提点名称（至少 2 个字符）" };
    const areaId = state.pointDraft.areaId;
    const area = DB.areas.find((a) => a.id === areaId) || DB.areas[0];
    const managerId = inputVal("pt-manager");
    const manager = DB.staff.find((s) => s.id === managerId) || pickupManagerStaff().find((s) => s.id === managerId);
    const patch = {
      name,
      areaId: area ? area.id : areaId,
      address: inputVal("pt-address"),
      hours: inputVal("pt-hours") || "每日 09:00–20:00",
      instruction: inputVal("pt-instruction") || "到店出示领取码",
      status: inputVal("pt-status") || "ACTIVE",
      managerId: manager ? manager.id : "",
      managerName: manager ? manager.name : "",
      contact: manager ? `${manager.name} ${manager.phone || ""}`.trim() : "未关联负责人",
      updatedAt: NOW,
      ...(state.pointDraft.locationChanged ? { latitude: state.pointDraft.poi.lat, longitude: state.pointDraft.poi.lng, locationSimulated: true } : {}),
    };
    const existing = state.formKind === "edit" ? byId("points", state.id) : null;
    if (existing) {
      Object.assign(existing, patch);
      addLog(existing, manager ? `关联点位负责人 ${manager.name}` : "已清除点位负责人");
      syncStaffAssignedPoints();
      return { ok: true, created: false, id: existing.id };
    }
    const rec = {
      id: "pt-" + Date.now().toString(36),
      createdAt: NOW,
      ...patch,
    };
    DB.points.unshift(rec);
    addLog(rec, manager ? `新增自提点并关联 ${manager.name}` : "新增自提点");
    syncStaffAssignedPoints();
    return { ok: true, created: true, id: rec.id };
  }
  function savePostponeForm() {
    const c = byId("campaigns", state.id);
    if (!c) return { ok: false, error: "找不到该团期。" };
    if (c.postponedOnce) return { ok: false, error: "该团期已经顺延过一次，不能再次顺延。" };
    const cutoff = parseLocalDateTime(inputVal("pp-cutoff"));
    const ship = parseLocalDateTime(inputVal("pp-ship"));
    const start = parseLocalDateTime(inputVal("pp-arrival-start"));
    const end = parseLocalDateTime(inputVal("pp-arrival-end"));
    if (!Number.isFinite(cutoff)) return { ok: false, error: "请填写有效的新截单时间。" };
    if (cutoff <= NOW) return { ok: false, error: "新截单时间必须晚于当前时间。" };
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: "请填写有效的到货时间。" };
    if (end < start) return { ok: false, error: "到货结束时间不能早于开始时间。" };
    c.cutoff = cutoff;
    c.shipAt = Number.isFinite(ship) ? ship : cutoff;
    c.arrivalStart = start;
    c.arrivalEnd = end;
    c.arrival = arrivalRangeLabel(start, end);
    c.status = "OPEN";
    c.postponedOnce = true;
    addLog(c, `顺延团期：截单 ${toLocalDateTimeValue(cutoff)}，到货 ${c.arrival}`);
    return { ok: true, id: c.id };
  }
  (function seedHappyPathOrders() {
    const pushOrder = (spec) => {
      DB.orders.push({
        id: spec.id,
        orderNo: spec.orderNo,
        user: spec.user,
        campaign: spec.campaign,
        goods: spec.goods,
        amount: spec.amount,
        status: spec.status,
        point: spec.point,
        pickup: spec.pickup || (spec.status === "PENDING_PAYMENT" ? "0 / 1 件" : "0 / 1 件"),
        paidAt: spec.status === "PENDING_PAYMENT" ? null : ago(spec.ago || 6),
        createdAt: ago((spec.ago || 6) + 0.2),
        logs: spec.status === "PENDING_PAYMENT"
          ? [{ at: ago((spec.ago || 6) + 0.2), actor: "系统", text: "待支付订单已创建" }]
          : [{ at: ago(spec.ago || 6), actor: "系统", text: "支付成功，金额以支付时为准" }],
      });
    };
    pushOrder({ id: "egg-paid-1", orderNo: "HT17888610027177044101E", user: "李思", campaign: "鲜蛋加团", goods: "散养鲜蛋 × 1", amount: 1890, status: "PAID", point: "车站东点", ago: 5 });
    pushOrder({ id: "egg-pend-1", orderNo: "HT17888610027177044102E", user: "陈阿姨", campaign: "鲜蛋加团", goods: "散养鲜蛋 × 1", amount: 1890, status: "PENDING_PAYMENT", point: "车站东点", ago: 4 });
    pushOrder({ id: "corn-paid-1", orderNo: "HT17888610027177044201C", user: "王小美", campaign: "玉米尝鲜", goods: "鲜玉米 × 1", amount: 990, status: "PAID", point: "幸福路自提点", ago: 7 });
    pushOrder({ id: "veg-pend-1", orderNo: "HT17888610027177044301V", user: "刘师傅", campaign: "周末时蔬团", goods: "黄心土豆 × 2", amount: 1360, status: "PENDING_PAYMENT", point: "幸福路自提点", ago: 3 });
    pushOrder({ id: "veg-pend-2", orderNo: "HT17888610027177044302V", user: "赵姐", campaign: "周末时蔬团", goods: "鲜玉米 × 1", amount: 990, status: "PENDING_PAYMENT", point: "幸福路自提点", ago: 2.5 });
    pushOrder({ id: "south-paid-1", orderNo: "HT17888610027177044801S", user: "刘师傅", campaign: "城南时蔬", goods: "黄心土豆 × 2", amount: 1360, status: "PAID", point: "车站东点", ago: 10 });
    pushOrder({ id: "south-paid-2", orderNo: "HT17888610027177044802S", user: "赵姐", campaign: "城南时蔬", goods: "黄心土豆 × 2", amount: 1360, status: "PAID", point: "车站东点", ago: 9 });
    const veg = DB.campaigns.find((x) => x.title === "周末时蔬团");
    let n = 0;
    while (veg && campaignPaidQty(veg) < campaignMinQty(veg) && n < 24) {
      n += 1;
      pushOrder({
        id: "veg-pad-" + n,
        orderNo: "HT17888610027177055" + String(n).padStart(4, "0") + "V",
        user: ["王小美", "李思", "陈阿姨", "刘师傅"][n % 4],
        campaign: "周末时蔬团",
        goods: "黄心土豆 × 2",
        amount: 1360,
        status: "PAID",
        point: "幸福路自提点",
        pickup: "0 / 2 件",
        ago: n + 1,
      });
    }
    syncStaffAssignedPoints();
  })();

  function unauthorized() {
    return `<div class="state-card solid"><h2>没有访问权限</h2><p>当前角色是${esc(label(state.role))}，不能查看或处理该页面。系统未展示会点击失败的入口。</p></div>`;
  }

  function loginPage() {
    return `<div class="login-page">
      <section class="login-story">
        <div class="brand"><span class="brand-mark">乡</span><div class="brand-copy"><strong>乡味集</strong><span>管理后台</span></div></div>
        <h1>乡味集管理后台</h1>
        <p>运营、客服、财务与点位负责人使用各自账号登录。本页为原型示意，不连接真实环境。</p>
      </section>
      <section class="login-panel">
        <div class="login-card">
          <form id="login-form">
            <h2>登录</h2>
            <p class="intro">使用内部员工账号进入后台。本页为原型，输入账号和密码即可进入。</p>
            ${state.loginError ? `<div class="inline-result bad">${esc(state.loginError)}</div>` : ""}
            <div class="field"><label class="req">账号</label><input id="login-user" name="username" autocomplete="username" placeholder="请输入账号" value="${esc(state.loginUser)}"></div>
            <div class="field"><label class="req">密码</label><input id="login-pass" name="password" type="password" autocomplete="current-password" placeholder="请输入密码"></div>
            <div class="field"><label>进入后预览角色</label>
              <select id="login-role" name="role">${ROLES.map((r) => `<option value="${r.id}"${state.role === r.id ? " selected" : ""}>${r.label}</option>`).join("")}</select>
            </div>
            <button type="submit" class="primary block">登录</button>
            <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;align-items:flex-start">
              <button type="button" class="link" data-act="forgot">忘记密码？请联系超级管理员重置</button>
              <button type="button" class="link" data-act="preview-setup">预览首次改密</button>
            </div>
          </form>
        </div>
      </section>
    </div>${flyoutHtml()}${modalHtml()}`;
  }

  function passwordSetupPage() {
    return `<div class="login-page">
      <section class="login-story">
        <div class="brand"><span class="brand-mark">乡</span><div class="brand-copy"><strong>乡味集</strong><span>管理后台</span></div></div>
        <h1>请先设置新密码</h1>
        <p>为了继续使用后台，请先完成密码修改。修改成功后将进入对应工作台。</p>
      </section>
      <section class="login-panel">
        <div class="login-card">
          <h2>请先设置新密码</h2>
          <p class="intro">临时密码仅可使用一次，请设置 8–128 位新密码。</p>
          ${state.loginError ? `<div class="inline-result bad">${esc(state.loginError)}</div>` : ""}
          <div class="field"><label>账号</label><input value="wangyunying" disabled></div>
          <div class="field"><label class="req">新密码</label><input id="np1" type="password" autocomplete="new-password"></div>
          <div class="field"><label class="req">确认新密码</label><input id="np2" type="password" autocomplete="new-password"></div>
          <button class="primary block" data-act="save-setup">保存新密码</button>
          <div style="margin-top:12px"><button class="secondary block" data-act="back-login">退出并返回登录</button></div>
        </div>
      </section>
    </div>`;
  }

  function workbench() {
    const overdueN = DB.orders.filter((o) => o.overdue && ["READY_FOR_PICKUP", "PARTIAL_PICKED"].includes(o.status)).length;
    const dispatchN = DB.deliveries.filter((d) => isPacking(d)).length;
    const refundConfirmN = DB.exceptions.filter((e) => e.status === "PENDING_CONFIRM").length;
    return `${headline("工作台", "", "总部待办走发货管理、确认退款订单、团期和售后工单。到货确认是点位工作，不在本页代店确认。逾期未领挂在订单上。")}
      <div class="work-grid">
        <button class="work-card" data-page="orders"><b>${DB.orders.length}</b><span>订单</span></button>
        <button class="work-card" data-page="campaigns"><b>${DB.campaigns.filter((c) => ["OPEN", "LOCKED", "FULFILLING"].includes(c.status)).length}</b><span>进行中团期</span></button>
        <button class="work-card" data-page="delivery"><b>${dispatchN}</b><span>待装袋</span></button>
        <button class="work-card" data-page="refund-confirm"><b>${refundConfirmN}</b><span>确认退款订单</span></button>
        <button class="work-card" data-page="orders"><b>${overdueN}</b><span>逾期未领</span></button>
      </div>
      <div class="dashboard">
        <section class="panel">
          <div class="panel-head"><h2>优先处理</h2><button class="text-action" data-page="refund-confirm">确认退款订单</button></div>
          <div class="todo"><i class="todo-mark red"></i><div class="todo-main"><b>确认退款订单 · 散养鲜蛋短少 2 盒</b><span>幸福路自提点 · 点位已登记实到，待运营确认受影响订单</span></div><button class="text-action" data-page="refund-confirm">处理</button></div>
          <div class="todo"><i class="todo-mark"></i><div class="todo-main"><b>发货管理 · 日常蛋品待装袋发车</b><span>今天 14:00 前按已付件数装袋</span></div><button class="text-action" data-page="delivery">处理</button></div>
          <div class="todo"><i class="todo-mark"></i><div class="todo-main"><b>售后工单 · HT17888610027177043010F</b><span>秋日苹果果面碰伤 · 待客服受理</span></div><button class="text-action" data-act="open-quality" data-id="q1">处理</button></div>
          <div class="todo"><i class="todo-mark"></i><div class="todo-main"><b>订单逾期 · HT17888610027177042980C</b><span>车站东点 · 领取窗口已截止</span></div><button class="text-action" data-act="open-order" data-id="od-o0">处理</button></div>
        </section>
        <div>
          <section class="panel">
            <div class="panel-head"><h2>今日履约</h2><button class="text-action" data-page="delivery">发货管理</button></div>
            <div class="summary-list">
              <button class="summary-item" data-page="delivery"><b>${dispatchN}</b><span>待装袋</span></button>
              <button class="summary-item" data-page="delivery"><b>${DB.deliveries.filter((d) => isDispatched(d)).length}</b><span>已发车</span></button>
              <button class="summary-item" data-page="refund-confirm"><b>${refundConfirmN}</b><span>待确认退款</span></button>
            </div>
          </section>
          <section class="panel" style="margin-top:15px">
            <div class="panel-head"><h2>运营提醒</h2></div>
            <div class="reminder"><i></i><div>2 个团期将在 24 小时内截单</div></div>
            <div class="reminder"><i></i><div>1 个自提点营业信息超过 30 天未更新</div></div>
          </section>
        </div>
      </div>`;
  }

  function emptyBlock(text, action) {
    return `<div class="empty"><p>${esc(text)}</p>${action || ""}</div>`;
  }

  function filterRows(rows) {
    if (state.listMode === "empty") {
      if (state.applied.q || (state.applied.status && state.applied.status !== "ALL")) return [];
      return [];
    }
    return rows;
  }

  function listOrEmpty(rows, unfiltered, emptyBiz, emptyFilter, createBtn) {
    if (!rows.length && (state.applied.q || (state.applied.status && state.applied.status !== "ALL"))) {
      return emptyBlock(emptyFilter, `<button class="secondary" data-act="reset">清空筛选</button>`);
    }
    if (!unfiltered.length || state.listMode === "empty") {
      return emptyBlock(emptyBiz, createBtn || "");
    }
    return null;
  }

  function productsList() {
    const all = newest(DB.products);
    const filtered = applyQuery(all, ["title", "sku", "origin", "category"]);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无商品，请先创建商品。", "没有符合筛选的商品。", hasRole("OPERATOR", "SUPER_ADMIN") ? `<button class="primary" data-act="create">新增商品</button>` : "");
    const rows = sliced.rows.map((p) => ({
      id: p.id,
      canEdit: hasRole("OPERATOR", "SUPER_ADMIN"),
      cells: [
        `<div class="product-cell">${thumb(p.title, p.category)}<div>${objectCell(p.title, p.sku)}</div></div>`,
        `${esc(p.category)} / ${esc(p.origin)}`,
        money(p.price),
        String(p.stock),
        productBadge(p.status),
        fmt(p.updatedAt),
      ],
    }));
    return `${headline("商品列表", hasRole("OPERATOR", "SUPER_ADMIN") ? `<button class="primary" data-act="create">新增商品</button>` : "")}
      ${toolbar("搜索商品名称、规格或产地", [["ALL", "全部状态"], ["ACTIVE", "上架"], ["INACTIVE", "下架"]])}
      ${appliedBar()}
      ${empty || `${table(["商品", "分类/产地", "默认售价", "默认可售量", "状态", "更新时间 ↓"], rows, "resource", "暂无商品")}${pager(sliced.total)}`}`;
  }

  function categoriesList() {
    const all = newest(DB.categories);
    const filtered = applyQuery(all, ["name"]);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无分类，请先新增分类。", "没有符合筛选的分类。", `<button class="primary" data-act="create">新增分类</button>`);
    const rows = sliced.rows.map((c) => ({
      id: c.id,
      cells: [esc(c.name), String(c.sortOrder), badge(c.status), fmt(c.updatedAt || c.createdAt)],
    }));
    return `${headline("分类管理", `<button class="primary" data-act="create">新增分类</button>`)}
      ${toolbar("搜索分类名称", [["ALL", "全部状态"], ["ACTIVE", "启用"], ["INACTIVE", "停用"]])}
      ${appliedBar()}
      ${empty || `${table(["分类", "排序", "状态", "更新时间 ↓"], rows, "resource")}${pager(sliced.total)}`}`;
  }

  function campaignsList() {
    const all = newest(DB.campaigns);
    const filtered = applyQuery(all, ["title", "point"]);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无团期，请先配置商品、区域和自提点。", "没有符合筛选的团期。", `<button class="primary" data-act="create">创建团期</button>`);
    const rows = sliced.rows.map((c) => ({
      id: c.id,
      canEdit: c.status === "DRAFT" && hasRole("OPERATOR", "SUPER_ADMIN"),
      cells: [
        objectCell(c.title, `${c.items} 个商品`),
        fmt(c.cutoff),
        esc(c.arrival),
        esc(c.point),
        `<button class="text-action" data-act="campaign-orders" data-title="${esc(c.title)}">${campaignOrderCount(c)}</button>`,
        esc(campaignPaidQtyLabel(c)),
        badge(c.status),
        fmt(c.updatedAt),
      ],
    }));
    return `${headline("团期列表", hasRole("OPERATOR", "SUPER_ADMIN") ? `<button class="primary" data-act="create">创建团期</button>` : "", "一团一固定自提点。本列表覆盖全部自提点，不按当前自提点过滤。")}
      ${toolbar("搜索团期名称或自提点", [["ALL", "全部状态"], ["DRAFT", "待开始"], ["OPEN", "报名中"], ["LOCKED", "已成团"], ["FULFILLING", "履约中"], ["NOT_FORMED", "未成团"], ["COMPLETED", "已完成"], ["CANCELLED", "已取消"]])}
      ${appliedBar()}
      ${empty || `${table(["团期", "截单时间", "预计到货", "自提点", "本团订单数", "已付件数 / 最小成团", "状态", "更新时间 ↓"], rows, "resource")}${pager(sliced.total)}`}`;
  }

  function ordersList() {
    const all = newest(DB.orders);
    const q = (state.applied.q || "").trim();
    const status = state.applied.status;
    const campaign = (state.applied.campaign || "").trim();
    let filtered = all;
    if (q) filtered = filtered.filter((o) => o.orderNo === q);
    if (status === "OVERDUE") filtered = filtered.filter((o) => o.overdue && ["READY_FOR_PICKUP", "PARTIAL_PICKED"].includes(o.status));
    else if (status && status !== "ALL") filtered = filtered.filter((o) => o.status === status);
    if (campaign) filtered = filtered.filter((o) => o.campaign === campaign);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无订单。", q ? "未找到匹配订单，请检查完整订单号。" : "没有符合筛选的订单。", "");
    const rows = sliced.rows.map((o) => ({
      id: o.id,
      canHandle: o.overdue && ["READY_FOR_PICKUP", "PARTIAL_PICKED"].includes(o.status) && hasRole("OPERATOR", "SUPER_ADMIN"),
      cells: [`<span class="mono">${esc(o.orderNo)}</span>`, esc(o.user), esc(o.campaign), money(o.amount), `${badge(o.status)}${o.overdue ? ` ${badge("OVERDUE")}` : ""}`, fmt(o.paidAt)],
    }));
    return `${headline("订单列表", "", campaign ? `当前筛选团期：${campaign}。覆盖全部自提点。` : "覆盖全部自提点，不按当前自提点过滤。领取进度是字段；逾期未领挂在订单上。")}
      ${toolbar("输入完整订单号", [
        ["ALL", "全部状态"],
        ["PENDING_PAYMENT", "待支付"],
        ["PAID", "已支付"],
        ["READY_FOR_PICKUP", "待领取"],
        ["PARTIAL_PICKED", "部分领取"],
        ["OVERDUE", "逾期未领"],
        ["COMPLETED", "已完成"],
        ["CANCELLING", "取消中"],
        ["CANCELLED", "已取消"],
        ["REFUNDING", "退款中"],
        ["REFUNDED", "退款成功"],
        ["REFUND_HOLD", "退款失败/挂起"],
      ])}
      ${appliedBar()}
      ${empty || `${table(["订单号", "消费者", "团期", "金额", "状态", "支付时间 ↓"], rows, hasRole("FINANCE") ? "view" : "task")}${pager(sliced.total)}`}`;
  }

  function taskList(opts) {
    const all = newest(opts.rows);
    const filtered = applyQuery(all, opts.keys);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, opts.empty, opts.emptyFilter, "");
    const rows = sliced.rows.map(opts.mapRow);
    const metrics = opts.metrics ? `<div class="metrics">${opts.metrics.map((m) => `<div class="metric${m.alert ? " alert" : ""}"><b>${m.n}</b><span>${m.t}</span></div>`).join("")}</div>` : "";
    return `${headline(opts.title, opts.primary || "", opts.note || "")}${state.banner || ""}${metrics}
      ${toolbar(opts.search, opts.statuses)}
      ${appliedBar()}
      ${empty || `${table(opts.columns, rows, "task")}${pager(sliced.total)}`}`;
  }

  function deliveryList() {
    const ops = hasRole("OPERATOR", "SUPER_ADMIN");
    return taskList({
      title: "发货管理",
      note: "覆盖全部自提点，不按当前自提点过滤。待装袋、已发车在此处理。发车后由点位做「到货确认」，总部不代店确认到货。",
      rows: DB.deliveries,
      keys: ["campaign", "point", "vehicle"],
      search: "搜索团期、自提点或车辆",
      empty: "暂无待装袋团期，请先截单成团。",
      emptyFilter: "没有符合筛选的发货记录。",
      statuses: [["ALL", "全部状态"], ["PACKING", "待装袋"], ["DISPATCHED", "已发车"]],
      columns: ["团期", "当前阶段", "下一步 / 截止", "自提点", "责任人", "更新时间 ↓"],
      metrics: [
        { n: DB.deliveries.filter((d) => isPacking(d)).length, t: "待装袋" },
        { n: DB.deliveries.filter((d) => isDispatched(d)).length, t: "已发车" },
      ],
      mapRow: (d) => ({
        id: d.id,
        canHandle: isPacking(d) && ops,
        handleAct: "dispatch",
        handleLabel: "装袋发车",
        handleHint: "已发车，等待点位到货确认",
        cells: [objectCell(d.campaign, d.vehicle === "未登记" ? "未登记车辆" : d.vehicle), badge(d.status), `${esc(d.next)}<div class="sub">${esc(d.due)}</div>`, esc(d.point), esc(d.owner), fmt(d.updatedAt)],
      }),
    });
  }

  function arrivalsList() {
    return taskList({
      title: "到货确认",
      note: "系统应到来自本点该批次已付款、未全额退款的件数。短少或破损登记在本页，不另建异常档案。",
      rows: DB.arrivals,
      keys: ["campaign", "point", "batch"],
      search: "搜索团期、自提点或批次",
      empty: "暂无到货任务。",
      emptyFilter: "没有符合筛选的到货任务。",
      statuses: [["ALL", "全部状态"], ["PENDING", "待确认"], ["CONFIRMED", "已确认"]],
      columns: ["到货任务", "当前状态", "下一步 / 时限", "短少/破损", "自提点", "更新时间 ↓"],
      metrics: [
        { n: DB.arrivals.filter((a) => isArrivalPending(a)).length, t: "待确认" },
        { n: DB.arrivals.filter((a) => a.status === "CONFIRMED").length, t: "已确认" },
        { n: DB.exceptions.filter((e) => e.status === "PENDING_CONFIRM").length, t: "待确认退款订单", alert: true },
      ],
      mapRow: (a) => ({
        id: a.id,
        canHandle: isArrivalPending(a) && hasRole("OPERATOR", "SUPER_ADMIN", "PICKUP_MANAGER"),
        cells: [objectCell(a.campaign, "批次 " + a.batch), badge(a.status), `${esc(a.next)}<div class="sub">${esc(a.due)}</div>`, esc(a.diff), esc(a.point), fmt(a.updatedAt)],
      }),
    });
  }

  function exceptionsList() {
    return taskList({
      title: "确认退款订单",
      note: "到货短少或破损由点位登记后，运营在此确认全部受影响订单，再交财务。覆盖全部自提点，不按当前自提点过滤。",
      rows: DB.exceptions,
      keys: ["orderNo", "point", "item"],
      search: "搜索订单号、自提点或商品",
      empty: "暂无待确认的退款订单。",
      emptyFilter: "没有符合筛选的退款订单。",
      statuses: [["ALL", "全部状态"], ["PENDING_CONFIRM", "待确认"], ["PENDING_EXECUTE", "待执行"], ["EXECUTING", "执行中"], ["SUCCEEDED", "成功"], ["FAILED_HOLD", "失败挂起"]],
      columns: ["订单", "异常类型", "商品", "可复算金额", "状态", "更新时间 ↓"],
      metrics: [{ n: DB.exceptions.filter((e) => e.status === "PENDING_CONFIRM").length, t: "待运营确认", alert: true }],
      mapRow: (e) => ({
        id: e.id,
        canHandle: e.status === "PENDING_CONFIRM" && hasRole("OPERATOR", "SUPER_ADMIN"),
        cells: [objectCell(e.orderNo, e.point), label(e.type), esc(e.item), money(e.amount), badge(e.status), fmt(e.updatedAt)],
      }),
    });
  }

  function overdueList() {
    return taskList({
      title: "逾期管理",
      rows: DB.overdue,
      keys: ["orderNo", "user", "point"],
      search: "搜索订单号、消费者或自提点",
      empty: "暂无需要运营处理的领取窗口。",
      emptyFilter: "没有符合筛选的逾期记录。",
      statuses: [["ALL", "全部状态"], ["EXPIRED_PENDING", "已逾期待处理"], ["REFUND_PENDING", "退款处理中"], ["LOSS_RECORDED", "已报损"]],
      columns: ["逾期单", "订单 / 消费者", "自提点", "截止时间", "下一步", "状态"],
      metrics: [{ n: DB.overdue.filter((o) => o.status === "EXPIRED_PENDING").length, t: "待处理" }, { n: 1, t: "即将超时", alert: true }],
      mapRow: (o) => ({
        id: o.id,
        canHandle: o.status === "EXPIRED_PENDING" && hasRole("OPERATOR", "SUPER_ADMIN"),
        cells: [o.id.toUpperCase(), objectCell(o.orderNo, o.user), esc(o.point), fmt(o.deadline), esc(o.next), badge(o.status)],
      }),
    });
  }

  function areasList() {
    const all = newest(DB.areas).map((a) => ({ ...a, status: a.orderEnabled ? "ENABLED" : "DISABLED" }));
    const filtered = applyQuery(all, ["name", "path"]);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无服务区域，请从行政目录开通。", "没有符合筛选的服务区域。", `<button class="primary" data-act="create">开通服务区域</button>`);
    const rows = sliced.rows.map((a) => ({
      id: a.id,
      canEdit: true,
      cells: [objectCell(a.name, a.id.toUpperCase()), esc(a.path), badge(a.orderEnabled ? "ENABLED" : "DISABLED"), fmt(a.updatedAt)],
    }));
    return `${headline("区域管理", `<button class="primary" data-act="create">开通服务区域</button>`)}
      ${toolbar("搜索区域名称或行政目录", [["ALL", "全部状态"], ["ENABLED", "启用"], ["DISABLED", "停用"]])}
      ${appliedBar()}
      ${empty || `${table(["服务区域", "行政目录", "状态", "更新时间 ↓"], rows, "resource")}${pager(sliced.total)}`}`;
  }

  function pointsList() {
    const all = newest(DB.points);
    const filtered = applyQuery(all, ["name", "address"]);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无自提点，请先选择服务区域并新增。", "没有符合筛选的自提点。", `<button class="primary" data-act="create">新增自提点</button>`);
    const rows = sliced.rows.map((p) => ({
      id: p.id,
      cells: [objectCell(p.name, DB.areas.find((a) => a.id === p.areaId)?.name), esc(p.address), esc(pointManagerLabel(p)), esc(p.hours), badge(p.status), fmt(p.updatedAt)],
    }));
    return `${headline("自提点管理", `<button class="primary" data-act="create">新增自提点</button>`)}
      ${toolbar("搜索自提点名称或地址", [["ALL", "全部状态"], ["ACTIVE", "启用"], ["INACTIVE", "停用"]])}
      ${appliedBar()}
      ${empty || `${table(["自提点", "地址", "点位负责人", "营业时间", "状态", "更新时间 ↓"], rows, "resource")}${pager(sliced.total)}`}`;
  }

  function consumersList() {
    const all = newest(DB.consumers);
    const q = (state.applied.q || "").trim();
    const status = state.applied.status;
    const deal = state.applied.deal;
    let filtered = all;
    if (q) {
      const n = q.toLocaleLowerCase();
      filtered = filtered.filter((u) => {
        const phone = String(u.phone ?? "");
        return [u.id, phone, maskPhone(phone)].some((v) => String(v ?? "").toLocaleLowerCase().includes(n));
      });
    }
    if (status && status !== "ALL") filtered = filtered.filter((row) => row.status === status);
    if (deal === "PAID") filtered = filtered.filter((u) => Number(u.orders) > 0);
    if (deal === "UNPAID") filtered = filtered.filter((u) => Number(u.orders) === 0);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无用户。", "没有匹配的用户。", "");
    const rows = sliced.rows.map((u) => ({
      id: u.id,
      cells: [esc(u.id), `<span class="mono">${esc(displayListPhone(u.phone))}</span>`, badge(u.status), dealBadge(u.orders), u.verified ? "手机号已认证" : "手机号未认证", String(u.orders), fmt(u.createdAt)],
    }));
    return `${headline("用户管理", "", "已登录小程序的用户。未成交 = 尚未完成支付订单，便于回访，不是下单客户，也不是区域开通线索。")}
      <div class="toolbar">
        <input data-filter="q" value="${esc(state.draft.q)}" placeholder="搜索用户编号或手机号" aria-label="关键字">
        <select data-filter="deal" aria-label="成交">
          ${[["ALL", "全部"], ["PAID", "已成交"], ["UNPAID", "未成交"]].map(([v, t]) => `<option value="${v}"${(state.draft.deal || "ALL") === v ? " selected" : ""}>${t}</option>`).join("")}
        </select>
        <select data-filter="status" aria-label="账号状态">${[["ALL", "全部状态"], ["ACTIVE", "启用"], ["BLOCKED", "已封禁"]].map(([v, t]) => `<option value="${v}"${state.draft.status === v ? " selected" : ""}>${t}</option>`).join("")}</select>
        <button class="secondary" data-act="time">时间范围</button>
        <button class="primary" data-act="search">查询</button>
        <button class="secondary" data-act="reset">重置</button>
        <span class="push"></span>
      </div>
      ${appliedBar()}
      ${empty || `${table(["用户编号", "手机号", "账号状态", "成交", "认证状态", "订单数", "注册时间 ↓"], rows, "view")}${pager(sliced.total)}`}`;
  }

  function qualityList() {
    return taskList({
      title: "售后工单",
      note: "品质投诉与客服/运营处理。通知投递失败在「系统 / 通知管理」。",
      rows: DB.quality,
      keys: ["orderNo", "user", "item"],
      search: "搜索订单号、消费者或商品",
      empty: "暂无售后工单。",
      emptyFilter: "没有符合筛选的售后工单。",
      statuses: [["ALL", "全部状态"], ["PENDING_ACCEPT", "待受理"], ["PENDING_OPERATOR", "待运营决定"], ["PENDING_FINANCE", "待财务退款"], ["COMPLETED", "已完成"], ["REJECTED", "已驳回"]],
      columns: ["售后申请", "订单 / 消费者", "原因", "下一步", "状态", "申报时间 ↓"],
      metrics: [{ n: DB.quality.filter((q) => q.status === "PENDING_ACCEPT").length, t: "待受理" }],
      mapRow: (q) => ({
        id: q.id,
        canHandle: (q.status === "PENDING_ACCEPT" && hasRole("CUSTOMER_SERVICE", "SUPER_ADMIN")) || (q.status === "PENDING_OPERATOR" && hasRole("OPERATOR", "SUPER_ADMIN")),
        handleHint: "当前角色不能处理",
        cells: [q.id.toUpperCase(), objectCell(q.orderNo, q.user), esc(q.item), q.status === "PENDING_ACCEPT" ? "客服受理" : q.status === "PENDING_OPERATOR" ? "运营决定" : q.status === "PENDING_FINANCE" ? "财务退款" : "已结案", badge(q.status), fmt(q.createdAt)],
      }),
    });
  }

  function cancellationsList() {
    const all = newest(DB.cancellations);
    const q = (state.applied.q || "").trim();
    const status = state.applied.status;
    let filtered = all;
    if (q) {
      const n = q.toLocaleLowerCase();
      filtered = filtered.filter((c) => ["orderNo", "user", "reason"].some((k) => String(c[k] ?? "").toLocaleLowerCase().includes(n)));
    }
    if (status && status !== "ALL") {
      if (status === "REFUNDED") filtered = filtered.filter((c) => c.status === "REFUNDED" || c.phase === "BEFORE_CUTOFF");
      else if (status === "CANCELLING") filtered = filtered.filter((c) => c.phase !== "BEFORE_CUTOFF" && c.status === "CANCELLING");
      else filtered = filtered.filter((c) => c.status === status);
    }
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无取消申请。", "没有符合筛选的取消申请。", "");
    const rows = sliced.rows.map((c) => ({
      id: c.id,
      canHandle: c.status === "CANCELLING" && c.phase !== "BEFORE_CUTOFF" && hasRole("OPERATOR", "SUPER_ADMIN"),
      handleHint: c.phase === "BEFORE_CUTOFF" ? "截单前已自动退款，无需审核" : "当前无需处理",
      cells: [
        c.id.toUpperCase(),
        objectCell(c.orderNo, c.user),
        esc(c.reason),
        c.phase === "BEFORE_CUTOFF" ? "截单前已自动退款" : (c.status === "CANCELLING" ? "截单后待审" : c.status === "REFUNDING" ? "财务退款" : "已结案"),
        badge(c.phase === "BEFORE_CUTOFF" ? "REFUNDED" : c.status),
        fmt(c.updatedAt),
      ],
    }));
    return `${headline("取消管理", "", "截单前取消自动退款；截单后取消中，运营批准则财务退，拒绝则继续履约。")}
      ${state.banner || ""}
      ${toolbar("搜索订单号、消费者或原因", [["ALL", "全部状态"], ["CANCELLING", "取消中"], ["REFUNDING", "退款中"], ["REFUNDED", "退款成功"], ["REJECTED", "已驳回"]])}
      ${appliedBar()}
      ${empty || `${table(["取消申请", "订单 / 消费者", "申请原因", "下一步", "状态", "更新时间 ↓"], rows, "task")}${pager(sliced.total)}`}`;
  }

  function notificationsList() {
    return taskList({
      title: "通知管理",
      rows: DB.notifications,
      keys: ["orderNo", "type", "user"],
      search: "搜索订单号或通知类型",
      empty: "暂无需要人工处理或重试的通知。",
      emptyFilter: "没有符合筛选的通知。",
      statuses: [["ALL", "全部状态"], ["MANUAL_REQUIRED", "需人工处理"], ["SUBMISSION_UNKNOWN", "结果核验中"]],
      columns: ["通知类型", "订单", "用户标识", "失败原因", "状态", "最近时间 ↓"],
      note: true,
      mapRow: (n) => ({
        id: n.id,
        canHandle: hasRole("CUSTOMER_SERVICE", "SUPER_ADMIN") && n.status !== "MANUAL_COMPLETED",
        cells: [label(n.type), `<span class="mono">${esc(n.orderNo)}</span>`, esc(n.user), esc(n.error), badge(n.status), fmt(n.updatedAt)],
      }),
    }).replace("</h1>", `</h1><p class="note">微信订阅通知投递失败或结果不明时在此处理，不是售后工单。系统未采集手机号。人工完成只记录已通过既有合规渠道处理的结果。</p>`);
  }

  function interestsList() {
    return taskList({
      title: "意向管理",
      rows: DB.interests,
      keys: ["region", "contact", "phone"],
      search: "搜索区域或联系人",
      empty: "暂无区域开通意向。",
      emptyFilter: "没有符合筛选的意向。",
      statuses: [["ALL", "全部状态"], ["NEW", "待处理"], ["CONTACTED", "已联系"], ["CLOSED", "已关闭"]],
      columns: ["区域意向", "联系人", "联系电话", "状态", "处理说明", "最近处理 ↓"],
      mapRow: (i) => ({
        id: i.id,
        canHandle: i.status !== "CLOSED" && hasRole("OPERATOR", "CUSTOMER_SERVICE", "SUPER_ADMIN"),
        cells: [esc(i.region), esc(i.contact), esc(i.phone), badge(i.status), esc(i.note || "—"), fmt(i.updatedAt)],
      }),
    });
  }

  function financeTodoList() {
    return taskList({
      title: "退款待办",
      note: "每条待办必须挂到已存在的订单与批准来源：售后、截单后取消、取消团期、到货确认或逾期未领。已挂起的不能再次自动提交。",
      rows: DB.financeTodos,
      keys: ["orderNo", "source"],
      search: "搜索订单号或退款来源",
      empty: "暂无退款待办。",
      emptyFilter: "没有符合筛选的退款待办。",
      statuses: [["ALL", "全部状态"], ["PENDING_EXECUTE", "待执行"], ["EXECUTING", "执行中"], ["SUCCEEDED", "成功"], ["FAILED_HOLD", "失败挂起"]],
      columns: ["来源", "订单", "金额", "当前状态", "下一步"],
      metrics: [{ n: DB.financeTodos.filter((r) => ["PENDING_EXECUTE", "EXECUTING"].includes(r.status)).length, t: "待财务执行" }],
      mapRow: (r) => ({
        id: r.id,
        canHandle: hasRole("FINANCE", "SUPER_ADMIN") && !["FAILED_HOLD", "SUCCEEDED", "REFUNDED"].includes(r.status),
        handleHint: r.status === "FAILED_HOLD" ? "已挂起，不可再次自动提交" : "当前账号无财务执行权限",
        cells: [esc(r.source), `<span class="mono">${esc(r.orderNo)}</span>`, money(r.amount), badge(r.status), r.status === "FAILED_HOLD" ? "人工核验" : (r.status === "FAILED" || r.status === "SUBMISSION_UNKNOWN" ? "转入挂起" : "执行已批准退款")],
      }),
    });
  }

  function financeRefundsList() {
    const all = newest(DB.refunds);
    const filtered = applyQuery(all, ["no", "orderNo"]);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无退款记录。", "没有符合筛选的退款记录。", "");
    const rows = sliced.rows.map((r) => ({
      id: r.id,
      cells: [`<span class="mono">${esc(r.no)}</span>`, `<span class="mono">${esc(r.orderNo)}</span>`, money(r.amount), badge(r.status), fmt(r.createdAt)],
    }));
    return `${headline("退款记录")}
      ${toolbar("搜索退款单或订单号", [["ALL", "全部状态"], ["SUCCEEDED", "成功"], ["FAILED_HOLD", "失败挂起"]])}
      ${appliedBar()}
      ${empty || `${table(["退款单", "订单", "金额", "状态", "创建时间 ↓"], rows, "view")}${pager(sliced.total)}`}`;
  }

  function financeLedgerList() {
    const all = newest(DB.ledger);
    const sliced = pageSlice(filterRows(all));
    const empty = listOrEmpty(sliced.rows, all, "暂无账务流水。", "没有符合筛选的流水。", "");
    const rows = sliced.rows.map((l) => ({
      id: l.id,
      cells: [label(l.event), `<span class="mono">${esc(l.ref)}</span>`, money(l.debit), money(l.credit), l.balanced ? badge("COMPLETED") : `<span class="badge red">借贷不平衡</span>`, fmt(l.createdAt)],
    }));
    return `${headline("账务流水")}
      ${toolbar("搜索关联单据", [["ALL", "全部状态"]])}
      ${appliedBar()}
      ${empty || `${table(["事件", "关联单据", "借方合计", "贷方合计", "平衡", "时间 ↓"], rows, "view")}${pager(sliced.total)}`}`;
  }

  function auditList() {
    const all = newest(DB.audits);
    const filtered = applyQuery(all, ["actor", "action", "resource", "requestId"]);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无操作日志。", "没有符合筛选的操作日志。", "");
    const rows = sliced.rows.map((a) => ({
      id: a.id,
      cells: [esc(a.actor), label(a.action), objectCell(a.resource, a.resourceId), `<span class="mono">${esc(a.requestId)}</span>`, fmt(a.createdAt)],
    }));
    return `${headline("操作日志")}
      ${toolbar("搜索操作者、动作或追踪编号", [["ALL", "全部状态"]])}
      ${appliedBar()}
      ${empty || `${table(["操作者", "操作内容", "操作对象", "追踪编号", "操作时间 ↓"], rows, "view")}${pager(sliced.total)}`}`;
  }

  function staffList() {
    const all = newest(DB.staff);
    const filtered = applyQuery(all, ["name", "staffNo", "phone"]);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "暂无员工。", "没有符合筛选的员工。", `<button class="primary" data-act="create">新增员工</button>`);
    const rows = sliced.rows.map((s) => ({
      id: s.id,
      cells: [objectCell(s.name, "员工编号：" + s.staffNo + (s.me ? " · 当前账号" : "")), esc(s.phone), label(s.role), esc(s.points), badge(s.status), fmt(s.createdAt)],
    }));
    return `${headline("员工管理", `<button class="primary" data-act="create">新增员工</button>`, "创建员工时指定角色；点位负责人须配置点位授权。菜单范围由「权限管理」按角色配置。")}
      ${toolbar("搜索姓名、员工编号或电话", [["ALL", "全部状态"], ["ACTIVE", "启用"], ["INACTIVE", "停用"], ["PASSWORD_SETUP_REQUIRED", "待首次改密"]])}
      ${appliedBar()}
      ${empty || `${table(["员工", "电话", "角色", "点位授权", "状态", "创建时间 ↓"], rows, "resource")}${pager(sliced.total)}`}`;
  }

  function groupMenuKeys(g) {
    if (g.page) return [g.page];
    return (g.items || []).map((i) => i.key);
  }
  function permCount(role) {
    return role === "SUPER_ADMIN" ? ALL_MENU_KEYS.length : (DB.rolePermissions[role] || []).length;
  }
  function permTreeHtml() {
    const locked = state.permRole === "SUPER_ADMIN";
    const selected = new Set(locked ? ALL_MENU_KEYS : state.permDraft);
    return `<p class="perm-locked">${locked ? "超级管理员可预览全部总部菜单。点位履约仅在预览「点位负责人」时出现，以免与总部数据串台。" : "勾选该角色可访问的菜单。点位履约勾选只在预览点位负责人时生效；运营预览不会混入本点页面。"}</p>
      <div class="perm-tree">${NAV.map((g) => {
        const keys = groupMenuKeys(g);
        const n = keys.filter((k) => selected.has(k)).length;
        const all = n === keys.length && keys.length > 0;
        const some = n > 0 && !all;
        const parent = `<label class="perm-node l1">
          <input type="checkbox" data-act="perm-group" data-group="${esc(g.key)}"${all ? " checked" : ""}${some ? " data-indeterminate=\"1\"" : ""}${locked ? " disabled" : ""}>
          ${esc(g.label)}
        </label>`;
        if (g.page) return parent;
        const children = (g.items || []).map((i) => `<label class="perm-node l2">
          <input type="checkbox" data-act="perm-item" data-key="${esc(i.key)}"${selected.has(i.key) ? " checked" : ""}${locked || (i.key === "permissions" && state.permRole === "SUPER_ADMIN") ? " disabled" : ""}>
          ${esc(i.treeLabel || i.label)}${i.hint ? `<span class="perm-hint"> · ${esc(i.hint)}</span>` : ""}
        </label>`).join("");
        return parent + children;
      }).join("")}</div>`;
  }
  function openPermEditor(role) {
    state.permRole = role;
    state.permDraft = role === "SUPER_ADMIN" ? ALL_MENU_KEYS.slice() : rolePermKeys(role);
    showFormDialog({
      title: `配置权限 · ${label(role)}`,
      confirm: role === "SUPER_ADMIN" ? "知道了" : "保存",
      cancel: "取消",
      wide: true,
      hideCancel: role === "SUPER_ADMIN",
      body: () => permTreeHtml(),
      submit: () => {
        if (role === "SUPER_ADMIN") {
          DB.rolePermissions.SUPER_ADMIN = ALL_MENU_KEYS.slice();
          state.permRole = null;
          return { ok: true };
        }
        const next = state.permDraft.filter((k) => ALL_MENU_KEYS.includes(k));
        DB.rolePermissions[role] = next;
        state.permRole = null;
        okBanner(`${label(role)}的菜单权限已更新`);
        return { ok: true };
      },
    });
  }
  function setPermDraft(keys) {
    state.permDraft = [...new Set(keys)];
    if (state.modal) {
      state.modal.body = permTreeHtml();
    }
  }
  function permissionsList() {
    const rows = ROLES.map((r) => {
      const n = permCount(r.id);
      const hint = r.id === "SUPER_ADMIN" ? "全部菜单，不可裁剪" : `${n} 个菜单`;
      return {
        id: r.id,
        canHandle: true,
        handleAct: "config-perms",
        handleLabel: r.id === "SUPER_ADMIN" ? "查看权限" : "配置权限",
        cells: [esc(r.label), `<span class="mono">${r.id}</span>`, esc(hint)],
      };
    });
    return `${headline("权限管理", "", "按角色配置可访问菜单。运营默认只有总部履约；点位负责人默认只有本点页面。预览总部角色时不展示点位履约，避免数据串台。")}
      ${state.banner || ""}
      ${table(["角色", "标识", "已授权菜单"], rows, "action")}${`<div class="pagination"><span>共 ${rows.length} 个角色</span></div>`}`;
  }

  function backBtn(page) {
    return `<button class="back" data-page="${page}">← 返回${esc(pageTitle(page))}</button>`;
  }
  function facts(items) {
    const rows = [];
    for (let i = 0; i < items.length; i += 2) {
      const a = items[i];
      const b = items[i + 1];
      rows.push(`<tr><th>${esc(a[0])}</th><td>${a[1]}</td>${b ? `<th>${esc(b[0])}</th><td>${b[1]}</td>` : ""}</tr>`);
    }
    return `<table class="form-table">${rows.join("")}</table>`;
  }
  function sheet(title, body) {
    return `<section class="panel form-sheet"><h2>${esc(title)}</h2>${body}</section>`;
  }
  function timelineText(text) {
    return esc(text).replace(/(\d+\s*\/\s*\d+(?:\s*件)?)/g, '<span class="timeline-keep">$1</span>');
  }
  function timeline(items) {
    return `<div class="timeline">${items.map((it) => `<div><b>${timelineText(it[0])}</b><small>${esc(it[1])}</small></div>`).join("")}</div>`;
  }

  function productDetail() {
    const p = byId("products", state.id);
    if (!p) return emptyBlock("找不到该商品。");
    const danger = hasRole("OPERATOR", "SUPER_ADMIN")
      ? `<section class="action-panel"><div><b>${p.status === "ACTIVE" ? "下架商品" : "重新上架"}</b><div class="sub">${p.status === "ACTIVE" ? "下架后公共目录不再展示；历史订单快照保留。" : "上架后可再次被团期引用。"}</div></div><button class="${p.status === "ACTIVE" ? "danger" : "primary"}" data-act="toggle-product">${p.status === "ACTIVE" ? "下架" : "上架"}</button></section>`
      : "";
    return `<div class="detail">${backBtn("products", "商品管理")}
      <div class="detail-head"><div><h1>${esc(p.title)}</h1><div class="sub">${esc(p.sku)}</div></div>${productBadge(p.status)}</div>
      ${state.banner || ""}
      ${sheet("商品资料", facts([["分类", p.category], ["产地", p.origin], ["默认售价", money(p.price)], ["默认可售量", String(p.stock)]]))}
      ${sheet("操作记录", timeline([["商品资料已保存", fmt(p.updatedAt) + " · 运营"], ["创建商品", fmt(p.createdAt)]])) }
      <section class="action-panel safe"><div><b>日常操作</b></div>${hasRole("OPERATOR", "SUPER_ADMIN") ? `<button class="primary" data-act="edit" data-id="${p.id}">编辑</button>` : ""}</section>
      ${danger}
    </div>`;
  }

  function campaignDetail() {
    const c = byId("campaigns", state.id);
    if (!c) return emptyBlock("找不到该团期。");
    const ops = hasRole("OPERATOR", "SUPER_ADMIN");
    const d = deliveryForCampaign(c);
    const actions = [];
    if (ops && c.status === "DRAFT") actions.push(`<button class="primary" data-act="open-campaign">开始报名</button>`);
    if (ops && c.status === "OPEN") actions.push(`<button class="primary" data-act="close-campaign">截单</button>`);
    if (ops && c.status === "NOT_FORMED") {
      actions.push(`<button class="primary" data-act="postpone">顺延一次</button>`);
    }
    if (ops && ["LOCKED", "FULFILLING", "COMPLETED"].includes(c.status)) actions.push(`<button class="secondary" data-act="labels">生成装袋标签</button>`);
    if (ops && d && isPacking(d)) actions.push(`<button class="secondary" data-act="vehicle">登记车辆</button>`);
    if (ops && d && isPacking(d)) actions.push(`<button class="primary" data-act="dispatch">装袋发车</button>`);
    const danger = [];
    if (ops && c.status === "DRAFT") danger.push(`<button class="danger" data-act="delete-draft">删除待开始团期</button>`);
    if (ops && ["DRAFT", "OPEN", "NOT_FORMED"].includes(c.status)) danger.push(`<button class="danger" data-act="cancel-campaign">取消团期</button>`);
    const orderCount = campaignOrderCount(c);
    const paidQty = campaignPaidQty(c);
    const minQty = campaignMinQty(c);
    const headerActions = [
      ...(c.status === "DRAFT" && ops ? [`<button class="secondary" data-act="edit" data-id="${c.id}">编辑</button>`] : []),
      ...actions,
      ...(d && isDispatched(d) && canAccess("point-arrival") ? [`<button class="secondary" data-page="point-arrival">到货确认</button>`] : []),
    ].join("");
    return `<div class="detail">
      ${backBtn("campaigns")}
      <div class="page-header">
        <div>
          <div class="page-header-title"><h1>${esc(c.title)}</h1>${badge(c.status)}</div>
          <p class="page-header-desc">一团一自提点 · 装袋、发车记在本团期上</p>
        </div>
        ${headerActions ? `<div class="page-header-extra">${headerActions}</div>` : ""}
      </div>
      ${state.banner || ""}
      ${sheet("团期资料", facts([["截单时间", fmt(c.cutoff)], ["预计到货", c.arrival], ["自提点", c.point], ["本团订单数", String(orderCount) + " 单"], ["已付件数 / 最小成团件数", `${paidQty} / ${minQty}`], ["商品数", String(c.items) + " 个"], ["未成团处理", campaignFailAction(c) === "POSTPONE" ? "顺延一次" : "取消并退款"], ["发车", shipStatusText(d, arrivalForCampaignAtPoint(c.title, c.point))], ["到货确认", arrivalStatusText(arrivalForCampaignAtPoint(c.title, c.point), d)]]))}
      ${d ? `${sheet("发车资料", facts([["车辆", d.vehicle], ["当前阶段", label(d.status)], ["下一步", d.next], ["责任人", d.owner]]) + `<p class="hint source-note">发车不另建配送档案；运输信息挂在本团期。</p>`)}` : ""}
      ${campaignOrdersSheet(c.title, null, { openOrders: true, sheetTitle: "本团订单" })}
      ${sheet("操作记录", logsTimeline(c, [["创建团期", fmt(c.createdAt) + " · 王运营"]]))}
      ${danger.length ? `<section class="action-panel"><div><b>危险操作</b><div class="sub">取消将释放待付款订单，已付款订单进入退款义务；删除仅限无订单、无运输记录的待开始团期。</div></div><div style="display:flex;gap:8px">${danger.join("")}</div></section>` : ""}
    </div>`;
  }

  function orderDetail() {
    const o = byId("orders", state.id);
    if (!o) return emptyBlock("找不到该订单。");
    const related = DB.quality.filter((q) => q.orderNo === o.orderNo);
    const cancel = DB.cancellations.find((c) => c.orderNo === o.orderNo);
    const ex = DB.exceptions.filter((e) => e.orderNo === o.orderNo);
    const arrival = DB.arrivals.find((a) => a.campaign === o.campaign && a.point === o.point);
    const expired = !!(o.overdue && ["READY_FOR_PICKUP", "PARTIAL_PICKED"].includes(o.status));
    const ops = hasRole("OPERATOR", "SUPER_ADMIN") && expired;
    const refundWait = o.status === "REFUNDING" && hasRole("OPERATOR", "FINANCE", "SUPER_ADMIN");
    return `<div class="detail">${backBtn("orders", "订单管理")}
      <div class="detail-head"><div><h1 class="mono" style="font-weight:600">${esc(o.orderNo)}</h1><div class="sub">${esc(o.user)} · ${esc(o.campaign)} · ${esc(o.point || "")}</div></div>${badge(o.status)}</div>
      ${state.banner || ""}
      ${sheet("订单信息", facts([
        ["消费者", o.user], ["团期", o.campaign],
        ["订单金额", money(o.amount)],
        ["自提点", o.point || "—"], ["支付时间", fmt(o.paidAt)],
        ["领取进度", o.pickup], ["领取截止", o.deadline ? fmt(o.deadline) : "到货确认后第 3 个自然日 23:59:59"],
      ]) + `<p class="hint source-note">领取截止来自对应点位到货确认日；逾期未领是订单标记，不是独立档案。分次核销进度见领取进度。</p>`)}
      ${sheet("商品详情", `<table class="form-table data-table"><thead><tr><th>商品</th><th>数量</th></tr></thead><tbody><tr><td>${esc(o.goods.replace(/ ×.*$/, ""))}</td><td>${esc((o.goods.match(/×\s*(.+)$/) || ["", o.goods])[1])}</td></tr></tbody></table><p class="hint">单价与数量以支付时为准，之后改价不影响本单</p>`)}
      ${sheet("操作记录", logsTimeline(o))}
      ${sheet("售后记录", !related.length && !cancel && !ex.length
        ? `<p class="hint">暂无售后记录</p>`
        : `<table class="form-table data-table"><thead><tr><th>类型</th><th>内容</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${related.map((q) => `<tr><td>售后工单</td><td>${esc(q.item)}</td><td>${badge(q.status)}</td><td><button class="text-action" data-page="quality">查看售后工单</button></td></tr>`).join("")}
        ${cancel ? `<tr><td>取消申请</td><td>${esc(cancel.reason)}</td><td>${badge(cancel.status)}</td><td><button class="text-action" data-page="cancellations">查看取消申请</button></td></tr>` : ""}
        ${ex.map((e) => `<tr><td>确认退款订单</td><td>${esc(label(e.type))} · ${esc(e.item)}</td><td>${badge(e.status)}</td><td><button class="text-action" data-page="refund-confirm">查看确认退款订单</button></td></tr>`).join("")}
        </tbody></table>`)}
      ${arrival && ex.length ? `<p class="hint source-note">到货异常来自批次 ${esc(arrival.batch)} 的到货确认结果，不是另行开单。</p>` : ""}
      ${ops ? `<section class="action-panel safe"><div><b>一次延期</b><div class="sub">每个领取窗口仅允许一次延期，需填写原因后确认。</div></div><button class="primary" data-act="extend">一次延期</button></section>
        <section class="action-panel"><div><b>不可恢复处置</b><div class="sub">登记退款后由财务执行；报损不再退款。</div></div><div style="display:flex;gap:8px"><button class="secondary" data-act="overdue-refund">登记退款</button><button class="danger" data-act="overdue-loss">登记报损</button></div></section>` : ""}
      ${refundWait ? `<section class="action-panel safe"><div><b>已登记退款义务</b><div class="sub">金额 ${money(o.amount)}，等待财务执行，运营不再改写支付结果。</div></div>${hasRole("FINANCE", "SUPER_ADMIN") ? `<button class="secondary" data-page="finance-todo">查看退款待办</button>` : `<span class="sub">财务待办仅财务可见</span>`}</section>` : ""}
      ${expired && o.status === "CANCELLED" ? `<p class="sub" style="margin-top:14px">本单已报损关闭，不再退款。处理人见上方记录。</p>` : ""}
    </div>`;
  }

  function deliveryDetail() {
    const d = byId("deliveries", state.id);
    if (!d) return emptyBlock("找不到该发货任务。");
    const ops = hasRole("OPERATOR", "SUPER_ADMIN");
    let action = "";
    if (ops && isPacking(d)) action = `<section class="action-panel safe"><div><b>装袋发车</b><div class="sub">按已付件数装袋。可先登记车辆。发车后由点位做「到货确认」，总部不代店确认。</div></div><div style="display:flex;gap:8px"><button class="secondary" data-act="vehicle">${d.vehicle === "未登记" ? "登记车辆" : "编辑车辆"}</button><button class="primary" data-act="dispatch">装袋发车</button></div></section>`;
    if (isDispatched(d)) action = `<section class="action-panel safe"><div><b>已发车</b><div class="sub">等待点位对照系统应到与现场实物确认到货。总部不在本页代店确认。</div></div>${canAccess("point-arrival") ? `<button class="secondary" data-page="point-arrival">到货确认</button>` : ""}</section>`;
    return `<div class="detail">${backBtn("delivery", "发货管理")}
      <div class="detail-head"><div><h1>${esc(d.campaign)}</h1></div>${badge(d.status)}</div>
      ${state.banner || ""}
      ${sheet("发货资料", facts([["自提点", d.point], ["车辆", d.vehicle], ["下一步", d.next], ["责任人", d.owner]]))}
      ${sheet("操作记录", timeline([[label(d.status), fmt(d.updatedAt)], ["进入发货队列", fmt(d.createdAt)]]))}
      ${action}
    </div>`;
  }

  function arrivalDetail() {
    const a = byId("arrivals", state.id);
    if (!a) return emptyBlock("找不到该到货任务。");
    const ops = hasRole("OPERATOR", "SUPER_ADMIN");
    let action = "";
    if (isArrivalPending(a)) {
      action = `<section class="action-panel safe"><div><b>确认到货</b></div><div style="display:flex;gap:8px">${ops ? `<button class="primary" data-act="confirm-arrival">确认到货</button>` : ""} ${isSuper() ? `<button class="danger" data-act="emergency-arrival">紧急代办到货</button>` : ""}</div></section>`;
    }
    if (ops && a.status === "CONFIRMED" && DB.exceptions.some((e) => e.status === "PENDING_CONFIRM" && e.point === a.point && DB.pickupOrders.some((p) => p.arrivalId === a.id && p.orderNo === e.orderNo))) {
      action = `<section class="action-panel safe"><div><b>确认退款订单</b><div class="sub">到货已确认并登记短少或破损。运营确认受影响订单后进入财务退款。</div></div><button class="primary" data-page="refund-confirm">确认退款订单</button></section>`;
    }
    return `<div class="detail">${backBtn("arrivals", "到货确认")}
      <div class="detail-head"><div><h1>${esc(a.campaign)}</h1><div class="sub">批次 ${esc(a.batch)} · ${esc(a.point)}</div></div>${badge(a.status)}</div>
      ${state.banner || ""}
      ${sheet("到货资料", facts([["下一步", a.next], ["时限", a.due], ["短少/破损", a.diff], ["自提点", a.point]]))}
      ${sheet("到货明细", arrivalSkuTable(a, true))}
      ${sheet("操作记录", logsTimeline(a, [[label(a.status), fmt(a.updatedAt)]]))}
      ${action}
    </div>`;
  }

  function exceptionDetail() {
    const e = byId("exceptions", state.id);
    if (!e) return emptyBlock("找不到该到货异常。");
    return `<div class="detail">${backBtn("refund-confirm", "确认退款订单")}
      <div class="detail-head"><div><h1>${esc(e.orderNo)}</h1></div>${badge(e.status)}</div>
      ${state.banner || ""}
      ${sheet("退款订单", facts([["自提点", e.point], ["行结果", label(e.type)], ["商品", e.item], ["可复算金额", money(e.amount)]]))}
      ${sheet("运营说明", `<p>${esc(e.note || "尚未填写")}</p>`)}
      ${e.status === "PENDING_CONFIRM" && hasRole("OPERATOR", "SUPER_ADMIN") ? `<section class="action-panel safe"><div><b>确认后进入财务</b><div class="sub">确认后受影响件数不能领取，退款待办交给财务。</div></div><button class="primary" data-act="confirm-alloc">确认退款订单</button></section>` : `<section class="action-panel safe"><div><b>${e.status === "FAILED_HOLD" ? "失败挂起" : "等待财务执行"}</b></div><button class="secondary" data-page="finance-todo">查看退款待办</button></section>`}
    </div>`;
  }

  function overdueDetail() {
    const o = byId("overdue", state.id);
    if (!o) return emptyBlock("找不到该逾期单。");
    const ops = hasRole("OPERATOR", "SUPER_ADMIN") && o.status === "EXPIRED_PENDING";
    return `<div class="detail">${backBtn("overdue", "逾期未领")}
      <div class="detail-head"><div><h1>${esc(o.orderNo)}</h1><div class="sub">${esc(o.user)} · ${esc(o.point)}</div></div>${badge(o.status)}</div>
      ${state.banner || ""}
      ${sheet("逾期资料", facts([["截止时间", fmt(o.deadline)], ["下一责任", o.next], ["状态", label(o.status)]]))}
      ${sheet("操作记录", timeline([[label(o.status), fmt(o.updatedAt)]]))}
      ${ops ? `<section class="action-panel safe"><div><b>一次延期</b><div class="sub">每个领取窗口仅允许一次延期。</div></div><button class="primary" data-act="extend">一次延期</button></section>
        <section class="action-panel"><div><b>不可恢复处置</b><div class="sub">登记退款后由财务执行；报损不再退款。</div></div><div style="display:flex;gap:8px"><button class="secondary" data-act="overdue-refund">登记退款</button><button class="danger" data-act="overdue-loss">登记报损</button></div></section>` : ""}
    </div>`;
  }

  function consumerDetail() {
    const u = byId("consumers", state.id);
    if (!u) return emptyBlock("找不到该用户。");
    const orders = DB.orders.filter((o) => o.user === ["王小美", "李思", "陈阿姨", "刘师傅"][["u21", "u22", "u23", "u24"].indexOf(u.id)] || o.user.includes("消费者")).slice(0, 5);
    const canCall = canSeeFullConsumerPhone();
    const phoneHtml = !boundPhone(u.phone)
      ? "未绑定"
      : canCall
        ? `<span class="mono">${esc(u.phone)}</span>`
        : `<span class="mono">${esc(maskPhone(u.phone))}</span>`;
    const phoneHint = boundPhone(u.phone) && canCall
      ? `<p class="hint source-note">完整号码便于外呼联系。本次查看已记入操作记录。</p>`
      : "";
    return `<div class="detail">${backBtn("consumers", "用户管理")}
      <div class="detail-head"><div><h1>${esc(u.id)}</h1></div>${badge(u.status)} ${dealBadge(u.orders)}</div>
      ${state.banner || ""}
      ${sheet("用户资料", facts([["手机号", phoneHtml], ["认证状态", u.verified ? "手机号已认证" : "手机号未认证"], ["成交", Number(u.orders) > 0 ? "已成交" : "未成交"], ["订单数", String(u.orders)], ["注册时间", fmt(u.createdAt)]]) + phoneHint)}
      ${sheet("操作记录", logsTimeline(u, [["注册", fmt(u.createdAt)]]))}
      <section class="panel form-sheet"><h2>近期订单</h2>
        ${orders.length ? `<table><thead><tr><th>订单编号</th><th>状态</th><th>金额</th><th>创建时间</th></tr></thead><tbody>${orders.map((o) => `<tr><td class="mono">${esc(o.orderNo)}</td><td>${badge(o.status)}</td><td>${money(o.amount)}</td><td>${fmt(o.createdAt)}</td></tr>`).join("")}</tbody></table>` : `<p class="sub">暂无订单</p>`}
      </section>
    </div>`;
  }

  function qualityDetail() {
    const q = byId("quality", state.id);
    if (!q) return emptyBlock("找不到该品质售后。");
    const accept = q.status === "PENDING_ACCEPT" && hasRole("CUSTOMER_SERVICE", "SUPER_ADMIN");
    const decide = q.status === "PENDING_OPERATOR" && hasRole("OPERATOR", "SUPER_ADMIN");
    return `<div class="detail">${backBtn("quality", "售后工单")}
      <div class="detail-head"><div><h1>${esc(q.orderNo)}</h1><div class="sub">${esc(q.user)}</div></div>${badge(q.status)}</div>
      ${state.banner || ""}
      ${sheet("申报内容", `<p>${esc(q.item)}</p>` + facts([["受理说明", q.accept || "—"], ["决定说明", q.decide || "—"]]))}
      ${sheet("操作记录", logsTimeline(q, [["客服受理", "待受理 → 待运营决定"], ["运营决定", "待财务退款或已驳回"], ["财务执行", "仅处理已批准退款"]]))}
      ${accept ? `<section class="action-panel safe"><div><b>受理</b></div><button class="primary" data-act="q-accept">受理</button></section>` : ""}
      ${decide ? `<section class="action-panel safe"><div><b>运营决定</b></div><div style="display:flex;gap:8px"><button class="primary" data-act="q-approve">批准退款</button><button class="danger" data-act="q-reject">驳回</button></div></section>` : ""}
      ${!accept && !decide ? `<p class="sub" style="margin-top:14px">${hasRole("CUSTOMER_SERVICE") && q.status !== "PENDING_ACCEPT" ? "当前状态无需客服处理。" : hasRole("OPERATOR") && q.status !== "PENDING_OPERATOR" ? "当前状态无需运营决定。" : "当前角色不能处理该案件。"}</p>` : ""}
    </div>`;
  }

  function cancellationDetail() {
    const c = byId("cancellations", state.id);
    if (!c) return emptyBlock("找不到该取消申请。");
    const auto = c.phase === "BEFORE_CUTOFF";
    const can = c.status === "CANCELLING" && !auto && hasRole("OPERATOR", "SUPER_ADMIN");
    return `<div class="detail">${backBtn("cancellations", "取消申请")}
      <div class="detail-head"><div><h1>${esc(c.orderNo)}</h1><div class="sub">${esc(c.user)}</div></div>${badge(auto ? "REFUNDED" : c.status)}</div>
      ${state.banner || ""}
      ${sheet("申请资料", facts([["申请原因", c.reason], ["阶段", auto ? "截单前已自动退款" : "截单后取消中"], ["状态", auto ? "退款成功" : label(c.status)]]))}
      ${auto ? `<div class="inline-result">截单前取消已自动退款，无需批准或拒绝。</div>` : ""}
      ${can ? `<section class="action-panel"><div><b>截单后取消审核</b><div class="sub">批准后由财务执行退款；拒绝后订单继续履约。</div></div><div style="display:flex;gap:8px"><button class="primary" data-act="ca-approve">批准</button><button class="danger" data-act="ca-reject">拒绝</button></div></section>` : ""}
    </div>`;
  }

  function notificationDetail() {
    const n = byId("notifications", state.id);
    if (!n) return emptyBlock("找不到该通知。");
    const can = hasRole("CUSTOMER_SERVICE", "SUPER_ADMIN");
    return `<div class="detail">${backBtn("notifications", "通知人工处理")}
      <div class="detail-head"><div><h1>${esc(label(n.type))}</h1><div class="sub">${esc(n.orderNo)}</div></div>${badge(n.status)}</div>
      ${state.banner || ""}
      ${sheet("通知资料", facts([["用户标识", n.user], ["失败原因", n.error], ["尝试次数", String(n.attempts)]]))}
      ${n.status === "SUBMISSION_UNKNOWN" ? `<div class="inline-result warn">微信可能已送达，请勿再次系统发送。</div>` : ""}
      ${can && n.status === "MANUAL_REQUIRED" ? `<section class="action-panel safe"><div><b>系统重试</b><div class="sub">仅重新进入既有投递流程，不展示消费者联系方式。</div></div><button class="secondary" data-act="n-retry">系统重试</button></section>` : ""}
      ${can ? `<section class="action-panel safe"><div><b>人工完成</b></div><button class="primary" data-act="n-complete">人工完成</button></section>` : ""}
    </div>`;
  }

  function interestDetail() {
    const i = byId("interests", state.id);
    if (!i) return emptyBlock("找不到该意向。");
    const next = i.status === "NEW" ? "CONTACTED" : i.status === "CONTACTED" ? "CLOSED" : null;
    return `<div class="detail">${backBtn("interests", "区域开通意向")}
      <div class="detail-head"><div><h1>${esc(i.region)}</h1></div>${badge(i.status)}</div>
      ${state.banner || ""}
      ${sheet("意向资料", facts([["联系人", i.contact], ["联系电话", i.phone], ["处理说明", i.note || "—"]]))}
      ${next ? `<section class="action-panel safe"><div><b>${next === "CONTACTED" ? "登记已联系" : "关闭意向"}</b></div><button class="primary" data-act="interest-next">${next === "CONTACTED" ? "登记已联系" : "关闭意向"}</button></section>` : ""}
    </div>`;
  }

  function refundRecordDetail() {
    const r = byId("refunds", state.id);
    if (!r) return emptyBlock("找不到该退款单。");
    return `<div class="detail">${backBtn("finance-refunds", "退款记录")}
      <div class="detail-head"><div><h1>${esc(r.no)}</h1></div>${badge(r.status)}</div>
      ${sheet("退款资料", facts([["订单", r.orderNo], ["金额", money(r.amount)], ["状态", label(r.status)]]))}
      ${r.status === "FAILED_HOLD" || r.status === "MANUAL_HOLD" ? `<div class="inline-result warn">退款失败/挂起，等待人工核验微信支付结果，禁止再自动提交。</div>` : ""}
    </div>`;
  }

  function ledgerDetail() {
    const l = byId("ledger", state.id);
    if (!l) return emptyBlock("找不到该流水。");
    return `<div class="detail">${backBtn("finance-ledger", "财务流水")}
      <div class="detail-head"><div><h1>${esc(label(l.event))}</h1></div>${l.balanced ? badge("COMPLETED") : `<span class="badge red">不平衡</span>`}</div>
      ${sheet("流水资料", facts([["关联单据", l.ref], ["借方合计", money(l.debit)], ["贷方合计", money(l.credit)]]))}
    </div>`;
  }

  function financeHandle() {
    const r = byId("financeTodos", state.id);
    if (!r) return emptyBlock("找不到该退款任务。");
    const order = DB.orders.find((o) => o.orderNo === r.orderNo);
    const held = r.status === "FAILED_HOLD" || r.status === "MANUAL_HOLD";
    const done = r.status === "SUCCEEDED" || r.status === "REFUNDED";
    const unknown = r.status === "FAILED" || r.status === "SUBMISSION_UNKNOWN";
    let action = "";
    if (!hasRole("FINANCE", "SUPER_ADMIN")) {
      action = `<p class="sub">当前账号无财务执行权限。</p>`;
    } else if (held) {
      action = `<section class="action-panel"><div><b>已挂起</b><div class="sub">退款已转入人工处理微信支付结果，不可再次自动提交。</div></div><button class="primary" data-act="exec-refund" disabled>执行退款</button></section>
        <p class="hint source-note">已挂起的退款只能人工核验渠道结果，不能再次点自动提交。</p>`;
    } else if (done) {
      action = `<p class="sub">该退款已执行完成。</p>`;
    } else if (unknown) {
      action = `<section class="action-panel"><div><b>渠道结果失败或不明</b><div class="sub">不要重复自动提交。可将本单转入挂起，等待人工核验。</div></div><button class="secondary" data-act="hold-refund">转入人工挂起</button></section>`;
    } else {
      action = `<section class="action-panel"><div><b>二次确认后提交支付渠道</b><div class="sub">提交后可能出现成功、核验中、可重试失败或人工挂起。</div></div><button class="primary" data-act="exec-refund">执行退款</button></section>`;
    }
    return `<div class="detail">${backBtn("finance-todo", "待执行退款")}
      <div class="detail-head"><div><h1>执行${esc(r.source)}退款</h1></div>${badge(r.status)}</div>
      ${state.banner || ""}
      ${sheet("退款任务", facts([["订单", r.orderNo], ["金额", money(r.amount)], ["来源", r.source], ["金额来源", "对应订单支付快照，不是财务手填"]]))}
      ${sheet("操作记录", logsTimeline(r))}
      ${order ? `<p class="hint source-note">对应订单 ${esc(order.orderNo)} · ${esc(order.user)} · 当前 ${esc(label(order.status))}</p>` : ""}
      ${held ? `<div class="inline-result warn">退款已挂起，等待人工处理微信支付结果，不可再次自动提交。</div>` : ""}
      ${unknown ? `<div class="inline-result ${r.status === "FAILED" ? "bad" : "warn"}">${r.status === "FAILED" ? "渠道返回失败，请勿再次自动提交。" : "渠道结果不明，微信可能已受理，请勿再次自动提交。"}</div>` : ""}
      ${action}
    </div>`;
  }

  function auditDetail() {
    const a = byId("audits", state.id);
    if (!a) return emptyBlock("找不到该审计记录。");
    return `<div class="detail">${backBtn("audit", "审计记录")}
      <div class="detail-head"><div><h1>${esc(label(a.action))}</h1></div></div>
      ${sheet("审计资料", facts([["操作者", a.actor], ["对象", a.resource + " / " + a.resourceId], ["追踪编号", a.requestId], ["时间", fmt(a.createdAt)]]))}
      <section class="panel" style="margin-top:14px"><h2>变更快照</h2><p class="sub">仅显示变更前后的安全摘要，不含完整联系方式。</p>
        <div class="form-grid"><div><div class="sub">变更前</div><div class="item-card">status: 待开始</div></div><div><div class="sub">变更后</div><div class="item-card">status: 报名中</div></div></div>
      </section>
    </div>`;
  }

  function staffDetail() {
    const s = byId("staff", state.id);
    if (!s) return emptyBlock("找不到该员工。");
    const self = !!s.me;
    return `<div class="detail">${backBtn("staff")}
      <div class="page-header">
        <div>
          <div class="page-header-title"><h1>${esc(s.name)}</h1>${badge(s.status)}</div>
          <p class="page-header-desc">${esc(s.staffNo)}</p>
        </div>
        <div class="page-header-extra"><button class="primary" data-act="edit" data-id="${s.id}">编辑</button></div>
      </div>
      ${state.banner || ""}
      ${sheet("员工资料", facts([["电话", s.phone], ["角色", label(s.role)], ["点位授权", s.role === "PICKUP_MANAGER" ? s.points : "不适用"], ["状态", label(s.status)]]))}
      ${self ? `<p class="sub">不能停用自己或给自己发放临时密码。</p>` : `<section class="action-panel"><div><b>敏感操作</b><div class="sub">停用或重置后旧会话立即失效；临时密码只显示一次。</div></div><div style="display:flex;gap:8px">${s.status === "INACTIVE" || s.status === "SUSPENDED" ? `<button class="primary" data-act="restore-staff">恢复</button>` : `<button class="danger" data-act="suspend-staff">停用</button>`}<button class="secondary" data-act="reset-staff">重置密码</button></div></section>`}
    </div>`;
  }

  function areaDetail() {
    const a = byId("areas", state.id);
    if (!a) return emptyBlock("找不到该服务区域。");
    return `<div class="detail">${backBtn("areas", "服务区域")}
      <div class="detail-head"><div><h1>${esc(a.name)}</h1></div>${badge(a.orderEnabled ? "ENABLED" : "DISABLED")}</div>
      ${state.banner || ""}
      ${sheet("区域资料", facts([["行政目录", a.path], ["状态", a.orderEnabled ? "启用" : "停用"]]))}
      <section class="action-panel"><div><b>${a.orderEnabled ? "停用区域" : "启用区域"}</b><div class="sub">停用只影响后续新团期，进行中的团期和未完成订单不受影响。</div></div><button class="${a.orderEnabled ? "danger" : "primary"}" data-act="toggle-area">${a.orderEnabled ? "停用" : "启用"}</button></section>
    </div>`;
  }

  function pointDetail() {
    const p = byId("points", state.id);
    if (!p) return emptyBlock("找不到该自提点。");
    return `<div class="detail">${backBtn("points", "自提点")}
      <div class="detail-head"><div><h1>${esc(p.name)}</h1></div>${badge(p.status)}</div>
      ${state.banner || ""}
      ${sheet("自提点资料", facts([["所属区域", DB.areas.find((a) => a.id === p.areaId)?.name || "—"], ["地址", p.address], ["营业时间", p.hours], ["领取说明", p.instruction], ["点位负责人", pointManagerLabel(p)], ["联系人", p.contact]]))}
      <section class="action-panel safe"><div><b>编辑资料</b></div><button class="primary" data-act="edit" data-id="${p.id}">编辑</button></section>
      <section class="action-panel"><div><b>${p.status === "ACTIVE" ? "停用自提点" : "启用自提点"}</b><div class="sub">位置或启用状态变更需重新核验定位。</div></div><button class="${p.status === "ACTIVE" ? "danger" : "primary"}" data-act="toggle-point">${p.status === "ACTIVE" ? "停用" : "启用"}</button></section>
    </div>`;
  }

  function categoryDetail() {
    const c = byId("categories", state.id);
    if (!c) return emptyBlock("找不到该分类。");
    return `<div class="detail">${backBtn("categories", "商品分类")}
      <div class="detail-head"><div><h1>${esc(c.name)}</h1></div>${badge(c.status)}</div>
      ${state.banner || ""}
      ${sheet("分类资料", facts([["排序", String(c.sortOrder)], ["状态", label(c.status)]]))}
      <section class="action-panel safe"><div><b>重命名</b></div><button class="primary" data-act="edit" data-id="${c.id}">编辑</button></section>
      <section class="action-panel"><div><b>停用或删除</b><div class="sub">已被商品引用的分类无法删除。</div></div><div style="display:flex;gap:8px"><button class="secondary" data-act="toggle-cat">${c.status === "ACTIVE" ? "停用" : "启用"}</button><button class="danger" data-act="delete-cat">删除</button></div></section>
    </div>`;
  }

  function formWrap(title, backPage, backTitle, fields, extra = "") {
    return `<div class="detail form">${backBtn(backPage)}
      <div class="detail-head"><div><h1>${esc(title)}</h1></div></div>
      ${state.banner || ""}
      <section class="panel">${fields}</section>${extra}
      <div class="form-footer">
        <button class="secondary" data-page="${backPage}">取消</button>
        <button class="primary" data-act="save-form">保存</button>
      </div>
    </div>`;
  }
  function field(labelText, inner, req, hint) {
    return `<div class="field"><label class="${req ? "req" : ""}">${esc(labelText)}</label>${inner}${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
  }

  function productForm() {
    const p = state.formKind === "edit" ? byId("products", state.id) : { title: "", sku: "", category: "蔬菜", origin: "", price: "", stock: 100, status: "ACTIVE" };
    return formWrap(state.formKind === "edit" ? "编辑商品" : "新增商品", "products", "商品管理", `
      ${field("商品主图", `<div class="map-box">原型示意：选择 JPEG / PNG / WebP，限 5MB。保存后重编码为 WebP。</div>`)}
      ${field("商品名称", `<input name="title" value="${esc(p.title)}">`, true)}
      <div class="form-grid">
        ${field("分类", `<select name="category">${DB.categories.filter((c) => c.status === "ACTIVE").map((c) => `<option${c.name === p.category ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`, true, DB.categories.some((c) => c.status === "ACTIVE") ? "" : "暂无分类，请先创建")}
        ${field("产地", `<input name="origin" value="${esc(p.origin)}">`, true)}
      </div>
      ${field("销售规格（包装单位）", `<input name="sku" value="${esc(p.sku)}" placeholder="例如 500克/袋、12枚/盒">`, true)}
      <div class="form-grid">
        ${field("默认售价（元）", `<input name="price" value="${p.price ? (p.price / 100).toFixed(2) : ""}" placeholder="例如 19.90">`, true)}
        ${field("默认团期可售量", `<input name="stock" value="${p.stock || ""}">`, true, "创建团期时带出的建议数量，团期内可调整")}
      </div>
      ${field("目录状态", `<select name="status"><option value="ACTIVE"${p.status === "ACTIVE" ? " selected" : ""}>上架（公共目录可见）</option><option value="INACTIVE"${p.status === "INACTIVE" ? " selected" : ""}>下架（历史快照保留）</option></select>`, true)}
    `);
  }

  function categoryForm() {
    const c = state.formKind === "edit" ? byId("categories", state.id) : { name: "", sortOrder: 0 };
    return formWrap(state.formKind === "edit" ? "编辑分类" : "新增分类", "categories", "商品分类", `
      ${field("分类名称", `<input name="name" value="${esc(c.name)}" placeholder="例如：蔬菜">`, true)}
      ${field("排序", `<input name="sort" value="${c.sortOrder || 0}">`)}
    `);
  }

  function campaignForm() {
    const c = state.formKind === "edit" ? byId("campaigns", state.id) : null;
    return formWrap(c ? "编辑待开始团期" : "创建社区团期", "campaigns", "团期管理", `
      ${field("团期名称", `<input name="title" value="${esc(c?.title || "")}">`, true)}
      <div class="form-grid">
        ${field("服务区域", `<select>${DB.areas.filter((a) => a.orderEnabled).map((a) => `<option>${esc(a.name)}</option>`).join("")}</select>`, true)}
        ${field("自提点", `<select>${DB.points.filter((p) => p.status === "ACTIVE").map((p) => `<option>${esc(p.name)}</option>`).join("")}</select>`, true)}
      </div>
      <div class="form-grid">
        ${field("截单时间", `<input value="2026-09-12 21:00">`, true)}
        ${field("计划发车时间", `<input value="2026-09-13 08:00">`, true)}
      </div>
      <div class="form-grid">
        ${field("预计到货开始", `<input value="2026-09-13 16:00">`, true)}
        ${field("预计到货结束", `<input value="2026-09-14 12:00">`, true)}
      </div>
      <div class="form-grid">
        ${field("最小成团件数", `<input value="20">`)}
        ${field("未成团处理", `<select><option value="CANCEL_AND_REFUND">取消并退款</option><option value="POSTPONE">顺延</option></select>`)}
      </div>
      <p class="hint">选择商品后自动带入默认售价，本期可单独调整。</p>
      <div class="item-card">
        <div class="form-grid">
          ${field("商品", `<select>${DB.products.filter((p) => p.status === "ACTIVE").map((p) => `<option>${esc(p.title)} · ${esc(p.sku)}</option>`).join("")}</select>`, true)}
          ${field("本团售价（元）", `<input value="6.80">`, true)}
        </div>
        ${field("可售量", `<input value="200">`, true)}
      </div>
      <button class="secondary" type="button">添加商品</button>
    `);
  }

  function postponeForm() {
    const c = byId("campaigns", state.id) || {};
    const cutoff = Math.max((c.cutoff || NOW) + 36 * 3600 * 1000, NOW + 52 * 3600 * 1000);
    const start = cutoff + 24 * 3600 * 1000;
    const end = cutoff + 44 * 3600 * 1000;
    return formWrap("顺延团期", "campaigns", "团期管理", `
      <p class="hint">每个团期最多顺延一次。新截单时间必须晚于当前时间。保存后原未成团关闭逻辑：本团回到报名中，并写入新的截单与到货时间。</p>
      ${field("新的截单时间", `<input id="pp-cutoff" value="${esc(toLocalDateTimeValue(cutoff))}">`, true)}
      ${field("新的发车时间", `<input id="pp-ship" value="${esc(toLocalDateTimeValue(start - 8 * 3600 * 1000))}">`, true)}
      ${field("新的到货开始", `<input id="pp-arrival-start" value="${esc(toLocalDateTimeValue(start))}">`, true)}
      ${field("新的到货结束", `<input id="pp-arrival-end" value="${esc(toLocalDateTimeValue(end))}">`, true)}
    `);
  }

  function vehicleForm() {
    const d = byId("deliveries", state.id) || {};
    return formWrap(d.vehicle === "未登记" ? "登记运输信息" : "编辑运输信息", "delivery", "发货管理", `
      ${field("物流平台", `<input value="县域货运">`, true)}
      ${field("运单号", `<input value="${esc(d.vehicle && d.vehicle !== "未登记" ? d.vehicle : "")}">`, true)}
      <div class="form-grid">
        ${field("司机姓名", `<input>`)}
        ${field("司机电话", `<input>`)}
      </div>
      <div class="form-grid">
        ${field("车牌", `<input>`)}
        ${field("预计到达", `<input value="2026-09-13 17:00">`)}
      </div>
    `);
  }

  function arrivalForm() {
    const a = byId("arrivals", state.id);
    if (!a) return emptyBlock("找不到该到货任务。");
    const emergency = isSuper() && state.formKind === "emergency";
    const pending = isArrivalPending(a);
    return `<div class="detail form">${backBtn("arrivals")}
      <div class="page-header">
        <div>
          <div class="page-header-title"><h1>${!pending ? `${esc(a.campaign)}到货已确认` : emergency ? "紧急代办：确认到货" : "确认到货"}</h1>${badge(a.status)}</div>
          <p class="page-header-desc">批次 ${esc(a.batch)} · ${esc(a.point)} · ${esc(a.campaign)}</p>
        </div>
      </div>
      <section class="panel">
        ${pending ? field("现场接收人", `<input id="arr-${a.id}-by" value="周点位">`, true) : ""}
        ${emergency && pending ? field("紧急代办原因", `<textarea placeholder="超管代办必须填写原因"></textarea>`, true) : ""}
        ${arrivalSkuTable(a, !pending)}
        ${state.arrivalError ? `<div class="inline-result bad">${esc(state.arrivalError)}</div>` : ""}
      </section>
      ${pending ? `<div class="form-footer"><button class="secondary" data-page="arrivals">取消</button><button class="primary" data-act="save-form">${esc(arrivalSubmitLabel())}</button></div>` : ""}
    </div>`;
  }

  function areaForm() {
    return formWrap("开通服务区域", "areas", "服务区域", `
      ${field("行政目录", `<select><option>河北省 / 某市 / 某县 / 城区</option><option>河北省 / 某市 / 某县 / 城南</option><option>河北省 / 某市 / 某县 / 城西</option></select>`, true, "从行政目录选择，不手写演示城市")}
      ${field("区域显示名", `<input placeholder="例如：城区服务区">`, true)}
    `);
  }

  function pointForm() {
    const key = state.formKind + ":" + state.id;
    if (!state.pointDraft || state.pointDraft.key !== key) {
      const p = state.formKind === "edit" ? byId("points", state.id) : null;
      state.pointDraft = { key, name: "", address: "", hours: "每日 09:00–20:00", instruction: "到店出示领取码", status: "ACTIVE", areaId: "", managerId: "", ...p, originalStatus: p?.status || "ACTIVE", originalAddress: p?.address || "", query: "", scenario: "success", confirmed: !!p, locationChanged: !p, poi: null, results: [], error: "", duplicateAccepted: false };
    }
    const p = state.pointDraft;
    return formWrap(p.id ? "编辑自提点" : "新增自提点", "points", "自提点", `
      ${field("所属服务区域", p.id ? `<input id="pt-area-label" value="${esc(byId("areas", p.areaId)?.name || p.areaId)}" readonly aria-readonly="true">` : `<select id="pt-area"><option value="">请选择服务区域</option>${DB.areas.map((a) => `<option value="${esc(a.id)}"${a.id === p.areaId ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select>`, true, p.id ? "编辑时保留原区域；调整位置后重新确认行政路径。" : "先选区域，再搜索位置。")}
      ${field("名称", `<input id="pt-name" value="${esc(p.name)}" placeholder="如：幸福路自提点">`, true)}
      ${field("详细地址或地点名称", `<input id="pt-address" value="${esc(p.address)}">`, true)}
      <section class="location-picker" aria-label="模拟位置选择">
        <strong>地图定位 · 交互模拟</strong><p class="hint">使用本地虚构候选和示意地图，不连接真实地图服务。</p>
        ${field("模拟场景", `<select id="pt-scenario">${[["success","正常定位"],["failure","地图服务失败"],["mismatch","行政路径不相容"],["duplicate","疑似重复点位"],["empty","没有搜索结果"]].map(([v,t]) => `<option value="${v}"${p.scenario === v ? " selected" : ""}>${t}</option>`).join("")}</select>`)}
        ${field("搜索地点", `<div class="location-search"><input id="pt-query" value="${esc(p.query)}" placeholder="输入路名或地标"><button class="secondary" data-act="location-search">搜索</button></div>`)}
        <div id="location-state">${locationStateHtml()}</div>
      </section>
      <div class="form-grid">
        ${field("营业时间", `<input id="pt-hours" value="${esc(p.hours)}">`, true)}
        ${field("领取说明", `<input id="pt-instruction" value="${esc(p.instruction)}">`)}
      </div>
      ${field("点位负责人", `<select id="pt-manager"><option value="">未关联</option>${pickupManagerStaff().map((m) => `<option value="${esc(m.id)}"${p.managerId === m.id ? " selected" : ""}>${esc(m.name)}</option>`).join("")}</select>`, true)}
      ${field("状态", `<select id="pt-status"><option value="ACTIVE"${p.status === "ACTIVE" ? " selected" : ""}>启用</option><option value="INACTIVE"${p.status === "INACTIVE" ? " selected" : ""}>停用</option></select>`)}
      <p id="point-validation" role="status" aria-live="polite"></p>
    `);
  }
  function capturePointDraft() {
    const p = state.pointDraft;
    if (!p || state.page !== "points" || state.view !== "form") return;
    for (const [id, key] of [["pt-name","name"],["pt-address","address"],["pt-hours","hours"],["pt-instruction","instruction"],["pt-manager","managerId"],["pt-status","status"],["pt-query","query"],["pt-scenario","scenario"]]) {
      const el = document.getElementById(id); if (el) p[key] = el.value;
    }
    if (!p.id && document.getElementById("pt-area")) p.areaId = inputVal("pt-area");
  }
  function pointValidation() {
    const p = state.pointDraft;
    if (!p) return "请填写点位信息";
    if (p.name.trim().length < 2) return "名称至少需要 2 个字符";
    if (!p.areaId) return "请先选择服务区域";
    if (!p.address.trim()) return "请填写详细地址或地点名称";
    if (!p.hours.trim()) return "请填写营业时间";
    if (!p.managerId) return "请选择点位负责人";
    if (!p.confirmed) return "请先选择候选并确认模拟地图位置";
    return "";
  }
  function syncPointSave() {
    if (state.page !== "points" || state.view !== "form") return;
    const error = pointValidation();
    const save = root.querySelector('[data-act="save-form"]'); if (save) { save.disabled = !!error; save.setAttribute("aria-describedby", "point-validation"); }
    const note = document.getElementById("point-validation"); if (note) note.textContent = error || "信息完整，可以保存到本次原型会话。";
  }
  function locationStateHtml() {
    const p = state.pointDraft;
    return `<p role="status" aria-live="polite" class="${p.error ? "inline-result bad" : "hint"}">${esc(p.error || (p.confirmed ? p.locationChanged ? "模拟位置已确认" : "保留已有位置；未更改地址时无需重新验证" : "尚未确认位置，保存暂不可用"))}</p>
      <div class="poi-list">${p.results.map((poi, i) => `<button class="secondary" data-act="location-select" data-index="${i}" aria-pressed="${p.poi?.id === poi.id}">${esc(poi.title)}<small>${esc(poi.address)}</small></button>`).join("")}</div>
      ${p.poi ? `<div class="simulated-map" aria-label="模拟地图预览"><span class="map-road road-one"></span><span class="map-road road-two"></span><span class="map-pin">●<span>${esc(p.poi.title)}</span></span><small>示意坐标 ${p.poi.lat.toFixed(4)}, ${p.poi.lng.toFixed(4)} · 非真实地图</small></div>
      <p class="hint">行政路径：${esc(p.scenario === "mismatch" ? "其他服务区域（不相容）" : byId("areas", p.areaId)?.name || p.areaId)}</p>
      ${p.scenario === "duplicate" ? `<label class="duplicate-check"><input type="checkbox" id="pt-duplicate"${p.duplicateAccepted ? " checked" : ""}> 已核对模拟重复候选，仍需保留此点位</label>` : ""}
      <div class="location-actions"><button class="secondary" data-act="location-adjust">微调模拟图钉</button><button class="primary" data-act="location-confirm"${p.confirmed ? " disabled" : ""}>确认此模拟位置</button></div>` : ""}
      ${p.scenario === "failure" && p.error ? '<button class="secondary" data-act="location-retry">恢复模拟服务并重试</button>' : ""}`;
  }
  function paintLocation() {
    const area = document.getElementById("location-state"); if (area) area.innerHTML = locationStateHtml(); syncPointSave();
  }
  function handlePointInput(el) {
    const p = state.pointDraft; if (!p) return;
    if (el.id === "pt-duplicate") { p.duplicateAccepted = el.checked; p.confirmed = false; p.error = ""; paintLocation(); return; }
    capturePointDraft();
    if (el.id === "pt-status" && p.originalStatus === "INACTIVE" && p.status === "ACTIVE") { p.confirmed = false; p.locationChanged = true; p.error = "重新启用需重新确认模拟位置"; paintLocation(); }
    if (["pt-address", "pt-area", "pt-scenario", "pt-query"].includes(el.id)) {
      p.confirmed = false; p.locationChanged = true; p.error = ""; p.duplicateAccepted = false;
      if (el.id !== "pt-address") { p.poi = null; p.results = []; }
      paintLocation();
    }
    syncPointSave();
  }
  function handleLocation(act, el) {
    capturePointDraft(); const p = state.pointDraft; if (!p) return;
    p.error = "";
    if (act === "location-retry") { p.scenario = "success"; document.getElementById("pt-scenario").value = "success"; act = "location-search"; }
    if (act === "location-search") {
      p.poi = null; p.results = []; p.confirmed = false; p.locationChanged = true;
      if (!p.areaId) p.error = "请先选择服务区域再搜索位置。";
      else if (!p.query.trim()) p.error = "请输入路名或地标，输入内容会保留。";
      else if (p.scenario === "failure") p.error = "模拟地图服务不可用，已保留输入；恢复后可重试。";
      else if (p.scenario === "empty") p.error = "模拟搜索没有结果，请调整关键词或切换场景。";
      else p.results = [1,2].map((n) => ({ id: String(n), title: `${p.query} · 模拟候选 ${n}`, address: `${p.query} ${n} 号（模拟地址）`, lat: 39.12 + n * .001, lng: 115.91 + n * .001 }));
    }
    if (act === "location-select") { p.poi = { ...p.results[Number(el.dataset.index)] }; p.address = p.poi.address; document.getElementById("pt-address").value = p.address; p.confirmed = false; p.duplicateAccepted = false; }
    if (act === "location-adjust" && p.poi) { p.poi.lat += .0001; p.poi.lng += .0001; p.confirmed = false; p.duplicateAccepted = false; }
    if (act === "location-confirm") {
      if (!p.poi || p.scenario === "failure") p.error = "地图不可用，请重新搜索。";
      else if (p.scenario === "mismatch") p.error = "模拟行政路径与服务区域不相容，请选择本区域候选。";
      else if (p.scenario === "duplicate" && !p.duplicateAccepted) p.error = "发现模拟重复候选：同地址点位，距离约 20 米。请明确核对后确认。";
      else p.confirmed = true;
    }
    paintLocation();
    const next = act === "location-search" ? '.poi-list button' : '[data-act="location-confirm"]';
    root.querySelector(next)?.focus();
  }

  function staffForm() {
    const s = state.formKind === "edit" ? byId("staff", state.id) : { name: "", phone: "", role: "OPERATOR", points: "" };
    const role = s.role || "OPERATOR";
    const selectedPoints = String(s.points || "").split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    return formWrap(s.id ? "编辑员工" : "新增员工", "staff", "员工管理", `
      ${field("姓名", `<input id="st-name" value="${esc(s.name || "")}" placeholder="请输入姓名">`, true)}
      ${s.id ? "" : field("账号", `<input id="st-account" placeholder="3–64 位登录账号">`, true)}
      ${field("手机", `<input id="st-phone" value="${esc((s.phone || "").replace(/\*/g, "0"))}" placeholder="11 位大陆手机号">`, true)}
      ${field("角色", `<select id="st-role" data-act="staff-role">${ROLES.map((r) => `<option value="${r.id}"${role === r.id ? " selected" : ""}>${r.label}</option>`).join("")}</select>`, true, "角色决定可访问菜单，在「权限管理」中配置。")}
      <div class="staff-points-field${role === "PICKUP_MANAGER" ? "" : " hidden"}">
        ${field("点位授权", `<select id="st-points" multiple size="4">${DB.points.filter((p) => p.status === "ACTIVE").map((p) => `<option${selectedPoints.includes(p.name) ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`, true, "仅点位负责人需要。可多选；保存后可在工作台切换当前自提点。")}
      </div>
      ${s.id ? field("变更原因", `<textarea placeholder="角色或点位变更时必填"></textarea>`) : ""}
    `);
  }

  function changePasswordPage() {
    return formWrap("修改我的密码", DEFAULT_PAGE[state.role], "工作台", `
      <p class="hint">修改成功后，其他设备和浏览器中的旧会话会立即失效。</p>
      ${field("当前密码", `<input type="password" autocomplete="current-password">`, true)}
      ${field("新密码", `<input type="password" autocomplete="new-password">`, true, "长度为 8–128 位")}
      ${field("确认新密码", `<input type="password" autocomplete="new-password">`, true)}
    `).replace(/← 返回[^<]*/, "← 返回");
  }

  function assignedPoints() {
    const name = (ACTOR[state.role] || {}).name;
    const staff = DB.staff.find((s) => s.role === "PICKUP_MANAGER" && s.name === name);
    if (staff) return DB.points.filter((p) => p.managerId === staff.id);
    if (canAccess("point-arrival") || canAccess("point-pickup") || canAccess("point-campaigns") || canAccess("point-pickup-records")) {
      return DB.points.filter((p) => p.status === "ACTIVE");
    }
    return [];
  }
  function currentPoint() {
    const rows = assignedPoints();
    return rows.find((p) => p.id === state.pointId) || rows[0] || { id: "", name: "未关联自提点", address: "" };
  }
  function arrivalsForPoint(pointId) {
    return DB.arrivals.filter((a) => a.pointId === pointId);
  }
  function pickupOrdersForPoint(pointId) {
    return DB.pickupOrders.filter((o) => o.pointId === pointId);
  }
  function pickupReceiptsForPoint(pointId) {
    return (DB.pickupReceipts || []).filter((r) => r.pointId === pointId);
  }
  function dateKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function isSameCalendarDay(ts, ref = NOW) {
    return dateKey(ts) === dateKey(ref);
  }
  function maskOrderNo(orderNo) {
    const s = String(orderNo || "");
    if (s.length <= 8) return s || "—";
    return `${s.slice(0, 2)}····${s.slice(-5)}`;
  }
  function pickupUnit(item) {
    const sku = String((item && item.sku) || "");
    if (sku.includes("袋")) return "袋";
    if (sku.includes("盒")) return "盒";
    if (sku.includes("箱")) return "箱";
    if (sku.includes("份")) return "份";
    if (sku.includes("根")) return "根";
    return "件";
  }
  function receiptInDateScope(row) {
    const range = state.applied.range || ((state.applied.from || state.applied.to) ? "CUSTOM" : "TODAY");
    if (range === "ALL") return true;
    if (range === "TODAY") return isSameCalendarDay(row.at);
    if (range === "CUSTOM" || state.applied.from || state.applied.to) {
      const day = dateKey(row.at);
      if (state.applied.from && day < state.applied.from) return false;
      if (state.applied.to && day > state.applied.to) return false;
      if (!state.applied.from && !state.applied.to) return isSameCalendarDay(row.at);
      return true;
    }
    return isSameCalendarDay(row.at);
  }
  function recordPickupReceipts(order, lines) {
    const orderedAll = order.items.reduce((n, item) => n + (item.ordered || 0), 0);
    const pickedAll = order.items.reduce((n, item) => n + (item.picked || 0), 0);
    lines.forEach(({ item, qty }) => {
      DB.pickupReceipts.unshift({
        id: "pr-" + Date.now().toString(36) + item.skuId,
        pickupOrderId: order.id,
        orderNo: order.orderNo,
        user: order.user,
        pointId: order.pointId,
        campaign: order.campaign,
        title: item.title,
        sku: item.sku,
        qty,
        unit: pickupUnit(item),
        operator: actorName(),
        at: NOW,
      });
    });
    const orderRec = DB.orders.find((o) => o.orderNo === order.orderNo);
    if (orderRec) {
      addLog(orderRec, `核销${lines.map(({ item, qty }) => `${item.title} ${qty} ${pickupUnit(item)}`).join("、")}，领取进度 ${pickedAll} / ${orderedAll} 件`);
      orderRec.pickup = `${pickedAll} / ${orderedAll} 件`;
      if (order.status === "COMPLETED" && ["READY_FOR_PICKUP", "PARTIAL_PICKED", "PAID"].includes(orderRec.status)) {
        orderRec.status = "COMPLETED";
      } else if (["READY_FOR_PICKUP", "PARTIAL_PICKED", "PAID"].includes(orderRec.status)) {
        orderRec.status = pickedAll > 0 && pickedAll < orderedAll ? "PARTIAL_PICKED" : order.status;
      }
    }
  }
  function remainingPickup(item) {
    return Math.max(0, (item.ready || 0) - (item.picked || 0));
  }
  function arrivalFingerprint(items) {
    return items.map((i) => [i.skuId, i.received, i.short, i.damaged, i.note || ""].join(":")).join("|");
  }
  function numVal(id, fallback) {
    const raw = document.getElementById(id)?.value;
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  }
  function clampInt(n, min, max) {
    const v = Number.isFinite(n) ? Math.floor(n) : min;
    return Math.min(max, Math.max(min, v));
  }
  function defaultArrivalDraftItem(item) {
    const expected = item.expected || 0;
    const arrived = Number.isFinite(item.received) && Number.isFinite(item.damaged)
      ? item.received + item.damaged
      : expected;
    return {
      arrived: arrived > 0 || item.short > 0 || item.damaged > 0 ? arrived : expected,
      damaged: item.damaged || 0,
      note: item.note || "",
    };
  }
  function ensureArrivalDraft(arrival) {
    if (!state.arrivalDrafts[arrival.id]) {
      state.arrivalDrafts[arrival.id] = Object.fromEntries(
        (arrival.items || []).map((item) => [item.skuId, defaultArrivalDraftItem(item)]),
      );
    }
    return state.arrivalDrafts[arrival.id];
  }
  function arrivalDraftLine(arrival, item) {
    const draft = ensureArrivalDraft(arrival)[item.skuId] || defaultArrivalDraftItem(item);
    const arrived = clampInt(draft.arrived, 0, item.expected);
    const damaged = clampInt(draft.damaged, 0, arrived);
    return { arrived, damaged, short: item.expected - arrived, note: draft.note || "" };
  }
  function arrivalSubmitLabel() {
    return "确认到货";
  }
  function itemsFromArrivalDraft(arrival) {
    return (arrival.items || []).map((item) => {
      const line = arrivalDraftLine(arrival, item);
      return {
        ...item,
        received: line.arrived - line.damaged,
        short: line.short,
        damaged: line.damaged,
        note: line.note,
      };
    });
  }
  function arrivalDisplayLine(item) {
    return {
      arrived: (item.received || 0) + (item.damaged || 0),
      short: item.short || 0,
      damaged: item.damaged || 0,
      note: item.note || "",
    };
  }
  function syncArrivalExceptionMath() {
    const f = state.arrivalExceptionForm;
    if (!f) return;
    const arrived = numVal("arr-ex-arrived", f.arrived);
    const damaged = numVal("arr-ex-damaged", f.damaged);
    f.arrived = arrived;
    f.damaged = damaged;
    if (document.getElementById("arr-ex-note")) f.note = document.getElementById("arr-ex-note").value;
    const shortEl = document.getElementById("arr-ex-short");
    if (shortEl) {
      const short = f.expected - arrived;
      shortEl.textContent = String(short);
      shortEl.classList.toggle("is-diff", short !== 0);
    }
  }
  function arrivalExceptionModalBody() {
    const f = state.arrivalExceptionForm;
    if (!f) return "";
    const short = f.expected - f.arrived;
    return modalFacts([
      ["商品", `${esc(f.title)} <span class="sub">${esc(f.sku)}</span>`],
      ["系统应到", `<span class="mono">${f.expected}</span>`],
      ["实到", `<input id="arr-ex-arrived" type="number" min="0" max="${f.expected}" value="${f.arrived}">`, true],
      ["其中破损", `<input id="arr-ex-damaged" type="number" min="0" max="${f.expected}" value="${f.damaged}">`],
      ["自动短少", `<span id="arr-ex-short" class="mono${short ? " is-diff" : ""}">${short}</span>`],
      ["说明", `<textarea id="arr-ex-note" rows="3" placeholder="短少或破损时必填">${esc(f.note)}</textarea>`, true],
    ]) + `<p class="hint source-note">实到含破损实物。短少 = 应到 − 实到，自动计算。其中破损不能大于实到。提交记账：良品 = 实到 − 破损，短少 = 应到 − 实到，破损单独记。</p>`;
  }
  function openArrivalException(arrival, item) {
    const line = arrivalDraftLine(arrival, item);
    state.arrivalExceptionForm = {
      arrivalId: arrival.id,
      skuId: item.skuId,
      expected: item.expected,
      title: item.title,
      sku: item.sku,
      arrived: line.arrived,
      damaged: line.damaged,
      note: line.note,
    };
    showFormDialog({
      title: "登记异常",
      confirm: "确认",
      cancel: "取消",
      body: () => arrivalExceptionModalBody(),
      submit: () => {
        const f = state.arrivalExceptionForm;
        if (!f) return { ok: false };
        const arrived = numVal("arr-ex-arrived", f.arrived);
        const damaged = numVal("arr-ex-damaged", f.damaged);
        const note = (document.getElementById("arr-ex-note")?.value || "").trim();
        f.arrived = arrived;
        f.damaged = damaged;
        f.note = note;
        if (arrived > f.expected) return { error: `实到不能大于应到 ${f.expected}。` };
        if (damaged > arrived) return { error: "其中破损不能大于实到。" };
        const short = f.expected - arrived;
        if ((short > 0 || damaged > 0) && !note) return { error: "存在短少或破损时必须填写说明。" };
        const draft = ensureArrivalDraft(byId("arrivals", f.arrivalId));
        draft[f.skuId] = { arrived, damaged, note };
        state.arrivalExceptionForm = null;
        return { ok: true };
      },
    });
  }
  function emptyArrivalReason(pointId) {
    const all = arrivalsForPoint(pointId);
    const waitingOps = all.some((a) => a.status === "CONFIRMED" && DB.exceptions.some((e) => e.status === "PENDING_CONFIRM" && e.point === a.point));
    const confirmed = all.some((a) => a.status === "CONFIRMED");
    const pointName = (assignedPoints().find((p) => p.id === pointId) || {}).name;
    const undeparted = DB.deliveries.some((d) => d.point === pointName && isPacking(d));
    if (waitingOps) return "本点已发车批次均已提交到货。存在待运营确认退款订单，受影响数量暂不可领取。";
    if (confirmed) return "本点已发车批次均已确认完毕。";
    if (undeparted) return "当前点位批次尚未发车，到货确认在发车后开放。";
    return "暂无已发车、待确认的授权点位配送。";
  }
  function emptyPickupReason(pointId) {
    const orders = pickupOrdersForPoint(pointId);
    const pickable = orders.some((o) => o.items.some((i) => remainingPickup(i) > 0));
    if (pickable) return "";
    const blocked = orders.some((o) => o.items.some((i) => i.blocked > 0));
    const awaiting = orders.some((o) => o.items.some((i) => i.pendingArrival));
    if (blocked) return "有订单因到货异常等待运营确认退款订单，受影响数量暂不可核销。";
    if (awaiting) return "订单尚未完成到货确认，确认后才可核销。";
    if (orders.length) return "本点已确认到货的订单均已领取完毕。";
    const all = arrivalsForPoint(pointId);
    if (all.some((a) => a.status === "CONFIRMED")) return "本点暂无待核销订单。已确认到货的批次没有待领取数量。";
    if (all.some((a) => isArrivalPending(a))) return "当前点位还没有可领取数量。到货确认后，正常数量才可核销。";
    return "当前点位还没有可领取数量。未发车或到货未确认的订单不能核销。";
  }
  function applyArrivalToPickups(arrival) {
    DB.pickupOrders.forEach((order) => {
      if (order.arrivalId !== arrival.id) return;
      order.items.forEach((line) => {
        const sku = arrival.items.find((i) => i.skuId === line.skuId);
        if (!sku) return;
        line.pendingArrival = false;
        if (sku.short + sku.damaged > 0) {
          line.ready = 0;
          line.blocked = line.ordered;
          line.blockReason = "到货异常待运营确认退款订单，受影响数量暂不可领取";
        } else {
          line.ready = line.ordered;
          line.blocked = 0;
          line.blockReason = "";
        }
      });
      const anyReady = order.items.some((i) => remainingPickup(i) > 0);
      const anyBlocked = order.items.some((i) => i.blocked > 0);
      order.status = anyReady ? (order.items.some((i) => i.picked > 0) ? "PARTIAL_PICKED" : "READY_FOR_PICKUP") : anyBlocked ? "PAID" : "PAID";
    });
    if (state.pickupLookup && state.pickupLookup.arrivalId === arrival.id) {
      state.pickupLookup = DB.pickupOrders.find((o) => o.id === state.pickupLookup.id) || null;
      state.pickupQtys = {};
    }
  }
  function arrivalResultText(arrival) {
    const hasDiff = arrival.items.some((i) => i.short > 0 || i.damaged > 0);
    return hasDiff
      ? "到货事实已登记。运营还要确认退款订单，受影响数量在确认前不可领取。"
      : "到货事实已登记。正常数量已可领取。";
  }
  function warnBanner(text) {
    state.banner = `<div class="inline-result warn"><b>已登记</b>：${esc(text)}</div>`;
    state.saved = true;
  }
  function resetPointWorkbenchState() {
    state.pointId = "pt1";
    state.pickupLookup = null;
    state.pickupQuery = "";
    state.pickupCode = "";
    state.pickupError = "";
    state.pickupQtys = {};
    state.replayArrivalId = null;
    state.arrivalError = "";
    state.arrivalDrafts = {};
    state.arrivalExceptionForm = null;
  }
  function commitArrival(arrival, items) {
    const fingerprint = arrivalFingerprint(items);
    if (arrival.lastFingerprint && arrival.lastFingerprint === fingerprint) {
      state.replayArrivalId = arrival.id;
      state.arrivalError = "";
      if (arrival.items.some((i) => i.short > 0 || i.damaged > 0)) warnBanner(arrivalResultText(arrival));
      else okBanner(arrivalResultText(arrival));
      return { ok: true, replay: true };
    }
    if (!isArrivalPending(arrival)) {
      state.arrivalError = "该批次已确认到货。";
      return { ok: false };
    }
    const invalid = items.find((i) => i.received + i.short + i.damaged !== i.expected);
    if (invalid) {
      state.arrivalError = `「${invalid.title}」实到、短少、破损之和必须等于应到 ${invalid.expected}。`;
      return { ok: false };
    }
    const needNote = items.find((i) => i.short + i.damaged > 0 && !i.note);
    if (needNote) {
      state.arrivalError = `「${needNote.title}」存在短少或破损时必须填写说明。`;
      return { ok: false };
    }
    const hasDiff = items.some((i) => i.short > 0 || i.damaged > 0);
    arrival.items = items;
    arrival.lastFingerprint = fingerprint;
    arrival.diff = hasDiff
      ? items.filter((i) => i.short + i.damaged > 0).map((i) => `${i.title}${i.short ? "短少 " + i.short : ""}${i.damaged ? "破损 " + i.damaged : ""}`).join("，")
      : "无";
    arrival.status = "CONFIRMED";
    arrival.next = hasDiff ? "确认退款订单" : "无需处理";
    arrival.updatedAt = NOW;
    addLog(arrival, hasDiff ? `到货确认完成，存在异常：${arrival.diff}` : "到货确认完成，实到与系统应到一致");
    delete state.arrivalDrafts[arrival.id];
    applyArrivalToPickups(arrival);
    if (hasDiff) {
      DB.pickupOrders.filter((p) => p.arrivalId === arrival.id && p.items.some((i) => i.blocked > 0)).forEach((p) => {
        if (DB.exceptions.some((e) => e.orderNo === p.orderNo && ["PENDING_CONFIRM", "PENDING_EXECUTE", "EXECUTING"].includes(e.status))) return;
        const o = DB.orders.find((x) => x.orderNo === p.orderNo);
        DB.exceptions.unshift({
          id: "ex-" + Date.now().toString(36) + Math.random().toString(16).slice(2, 5),
          orderNo: p.orderNo,
          point: arrival.point,
          type: items.some((i) => i.damaged > 0) ? "PACKAGE_DAMAGED" : "SHORT_RECEIPT",
          item: arrival.diff,
          amount: o ? o.amount : 0,
          status: "PENDING_CONFIRM",
          note: arrival.diff,
          createdAt: NOW,
          updatedAt: NOW,
        });
      });
    }
    state.replayArrivalId = arrival.id;
    state.arrivalError = "";
    if (hasDiff) warnBanner(arrivalResultText(arrival));
    else okBanner(arrivalResultText(arrival));
    return { ok: true, replay: false };
  }
  function arrivalSkuTable(arrival, readonly) {
    const rows = (arrival.items || []).map((item) => {
      const line = readonly ? arrivalDisplayLine(item) : arrivalDraftLine(arrival, item);
      const diff = line.short > 0 || line.damaged > 0;
      const action = readonly
        ? ""
        : `<td class="col-act"><button class="text-action" data-act="arrival-exception" data-id="${arrival.id}" data-sku="${item.skuId}">登记异常</button></td>`;
      return `<tr${diff ? ` class="arrival-ex-row"` : ""}>
        <td class="col-goods">${esc(item.title)}</td>
        <td class="col-sku">${esc(item.sku)}</td>
        <td class="col-num">${item.expected}</td>
        <td class="col-num">${line.arrived}</td>
        <td class="col-num${line.short ? " is-diff" : ""}">${line.short}</td>
        <td class="col-num${line.damaged ? " is-diff" : ""}">${line.damaged}</td>
        <td class="col-note">${skuLineBadge({ short: line.short, damaged: line.damaged })}</td>
        <td class="col-note">${esc(line.note || "—")}</td>
        ${action}
      </tr>`;
    }).join("");
    return `<div class="table-wrap arrival-sku-wrap"><table class="form-table data-table arrival-sku-table">
      <thead><tr>
        <th class="col-goods">商品</th>
        <th class="col-sku">规格</th>
        <th class="col-num" title="本点该批次已付款且未全额退款的件数合计">系统应到</th>
        <th class="col-num">实到<div class="sub">含破损</div></th>
        <th class="col-num">短少<div class="sub">自动</div></th>
        <th class="col-num">破损<div class="sub">其中</div></th>
        <th class="col-note">行结果</th>
        <th class="col-note">说明</th>
        ${readonly ? "" : `<th class="col-act">操作</th>`}
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="${readonly ? 8 : 9}">暂无商品</td></tr>`}</tbody>
    </table></div>`;
  }
  function pickupOrderCard(order, point) {
    return `<div class="item-card" style="margin-top:14px">
      <div class="panel-head"><div><div class="object">订单 ${esc(order.orderNo)}</div><div class="sub">${esc(order.user)} · ${esc(order.campaign)} · ${esc(point.name)}</div></div>${badge(order.status)}</div>
      <div class="table-wrap" style="margin-top:8px"><div class="table-shell wb-table"><table>
        <thead><tr><th>商品</th><th>到货可领</th><th>已领取</th><th>本次最多</th><th>本次领取</th></tr></thead>
        <tbody>${order.items.map((item) => {
          const max = remainingPickup(item);
          const qty = state.pickupQtys[item.skuId] ?? 0;
          const blocked = item.blocked > 0 || item.pendingArrival;
          const reason = item.blockReason || (item.pendingArrival ? "尚未完成到货确认，确认后才可领取" : "受影响数量暂不可领取");
          return `<tr>
            <td>${esc(item.title)} ${esc(item.sku)}${blocked ? `<div class="sub blocked-note">${esc(reason)}</div>` : ""}</td>
            <td>${item.ready}</td>
            <td>${item.picked}</td>
            <td>${max}</td>
            <td><input class="qty-input" id="pk-${item.skuId}" type="number" min="0" max="${max}" value="${qty}"${max === 0 ? " disabled" : ""}></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div></div>
      ${order.items.some((i) => i.blocked > 0) ? `<div class="inline-result warn">短少或破损数量需运营确认后才能领取，当前不可核销受影响件数。</div>` : ""}
      ${order.items.some((i) => i.pendingArrival) ? `<div class="inline-result warn">该订单对应批次尚未完成到货确认，确认后正常数量才可领取。</div>` : ""}
      ${state.pickupError ? `<div class="inline-result bad">${esc(state.pickupError)}</div>` : ""}
      ${field("6 位取货码", `<input id="pickup-code" placeholder="6 位取货码" maxlength="6" inputmode="numeric" value="${esc(state.pickupCode)}">`, true)}
      <button class="primary" data-act="review-pickup"${order.items.every((i) => remainingPickup(i) === 0) ? " disabled" : ""}>复核并核销</button>
    </div>`;
  }
  function pointSelector() {
    const points = assignedPoints();
    const point = currentPoint();
    if (!points.length) {
      return `<div class="toolbar"><span class="sub">当前账号未授权自提点，请联系超级管理员在员工管理中配置点位授权。</span></div>`;
    }
    if (points.length === 1) {
      return `<div class="toolbar"><label class="wb-label">当前自提点<span class="object">${esc(point.name)}</span><span class="sub">${esc(point.address || "")}</span></label></div>`;
    }
    return `<div class="toolbar">
      <label class="wb-label">当前自提点
        <select data-act="switch-point">${points.map((p) => `<option value="${p.id}"${p.id === point.id ? " selected" : ""}>${esc(p.name)} · ${esc(p.address)}</option>`).join("")}</select>
      </label>
    </div>`;
  }
  function pointArrivalInner(point) {
    const emptyDemo = state.listMode === "empty";
    const pending = emptyDemo ? [] : arrivalsForPoint(point.id).filter((a) => isArrivalPending(a));
    const waiting = emptyDemo ? [] : arrivalsForPoint(point.id).filter((a) => a.status === "CONFIRMED" && DB.exceptions.some((e) => e.status === "PENDING_CONFIRM" && e.point === a.point));
    const replay = !emptyDemo && state.replayArrivalId ? byId("arrivals", state.replayArrivalId) : null;
    const replayHere = !!(replay && replay.pointId === point.id && !isArrivalPending(replay));
    if (emptyDemo) {
      return `<div class="empty wb-empty"><p>暂无待确认到货</p><p class="sub">当前点位批次尚未发车，到货确认在发车后开放。</p></div>`;
    }
    let html = pending.map((a) => `<div class="arrival-block">
        <div class="panel-head"><div><h3>${esc(a.campaign)}</h3><div class="sub">批次 ${esc(a.batch)} · ${esc(a.point)} · 已发车 · ${esc(a.due)}</div></div>${badge(a.status)}</div>
        ${field("现场接收人", `<input id="arr-${a.id}-by" value="周点位">`, true)}
        ${arrivalSkuTable(a, false)}
        ${state.arrivalError ? `<div class="inline-result bad">${esc(state.arrivalError)}</div>` : ""}
        <div class="form-footer" style="margin-top:8px;padding-top:12px"><button class="primary" data-act="submit-arrival" data-id="${a.id}">${esc(arrivalSubmitLabel())}</button></div>
      </div>`).join("");
    html += waiting.map((a) => `<div class="inline-result warn"><b>${esc(a.campaign)} · 批次 ${esc(a.batch)}</b>：${esc(a.diff)}。运营还要确认退款订单，受影响数量暂不可领取。</div>`).join("");
    if (replayHere) {
      html += `<div class="item-card"><div class="object">${esc(replay.campaign)}到货已确认</div>
        ${arrivalSkuTable(replay, true)}
      </div>`;
    }
    if (!pending.length && !waiting.length && !replayHere) {
      html += `<div class="empty wb-empty"><p>暂无待确认到货</p><p class="sub">${esc(emptyArrivalReason(point.id))}</p></div>`;
    }
    return html;
  }
  function pointPickupInner(point) {
    const emptyDemo = state.listMode === "empty";
    const order = emptyDemo ? null : state.pickupLookup;
    if (emptyDemo) {
      return `<div class="empty wb-empty"><p>暂无待核销</p><p class="sub">当前点位还没有可领取数量。未发车或到货未确认的订单不能核销。</p></div>`;
    }
    return `<div class="toolbar" style="margin:0;border:0;padding:0">
        <input id="pickup-no" placeholder="订单号" style="min-width:240px" value="${esc(state.pickupQuery)}">
        <button class="primary" data-act="lookup-pickup">查询订单</button>
      </div>
      <p class="hint">${point.id === "pt1"
        ? "本点可查 HT17888610027177043022D（已到货可领，取货码 482917）、HT17888610027177043010F（随秋日水果团到货，取货码 560128）、HT17888610027177043018A（鲜蛋短少待运营确认）。"
        : "只查当前自提点订单，输入其他点的订单号不会返回。"}</p>
      ${state.pickupError && !order ? `<div class="inline-result bad">${esc(state.pickupError)}</div>` : ""}
      ${order ? pickupOrderCard(order, point) : (emptyPickupReason(point.id) ? `<div class="empty wb-empty" style="margin-top:14px"><p>暂无待核销</p><p class="sub">${esc(emptyPickupReason(point.id))}</p></div>` : "")}`;
  }
  function campaignsForCurrentPoint() {
    const point = currentPoint();
    return DB.campaigns.filter((c) => c.point === point.name);
  }
  function pointCampaignsList() {
    const point = currentPoint();
    const all = newest(campaignsForCurrentPoint());
    const filtered = applyQuery(all, ["title", "status"]);
    const shown = filterRows(filtered);
    const sliced = pageSlice(shown);
    const empty = listOrEmpty(shown, all, "本点暂无团期。运营创建团期并绑定本自提点后会出现在这里。", "没有符合筛选的本点团期。", "");
    const rows = sliced.rows.map((c) => {
      const d = deliveryForCampaign(c);
      const a = arrivalForCampaignAtPoint(c.title, point.name);
      const next = campaignNextStep(c, point.name);
      return {
        id: c.id,
        canHandle: !!next.page,
        handleAct: next.page ? "point-next" : "view",
        handleLabel: next.page ? next.text : "查看",
        handleHint: next.text,
        cells: [
          objectCell(c.title, point.name),
          badge(c.status),
          String(campaignOrderCount(c, point.name)),
          esc(campaignPaidQtyLabel(c, point.name)),
          esc(shipStatusText(d, a)),
          esc(arrivalStatusText(a, d)),
          esc(next.text),
        ],
      };
    });
    return `${headline("本点团期", "", "只看当前自提点已绑定的团期。物流与订单都是本点本团，不进入平台订单管理。")}
      ${state.banner || ""}
      ${pointSelector()}
      ${toolbar("搜索团期名称", [["ALL", "全部状态"], ["DRAFT", "待开始"], ["OPEN", "报名中"], ["LOCKED", "已成团"], ["FULFILLING", "履约中"], ["NOT_FORMED", "未成团"], ["COMPLETED", "已完成"], ["CANCELLED", "已取消"]])}
      ${appliedBar()}
      ${empty || `${table(["团期", "状态", "订单数", "已付 / 成团", "发货/运输状态", "到货状态", "下一步"], rows, "task")}${pager(sliced.total)}`}`;
  }
  function pointCampaignDetail() {
    const c = byId("campaigns", state.id);
    const point = currentPoint();
    if (!c || c.point !== point.name) return emptyBlock("找不到本点的该团期。");
    const d = deliveryForCampaign(c);
    const a = arrivalForCampaignAtPoint(c.title, point.name);
    const next = campaignNextStep(c, point.name);
    const departed = !!(d && (d.status === "IN_TRANSIT" || d.status === "VEHICLE_DISPATCHED" || (a && a.status)));
    return `<div class="detail">${backBtn("point-campaigns")}
      <div class="page-header">
        <div>
          <div class="page-header-title"><h1>${esc(c.title)}</h1>${badge(c.status)}</div>
          <p class="page-header-desc">本点本团 · ${esc(point.name)}</p>
        </div>
        ${next.page ? `<div class="page-header-extra"><button class="primary" data-act="point-next" data-id="${esc(c.id)}">${esc(next.text)}</button></div>` : ""}
      </div>
      ${state.banner || ""}
      ${sheet("本团物流摘要", facts([
        ["车辆", d ? d.vehicle : "未登记"],
        ["是否发车", departed ? "已发车" : "未发车"],
        ["发货/运输", shipStatusText(d, a)],
        ["到货状态", arrivalStatusText(a, d)],
        ["下一步", next.text],
        ["本团本点订单数", String(campaignOrderCount(c, point.name)) + " 单"],
        ["已付件数 / 最小成团件数", campaignPaidQtyLabel(c, point.name)],
      ]))}
      ${campaignOrdersSheet(c.title, point.name, { openOrders: false, sheetTitle: "本团本点订单" })}
    </div>`;
  }
  function pointArrival() {
    const point = currentPoint();
    return `${headline("到货确认", "", "仅当前自提点。对照系统应到与现场实物。短少或破损用「登记异常」，确认到货后本批次不再提交。总部不在此代店确认。")}
      ${state.banner || ""}
      ${pointSelector()}
      <div class="wb-stack">${pointArrivalInner(point)}</div>`;
  }
  function pointPickup() {
    const point = currentPoint();
    return `${headline("领取核销", "", "仅当前自提点。只核销本点已确认到货、仍在领取窗口内的订单，不会列出其他点的单。")}
      ${state.banner || ""}
      ${pointSelector()}
      <section class="panel" style="margin-top:16px">${pointPickupInner(point)}</section>`;
  }
  function openPickupCardFromReceipt(receipt) {
    if (!receipt || !canAccess("point-pickup")) return false;
    if (receipt.pointId !== currentPoint().id) return false;
    const found = pickupOrdersForPoint(currentPoint().id).find((o) => o.orderNo === receipt.orderNo || o.id === receipt.pickupOrderId);
    state.pickupQuery = receipt.orderNo;
    state.pickupLookup = found || null;
    state.pickupCode = "";
    state.pickupError = found ? "" : "未找到该点位的订单。请核对订单号，或确认到货后重试。";
    state.pickupQtys = found
      ? Object.fromEntries(found.items.map((item) => [item.skuId, remainingPickup(item) > 0 ? 1 : 0]))
      : {};
    go("point-pickup");
    return true;
  }
  function pickupRecordsToolbar(windows) {
    const range = state.draft.range || "TODAY";
    return `<div class="toolbar">
      <input data-filter="q" value="${esc(state.draft.q)}" placeholder="搜索订单号或消费者" aria-label="关键字">
      <select data-filter="window" aria-label="领取窗口">
        <option value="ALL"${!state.draft.window || state.draft.window === "ALL" ? " selected" : ""}>全部领取窗口</option>
        ${windows.map((w) => `<option value="${esc(w)}"${state.draft.window === w ? " selected" : ""}>${esc(w)}</option>`).join("")}
      </select>
      <select data-filter="range" aria-label="日期">
        <option value="TODAY"${range === "TODAY" ? " selected" : ""}>今天</option>
        <option value="ALL"${range === "ALL" ? " selected" : ""}>全部日期</option>
      </select>
      <button class="secondary" data-act="time">时间范围</button>
      <button class="primary" data-act="search">查询</button>
      <button class="secondary" data-act="reset">重置</button>
      <span class="push"></span>
    </div>`;
  }
  function pointPickupRecords() {
    if (!canSeePickupRecords()) return unauthorized();
    const point = currentPoint();
    const scoped = pickupReceiptsForPoint(point.id).slice().sort((a, b) => b.at - a.at);
    const windows = [...new Set(scoped.map((r) => r.campaign).filter(Boolean))];
    const queried = applyQuery(scoped, ["orderNo", "user", "title", "operator"]);
    const windowed = (state.applied.window && state.applied.window !== "ALL")
      ? queried.filter((r) => r.campaign === state.applied.window)
      : queried;
    const dated = windowed.filter(receiptInDateScope);
    const shown = filterRows(dated);
    const sliced = pageSlice(shown);
    const hasAny = scoped.length > 0;
    const hasToday = scoped.some((r) => isSameCalendarDay(r.at));
    const filtered = !!(state.applied.q || (state.applied.window && state.applied.window !== "ALL") || state.applied.from || state.applied.to || state.applied.range === "ALL" || state.applied.range === "CUSTOM");
    let empty = null;
    if (state.listMode === "empty" || !shown.length) {
      if (filtered && hasAny) empty = emptyBlock("没有符合筛选的核销记录。", `<button class="secondary" data-act="reset">清空筛选</button>`);
      else if (hasAny && !hasToday) empty = emptyBlock("今天暂无领取核销记录。", `<button class="secondary" data-act="show-all-receipts">查看全部日期</button>`);
      else empty = emptyBlock("本点暂无领取核销记录。");
    }
    const rows = sliced.rows.map((r) => ({
      id: r.id,
      clickView: true,
      cells: [
        fmt(r.at),
        `<span class="mono" title="${esc(r.orderNo)}">${esc(maskOrderNo(r.orderNo))}</span>`,
        esc(r.user),
        objectCell(r.title, r.sku),
        `${r.qty} ${esc(r.unit || "件")}`,
        esc(r.operator),
        `<span class="sub">已核销</span>`,
      ],
    }));
    return `${headline("领取核销记录", "", "只看当前自提点。默认今天；可改领取窗口或时间范围。取货码不展示。")}
      ${state.banner || ""}
      ${pointSelector()}
      ${pickupRecordsToolbar(windows)}
      ${appliedBar()}
      ${empty || `${table(["时间 ↓", "订单号", "消费者", "商品", "本次件数", "核销人", "核销"], rows, "view")}${pager(sliced.total)}`}`;
  }
  function pickupReceiptDetail() {
    if (!canSeePickupRecords()) return unauthorized();
    const r = byId("pickupReceipts", state.id);
    const allowedIds = assignedPoints().map((p) => p.id);
    if (!r || !allowedIds.includes(r.pointId)) return emptyBlock("找不到该核销记录。");
    const point = DB.points.find((p) => p.id === r.pointId);
    const openCard = isPointOnly() && r.pointId === currentPoint().id
      ? `<section class="action-panel safe"><div><b>同单核销卡</b><div class="sub">仍按订单号查询本点核销卡，不进入订单管理。</div></div><button class="primary" data-act="open-pickup-card" data-id="${esc(r.id)}">打开核销卡</button></section>`
      : "";
    return `<div class="detail">${backBtn("point-pickup-records")}
      <div class="detail-head"><div><h1>领取核销记录</h1><div class="sub">${esc(maskOrderNo(r.orderNo))} · ${esc(r.user)}</div></div><span class="badge green">已核销</span></div>
      ${sheet("核销事实", facts([
        ["时间", fmt(r.at)],
        ["订单号", `<span class="mono">${esc(r.orderNo)}</span>`],
        ["消费者", esc(r.user)],
        ["商品", `${esc(r.title)} <span class="sub">${esc(r.sku)}</span>`],
        ["本次件数", `${r.qty} ${esc(r.unit || "件")}`],
        ["核销人", esc(r.operator)],
        ["自提点", esc((point && point.name) || currentPoint().name)],
        ["领取窗口", esc(r.campaign || "—")],
      ]))}
      <p class="hint source-note">本页只证明已核销。取货码不展示。</p>
      ${openCard}
    </div>`;
  }

  function noteForm(title, back, backTitle, labelText, act) {
    return `<div class="detail form">${backBtn(back)}
      <div class="detail-head"><div><h1>${esc(title)}</h1></div></div>
      <section class="panel">${field(labelText, `<textarea id="note-field"></textarea>`, true)}</section>
      <div class="form-footer"><button class="secondary" data-page="${back}">取消</button><button class="primary" data-act="${act}">继续复核</button></div>
    </div>`;
  }

  function LIST() {
    return {
      workbench, products: productsList, categories: categoriesList, campaigns: campaignsList, orders: ordersList,
      delivery: deliveryList, arrivals: arrivalsList, exceptions: exceptionsList, overdue: overdueList,
      "refund-confirm": exceptionsList,
      areas: areasList, points: pointsList, consumers: consumersList, quality: qualityList,
      cancellations: cancellationsList, notifications: notificationsList, interests: interestsList,
      "finance-todo": financeTodoList, "finance-refunds": financeRefundsList, "finance-ledger": financeLedgerList,
      audit: auditList, staff: staffList, permissions: permissionsList, "point-arrival": pointArrival, "point-pickup": pointPickup,
      "point-pickup-records": pointPickupRecords, "point-campaigns": pointCampaignsList,
    }[state.page];
  }
  function DETAIL() {
    return {
      products: productDetail, categories: categoryDetail, campaigns: campaignDetail, orders: orderDetail,
      delivery: deliveryDetail, arrivals: arrivalDetail, exceptions: exceptionDetail, overdue: overdueDetail,
      "refund-confirm": exceptionDetail,
      areas: areaDetail, points: pointDetail, consumers: consumerDetail, quality: qualityDetail,
      cancellations: cancellationDetail, notifications: notificationDetail, interests: interestDetail,
      "finance-todo": financeHandle, "finance-refunds": refundRecordDetail, "finance-ledger": ledgerDetail,
      audit: auditDetail, staff: staffDetail, "point-pickup-records": pickupReceiptDetail,
      "point-campaigns": pointCampaignDetail,
    }[state.page];
  }
  function FORM() {
    const map = {
      products: productForm, categories: categoryForm, campaigns: () => (state.formKind === "postpone" ? postponeForm() : campaignForm()),
      delivery: vehicleForm, arrivals: arrivalForm, areas: areaForm, points: pointForm, staff: staffForm,
      quality: () => noteForm("填写处理说明", "quality", "品质售后", "处理说明", "q-confirm"),
      cancellations: () => noteForm("填写审核理由", "cancellations", "取消申请", "审核理由", "ca-confirm"),
      notifications: () => formWrap("填写人工处理说明", "notifications", "通知人工处理", `
        ${field("处理说明", `<textarea></textarea>`, true)}
        ${field("渠道", `<select><option>微信客服</option><option>外部 CRM</option><option>其他已批准渠道</option></select>`, true)}
        ${field("外部引用号", `<input>`, true)}
        ${field("结果", `<select><option>已联系到</option><option>用户已知晓</option><option>已解决</option></select>`, true)}
      `),
      interests: () => noteForm("填写处理说明", "interests", "区域开通意向", "处理说明", "save-form"),
      overdue: () => noteForm(state.formKind === "extend" ? "确认一次延期领取" : state.formKind === "loss" ? "确认登记逾期报损" : "确认登记逾期退款", "overdue", "逾期未领", "处理原因", "save-form"),
    };
    return map[state.page];
  }

  function mainContent() {
    if (!pageAllowed(state.page) && state.page !== "change-password") return unauthorized();
    if (state.page === "change-password") return changePasswordPage();
    if (state.page === "workbench" || state.page === "point-arrival" || state.page === "point-pickup") {
      if (state.listMode === "loading") return `<div class="skeleton"><div class="sk-row"></div><div class="sk-row"></div></div>`;
      if (state.listMode === "error") return `<div class="state-card solid"><h2>数据加载失败</h2><button class="primary" data-act="retry">重试</button></div>`;
    }
    if (state.view === "form") {
      const fn = FORM();
      return fn ? fn() : emptyBlock("该页没有表单。");
    }
    if (state.view === "detail" || state.view === "handle") {
      const fn = DETAIL();
      return fn ? fn() : emptyBlock("该页没有详情。");
    }
    if ((state.listMode === "loading" || state.listMode === "error") && state.view === "list") {
      const title = findNav(state.page).title || "页面";
      return `${headline(title)}${listStates(() => "")}`;
    }
    const fn = LIST();
    return fn ? fn() : emptyBlock("页面未实现。");
  }

  let modalReturnFocus = null;
  function render() {
    capturePointDraft();
    const oldDialog = root.querySelector(".modal");
    const focused = document.activeElement;
    const focusKey = focusDescriptor(focused);
    const opening = !!state.modal && !oldDialog;
    if (opening) modalReturnFocus = focusKey;
    if (!state.session) {
      root.innerHTML = loginPage();
      enhanceAccessibility(opening, !!oldDialog, focusKey);
      return;
    }
    if (state.page === "password-setup") {
      root.innerHTML = passwordSetupPage();
      enhanceAccessibility(opening, !!oldDialog, focusKey);
      return;
    }
    if (state.page === "login") {
      go(DEFAULT_PAGE[state.role] || "workbench");
      return;
    }
    root.innerHTML = shell(mainContent());
    root.querySelectorAll("input[data-indeterminate]").forEach((el) => { el.indeterminate = true; });
    enhanceAccessibility(opening, !!oldDialog, focusKey);
    syncPointSave();
  }

  function flyoutHtml() {
    if (!state.flyout || !state.sidebarCollapsed || window.innerWidth <= 767) return "";
    const g = visibleNav().find((item) => item.key === state.flyout);
    return g ? `<section id="nav-flyout" class="nav-flyout" aria-label="${esc(g.label)}"><strong>${esc(g.label)}</strong>${g.items.map((i) => `<button data-page="${i.key}"${state.page === i.key ? ' aria-current="page"' : ""}>${esc(i.label)}</button>`).join("")}</section>` : "";
  }
  function focusDescriptor(el) {
    if (!el || el === document.body) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    for (const attr of ["data-act", "data-group-toggle", "data-page"]) if (el.hasAttribute?.(attr)) return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]` + (el.dataset.id ? `[data-id="${CSS.escape(el.dataset.id)}"]` : "");
    return null;
  }
  function enhanceAccessibility(opening, hadDialog, focusKey) {
    root.querySelectorAll("label:not([for])").forEach((label, i) => {
      if (label.querySelector("input,select,textarea")) return;
      const control = label.parentElement.querySelector("input,select,textarea");
      if (!control) return;
      if (!control.id) control.id = "label-control-" + i;
      label.htmlFor = control.id;
    });
    root.querySelectorAll(".form-table tr").forEach((row) => { const name = row.querySelector("th")?.textContent; row.querySelectorAll("input,select,textarea").forEach((el) => { if (name && !el.labels?.length) el.setAttribute("aria-label", name); }); });
    root.querySelectorAll("input,select,textarea").forEach((el) => { if (!el.labels?.length && !el.getAttribute("aria-label")) el.setAttribute("aria-label", el.placeholder || el.title || (el.dataset.act === "page-size" ? "每页条数" : el.type === "checkbox" ? "选择此项" : "筛选条件")); });
    root.querySelectorAll(".inline-result,.state-card").forEach((el) => { el.setAttribute("role", el.classList.contains("bad") ? "alert" : "status"); el.setAttribute("aria-live", el.classList.contains("bad") ? "assertive" : "polite"); });
    root.querySelectorAll(".table-wrap,.arrival-sku-wrap").forEach((el) => { el.tabIndex = 0; el.setAttribute("role", "region"); el.setAttribute("aria-label", "数据表格，可左右滚动查看所有列和操作"); });
    const dialog = root.querySelector(".modal");
    const main = root.querySelector("main"); if (main) main.inert = !!dialog || state.mobileNav;
    const aside = root.querySelector("aside"); if (aside) aside.inert = !!dialog || (window.innerWidth <= 767 && !state.mobileNav);
    const flyout = root.querySelector("#nav-flyout");
    if (flyout) { const anchor = root.querySelector(`[data-group-toggle="${state.flyout}"]`); const rect = anchor.getBoundingClientRect(); flyout.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - flyout.offsetHeight - 8)) + "px"; flyout.style.left = rect.right + 6 + "px"; }
    if (opening && dialog) (dialog.querySelector("input,textarea,select") || dialog).focus();
    else if (hadDialog && !dialog) { const target = modalReturnFocus && root.querySelector(modalReturnFocus); (target || root.querySelector("h1, [data-act=refresh]"))?.focus(); modalReturnFocus = null; }
    else if (focusKey) root.querySelector(focusKey)?.focus();
  }
  root.addEventListener("keydown", (e) => {
    const trap = root.querySelector(".modal") || (state.mobileNav ? root.querySelector("aside") : root.querySelector("#nav-flyout"));
    if (e.key === "Escape") {
      if (state.modal) { state.modal = null; state.arrivalExceptionForm = null; render(); }
      else if (state.mobileNav) { state.mobileNav = false; render(); root.querySelector('[data-act="open-nav"]')?.focus(); }
      else if (state.flyout) { const key = state.flyout; state.flyout = null; render(); root.querySelector(`[data-group-toggle="${key}"]`)?.focus(); }
      return;
    }
    if (e.key === "Enter" && e.target.id === "pt-query") { e.preventDefault(); handleLocation("location-search", e.target); return; }
    if (!trap || e.key !== "Tab") return;
    const items = [...trap.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter((el) => el.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) { e.preventDefault(); first.focus(); }
  });
  document.addEventListener("click", (e) => { if (state.flyout && !e.target.closest("#nav-flyout,[data-group-toggle]")) { state.flyout = null; render(); } });
  let compactViewport = window.innerWidth <= 1023;
  window.addEventListener("resize", () => { const compact = window.innerWidth <= 1023; if (compact !== compactViewport) { state.sidebarCollapsed = compact; compactViewport = compact; } if (window.innerWidth > 767) state.mobileNav = false; state.flyout = null; render(); });

  function showModal(cfg) {
    state.modal = cfg;
    render();
  }
  function okBanner(text) {
    state.banner = `<div class="inline-result"><b>已保存</b>：${esc(text)}</div>`;
    state.saved = true;
  }

  function eventEl(e) {
    const t = e.target;
    if (t && typeof t.closest === "function") return t;
    return t && t.parentElement ? t.parentElement : null;
  }

  function doLogin() {
    const user = (document.getElementById("login-user")?.value || "").trim();
    const pass = document.getElementById("login-pass")?.value || "";
    const role = document.getElementById("login-role")?.value || state.role;
    state.role = role;
    state.loginUser = user;
    state.loginError = "";
    if (!user || !pass) {
      state.loginError = "请输入账号和密码";
      return render();
    }
    state.session = true;
    resetPointWorkbenchState();
    go(DEFAULT_PAGE[state.role] || "workbench");
  }

  root.addEventListener("submit", (e) => {
    if (e.target && e.target.id === "login-form") {
      e.preventDefault();
      doLogin();
    }
  });

  root.addEventListener("click", (e) => {
    const target = eventEl(e);
    if (!target) return;
    const g = target.closest(".group-toggle");
    if (g && !g.dataset.page) {
      if (state.sidebarCollapsed && window.innerWidth > 767) {
        state.flyout = state.flyout === g.dataset.groupToggle ? null : g.dataset.groupToggle;
        render();
        root.querySelector(state.flyout ? "#nav-flyout button" : `[data-group-toggle="${g.dataset.groupToggle}"]`)?.focus();
        return;
      }
      const box = g.closest(".nav-group");
      const key = box.dataset.group;
      state.openGroups[key] = !isGroupOpen(key);
      render();
      return;
    }
    const actEl = target.closest("[data-act]");
    const pageEl = target.closest("[data-page]");
    if (pageEl && !actEl) {
      const page = pageEl.dataset.page;
      if (page === "change-password") return go("change-password", "form");
      go(page);
      return;
    }
    if (!actEl) return;
    const act = actEl.dataset.act;
    const id = actEl.dataset.id;
    if (act.startsWith("location-")) { handleLocation(act, actEl); return; }
    if (act === "open-nav" || act === "close-nav") { state.mobileNav = act === "open-nav"; render(); root.querySelector(state.mobileNav ? "aside button" : '[data-act="open-nav"]')?.focus(); return; }
    if (act === "backdrop") {
      if (e.target === actEl) { state.modal = null; state.arrivalExceptionForm = null; render(); }
      return;
    }
    if (act === "close-modal") {
      state.modal = null;
      state.arrivalExceptionForm = null;
      render();
      return;
    }
    if (act === "account") { state.accountOpen = !state.accountOpen; render(); return; }
    if (act === "collapse-nav") { if (window.innerWidth <= 767) state.mobileNav = false; else state.sidebarCollapsed = !state.sidebarCollapsed; state.flyout = null; render(); return; }
    if (act === "config-perms") {
      openPermEditor(id);
      return;
    }
    if (act === "logout") { state.session = false; state.page = "login"; location.hash = "#/login"; render(); return; }
    if (act === "refresh") { state.banner = `<div class="inline-result">已刷新 · ${fmt(NOW)}</div>`; render(); return; }
    if (act === "retry") { state.listMode = "data"; render(); return; }
    if (act === "forgot") {
      showModal({ title: "密码重置说明", body: "<p>当前页面不能自助找回密码，请联系超级管理员重置临时密码后再登录。</p>", confirm: "返回登录", hideCancel: true });
      return;
    }
    if (act === "preview-setup") {
      state.session = true;
      state.loginError = "";
      state.page = "password-setup";
      if (location.hash !== "#/password-setup") location.hash = "#/password-setup";
      else render();
      return;
    }
    if (act === "back-login") {
      state.session = false;
      state.page = "login";
      state.loginError = "";
      if (location.hash !== "#/login") location.hash = "#/login";
      else render();
      return;
    }
    if (act === "save-setup") {
      const a = document.getElementById("np1")?.value || "";
      const b = document.getElementById("np2")?.value || "";
      if (a.length < 8) { state.loginError = "密码长度为 8–128 位"; render(); return; }
      if (a !== b) { state.loginError = "两次输入的密码不一致"; render(); return; }
      state.page = DEFAULT_PAGE[state.role];
      state.view = "list";
      go(state.page);
      return;
    }
    if (act === "search") {
      state.applied = { ...state.draft };
      state.pageNum = 1;
      render();
      return;
    }
    if (act === "reset") {
      state.draft = { q: "", status: "ALL", from: "", to: "", window: "ALL", range: "TODAY", campaign: "", deal: "ALL" };
      state.applied = {};
      state.pageNum = 1;
      render();
      return;
    }
    if (act === "clear-chip") {
      const chip = actEl.dataset.chip;
      if (chip === "q") { state.applied.q = ""; state.draft.q = ""; }
      if (chip === "status") { state.applied.status = "ALL"; state.draft.status = "ALL"; }
      if (chip === "from") { state.applied.from = ""; state.draft.from = ""; }
      if (chip === "to") { state.applied.to = ""; state.draft.to = ""; }
      if (chip === "window") { state.applied.window = "ALL"; state.draft.window = "ALL"; }
      if (chip === "campaign") { state.applied.campaign = ""; state.draft.campaign = ""; }
      if (chip === "deal") { state.applied.deal = "ALL"; state.draft.deal = "ALL"; }
      if (chip === "range") {
        state.applied.range = "TODAY";
        state.draft.range = "TODAY";
        state.applied.from = "";
        state.applied.to = "";
        state.draft.from = "";
        state.draft.to = "";
      }
      state.pageNum = 1;
      render();
      return;
    }
    if (act === "time") {
      showModal({
        title: "时间范围",
        body: `<div class="form-grid">${field("开始", `<input id="tf" type="date">`)}${field("结束", `<input id="tt" type="date">`)}</div>`,
        confirm: "应用",
        onOk: () => {
          state.draft.from = document.getElementById("tf")?.value || "";
          state.draft.to = document.getElementById("tt")?.value || "";
          if (state.draft.from || state.draft.to) state.draft.range = "CUSTOM";
        },
      });
      return;
    }
    if (act === "page") {
      const to = Number(actEl.dataset.to);
      if (to >= 1) { state.pageNum = to; render(); }
      return;
    }
    if (act === "view") {
      if (state.page === "consumers") {
        const u = byId("consumers", id);
        if (u && canSeeFullConsumerPhone() && boundPhone(u.phone)) {
          addLog(u, `查看完整手机号 ${u.phone}`);
        }
      }
      go(state.page, "detail", id);
      return;
    }
    if (act === "edit") { state.formKind = "edit"; go(state.page, "form", id, { formKind: "edit" }); return; }
    if (act === "handle") { go(state.page, "detail", id); return; }
    if (act === "open-order") { go("orders", "detail", id); return; }
    if (act === "campaign-orders") {
      const title = actEl.dataset.title || (byId("campaigns", id) || {}).title;
      if (!title || !hasRole("OPERATOR", "SUPER_ADMIN", "CUSTOMER_SERVICE", "FINANCE")) return;
      go("orders", "list", null, {
        applied: { campaign: title },
        draft: { q: "", status: "ALL", from: "", to: "", window: "ALL", range: "TODAY", campaign: title },
      });
      return;
    }
    if (act === "point-next") {
      if (!canAccess("point-campaigns")) return;
      const c = byId("campaigns", id);
      const next = campaignNextStep(c, currentPoint().name);
      if (next.page && pageAllowed(next.page)) go(next.page);
      else if (c) go("point-campaigns", "detail", c.id);
      return;
    }
    if (act === "open-arrival") { go("arrivals", "detail", id); return; }
    if (act === "open-quality") { go("quality", "detail", id); return; }
    if (act === "create") { state.formKind = "create"; go(state.page, "form", "new", { formKind: "create" }); return; }
    if (act === "save-form") {
      if (state.page === "points") {
        const saved = savePointForm();
        if (!saved.ok) {
          state.banner = `<div class="inline-result bad">${esc(saved.error)}</div>`;
          render();
          return;
        }
        okBanner(saved.created ? "自提点已保存，点位负责人已关联" : "自提点已更新");
        go("points", "detail", saved.id);
        return;
      }
      if (state.page === "campaigns" && state.formKind === "postpone") {
        const saved = savePostponeForm();
        if (!saved.ok) {
          state.banner = `<div class="inline-result bad">${esc(saved.error)}</div>`;
          render();
          return;
        }
        okBanner("顺延已保存，截单与到货时间已更新，团期已重新开售");
        go("campaigns", "detail", saved.id);
        return;
      }
      if (state.page === "overdue") {
        const rec = byId("overdue", state.id);
        if (rec) rec.status = state.formKind === "extend" ? "EXTENDED" : state.formKind === "loss" ? "LOSS_RECORDED" : "REFUND_PENDING";
        const o = rec ? DB.orders.find((x) => x.orderNo === rec.orderNo) : null;
        if (o) {
          o.status = rec.status;
          addLog(o, "逾期处理（旧表单入口）已同步到订单");
        }
      }
      if (state.page === "interests") {
        const i = byId("interests", state.id);
        if (i) i.status = i.status === "NEW" ? "CONTACTED" : "CLOSED";
      }
      if (state.page === "notifications") {
        const n = byId("notifications", state.id);
        if (n) n.status = "MANUAL_COMPLETED";
      }
      if (state.page === "delivery") {
        const d = byId("deliveries", state.id);
        if (d && d.status === "SITE_CONFIRMED") { d.status = "VEHICLE_BOOKED"; d.vehicle = "冀F·8A21K"; }
      }
      if (state.page === "arrivals") {
        const a = byId("arrivals", state.id);
        if (a) {
          const receivedBy = (document.getElementById(`arr-${a.id}-by`)?.value || "").trim();
          if (receivedBy.length < 2) {
            state.arrivalError = "请填写现场接收人。";
            render();
            return;
          }
          const result = commitArrival(a, itemsFromArrivalDraft(a));
          if (!result.ok) {
            render();
            return;
          }
          go("arrivals", "detail", a.id);
          return;
        }
      }
      okBanner(findNav(state.page).title + "已更新。");
      if (state.page === "campaigns" && state.formKind !== "postpone") {
        showModal({
          title: state.formKind === "edit" ? "保存草稿前复核" : "创建前发布复核",
          body: "<p>一团一自提点。保存后仍是草稿，开售前需再次复核截单时间与商品。</p>",
          confirm: "确认保存",
          onOk: () => { go(state.page, "list"); },
        });
        state.modal.onOk = () => { state.banner = `<div class="inline-result"><b>已保存</b>：草稿已更新，开售前请再次复核。</div>`; go(state.page, "list"); };
        return;
      }
      go(state.page, state.id && state.id !== "new" ? "detail" : "list", state.id === "new" ? null : state.id);
      return;
    }
    if (act === "toggle-product") {
      const p = byId("products", state.id);
      showModal({
        title: p.status === "ACTIVE" ? "确认停用商品？" : "确认启用商品？",
        body: `<p>${p.status === "ACTIVE" ? "停用后公共目录不再展示，历史订单快照保留。" : "启用后可再次出现在公共目录。"}</p>`,
        confirm: "确认",
        danger: p.status === "ACTIVE",
        onOk: () => { p.status = p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"; okBanner(p.status === "INACTIVE" ? "商品已停用，公共目录不再展示" : "商品已重新启用"); render(); },
      });
      return;
    }
    if (act === "open-campaign") {
      const c = byId("campaigns", state.id);
      showModal({
        title: "开售前二次确认",
        body: `<p>确认开售「${esc(c.title)}」？截单时间为 ${fmt(c.cutoff)}。截单时间已过则不能开售。</p>`,
        confirm: "确认开售",
        onOk: () => { c.status = "OPEN"; addLog(c, "开售"); okBanner("团期已开售"); render(); },
      });
      return;
    }
    if (act === "close-campaign") {
      const c = byId("campaigns", state.id);
      const paidQty = campaignPaidQty(c);
      const minQty = campaignMinQty(c);
      const fail = campaignFailAction(c);
      const reached = paidQty >= minQty;
      const willPostpone = !reached && fail === "POSTPONE" && !c.postponedOnce;
      const outcome = reached
        ? "截单后将锁定成团，未支付订单关闭。"
        : (willPostpone ? "已付件数未达最小成团，截单后进入顺延。" : "已付件数未达最小成团，截单后将取消并为已付款订单退款。");
      showModal({
        title: "截单前二次确认",
        body: `<p>当前已付 ${paidQty} 件，最小成团 ${minQty} 件。${outcome}</p>`,
        confirm: "确认截单",
        onOk: () => {
          if (paidQty >= minQty) {
            c.status = "LOCKED";
            closeUnpaidOnLock(c);
            addLog(c, `截单成团，已付 ${paidQty} 件 / 门槛 ${minQty}，未支付订单关闭`);
            okBanner("团期已截单锁定，库存和订单状态已更新");
          } else if (willPostpone) {
            c.status = "NOT_FORMED";
            addLog(c, `未成团（已付 ${paidQty} / 门槛 ${minQty}），可顺延一次`);
            okBanner("未达最小成团件数，团期记为未成团。可顺延一次，不会自动进入已取消。");
          } else {
            applyCampaignCancelRefund(c, `未成团（已付 ${paidQty} / 门槛 ${minQty}）`, "取消团期");
            okBanner("未达最小成团件数，团期已取消，已付款订单已进入退款义务");
          }
          render();
        },
      });
      return;
    }
    if (act === "cancel-campaign") {
      const c = byId("campaigns", state.id);
      const impact = campaignImpactHtml(c);
      showModal({
        title: "取消团期前二次确认",
        body: `<div class="impact">${esc(impact)}</div>${field("取消原因", `<textarea id="cancel-reason"></textarea>`, true)}`,
        confirm: "确认取消",
        danger: true,
        onOk: () => {
          const reason = document.getElementById("cancel-reason")?.value.trim() || "";
          if (reason.length < 2) {
            showModal({
              title: "取消团期前二次确认",
              body: `<div class="inline-result bad">请填写取消原因（至少 2 个字符）</div><div class="impact">${esc(impact)}</div>${field("取消原因", `<textarea id="cancel-reason"></textarea>`, true)}`,
              confirm: "确认取消",
              danger: true,
              onOk: state.modal.onOk,
            });
            return;
          }
          applyCampaignCancelRefund(c, reason, "取消团期");
          okBanner("团期已取消，待付款订单已释放，已付款订单已进入退款义务");
          render();
        },
      });
      return;
    }
    if (act === "delete-draft") {
      showModal({
        title: "删除草稿团期",
        body: "<p>仅允许删除没有订单或运输履约记录的草稿。删除后不能恢复，审计记录保留。</p>",
        confirm: "确认删除",
        danger: true,
        onOk: () => { DB.campaigns = DB.campaigns.filter((x) => x.id !== state.id); go("campaigns"); },
      });
      return;
    }
    if (act === "postpone") { state.formKind = "postpone"; go("campaigns", "form", state.id, { formKind: "postpone" }); return; }
    if (act === "labels") {
      const c = byId("campaigns", state.id);
      const body = c ? labels(c) : "";
      if (!body) {
        showModal({
          title: "没有可装袋订单",
          body: "<p>当前团期没有已支付且未取消的订单，不能生成装袋标签。</p>",
          confirm: "知道了",
          hideCancel: true,
        });
        return;
      }
      showModal({
        title: "装袋标签",
        wide: true,
        body,
        confirm: "关闭",
        hideCancel: true,
      });
      return;
    }
    if (act === "vehicle") {
      const { c, d } = resolveFulfillmentTarget(id || state.id);
      if (!d) {
        showModal({ title: "无法登记运输", body: "<p>该团期还没有可发车批次。请先截单并完成装袋。</p>", confirm: "知道了", hideCancel: true });
        return;
      }
      showFormDialog({
        title: d.vehicle === "未登记" ? "登记运输信息" : "编辑运输信息",
        confirm: "确认保存",
        cancel: "取消",
        body: () => modalFacts([
          ["团期", esc(d.campaign)],
          ["自提点", esc(d.point)],
          ["物流平台", `<input id="veh-platform" value="县域货运">`, true],
          ["车牌 / 运单号", `<input id="veh-no" value="${esc(d.vehicle === "未登记" ? "" : d.vehicle)}" placeholder="例如 冀F·8A21K">`, true],
          ["司机电话", `<input id="veh-phone" placeholder="选填">`],
          ["处理说明", `<textarea id="task-reason" placeholder="可选补充">已核对装袋件数</textarea>`],
        ]) + `<p class="hint source-note">运输信息记在团期上，在发货管理处理，不另建配送档案。</p>`,
        submit: () => {
          const no = (document.getElementById("veh-no")?.value || "").trim();
          if (no.length < 3) return { error: "请填写车牌或运单号" };
          d.vehicle = no;
          d.status = "VEHICLE_BOOKED";
          d.next = "创建批次并发车";
          d.owner = actorName();
          d.updatedAt = NOW;
          if (c) {
            addLog(c, `登记运输信息 ${no}`);
            c.updatedAt = NOW;
          }
          addLog(d, `登记运输信息 ${no}`);
          okBanner(state.page === "delivery" ? "运输信息已保存，可创建批次并发车" : "运输信息已保存，可在发货管理或团期详情发车");
          return { ok: true };
        },
      });
      return;
    }
    if (act === "dispatch") {
      const { c, d } = resolveFulfillmentTarget(id || state.id);
      const title = c ? c.title : d && d.campaign;
      const paid = campaignPaidOrders({ title }).length;
      showFormDialog({
        title: "发车前复核",
        confirm: "确认发车",
        cancel: "取消",
        body: () => modalFacts([
          ["团期", esc(c ? c.title : d.campaign)],
          ["自提点", esc(c ? c.point : d.point)],
          ["车辆", esc(d ? d.vehicle : "未登记")],
          ["待发货订单", String(paid) + " 笔（已付款且未关闭）"],
          ["处理说明", `<textarea id="task-reason" rows="3">已核对应发件数</textarea>`, true],
        ]) + `<div class="impact">发车后创建到货批次。若没有可发货订单，请先到订单列表核实。</div>`,
        submit: () => {
          const reason = readReason();
          if (reason.length < 2) return { error: "请填写处理说明（至少 2 个字符）" };
          if (d) {
            d.status = "DISPATCHED";
            d.vehicle = d.vehicle === "未登记" ? "冀F·8A21K" : d.vehicle;
            d.next = "等待点位确认到货";
            d.updatedAt = NOW;
            addLog(d, "创建批次并发车：" + reason);
          }
          if (c) {
            c.status = "FULFILLING";
            addLog(c, "发车：" + reason);
          }
          const created = ensureDispatchArrival(c, d);
          okBanner(created.created
            ? `批次 ${created.arrival.batch} 已发车，点位可在「到货确认」对照实物`
            : "已发车。该团本点已有到货批次，未重复创建。");
          if (state.page === "delivery" && d) {
            state.view = "detail";
            state.id = d.id;
          }
          return { ok: true };
        },
      });
      return;
    }
    if (act === "confirm-arrival") { state.formKind = "confirm"; go("arrivals", "form", state.id, { formKind: "confirm" }); return; }
    if (act === "emergency-arrival") { state.formKind = "emergency"; go("arrivals", "form", state.id, { formKind: "emergency" }); return; }
    if (act === "confirm-alloc") {
      const a = byId("arrivals", state.id);
      const affected = DB.pickupOrders.filter((p) => p.arrivalId === a.id && p.items.some((i) => i.blocked > 0));
      showFormDialog({
        title: "确认退款订单",
        confirm: "确认进入退款",
        body: () => modalFacts([
          ["批次", esc(a.batch + " · " + a.campaign)],
          ["自提点", esc(a.point)],
          ["到货结果", esc(a.diff)],
          ["退款订单", affected.length ? affected.map((p) => p.orderNo).join("、") : "按到货确认结果匹配已付款未退款订单"],
          ["处理说明", `<textarea id="task-reason" rows="3">按实到短少确认退款</textarea>`, true],
        ]) + `<p class="hint source-note">短少件数来自本批次到货确认，不是另行开异常单。</p><div class="impact">确认后短少或破损订单进入财务待执行退款，点位侧不再改写实到数量。</div>`,
        submit: () => {
          const reason = readReason();
          if (reason.length < 2) return { error: "请填写处理说明（至少 2 个字符）" };
          a.status = "CONFIRMED";
          a.next = "无需处理";
          addLog(a, "确认退款订单：" + reason);
          affected.forEach((p) => {
            const o = DB.orders.find((x) => x.orderNo === p.orderNo);
            if (o) {
              o.status = "REFUND_PENDING";
              addLog(o, `到货短少已确认，进入退款义务：${reason}`);
            }
            enqueueFinanceTodo({ source: "到货异常", orderNo: p.orderNo, amount: o ? o.amount : 3780, status: "REFUND_CONFIRMED", kind: "ex" });
          });
          if (!affected.length) enqueueFinanceTodo({ source: "到货异常", orderNo: "HT17888610027177043018A", amount: 3780, status: "REFUND_CONFIRMED", kind: "ex" });
          okBanner("退款订单已确认，退款义务已交给财务");
          return { ok: true };
        },
      });
      return;
    }
    if (act === "extend" || act === "overdue-refund" || act === "overdue-loss") {
      const rec = byId("overdue", state.id);
      const o = byId("orders", state.id) || (rec ? DB.orders.find((x) => x.orderNo === rec.orderNo) : null);
      if (!o) {
        showModal({ title: "找不到订单", body: "<p>该逾期事项没有对应订单，不能处理。</p>", confirm: "返回", hideCancel: true });
        return;
      }
      const spec = {
        extend: {
          title: "一次延期",
          confirm: "确认延期",
          impact: "每个领取窗口仅允许一次延期。确认后订单变为「已延期」，领取截止顺延 1 个自然日。",
          source: "领取截止 = 到货确认日后第 3 个自然日 23:59:59。本单截止来自对应点位到货确认记录。",
          apply: (reason) => {
            o.status = "EXTENDED";
            o.deadline = NOW + 24 * 3600 * 1000;
            addLog(o, "一次延期：" + reason);
            if (rec) rec.status = "EXTENDED";
            okBanner("已记录一次延期，操作人与时间已写入操作记录");
          },
        },
        "overdue-refund": {
          title: "登记逾期退款",
          confirm: "确认登记退款",
          impact: "登记后生成退款义务，由财务执行；本页不再改写支付结果。",
          source: `退款金额 = 支付快照 ${money(o.amount)} − 已退 ¥0.00。`,
          apply: (reason) => {
            o.status = "REFUND_PENDING";
            addLog(o, `登记逾期退款 ${money(o.amount)}：${reason}`);
            if (rec) rec.status = "REFUND_PENDING";
            enqueueFinanceTodo({ source: "逾期未领", orderNo: o.orderNo, amount: o.amount, status: "REFUND_PENDING", kind: "overdue" });
            okBanner("已登记退款义务，等待财务执行");
          },
        },
        "overdue-loss": {
          title: "登记逾期报损",
          confirm: "确认报损",
          danger: true,
          impact: "报损后不再退款，未领件数按损耗入账。该操作不可恢复为退款。",
          source: `报损对象为本单未领取件数，来自领取核销进度（${esc(o.pickup || "未领")}）。`,
          apply: (reason) => {
            o.status = "LOSS_RECORDED";
            addLog(o, "登记逾期报损：" + reason);
            if (rec) rec.status = "LOSS_RECORDED";
            okBanner("已登记报损，不再进入退款");
          },
        },
      }[act];
      showFormDialog({
        title: spec.title,
        confirm: spec.confirm,
        danger: spec.danger,
        body: () => modalFacts([
          ["订单号", `<span class="mono">${esc(o.orderNo)}</span>`],
          ["消费者 / 点位", `${esc(o.user)} · ${esc(o.point || "")}`],
          ["领取截止", fmt(o.deadline)],
          ["当前状态", label(o.status)],
          ["订单金额", money(o.amount)],
          ["处理原因", `<textarea id="task-reason" rows="3" placeholder="请填写原因，至少 2 个字"></textarea>`, true],
        ]) + `<p class="hint source-note">数据来源：${esc(spec.source)}</p><div class="impact">${esc(spec.impact)}</div>`,
        submit: () => {
          const reason = readReason();
          if (reason.length < 2) return { error: "请填写处理原因（至少 2 个字符）" };
          spec.apply(reason);
          return { ok: true };
        },
      });
      return;
    }
    if (act === "toggle-area") {
      const a = byId("areas", state.id);
      showModal({
        title: a.orderEnabled ? "确认暂停区域接单？" : "确认恢复接单？",
        body: `<p>${a.orderEnabled ? "暂停只影响后续新团期，进行中的团期和未完成订单不受影响。" : "恢复后新团期可以继续使用该区域。"}</p>`,
        confirm: a.orderEnabled ? "确认暂停" : "确认开启",
        danger: a.orderEnabled,
        onOk: () => { a.orderEnabled = !a.orderEnabled; okBanner(a.orderEnabled ? "区域已开启接单" : "区域已暂停接单"); render(); },
      });
      return;
    }
    if (act === "toggle-point") {
      const p = byId("points", state.id);
      p.status = p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      okBanner(p.status === "ACTIVE" ? "自提点已启用" : "自提点已停用");
      render();
      return;
    }
    if (act === "toggle-cat") {
      const c = byId("categories", state.id);
      c.status = c.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      okBanner(c.status === "ACTIVE" ? "分类已启用" : "分类已停用");
      render();
      return;
    }
    if (act === "delete-cat") {
      showModal({
        title: "删除分类",
        body: "<p>确定删除该分类吗？已被商品引用的分类无法删除。</p>",
        confirm: "确认删除",
        danger: true,
        onOk: () => { DB.categories = DB.categories.filter((x) => x.id !== state.id); go("categories"); },
      });
      return;
    }
    if (act === "q-accept" || act === "q-approve" || act === "q-reject") {
      const q = byId("quality", state.id);
      const spec = {
        "q-accept": { title: "受理售后工单", confirm: "确认受理", next: "ACCEPTED", field: "accept" },
        "q-approve": { title: "批准退款", confirm: "确认批准", next: "REFUNDING", field: "decide" },
        "q-reject": { title: "拒绝售后", confirm: "确认拒绝", danger: true, next: "REJECTED", field: "decide" },
      }[act];
      showFormDialog({
        title: spec.title,
        confirm: spec.confirm,
        danger: spec.danger,
        body: () => modalFacts([
          ["订单号", `<span class="mono">${esc(q.orderNo)}</span>`],
          ["消费者", esc(q.user)],
          ["申报内容", esc(q.item)],
          ["处理说明", `<textarea id="task-reason" rows="3"></textarea>`, true],
        ]) + `<p class="hint source-note">数据来源：用户提交的售后工单，客服/运营只填写处理说明。</p>`,
        submit: () => {
          const reason = readReason();
          if (reason.length < 2) return { error: "请填写处理说明（至少 2 个字符）" };
          q.status = spec.next;
          q[spec.field] = reason;
          addLog(q, spec.title + "：" + reason);
          if (spec.next === "REFUNDING") {
            enqueueFinanceTodo({ source: "品质售后", orderNo: q.orderNo, amount: 1890, status: "REFUNDING", kind: "quality" });
          }
          okBanner("售后工单已更新，处理人与时间已写入记录");
          return { ok: true };
        },
      });
      return;
    }
    if (act === "q-confirm") {
      go("quality", "detail", state.id);
      return;
    }
    if (act === "ca-approve" || act === "ca-reject") {
      const c = byId("cancellations", state.id);
      if (c && c.phase === "BEFORE_CUTOFF") {
        showModal({ title: "无需审核", body: "<p>截单前取消已自动退款，不能批准或拒绝。</p>", confirm: "知道了", hideCancel: true });
        return;
      }
      const approve = act === "ca-approve";
      showFormDialog({
        title: approve ? "批准截单后取消" : "拒绝截单后取消",
        confirm: approve ? "确认批准" : "确认拒绝",
        danger: !approve,
        body: () => modalFacts([
          ["订单号", `<span class="mono">${esc(c.orderNo)}</span>`],
          ["消费者", esc(c.user)],
          ["申请原因", esc(c.reason)],
          ["审核理由", `<textarea id="task-reason" rows="3"></textarea>`, true],
        ]) + `<p class="hint source-note">申请来自用户截单后取消，不是运营新建。</p><div class="impact">${approve ? "批准后由财务执行退款。" : "拒绝后订单继续履约。"}</div>`,
        submit: () => {
          const reason = readReason();
          if (reason.length < 2) return { error: "请填写审核理由（至少 2 个字符）" };
          c.status = approve ? "APPROVED_WAITING_FINANCE" : "REJECTED";
          addLog(c, (approve ? "批准取消：" : "拒绝取消：") + reason);
          if (approve) {
            const o = DB.orders.find((x) => x.orderNo === c.orderNo);
            if (o) {
              o.status = "REFUND_PENDING";
              addLog(o, "截单后取消已批准，进入退款义务");
            }
            enqueueFinanceTodo({ source: "截单后取消", orderNo: c.orderNo, amount: o ? o.amount : 990, status: "APPROVED_WAITING_FINANCE", kind: "cancel" });
          }
          okBanner("取消申请已更新");
          return { ok: true };
        },
      });
      return;
    }
    if (act === "ca-confirm") {
      go("cancellations", "detail", state.id);
      return;
    }
    if (act === "n-retry") {
      showModal({
        title: "二次确认系统重试",
        body: "<p>将重新进入既有系统投递流程，不展示或新增消费者联系方式。</p>",
        confirm: "确认重新投递",
        onOk: () => { okBanner("通知已重新进入系统重试队列"); render(); },
      });
      return;
    }
    if (act === "n-complete") {
      const n = byId("notifications", state.id);
      showFormDialog({
        title: "人工完成通知",
        confirm: "确认完成",
        body: () => modalFacts([
          ["通知类型", esc(label(n.type))],
          ["订单号", `<span class="mono">${esc(n.orderNo)}</span>`],
          ["失败原因", esc(n.error)],
          ["处理说明", `<textarea id="task-reason" rows="3"></textarea>`, true],
          ["渠道", `<select id="n-channel"><option>微信客服</option><option>外部 CRM</option><option>其他已批准渠道</option></select>`, true],
          ["外部引用号", `<input id="n-ref" placeholder="渠道回执号">`, true],
        ]) + `<p class="hint source-note">系统未采集手机号。只记录已通过既有合规渠道处理的结果。</p>`,
        submit: () => {
          const reason = readReason();
          const ref = (document.getElementById("n-ref")?.value || "").trim();
          if (reason.length < 2) return { error: "请填写处理说明（至少 2 个字符）" };
          if (!ref) return { error: "请填写外部引用号" };
          n.status = "MANUAL_COMPLETED";
          addLog(n, `人工完成（${document.getElementById("n-channel")?.value || ""} / ${ref}）：${reason}`);
          okBanner("通知已人工完成，处理人与渠道回执已留痕");
          return { ok: true };
        },
      });
      return;
    }
    if (act === "interest-next") {
      const i = byId("interests", state.id);
      const next = i.status === "NEW" ? "CONTACTED" : "CLOSED";
      showFormDialog({
        title: next === "CONTACTED" ? "登记已联系" : "关闭意向",
        confirm: "确认",
        body: () => modalFacts([
          ["区域", esc(i.region)],
          ["联系人", esc(i.contact)],
          ["处理说明", `<textarea id="task-reason" rows="3">${esc(i.note || "")}</textarea>`, true],
        ]),
        submit: () => {
          const reason = readReason();
          if (reason.length < 2) return { error: "请填写处理说明（至少 2 个字符）" };
          i.status = next;
          i.note = reason;
          addLog(i, (next === "CONTACTED" ? "已联系：" : "关闭意向：") + reason);
          okBanner("意向已更新");
          return { ok: true };
        },
      });
      return;
    }
    if (["hold-refund", "exec-refund"].includes(act) && !hasRole("FINANCE", "SUPER_ADMIN")) return;
    if (act === "hold-refund") {
      const r = byId("financeTodos", state.id);
      if (!r) return;
      if (r.status === "FAILED_HOLD") {
        okBanner("该退款已挂起，不可再次自动提交");
        render();
        return;
      }
      showFormDialog({
        title: "转入人工挂起",
        confirm: "确认挂起",
        body: () => modalFacts([
          ["订单", `<span class="mono">${esc(r.orderNo)}</span>`],
          ["金额", money(r.amount)],
          ["当前状态", label(r.status)],
          ["处理说明", `<textarea id="task-reason" rows="3">渠道失败或结果不明，转入人工核验</textarea>`, true],
        ]) + `<div class="impact">挂起后不可再次自动提交支付渠道。</div>`,
        submit: () => {
          const reason = readReason();
          if (reason.length < 2) return { error: "请填写处理说明（至少 2 个字符）" };
          r.status = "FAILED_HOLD";
          addLog(r, "转入人工挂起：" + reason);
          const rec = DB.refunds.find((x) => x.orderNo === r.orderNo && ["FAILED", "SUBMISSION_UNKNOWN", "FAILED_HOLD"].includes(x.status));
          if (rec) rec.status = "FAILED_HOLD";
          else {
            DB.refunds.unshift({
              id: "rf-" + Date.now(),
              no: "RF-" + new Date(NOW).toISOString().slice(0, 10).replace(/-/g, "") + "-" + String(DB.refunds.length + 30).padStart(3, "0"),
              orderNo: r.orderNo,
              amount: r.amount,
              status: "FAILED_HOLD",
              createdAt: NOW,
            });
          }
          okBanner("退款已挂起，不可再次自动提交");
          return { ok: true };
        },
      });
      return;
    }
    if (act === "exec-refund") {
      const r = byId("financeTodos", state.id);
      if (r && (r.status === "FAILED_HOLD" || r.status === "MANUAL_HOLD" || r.status === "SUCCEEDED" || r.status === "REFUNDED")) {
        showModal({
          title: "不能自动提交",
          body: `<p>${r.status === "FAILED_HOLD" || r.status === "MANUAL_HOLD" ? "该退款已挂起，等待人工处理微信支付结果，不可再次自动提交。" : "该退款已执行完成。"}</p>`,
          confirm: "知道了",
          hideCancel: true,
        });
        return;
      }
      if (r && (r.status === "FAILED" || r.status === "SUBMISSION_UNKNOWN")) {
        showModal({
          title: "不能再次自动提交",
          body: "<p>渠道已失败或结果不明，请转入人工挂起，不要再次自动提交。</p>",
          confirm: "知道了",
          hideCancel: true,
        });
        return;
      }
      showFormDialog({
        title: "二次确认执行退款",
        confirm: "确认执行退款",
        body: () => modalFacts([
          ["来源", esc(r ? r.source : "退款义务")],
          ["订单", `<span class="mono">${esc(r ? r.orderNo : "")}</span>`],
          ["金额", r ? money(r.amount) : "—"],
          ["处理说明", `<textarea id="task-reason" rows="3">按已批准结果提交支付渠道</textarea>`, true],
        ]) + `<div class="impact">提交后金额与账本分录将按已批准结果执行，可能进入核验中或人工挂起。</div>`,
        submit: () => {
          const reason = readReason();
          if (reason.length < 2) return { error: "请填写处理说明（至少 2 个字符）" };
          if (r) {
            const outcome = r.demoOutcome === "FAILED" ? "FAILED" : (r.demoOutcome === "SUBMISSION_UNKNOWN" ? "SUBMISSION_UNKNOWN" : "SUCCEEDED");
            r.status = outcome;
            addLog(r, (outcome === "SUCCEEDED" ? "执行退款：" : outcome === "FAILED" ? "渠道返回失败：" : "渠道结果不明：") + reason);
            DB.refunds.unshift({
              id: "rf-" + Date.now(),
              no: "RF-" + new Date(NOW).toISOString().slice(0, 10).replace(/-/g, "") + "-" + String(DB.refunds.length + 30).padStart(3, "0"),
              orderNo: r.orderNo,
              amount: r.amount,
              status: outcome === "SUCCEEDED" ? "SUCCEEDED" : outcome,
              createdAt: NOW,
            });
            const o = DB.orders.find((x) => x.orderNo === r.orderNo);
            if (outcome === "SUCCEEDED" && o && ["REFUND_PENDING", "REFUNDING"].includes(o.status)) {
              o.status = "REFUNDED";
              addLog(o, "财务已执行退款：" + reason);
            }
            if (outcome !== "SUCCEEDED") {
              okBanner(outcome === "FAILED" ? "渠道返回失败，请转入人工挂起，不要再次自动提交" : "渠道结果不明，请转入人工挂起，不要再次自动提交");
              return { ok: true };
            }
          }
          okBanner("退款已提交，系统正在同步退款与账本状态");
          return { ok: true };
        },
      });
      return;
    }
    if (act === "suspend-staff" || act === "restore-staff" || act === "reset-staff") {
      const s = byId("staff", state.id);
      showModal({
        title: act === "reset-staff" ? "重置密码" : act === "suspend-staff" ? "确认停用员工" : "确认恢复员工",
        body: `${field("原因", `<textarea id="staff-reason"></textarea>`, true)}`,
        confirm: "确认",
        danger: act === "suspend-staff",
        onOk: () => {
          if (act === "suspend-staff") s.status = "SUSPENDED";
          if (act === "restore-staff") s.status = "ACTIVE";
          if (act === "reset-staff") {
            showModal({
              title: "临时密码（仅显示一次）",
              body: `<p>请立即转交给员工并提醒登录后改密。</p><div class="item-card"><b>Xw-7kP2nQ9dL</b></div>`,
              confirm: "已记下",
              hideCancel: true,
            });
            return;
          }
          okBanner(act === "suspend-staff" ? "员工已停用" : "员工已恢复");
          render();
        },
      });
      return;
    }
    if (act === "arrival-exception") {
      const arrival = byId("arrivals", id);
      const item = arrival?.items.find((i) => i.skuId === actEl.dataset.sku);
      if (!arrival || !item || !isArrivalPending(arrival)) return;
      openArrivalException(arrival, item);
      return;
    }
    if (act === "submit-arrival") {
      if (!canAccess("point-arrival")) return;
      const arrival = byId("arrivals", id);
      if (!arrival || arrival.pointId !== currentPoint().id) {
        state.arrivalError = "只能确认当前授权点位的已发车批次。";
        render();
        return;
      }
      const receivedBy = (document.getElementById(`arr-${arrival.id}-by`)?.value || "").trim();
      if (receivedBy.length < 2) {
        state.arrivalError = "请填写现场接收人。";
        render();
        return;
      }
      commitArrival(arrival, itemsFromArrivalDraft(arrival));
      render();
      return;
    }
    if (act === "replay-arrival") {
      if (!canAccess("point-arrival")) return;
      const arrival = byId("arrivals", id);
      if (!arrival || arrival.pointId !== currentPoint().id) return;
      commitArrival(arrival, arrival.items.map((item) => ({ ...item })));
      render();
      return;
    }
    if (act === "lookup-pickup") {
      if (!canAccess("point-pickup")) return;
      const q = (document.getElementById("pickup-no")?.value || "").trim();
      state.pickupQuery = q;
      state.pickupCode = document.getElementById("pickup-code")?.value || "";
      state.pickupQtys = {};
      state.pickupError = "";
      if (!q) {
        state.pickupLookup = null;
        state.pickupError = "请输入订单号。";
        render();
        return;
      }
      const found = pickupOrdersForPoint(currentPoint().id).find((o) => o.orderNo === q || o.orderNo.includes(q));
      if (!found) {
        state.pickupLookup = null;
        state.pickupError = "未找到该点位的订单。请核对订单号，或确认到货后重试。";
        render();
        return;
      }
      state.pickupLookup = found;
      state.pickupQtys = Object.fromEntries(found.items.map((item) => [item.skuId, remainingPickup(item) > 0 ? 1 : 0]));
      render();
      return;
    }
    if (act === "review-pickup") {
      const order = state.pickupLookup;
      if (!order || !canAccess("point-pickup")) return;
      if (order.pointId !== currentPoint().id) {
        state.pickupError = "该订单不属于当前点位。";
        render();
        return;
      }
      state.pickupCode = (document.getElementById("pickup-code")?.value || "").trim();
      const lines = [];
      const qtys = {};
      order.items.forEach((item) => {
        const max = remainingPickup(item);
        const qty = Math.max(0, Math.min(max, numVal(`pk-${item.skuId}`, 0)));
        qtys[item.skuId] = qty;
        if (qty > 0) lines.push({ item, qty });
      });
      state.pickupQtys = qtys;
      if (!lines.length) {
        state.pickupError = "请至少填写一项大于 0 的本次领取数量。";
        render();
        return;
      }
      if (!/^\d{6}$/.test(state.pickupCode)) {
        state.pickupError = "请输入 6 位数字取货码。";
        render();
        return;
      }
      if (state.pickupCode !== order.code) {
        state.pickupError = "取货码不正确，请核对 6 位数字取货码。";
        render();
        return;
      }
      state.pickupError = "";
      const summary = lines.map((line) => `${line.item.title} × ${line.qty}`).join("，");
      showModal({
        title: "本次领取复核",
        body: `<p>${esc(summary)}。提交后不可撤回本次核销数量。</p>`,
        confirm: "确认核销",
        onOk: () => {
          lines.forEach(({ item, qty }) => { item.picked += qty; });
          order.status = order.items.some((item) => remainingPickup(item) > 0) ? "READY_FOR_PICKUP" : "COMPLETED";
          recordPickupReceipts(order, lines);
          state.pickupQtys = Object.fromEntries(order.items.map((item) => [item.skuId, remainingPickup(item) > 0 ? 1 : 0]));
          state.pickupCode = "";
          okBanner(order.status === "COMPLETED" ? "本次领取已核销，订单已完成" : "本次领取已核销");
          render();
        },
      });
      return;
    }
    if (act === "open-pickup-card") {
      const receipt = byId("pickupReceipts", id);
      if (!openPickupCardFromReceipt(receipt)) {
        state.banner = `<div class="inline-result bad">只能打开当前自提点的核销卡。</div>`;
        render();
      }
      return;
    }
    if (act === "show-all-receipts") {
      state.draft.range = "ALL";
      state.applied = { ...state.applied, range: "ALL", from: "", to: "" };
      state.pageNum = 1;
      render();
      return;
    }
    if (act === "point-arrival") { return; }
    if (act === "modal-ok") {
      const fn = state.modal?.onOk;
      state.modal = null;
      if (fn) fn();
      if (!fn) render();
      else if (state.modal === null && state.session) render();
    }
  });

  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id?.startsWith("pt-")) { handlePointInput(el); return; }
    if (el.dataset.act === "role") {
      state.role = el.value;
      resetPointWorkbenchState();
      const next = DEFAULT_PAGE[state.role];
      if (!pageAllowed(state.page)) go(next);
      else render();
      return;
    }
    if (el.dataset.act === "staff-role") {
      const wrap = root.querySelector(".staff-points-field");
      if (wrap) wrap.classList.toggle("hidden", el.value !== "PICKUP_MANAGER");
      return;
    }
    if (el.dataset.act === "perm-group") {
      const g = NAV.find((x) => x.key === el.dataset.group);
      if (!g || state.permRole === "SUPER_ADMIN") return;
      const keys = groupMenuKeys(g);
      setPermDraft(el.checked ? [...state.permDraft, ...keys] : state.permDraft.filter((k) => !keys.includes(k)));
      render();
      return;
    }
    if (el.dataset.act === "perm-item") {
      if (state.permRole === "SUPER_ADMIN") return;
      const key = el.dataset.key;
      setPermDraft(el.checked ? [...state.permDraft, key] : state.permDraft.filter((k) => k !== key));
      render();
      return;
    }
    if (el.dataset.act === "switch-point") {
      state.pointId = el.value;
      state.pickupLookup = null;
      state.pickupQuery = "";
      state.pickupCode = "";
      state.pickupError = "";
      state.pickupQtys = {};
      state.arrivalError = "";
      state.banner = null;
      if (state.page === "point-campaigns" && state.view === "detail") {
        const c = byId("campaigns", state.id);
        if (!c || c.point !== currentPoint().name) {
          state.view = "list";
          state.id = null;
        }
      }
      render();
      return;
    }
    if (el.dataset.act === "list-mode") { state.listMode = el.value; render(); return; }
    if (el.dataset.act === "page-size") {
      state.pageSize = Number(String(el.value).split(" ")[0]);
      state.pageNum = 1;
      render();
      return;
    }
    if (el.dataset.filter) {
      state.draft[el.dataset.filter] = el.value;
      if (el.dataset.filter === "range" && el.value !== "CUSTOM") {
        state.draft.from = "";
        state.draft.to = "";
      }
    }
  });

  root.addEventListener("input", (e) => {
    const el = e.target;
    if (!el || !el.id) return;
    if (el.id.startsWith("pt-") && el.tagName !== "SELECT") { handlePointInput(el); return; }
    if (el.id === "arr-ex-arrived" || el.id === "arr-ex-damaged" || el.id === "arr-ex-note") {
      syncArrivalExceptionMath();
    }
  });

  window.addEventListener("hashchange", () => {
    const raw = location.hash.replace(/^#\/?/, "");
    const parts = raw.split("/").filter(Boolean);
    const page = parts[0] || "";
    if (!state.session) {
      state.page = "login";
      render();
      return;
    }
    if (!page || page === "login") {
      go(DEFAULT_PAGE[state.role] || "workbench");
      return;
    }
    if (page === "password-setup") {
      state.page = "password-setup";
      render();
      return;
    }
    if (page === "point-workbench" || page === "exceptions" || page === "overdue") {
      const route = normalizeRoute(page, parts[1] || "list", parts[2] || null);
      go(route.page, route.view, route.id, route.extra);
      return;
    }
    state.page = page;
    state.view = parts[1] || "list";
    state.id = parts[2] || null;
    if (state.view === "form" && !state.formKind) state.formKind = state.id === "new" ? "create" : "edit";
    render();
  });

  state.page = "login";
  if (location.hash !== "#/login") location.hash = "#/login";
  render();
})();
