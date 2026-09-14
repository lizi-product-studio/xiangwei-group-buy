const IMG = {
  hero: "assets/xiangwei-hero-field.png",
  pickup: "assets/xiangwei-pickup-point.png",
  potato: "assets/xiangwei-potato.png",
  corn: "assets/xiangwei-corn.png",
  greens: "assets/xiangwei-greens.png",
  tomato: "assets/xiangwei-tomato.png",
};

const ICONS = {
  pin: '<path d="M12 21s7-7.4 7-12.2A7 7 0 1 0 5 8.8C5 13.6 12 21 12 21z"/><circle cx="12" cy="9" r="2.4"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  message: '<path d="M4 6.5h16v10.2H8.2L4 20V6.5z"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.2 6.8l3 3"/>',
  headset: '<path d="M5 13.5v-2a7 7 0 0 1 14 0v2"/><rect x="3.2" y="12.2" width="3.8" height="6.4" rx="1.8"/><rect x="17" y="12.2" width="3.8" height="6.4" rx="1.8"/><path d="M20.8 18.6v.8a2.8 2.8 0 0 1-2.8 2.8H16"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.25c-.7.4-1.1 1-1.1 1.75V14"/><path d="M12 17.2h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.2V17"/><path d="M12 7.6h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8.2a4 4 0 0 1 8 0V11"/>',
  nav: '<path d="M4.2 11.2l15.6-7.2-7.2 15.6-1.8-6.6-6.6-1.8z"/>',
  phone: '<path d="M7.2 3.6h3l1.4 3.8-2.1 1.2a12.6 12.6 0 0 0 5.9 5.9l1.2-2.1 3.8 1.4v3c0 1.1-1.1 2.6-3.1 2.6C8.6 19.4 4.6 12.6 4.6 6.7c0-2 .9-3.1 2.6-3.1z"/>',
  wallet: '<rect x="3" y="6" width="18" height="13.2" rx="2"/><path d="M3 10h18"/><circle cx="16.4" cy="14.4" r="1.1"/>',
  qr: '<path d="M4 4h6.2v6.2H4zM13.8 4H20v6.2h-6.2zM4 13.8h6.2V20H4z"/><path d="M13.8 13.8h2.6v2.6h-2.6zM17.8 13.8H20v2.6h-2.2zM13.8 17.8h2.6V20h-2.6zM17.8 17.8H20V20h-2.2z"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.2 7V5.2h5.6V7"/><path d="M7.2 7l1 12.2h7.6l1-12.2"/>',
  shop: '<path d="M4 10.2L12 4l8 6.2V20H4z"/><path d="M10 20v-6h4v6"/>',
  cart: '<circle cx="9" cy="19.4" r="1.15"/><circle cx="17.2" cy="19.4" r="1.15"/><path d="M3.4 4.4h2.2l2.1 10.6h10.4L20.6 8H7"/>',
  orders: '<path d="M8 4h8l1.8 2.8H6.2L8 4z"/><rect x="5.2" y="6.8" width="13.6" height="13.2" rx="1.8"/><path d="M9 12.2h6M9 16h4.2"/>',
  user: '<circle cx="12" cy="8.2" r="3.3"/><path d="M5.2 19.6c1.4-3.3 3.8-4.8 6.8-4.8s5.4 1.5 6.8 4.8"/>',
  clipboard: '<rect x="6" y="5" width="12" height="15" rx="2"/><path d="M9 5.2V4.4h6v.8"/><path d="M9 11h6M9 14.5h4"/>',
};

function icon(name, size) {
  const inner = ICONS[name];
  if (!inner) return "";
  const s = size || 18;
  return `<svg class="icon" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function btn({ go, kind, iconName, label, grow }) {
  const kinds = {
    primary: "btn",
    outline: "btn btn--outline",
    soft: "btn btn--soft",
    text: "btn btn--text",
  };
  const cls = [kinds[kind] || "btn", grow ? `btn--${grow}` : ""].filter(Boolean).join(" ");
  return `<button class="${cls}" type="button"${go ? ` data-go="${go}"` : ""}>${iconName ? icon(iconName) : ""}${label}</button>`;
}

const PRODUCTS = [
  { id: "potato", origin: "坝上", title: "黄心土豆", spec: "约 3 斤 / 份", price: "9.90", sold: 15, img: IMG.potato },
  { id: "corn", origin: "鲜食", title: "鲜玉米", spec: "4 根 / 份", price: "12.80", sold: 18, img: IMG.corn },
  { id: "greens", origin: "时令", title: "小青菜", spec: "250g / 份", price: "6.90", sold: 22, img: IMG.greens },
  { id: "tomato", origin: "园采", title: "自然熟番茄", spec: "约 500g / 份", price: "8.60", sold: 11, img: IMG.tomato },
];

const GROUPS = [
  {
    name: "逛团",
    items: [
      { id: "home-empty", label: "未选点", tab: "home", title: "乡味集" },
      { id: "pickup", label: "选自提点", title: "选择固定自提点", back: "home-empty" },
      { id: "home", label: "本期团购", tab: "home", title: "乡味集" },
      { id: "campaign", label: "商品详情", title: "商品详情", back: "home" },
    ],
  },
  {
    name: "购买",
    items: [
      { id: "cart-empty", label: "空购物车", tab: "cart", title: "购物车" },
      { id: "cart", label: "购物车", tab: "cart", title: "购物车" },
      { id: "checkout", label: "确认结算", title: "确认订单", back: "cart" },
      { id: "pay-ok", label: "支付成功", title: "支付结果", back: "order-wait" },
    ],
  },
  {
    name: "订单状态",
    items: [
      { id: "orders", label: "订单列表", tab: "orders", title: "订单" },
      { id: "order-pay", label: "待付款", title: "订单详情", back: "orders" },
      { id: "order-wait", label: "等待成团", title: "订单详情", back: "orders" },
      { id: "order-formed", label: "已成团", title: "订单详情", back: "orders" },
      { id: "order-transit", label: "送往自提点", title: "订单详情", back: "orders" },
      { id: "order-pick", label: "待领取", title: "订单详情", back: "orders" },
      { id: "order-done", label: "已完成", title: "订单详情", back: "orders" },
      { id: "order-unformed", label: "未成团", title: "订单详情", back: "orders" },
      { id: "order-review", label: "取消审核中", title: "订单详情", back: "orders" },
      { id: "order-cancel", label: "已取消", title: "订单详情", back: "orders" },
      { id: "order-refund", label: "退款中", title: "订单详情", back: "orders" },
      { id: "order-fail", label: "退款失败", title: "订单详情", back: "orders" },
      { id: "order-overdue", label: "逾期未领", title: "订单详情", back: "orders" },
    ],
  },
  {
    name: "领取与售后",
    items: [
      { id: "code", label: "取货码", title: "取货码", back: "order-pick" },
      { id: "after-sale", label: "申请售后", title: "申请售后", back: "order-pick" },
      { id: "after-progress", label: "售后进度", title: "订单详情", back: "orders" },
    ],
  },
  {
    name: "我的",
    items: [
      { id: "profile-guest", label: "我的·未登录", tab: "mine", title: "我的" },
      { id: "profile", label: "我的·已登录", tab: "mine", title: "我的" },
      { id: "login", label: "登录", title: "登录", back: "profile-guest" },
      { id: "messages", label: "订单消息", title: "订单消息", back: "profile" },
      { id: "messages-empty", label: "消息空态", title: "订单消息", back: "profile" },
      { id: "interest", label: "开通意向", title: "开通意向", back: "profile" },
      { id: "help", label: "帮助", title: "帮助", back: "profile" },
      { id: "legal", label: "隐私与协议", title: "隐私与协议", back: "profile" },
      { id: "about", label: "关于", title: "关于", back: "profile" },
    ],
  },
];

const SCREENS = GROUPS.flatMap((group) => group.items);
const initialScreen = new URLSearchParams(location.search).get("screen");
const state = {
  screen: SCREENS.some((item) => item.id === initialScreen) ? initialScreen : "home",
  sku: "potato",
  loggedIn: false, consent: false, returnTo: "profile", loginBack: "profile-guest",
  legalBack: "profile", legalTab: "terms", pickupBack: "home", point: "happy", region: "central",
  orderFilter: "全部", scenario: "success", pageState: "ready", busy: false, pending: null,
  requestVersion: 0, cancelUnpaid: false, error: "", reminder: "accept", reminders: 0, reminderRefused: false,
  afterSubmitted: false, afterSku: "potato",
  after: { selected: true, quantity: 1, reason: "品质问题", detail: "" },
  interest: { area: "", name: "", phone: "" }, interestSubmitted: false,
  quantity: 1, cart: { potato: 1, corn: 1 },

};

// Every fixture and request in this file is local to this prototype.
const POINTS = [
  { id: "happy", region: "central", name: "幸福路台站点", address: "幸福路 12 号小区门口", hours: "07:00–20:00", contact: "周姐" },
  { id: "east", region: "east", name: "车站东点", address: "东站广场商铺 3 号", hours: "08:00–19:00", contact: "李师傅" },
];
function currentPoint() { return POINTS.find(p => p.id === state.point) || POINTS[0]; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function isPrivate(screen) { return /^(order|after-|code$|messages|checkout$|pay-ok$|interest$)/.test(screen); }
let feedbackTimer;
function feedback(message) { clearTimeout(feedbackTimer); $("feedback").textContent = message; $("feedback").hidden = false; feedbackTimer = setTimeout(() => { $("feedback").hidden = true; }, 5000); }
function errorHtml() { return state.error ? `<p class="form-error" role="alert">${escapeHtml(state.error)}</p>` : ""; }
function pointText(html) {
  // Existing order fixtures retain the point snapshot of their original order.
  if (state.screen === "pickup" || (isPrivate(state.screen) && state.screen !== "checkout")) return html;
  const p = currentPoint();
  return html.replaceAll("幸福路台站点", p.name).replaceAll("幸福路 12 号小区门口", p.address).replaceAll("07:00–20:00", p.hours).replaceAll("点位负责人 周姐", `点位负责人 ${p.contact}`);
}

const TIMELINES = {
  pay: [
    { label: "待付款", hint: "请在 30 分钟内完成支付", state: "on" },
    { label: "等待成团", hint: "支付后计入成团进度", state: "todo" },
    { label: "待领取", hint: "到货后凭码领取", state: "todo" },
    { label: "已完成", hint: "在自提点领取完成", state: "todo" },
  ],
  wait: [
    { label: "已支付", hint: "款项已收到", state: "done" },
    { label: "等待成团", hint: "本团还差件数，截单前可退", state: "on" },
    { label: "待领取", hint: "成团到货后凭码领取", state: "todo" },
    { label: "已完成", hint: "在自提点领取完成", state: "todo" },
  ],
  formed: [
    { label: "已支付", hint: "款项已收到", state: "done" },
    { label: "已成团备货", hint: "仓库按已付件数装袋", state: "on" },
    { label: "待领取", hint: "到货后凭码领取", state: "todo" },
    { label: "已完成", hint: "在自提点领取完成", state: "todo" },
  ],
  transit: [
    { label: "已支付", hint: "款项已收到", state: "done" },
    { label: "送往自提点", hint: "商品已发车，正在途中", state: "on" },
    { label: "待领取", hint: "点位确认到货后可领", state: "todo" },
    { label: "已完成", hint: "在自提点领取完成", state: "todo" },
  ],
  pick: [
    { label: "已支付", hint: "款项已收到", state: "done" },
    { label: "已到店", hint: "点位已确认到货", state: "done" },
    { label: "待领取", hint: "可分次凭码领取", state: "on" },
    { label: "已完成", hint: "领完即完成", state: "todo" },
  ],
  done: [
    { label: "已支付", hint: "款项已收到", state: "done" },
    { label: "已成团备货", hint: "已按件数备货到店", state: "done" },
    { label: "待领取", hint: "已到店领取", state: "done" },
    { label: "已完成", hint: "本单已全部领取", state: "done" },
  ],
  unformed: [
    { label: "已支付", hint: "款项已收到", state: "done" },
    { label: "未成团", hint: "截单件数未达最少成团", state: "on" },
    { label: "退款中", hint: "将按规则原路退回", state: "todo" },
  ],
  review: [
    { label: "已支付", hint: "款项已收到", state: "done" },
    { label: "取消审核中", hint: "已过截单，等待运营决定", state: "on" },
    { label: "待结果", hint: "通过则退款，未通过继续履约", state: "todo" },
  ],
  cancel: [
    { label: "已支付", hint: "原订单已关闭", state: "done" },
    { label: "已取消", hint: "不再履约领取", state: "on" },
    { label: "退款中", hint: "款项原路退回", state: "todo" },
  ],
  refund: [
    { label: "已支付", hint: "受影响件数进入退款", state: "done" },
    { label: "退款中", hint: "财务正在提交微信退款", state: "on" },
    { label: "到账", hint: "以微信通知为准", state: "todo" },
  ],
  fail: [
    { label: "已支付", hint: "短少件数原应退款", state: "done" },
    { label: "退款失败", hint: "微信退款失败，已转人工", state: "on" },
    { label: "客服处理", hint: "请联系客服查询，勿重复申请", state: "todo" },
  ],
  overdue: [
    { label: "已支付", hint: "款项已收到", state: "done" },
    { label: "待领取", hint: "领取窗口已过", state: "done" },
    { label: "逾期未领", hint: "未领件数进入退款或报损", state: "on" },
  ],
  after: [
    { label: "已领取", hint: "商品已在自提点领取", state: "done" },
    { label: "售后受理", hint: "客服已收到申报", state: "done" },
    { label: "等待决定", hint: "运营通过后由财务退款", state: "on" },
  ],
};

function $(id) {
  return document.getElementById(id);
}

function meta() {
  return SCREENS.find((item) => item.id === state.screen);
}

function product() {
  return PRODUCTS.find((item) => item.id === state.sku) || PRODUCTS[0];
}

function locBar(name, note) {
  return `
    <button class="loc" type="button" data-go="pickup">
      <span class="loc__label">当前固定自提点</span>
      <span class="loc__name">${name}</span>
      <span class="loc__note">${note}</span>
    </button>`;
}

function card(item) {
  return `
    <button class="card" type="button" data-go="campaign" data-sku="${item.id}">
      <div class="card__media"><img src="${item.img}" alt="${item.title}" /><span class="card__tag">${item.origin}</span></div>
      <div class="card__body">
        <div class="card__title">${item.title}</div>
        <span class="card__desc">${item.spec}</span>
        <span class="card__time">截单今晚 21:00 · 预计周六到货</span>
        <div class="card__foot">
          <div><span class="price"><small>¥</small>${item.price}</span><span class="price-note">团购价</span></div>
          <span class="ghost-cta">去看看</span>
        </div>
      </div>
    </button>`;
}

function timeline(kind) {
  const items = TIMELINES[kind];
  if (!items) return "";
  return `<ol class="timeline">${items
    .map((item) => {
      const cls = item.state === "done" ? "is-done" : item.state === "on" ? "is-on" : "";
      return `<li class="${cls}"><i class="timeline__dot"></i><div class="timeline__body"><strong>${item.label}</strong><p>${item.hint}</p></div></li>`;
    })
    .join("")}</ol>`;
}

function notice(title, text, action) {
  return `
    <div class="notice">
      <strong>${title}</strong>
      <p>${text}</p>
      ${action || ""}
    </div>`;
}

function skuRow({ img, title, spec, pill, pillClass, amount }) {
  return `
    <div class="sku">
      <img src="${img}" alt="" />
      <div>
        <strong>${title}</strong>
        <p>${spec}</p>
        ${pill ? `<span class="pill ${pillClass}">${pill}</span>` : ""}
      </div>
      <b>${amount}</b>
    </div>`;
}

function pickupPanel(title) {
  return `
    <div class="panel pickup-card">
      <h3>${title || "本团领取安排"}</h3>
      <div class="pickup-row">
        <img class="pickup-row__thumb" src="${IMG.pickup}" alt="" />
        <div class="pickup-row__mid">
          <strong>幸福路台站点</strong>
          <p>幸福路 12 号小区门口</p>
          <p>07:00–20:00 · 点位负责人 周姐</p>
        </div>
        <div class="pickup-row__ops">
          <button type="button">${icon("nav", 14)}<span>导航</span></button>
          <button type="button">${icon("phone", 14)}<span>电话</span></button>
        </div>
      </div>
    </div>`;
}

function orderPage({ title, hint, no, flow, noticeHtml, skuHtml, warn, total, actions, extra }) {
  return `
    <div class="page page--bar">
      <div class="status-hero">
        <h1>${title}</h1>
        <p>${hint}</p>
        <small>订单号 ${no || "HT17883022D"}</small>
      </div>
      ${noticeHtml || ""}
      ${flow ? timeline(flow) : ""}
      ${pickupPanel()}
      <div class="panel">
        <h3>商品明细</h3>
        ${skuHtml}
        ${warn ? `<div class="warnbox">${warn}</div>` : ""}
        <div class="total"><span>实付合计</span><b>${total || "¥19.80"}</b></div>
      </div>
      ${extra || ""}
      ${actions ? `<div class="dock">${actions}</div>` : ""}
    </div>`;
}

function renderHomeEmpty() {
  return `
    <div class="page">
      ${locBar("选择你的自提点 ›", "先看看附近有哪些好味道")}
      <div class="hero">
        <img src="${IMG.hero}" alt="" />
        <div class="hero__cover">
          <div class="hero__title">时令之味
一起带回家</div>
          <div class="hero__note">乡土好物 · 按团集中到货</div>
        </div>
      </div>
      <div class="state">
        <h3>好味道，从附近开始</h3>
        <p>选择已开放的收货区域，再选一个固定自提点。下单后都在这个点领取。</p>
        <button class="btn" type="button" data-go="pickup">选择固定自提点</button>
      </div>
    </div>`;
}

function renderPickup() {
  return `<div class="page">
    <div class="photo-banner"><img src="${IMG.pickup}" alt="社区自提点示意" /></div>
    <div class="intro"><h2>选择固定自提点</h2><p>先选服务区域，再选自提点。切换仅影响后续浏览，已有订单按原点位领取。</p></div>
    <div class="form panel"><label for="pickupRegion">服务区域</label><select id="pickupRegion"><option value="central" ${state.region === "central" ? "selected" : ""}>城区示例区域</option><option value="east" ${state.region === "east" ? "selected" : ""}>城东示例区域</option></select></div>
    ${POINTS.filter(p => p.region === state.region).map(p => `<button class="point ${state.point === p.id ? "is-on" : ""}" type="button" data-point="${p.id}"><i class="point__pin">${icon("pin")}</i><div class="point__mid"><strong>${p.name}</strong><p>${p.address} · ${p.hours}<br>点位负责人 ${p.contact}</p></div><em>${state.point === p.id ? "已选择" : "选这里"}</em></button>`).join("")}
    <button class="btn btn--text btn--block" type="button" data-go="interest">所在区域暂未开放？登记开通意向</button>
  </div>`;
}

function renderHome() {
  return `
    <div class="page">
      ${locBar("幸福路台站点 ›", "幸福路 12 号小区门口")}
      <div class="hero">
        <img src="${IMG.hero}" alt="" />
        <div class="hero__cover">
          <div class="hero__title">时令之味
一起带回家</div>
          <div class="hero__note">乡土好物 · 按团集中到货</div>
        </div>
      </div>
      <div class="section-row">
        <div>
          <h2>本期团购</h2>
          <span class="muted" style="font-size:12px">截单今晚 21:00 · 预计周六到货</span>
        </div>
        <button class="link" type="button" data-go="orders">我的订单 ›</button>
      </div>
      <div class="chips">
        <span class="chip is-on">全部</span>
        <span class="chip">时蔬</span>
        <span class="chip">鲜食</span>
      </div>
      <div class="grid">${PRODUCTS.map((item) => card(item)).join("")}</div>
      <button class="float-cart" type="button" data-go="cart">查看购物车 · ${cartCount()} 件<span>本期商品统一结算 ›</span></button>
    </div>`;
}

function renderCampaign() {
  const item = product();
  return `
    <div class="page page--flush">
      <div class="hero-photo"><img src="${item.img}" alt="${item.title}" /></div>
      <div class="summary">
        <span class="price"><small>¥</small>${item.price}</span><span class="tag">团购价</span>
        <span class="sold">已支付 ${item.sold} 件</span>
        <h2>${item.title}</h2>
        <p class="muted" style="margin-top:6px;font-size:13px">${item.spec} · 一团集中送到固定自提点</p>
      </div>
      <div class="panel">
        <div class="kv"><span>本团成团进度</span><span>已支付 ${item.sold} / 20 件</span></div>
        <div class="bar"><i style="width:${Math.min(100, (item.sold / 20) * 100)}%"></i></div>
        <div class="kv"><span>截单时间</span><span>今晚 21:00</span></div>
        <div class="countdown">距截单还剩 4 小时 12 分</div>
        <div class="kv"><span>预计到货</span><span>周六 10:00</span></div>
        <p class="explain">最少 20 件成团。未成团将按公示规则全额退款，或顺延一次。</p>
      </div>
      ${pickupPanel("本团固定自提点")}
      <div class="buybar">
        <div class="stepper"><button type="button" aria-label="减少数量" data-qty="selected" data-delta="-1">−</button><span>${state.quantity}</span><button type="button" aria-label="增加数量" data-qty="selected" data-delta="1">＋</button></div>
        ${`<button class="btn btn--soft" type="button" data-action="add-cart">加入购物车</button>`}
        ${`<button class="btn btn--pri" type="button" data-action="buy-now">立即购买</button>`}
      </div>
    </div>`;
}

function renderCartEmpty() {
  return `
    <div class="page">
      <div class="state">
        <h3>购物车还是空的</h3>
        <p>从当前自提点正在收单的商品里挑几件。同一期一起结算。</p>
        <button class="btn" type="button" data-go="home">去逛团购</button>
      </div>
    </div>`;
}

function cartItems() { return PRODUCTS.filter(p => state.cart[p.id] > 0); }
function cartCount() { return Object.values(state.cart).reduce((n, q) => n + q, 0); }
function cartTotal() { return cartItems().reduce((n, p) => n + Math.round(Number(p.price) * 100) * state.cart[p.id], 0) / 100; }
function renderCart() {
  if (!cartCount()) return renderCartEmpty();
  return `<div class="page page--bar"><div class="panel cart-head"><div class="info-row"><span class="info-row__glyph">${icon("shop")}</span><div class="info-row__mid"><strong>周末时蔬团</strong><p>幸福路台站点 · 幸福路 12 号小区门口</p></div><button class="text-action" type="button" data-action="clear-cart">清空</button></div></div>
    <div class="panel">${cartItems().map(p => `${skuRow({ img: p.img, title: p.title, spec: `${p.spec} · ¥${p.price}`, amount: `× ${state.cart[p.id]}` })}<div class="qty-row"><button class="remove" type="button" data-remove="${p.id}">删除</button><div class="stepper"><button type="button" aria-label="减少${p.title}" data-qty="${p.id}" data-delta="-1">−</button><span>${state.cart[p.id]}</span><button type="button" aria-label="增加${p.title}" data-qty="${p.id}" data-delta="1">＋</button></div></div>`).join("")}</div>
    <div class="dock"><div class="sum"><span>共 ${cartCount()} 件</span><b>¥${cartTotal().toFixed(2)}</b></div>${btn({ go: "checkout", label: "去结算", grow: "pri" })}</div></div>`;
}

function renderCheckout() {
  return `
    <div class="page page--bar">
      <button class="panel loc-card" type="button" data-go="pickup">
        <div class="info-row">
          <img class="info-row__thumb" src="${IMG.pickup}" alt="" />
          <div class="info-row__mid">
            <span class="info-row__kicker">固定自提点</span>
            <strong>幸福路台站点</strong>
            <p>07:00–20:00 · 一团一个点，下单后不能改送到家</p>
          </div>
          <span class="info-row__action">查看${icon("chevron", 16)}</span>
        </div>
      </button>
      <div class="panel">
        <h3>周末时蔬团</h3>
        ${cartItems().map(p => skuRow({ img: p.img, title: p.title, spec: p.spec, amount: `¥${p.price} × ${state.cart[p.id]}` })).join("")}
        <div class="kv"><span>商品小计</span><span>¥${cartTotal().toFixed(2)}</span></div>
        <div class="kv"><span>集中配送</span><span>按团期统一安排</span></div>
      </div>
      ${notice("成团说明", "最少 20 件成团。未成团将全额退款，或顺延一次。截单前取消将原路退款。")}
      <div class="dock">
        <div class="sum"><span>合计</span><b>¥${cartTotal().toFixed(2)}</b></div>
        ${btn({ go: "pay-ok", kind: "primary", iconName: "wallet", label: "确认并支付", grow: "pri" })}
      </div>
    </div>`;
}

function renderPayOk() {
  return `
    <div class="page">
      <div class="state">
        <h3>支付已完成</h3>
        <p>现在是<strong>等待成团</strong>。还差 5 件。成团和到店时，可在订单消息里收提醒。</p>
        <button class="btn" type="button" data-go="order-wait">查看订单</button>
        <button class="btn btn--text" type="button" data-action="reminder">开启到货提醒</button>
      </div>
    </div>`;
}

function renderOrders() {
  const rows = [
    ["order-pick", IMG.potato, "待领取", "st-go", "黄心土豆等 2 件", "已领 1 / 待领 1"],
    ["order-wait", IMG.greens, "等待成团", "st-wait", "小青菜", "截单前可取消并退款"],
    ["order-pay", IMG.tomato, "待付款", "st-go", "自然熟番茄", "请在 30 分钟内支付"],
    ["order-done", IMG.corn, "已完成", "st-ok", "鲜玉米", "已在自提点领取"],
    ["order-refund", IMG.corn, "退款中", "st-go", "鲜玉米", "短少退款处理中"],
  ];
  return `
    <div class="page">
      <div class="filter" aria-label="订单状态筛选">${["全部", "待付款", "进行中", "待领取", "退款/售后", "已完成"].map(label => `<button class="${state.orderFilter === label ? "is-on" : ""}" aria-pressed="${state.orderFilter === label}" type="button" data-filter="${label}">${label}</button>`).join("")}</div>
      ${rows.filter(row => state.orderFilter === "全部" || ({ "待付款": "order-pay", "进行中": "order-wait", "待领取": "order-pick", "退款/售后": "order-refund", "已完成": "order-done" }[state.orderFilter] === row[0]))
        .map(
          ([go, img, st, cls, title, note]) => `
        <button class="order-row" type="button" data-go="${go}">
          <header><span>HT1788…</span><span class="st ${cls}">${st}</span></header>
          <div class="order-row__body">
            <img src="${img}" alt="" />
            <div><h3>${title}</h3><p class="explain">幸福路台站点 · ${note}</p></div>
          </div>
        </button>`,
        )
        .join("")}
    </div>`;
}

function potatoWaitSku() {
  return skuRow({
    img: IMG.potato,
    title: "黄心土豆",
    spec: "¥9.90 × 2",
    pill: "等待成团",
    pillClass: "pill--wait",
    amount: "¥19.80",
  });
}

function renderOrderPay() {
  return orderPage({
    title: "待付款",
    hint: "请在 30 分钟内完成支付，超时将自动关闭。",
    flow: "pay",
    skuHtml: skuRow({ img: IMG.tomato, title: "自然熟番茄", spec: "¥8.60 × 1", pill: "待支付", pillClass: "pill--wait", amount: "¥8.60" }),
    total: "¥8.60",
    actions:
      btn({ kind: "soft", label: "取消订单", grow: "sec" }) +
      btn({ go: "pay-ok", kind: "primary", iconName: "wallet", label: "继续支付", grow: "pri" }),
  });
}

function renderOrderWait() {
  return orderPage({
    title: "等待成团",
    hint: "已支付。本团还差 5 件。截单前可取消并自动退款。",
    flow: "wait",
    noticeHtml: notice(
      "现在是等待成团",
      "可在订单查看成团和到店进度。截单前取消将原路全额退款。",
      `<button class="btn btn--mini btn--soft" type="button" data-action="reminder">开启到货提醒</button>`,
    ),
    skuHtml: potatoWaitSku(),
    actions: btn({ kind: "soft", label: "取消并退款" }),
  });
}

function renderOrderFormed() {
  return orderPage({
    title: "已成团",
    hint: "已经成团，仓库正在按已付件数装袋。到货后可到幸福路台站点领取。",
    flow: "formed",
    noticeHtml: notice("备货中", "预计周六早上发往自提点。到店后可在订单查看领取状态。"),
    skuHtml: skuRow({ img: IMG.potato, title: "黄心土豆", spec: "¥9.90 × 2", pill: "备货中", pillClass: "pill--go", amount: "¥19.80" }),
  });
}

function renderOrderTransit() {
  return orderPage({
    title: "送往自提点",
    hint: "商品已发车，正在送往幸福路台站点。点位确认到货后即可领取。",
    flow: "transit",
    noticeHtml: notice("运输中", "预计周六 10:00 前后到店。请先不要出门，等「待领取」通知。"),
    skuHtml: skuRow({ img: IMG.potato, title: "黄心土豆", spec: "¥9.90 × 2", pill: "运输中", pillClass: "pill--go", amount: "¥19.80" }),
  });
}

function renderOrderPick() {
  return orderPage({
    title: "待领取",
    hint: "到货已确认，可分次领取。已领 1 件，还剩 1 件可领。",
    flow: "pick",
    skuHtml:
      skuRow({ img: IMG.potato, title: "黄心土豆", spec: "¥9.90 × 2　已领 1 / 待领 1", pill: "部分领取", pillClass: "pill--warn", amount: "¥19.80" }) +
      skuRow({ img: IMG.corn, title: "鲜玉米", spec: "¥12.80 × 1　待领 0", pill: "短少 1 件，不可领取", pillClass: "pill--danger", amount: "¥12.80" }),
    warn: "以下件数暂不能领取，其余可凭码领取：鲜玉米 1 件短少，将按实退款。",
    total: "¥32.60",
    actions:
      btn({ go: "after-sale", kind: "soft", iconName: "clipboard", label: "申请售后", grow: "eq" }) +
      btn({ go: "code", kind: "primary", iconName: "qr", label: "查看取货码", grow: "eq" }),
  });
}

function renderOrderDone() {
  return orderPage({
    title: "已完成",
    hint: "已在自提点领取。如有品质问题，请在领取后 24 小时内申请售后。",
    flow: "done",
    skuHtml: skuRow({ img: IMG.corn, title: "鲜玉米", spec: "¥12.80 × 1　已领 1", pill: "已领取", pillClass: "pill--ok", amount: "¥12.80" }),
    total: "¥12.80",
    extra: `<div class="panel"><h3>领取凭证</h3><p class="explain">今日 11:20 领取 1 件 · 品质申报截止明日 11:20</p></div>`,
    actions: btn({ go: "after-sale", kind: "soft", iconName: "clipboard", label: "申请售后" }),
  });
}

function renderOrderUnformed() {
  return orderPage({
    title: "未成团",
    hint: "截单时已支付件数未达到最少 20 件。将按公示规则全额退款，或由运营顺延一次。",
    flow: "unformed",
    skuHtml: potatoWaitSku(),
    noticeHtml: notice("未成团处理中", "本单将原路退回 ¥19.80。若选择顺延，新截单时间会写在订单和消息里。"),
  });
}

function renderOrderReview() {
  return orderPage({
    title: "取消审核中",
    hint: "已过截单，取消申请已交给运营。通过后由财务退款；未通过则继续履约。",
    flow: "review",
    skuHtml: potatoWaitSku(),
    noticeHtml: notice("等待运营审核", "审核完成前请先不要重复提交。结果会写在订单和消息里。"),
  });
}

function renderOrderCancel() {
  if (state.cancelUnpaid) return orderPage({ title: "已取消", hint: "本单尚未付款，取消后无需退款。", flow: null,
    skuHtml: skuRow({ img: IMG.tomato, title: "自然熟番茄", spec: "未付款 · 1 件", pill: "已取消", pillClass: "pill--danger", amount: "¥8.60" }), total: "¥0.00" });
  return orderPage({
    title: "已取消",
    hint: "订单已关闭。截单前取消的款项将原路退回；团期取消的已付款同样进入退款。",
    flow: "cancel",
    skuHtml: skuRow({ img: IMG.potato, title: "黄心土豆", spec: "¥9.90 × 2", pill: "已取消", pillClass: "pill--danger", amount: "¥19.80" }),
    noticeHtml: notice("退款进度", "¥19.80 退款中，到账以微信通知为准。"),
  });
}

function renderOrderRefund() {
  return orderPage({
    title: "退款中",
    hint: "财务正在提交微信退款。到账前可在本页查看进度，无需重复申请。",
    flow: "refund",
    skuHtml: skuRow({ img: IMG.corn, title: "鲜玉米", spec: "短少 1 件", pill: "退款中", pillClass: "pill--go", amount: "¥12.80" }),
    total: "¥12.80",
    noticeHtml: notice("退款处理中", "短少件数按实退款。其余可领商品不受影响。"),
  });
}

function renderOrderFail() {
  return orderPage({
    title: "退款未完成",
    hint: "微信退款失败或结果不明，已转人工处理。请通过客服查询，不要重复提交。",
    flow: "fail",
    skuHtml: skuRow({ img: IMG.corn, title: "鲜玉米", spec: "短少 1 件", pill: "退款挂起", pillClass: "pill--danger", amount: "¥12.80" }),
    total: "¥12.80",
    noticeHtml: notice("已转人工", "本笔退款已挂起。客服会凭订单号跟进，无需再点申请。"),
    actions: btn({ go: "profile", kind: "outline", iconName: "headset", label: "联系客服" }),
  });
}

function renderOrderOverdue() {
  return orderPage({
    title: "逾期未领",
    hint: "领取窗口已过（到货确认后第 3 日 23:59）。未领件数将登记退款或报损，不能再出示取货码。",
    flow: "overdue",
    skuHtml: skuRow({ img: IMG.potato, title: "黄心土豆", spec: "待领 1 件已逾期", pill: "逾期未领", pillClass: "pill--warn", amount: "¥9.90" }),
    total: "¥9.90",
    noticeHtml: notice("窗口已关闭", "未领 1 件进入退款或报损流程。结果会写在本页。"),
  });
}

function renderCode() {
  return `
    <div class="page code-page">
      <p class="muted">到店打开本页，向点位负责人出示下面 6 位数字码</p>
      <div class="digits">382 916</div>
      <p class="hint">码有效至今日 20:00 · 领取截止周日 23:59</p>
      <div class="ticket">
        <div class="pickup-row">
          <img class="pickup-row__thumb" src="${IMG.pickup}" alt="" />
          <div class="pickup-row__mid">
            <strong>幸福路台站点</strong>
            <p>幸福路 12 号小区门口</p>
            <p>07:00–20:00 · 点位负责人 周姐</p>
          </div>
          <div class="pickup-row__ops">
            <button type="button">${icon("nav", 14)}<span>导航</span></button>
            <button type="button">${icon("phone", 14)}<span>电话</span></button>
          </div>
        </div>
        <p>还可领取 1 件（黄心土豆 1，不含已短少的玉米）</p>
      </div>
      <p class="explain">请勿提前把取货码发给他人。未领完可再来。</p>
    </div>`;
}

function renderAfterSale() {
  const a = state.after;
  const item = PRODUCTS.find(p => p.id === state.afterSku);
  return `<form class="page page--bar form" id="afterForm">
    ${notice("售后申请", "领取后未满 24 小时可申报品质问题。按领取凭证选择商品，申请结果以审核为准。")}
    <fieldset class="panel" ${state.busy ? "disabled" : ""}><legend>选择异常商品</legend>
      <label class="claim"><img src="${item.img}" alt="" /><span><strong>${item.title}</strong><br>已领取 1 件 · 明日 11:20 截止</span><input id="afterSelected" type="checkbox" ${a.selected ? "checked" : ""} /></label>
      <label for="afterReason">问题类型</label><select id="afterReason"><option>品质问题</option></select>
      <label for="afterQuantity">异常数量（最多 1 件）</label><input id="afterQuantity" type="number" min="1" max="1" step="1" value="${a.quantity}" required />
      <label for="afterDetail">问题说明（至少 5 个字）</label><textarea id="afterDetail" minlength="5" maxlength="500" required placeholder="请描述该商品发生的情况">${escapeHtml(a.detail)}</textarea>
      ${errorHtml()}
    </fieldset>
    <div class="dock"><button type="submit" class="btn" ${state.busy ? "disabled" : ""}>${state.busy ? "提交中…" : "提交申请"}</button></div>
  </form>`;
}

function renderAfterProgress() {
  if (state.afterSubmitted) {
    const item = PRODUCTS.find(p => p.id === state.afterSku);
    return orderPage({ title: "售后申请已提交", hint: "等待客服受理，处理结果以审核为准。", flow: null,
      skuHtml: skuRow({ img: item.img, title: item.title, spec: `${state.after.reason} · ${state.after.quantity} 件`, pill: "待受理", pillClass: "pill--wait", amount: `¥${item.price}` }),
      total: `¥${item.price}`, extra: `<div class="panel"><h3>申请说明</h3><p class="explain">${escapeHtml(state.after.detail)}</p></div>` });
  }
  return orderPage({
    title: "售后处理中",
    hint: "客服已受理。运营决定后，通过则财务退款，驳回会写明原因。",
    flow: "after",
    skuHtml: skuRow({ img: IMG.potato, title: "黄心土豆", spec: "品质问题 · 1 件", pill: "待运营决定", pillClass: "pill--warn", amount: "¥9.90" }),
    total: "¥9.90",
    extra: `<div class="panel"><h3>售后进度</h3><p class="explain">今日 11:40 已提交<br>今日 12:05 客服已受理<br>正在等待运营决定</p></div>`,
  });
}

function svcRow(go, iconName, title, hint) {
  return `
    <button class="svc-row" type="button"${go ? ` data-go="${go}"` : ""}>
      <span class="svc-row__icon">${icon(iconName, 20)}</span>
      <span class="svc-row__mid"><span>${title}</span><em>${hint}</em></span>
      ${icon("chevron", 16)}
    </button>`;
}

function renderProfile(guest) {
  return `
    <div class="page">
      <${guest ? 'button type="button" data-go="login"' : "div"} class="identity">
        <i>${icon("user", 22)}</i>
        <div>
          <strong>${guest ? "欢迎来到乡味集" : "陈阿姨"}</strong>
          <p>${guest ? "登录，查看订单与取货信息" : "好味道，就在家附近"}</p>
        </div>
        ${guest ? `<span class="info-row__action">${icon("chevron", 16)}</span>` : ""}
      </${guest ? "button" : "div"}>
      <div class="panel">
        <div class="section-row" style="margin:0 0 8px"><h2 style="font-size:16px">我的订单</h2><button class="link" type="button" data-go="orders">全部订单 ›</button></div>
        <div class="stat-grid">
          <button type="button" data-filter="待付款"><b>${guest ? "—" : "1"}</b>待付款</button>
          <button type="button" data-filter="进行中"><b>${guest ? "—" : "1"}</b>进行中</button>
          <button type="button" data-filter="待领取"><b>${guest ? "—" : "1"}</b>待领取</button>
          <button type="button" data-filter="退款/售后"><b>${guest ? "—" : "1"}</b>退款售后</button>
        </div>
      </div>
      <button class="panel loc-card" type="button" data-go="pickup">
        <div class="info-row">
          <span class="info-row__glyph">${icon("pin", 20)}</span>
          <div class="info-row__mid">
            <span class="info-row__kicker">默认自提点</span>
            <strong>${state.point ? currentPoint().name : "请选择固定自提点"}</strong>
            <p>${currentPoint().address}</p>
          </div>
          <span class="info-row__action">切换${icon("chevron", 16)}</span>
        </div>
      </button>
      <div class="panel list-panel">
        <h3>常用服务</h3>
        ${svcRow("messages", "message", "订单消息", "地点、发车与到货提醒")}
        ${svcRow("interest", "edit", "开通意向", "所在区县暂未开放？登记需求")}
        ${svcRow("", "headset", "客服", "联系在线客服")}
        ${svcRow("help", "question", "帮助", "下单、成团、领取与售后")}
        ${svcRow("about", "info", "关于", "版本与平台信息")}
        ${svcRow("legal", "lock", "隐私与协议", "用户服务协议与隐私说明")}
      </div>
      <button class="logout" type="button" data-go="${guest ? "login" : "profile-guest"}">${guest ? "登录账号" : "退出登录"}</button>
    </div>`;
}

function renderLogin() {
  return `<div class="page login">
    <div class="login__hero"><img src="${IMG.hero}" alt="田野与时令好物" /></div>
    <p class="login__brand">乡味集</p><h2>好味道，一起分享</h2><p class="muted">登录后查看订单与取货信息</p>
    <div class="consent"><label class="consent-check"><input id="loginConsent" type="checkbox" ${state.consent ? "checked" : ""} ${state.busy ? "disabled" : ""} /><span>我已阅读并同意</span></label><span class="consent-links"><button type="button" data-legal="terms">《用户服务协议》</button><button type="button" data-legal="privacy">《隐私说明》</button></span></div>
    ${errorHtml()}
    <button class="btn btn--block" type="button" data-action="login" ${state.busy ? "disabled" : ""}>${state.busy ? "登录中…" : "手机号快捷登录"}</button>
    <button class="btn btn--text btn--block" type="button" data-go="home">暂不登录，先逛逛</button>
    <p class="explain">手机号用于识别账号和订单联系。请先阅读相关协议，自主决定是否继续。</p>
  </div>`;
}

function renderMessages(empty) {
  if (empty) {
    return `
      <div class="page">
        ${notice("订单提醒", reminderCopy(), `<button class="btn btn--mini btn--soft" type="button" data-action="reminder">开启微信提醒</button>`)}
        <div class="state"><h3>暂时没有订单消息</h3><p>团期地点确认、发车或到货后，消息会出现在这里。</p></div>
      </div>`;
  }
  const items = [
    ["order-pick", "到货可领取", "幸福路台站点已确认到货，请凭码领取。", "今天 10:12"],
    ["order-wait", "等待成团", "本团还差 5 件，截单今晚 21:00。", "今天 09:01"],
    ["order-refund", "短少退款", "鲜玉米 1 件短少，已进入退款。", "昨天 18:20"],
  ];
  return `
    <div class="page">
      ${notice("订单提醒", reminderCopy(), `<button class="btn btn--mini btn--soft" type="button" data-action="reminder">继续授权</button>`)}
      ${items
        .map(
          ([go, title, copy, time]) => `
        <button class="msg" type="button" data-go="${go}">
          <header><strong>${title}</strong><span>${time}</span></header>
          <p>${copy}</p>
          <em>查看订单 ›</em>
        </button>`,
        )
        .join("")}
    </div>`;
}

function renderInterest() {
  return `<form class="page form" id="interestForm"><div class="intro"><h2>所在区域暂未开放？</h2><p>登记开通需求，供运营评估。登记不代表开通承诺。</p></div>
    ${state.interestSubmitted ? notice("模拟登记已完成", "本次示例保存在当前页面会话，没有提交真实联系信息。") : ""}
    <fieldset class="panel" ${state.busy ? "disabled" : ""}><legend>登记开通意向</legend>
    <label for="interestArea">所在省 / 市 / 区县</label><input id="interestArea" value="${escapeHtml(state.interest.area)}" placeholder="请填写示例区域" required />
    <label for="interestName">联系人</label><input id="interestName" value="${escapeHtml(state.interest.name)}" placeholder="示例称呼" required maxlength="30" />
    <label for="interestPhone">联系电话</label><input id="interestPhone" value="${escapeHtml(state.interest.phone)}" placeholder="原型请使用虚构或脱敏内容" required />
    <p class="explain">原型不会上传表单内容，请勿填写真实个人信息。</p>${errorHtml()}
    <button class="btn btn--block" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "提交中…" : "提交开通意向"}</button></fieldset></form>`;
}

function renderHelp() {
  const rows = [
    ["怎么选点", "先选区县，再选固定自提点。一团一个点，不能改送到家。"],
    ["等待成团", "支付后等到截单。件数够了就成团；不够则退款或顺延一次。"],
    ["截单前取消", "订单详情点「取消并退款」，原路全额退回。"],
    ["截单后取消", "需要运营审核。通过后退款，未通过则继续履约。"],
    ["短少破损", "到货时点位会登记。受影响件数不能领，其余可凭码领取。"],
    ["怎么领取", "到店向点位负责人出示 6 位数字码，可分次领取。"],
    ["逾期未领", "到货确认后第 3 日 23:59 截止，未领进入退款或报损。"],
    ["领取后品质", "领取后 24 小时内在订单申请售后。"],
    ["退款失败", "已转人工，请找客服，不要重复申请。"],
  ];
  return `
    <div class="page">
      <div class="intro"><h2>下单与领取说明</h2><p>乡味集是社区团购：选固定自提点，成团后集中到货，凭码领取。</p></div>
      ${rows.map(([t, p]) => `<div class="panel"><h3>${t}</h3><p class="explain">${p}</p></div>`).join("")}
    </div>`;
}

function renderLegal() {
  const privacy = state.legalTab === "privacy";
  return `<div class="page"><div class="chips">${[["terms", "用户服务协议"], ["privacy", "隐私说明"]].map(([id, label]) => `<button type="button" class="chip ${state.legalTab === id ? "is-on" : ""}" data-legal="${id}" aria-pressed="${state.legalTab === id}">${label}</button>`).join("")}</div>
    <div class="panel"><h3>${privacy ? "隐私说明" : "用户服务协议"}</h3>
      <p class="explain">${privacy ? "登录涉及手机号与账号标识；订单履约涉及商品、固定自提点和联系信息。请仅在了解用途后继续。" : "乡味集提供团购浏览、订单查询、固定自提点领取及售后。下单前请确认团期、商品数量及固定自提点。"}</p>
      <p class="explain">本页为原型阅读示意，正式协议全文及适用版本需在实际产品中提供；此处勾选不会形成真实授权。</p>
      <button type="button" class="btn btn--outline" data-action="legal-back">返回${state.legalBack === "login" ? "登录" : "上一页"}</button>
    </div></div>`;
}

function renderAbout() {
  return `
    <div class="page">
      <div class="state">
        <h3>乡味集</h3>
        <p>社区团购 · 固定自提点领取<br>原型示意版本 2026.09.09<br>不是配送到家，也没有团长角色。</p>
      </div>
    </div>`;
}

const RENDER = {
  "home-empty": renderHomeEmpty,
  pickup: renderPickup,
  home: renderHome,
  campaign: renderCampaign,
  "cart-empty": renderCartEmpty,
  cart: renderCart,
  checkout: renderCheckout,
  "pay-ok": renderPayOk,
  orders: renderOrders,
  "order-pay": renderOrderPay,
  "order-wait": renderOrderWait,
  "order-formed": renderOrderFormed,
  "order-transit": renderOrderTransit,
  "order-pick": renderOrderPick,
  "order-done": renderOrderDone,
  "order-unformed": renderOrderUnformed,
  "order-review": renderOrderReview,
  "order-cancel": renderOrderCancel,
  "order-fail": renderOrderFail,
  "order-refund": renderOrderRefund,
  "order-overdue": renderOrderOverdue,
  code: renderCode,
  "after-sale": renderAfterSale,
  "after-progress": renderAfterProgress,
  "profile-guest": () => renderProfile(true),
  profile: () => renderProfile(false),
  login: renderLogin,
  messages: () => renderMessages(false),
  "messages-empty": () => renderMessages(true),
  interest: renderInterest,
  help: renderHelp,
  legal: renderLegal,
  about: renderAbout,
};

function paintChrome() {
  const info = meta();
  $("navTitle").textContent = info.title;
  $("navBack").hidden = !info.back;
  const tabbar = $("tabbar");
  const tabs = [
    ["home", "团购", "home", "shop"],
    ["cart", "购物车", "cart", "cart"],
    ["orders", "订单", "orders", "orders"],
    ["mine", "我的", state.loggedIn ? "profile" : "profile-guest", "user"],
  ];
  if (!info.tab) {
    tabbar.classList.add("hidden");
    tabbar.innerHTML = "";
    return;
  }
  tabbar.classList.remove("hidden");
  tabbar.innerHTML = tabs
    .map(
      ([id, label, go, iconName]) =>
        `<button type="button" class="${info.tab === id ? "is-on" : ""}" data-go="${go}">${icon(iconName, 22)}<span>${label}</span></button>`,
    )
    .join("");
}

function paintBoard() {
  $("screenSwitch").innerHTML = GROUPS.map(
    (group) => `
      <p class="group-label">${group.name}</p>
      <div class="screen-switch">
        ${group.items
          .map(
            (item) =>
              `<button type="button" data-screen="${item.id}" class="${state.screen === item.id ? "is-on" : ""}">${item.label}</button>`,
          )
          .join("")}
      </div>`,
  ).join("");
}

function reminderCopy() {
  return `${state.reminderRefused ? "本次未同意提醒，可继续查看站内消息。" : "可按需开启订阅提醒；是否送达取决于授权与平台结果。"}模拟剩余授权次数：${state.reminders}。`;
}
function navigate(target) {
  if (state.busy) { feedback("请求处理中，请稍候；可在设备外控制器完成模拟请求。"); return; }
  if (target === "profile") target = state.loggedIn ? "profile" : "profile-guest";
  if (target === "profile-guest") state.loggedIn = false;
  if (target === "login" || (!state.loggedIn && isPrivate(target))) {
    state.returnTo = target === "login" ? "profile" : target;
    state.loginBack = state.screen === "legal" ? "profile-guest" : state.screen;
    target = "login";
  }
  if (target === "after-sale") { state.afterSku = state.screen === "order-done" ? "corn" : "potato"; }
  if (target === "pickup") { state.pickupBack = state.screen; state.region = currentPoint().region; }
  if (target === "legal") state.legalBack = state.screen;
  state.screen = target; state.error = ""; state.pageState = "ready"; $("demoPage").value = "ready"; render();
}
function request(kind, onSuccess) {
  if (state.busy) return;
  state.error = ""; state.busy = true;
  const version = ++state.requestVersion;
  state.pending = () => {
    if (version !== state.requestVersion) return;
    state.busy = false; state.pending = null;
    if (state.scenario === "api-error") state.error = "模拟请求失败，填写内容已保留。请重试。";
    else if (kind === "login" && state.scenario === "phone-refused") state.error = "未获得手机号授权。可重新尝试，或先逛逛。";
    else { onSuccess(); feedback("模拟操作已完成；未向真实服务发送请求。"); }
    render();
  };
  render();
  if (state.scenario !== "loading") setTimeout(() => { if (version === state.requestVersion && state.pending) state.pending(); }, 650);
}
function render() {
  paintBoard(); paintChrome();
  let html;
  if (state.pageState === "loading") html = `<div class="page"><div class="state" role="status"><h3>正在加载…</h3><p>请稍候</p><button class="btn btn--outline" type="button" data-action="retry-page">重新加载</button></div></div>`;
  else if (state.pageState === "error") html = `<div class="page"><div class="state" role="alert"><h3>暂时加载失败</h3><p>请检查后重试，已填写内容会保留。</p><button class="btn" type="button" data-action="retry-page">重试</button></div></div>`;
  else if (state.pageState === "empty") html = `<div class="page"><div class="state"><h3>暂无内容</h3><p>稍后再来看看，也可以继续逛团购。</p><button class="btn" data-go="home" type="button">去逛逛</button></div></div>`;
  else html = pointText(RENDER[state.screen]());
  $("screen").innerHTML = html; $("screen").scrollTop = 0;
  $("screen").setAttribute("aria-busy", String(state.busy || state.pageState === "loading"));
  $("demoStatus").textContent = `${state.loggedIn ? "已登录示例" : "游客模式"} · ${meta().title} · ${state.busy ? "模拟请求中" : "无真实网络请求"}`;
}
function submitLogin() {
  if (!state.consent) { state.error = "请先阅读并勾选同意用户服务协议与隐私说明。"; render(); return; }
  request("login", () => { state.loggedIn = true; state.screen = state.returnTo; });
}
function submitAfter() {
  const a = state.after;
  if (!a.selected || a.quantity !== 1 || a.detail.trim().length < 5) { state.error = "请选择已领取商品，数量为 1，并填写至少 5 个字的问题说明。"; render(); return; }
  request("after", () => { state.afterSubmitted = true; state.screen = "after-progress"; });
}
document.body.addEventListener("input", event => {
  const { id, value, checked } = event.target;
  if (id === "loginConsent") state.consent = checked;
  if (id === "afterSelected") state.after.selected = checked;
  if (id === "afterQuantity") state.after.quantity = Number(value);
  if (id === "afterDetail") state.after.detail = value;
  if (id === "afterReason") state.after.reason = value;
  const interestKeys = { interestArea: "area", interestName: "name", interestPhone: "phone" };
  if (interestKeys[id]) state.interest[interestKeys[id]] = value;
});
document.body.addEventListener("change", event => {
  const { id, value } = event.target;
  if (id === "demoWidth") $("device").style.setProperty("--device-w", `${value}px`);
  if (id === "demoScenario") { state.scenario = value; if (value === "consent") { state.consent = false; if (!state.busy && state.screen !== "login") navigate("login"); else render(); } }
  if (id === "demoPage") { state.pageState = value; render(); }
  if (id === "demoReminder") state.reminder = value;
  if (id === "pickupRegion") { state.region = value; render(); }
});
document.body.addEventListener("submit", event => {
  if (event.target.id === "afterForm") { event.preventDefault(); submitAfter(); }
  if (event.target.id === "interestForm") { event.preventDefault(); request("interest", () => { state.interestSubmitted = true; }); }
});
document.body.addEventListener("click", event => {
  const target = event.target.closest("button"); if (!target) return;
  const d = target.dataset;
  if (d.action === "finish-request") { if (state.pending) { state.scenario = "success"; $("demoScenario").value = "success"; state.pending(); } else feedback("当前没有等待中的模拟请求。"); return; }
  if (state.busy) return;
  $("feedback").hidden = true;
  if (d.screen) {
    state.screen = d.screen; state.pageState = "ready"; $("demoPage").value = "ready"; state.error = "";
    if (isPrivate(d.screen) || d.screen === "profile") state.loggedIn = true;
    if (["profile-guest", "login"].includes(d.screen)) state.loggedIn = false;
    if (d.screen === "order-cancel") state.cancelUnpaid = false;
    if (d.screen === "after-progress") state.afterSubmitted = false;
    if (d.screen === "login") { state.returnTo = "profile"; state.loginBack = "profile-guest"; }
    if (d.screen === "legal") state.legalBack = state.loggedIn ? "profile" : "profile-guest";
    render(); return;
  }
  if (d.filter) { state.orderFilter = d.filter; navigate("orders"); return; }
  if (d.legal) { if (state.screen !== "legal") state.legalBack = state.screen; state.legalTab = d.legal; state.screen = "legal"; render(); return; }
  if (d.point) { state.point = d.point; navigate(state.pickupBack === "home-empty" ? "home" : state.pickupBack); feedback("模拟自提点已切换，已有订单仍保留原自提点。"); return; }
  if (d.qty) { const delta = Number(d.delta); if (d.qty === "selected") state.quantity = Math.max(1, state.quantity + delta); else state.cart[d.qty] = Math.max(1, state.cart[d.qty] + delta); render(); return; }
  if (d.remove) { delete state.cart[d.remove]; render(); return; }
  const action = d.action;
  if (action === "login") { submitLogin(); return; }
  if (action === "legal-back") { state.screen = state.legalBack; render(); return; }
  if (action === "retry-page") { state.pageState = "ready"; $("demoPage").value = "ready"; render(); return; }
  if (action === "clear-cart") { state.cart = {}; render(); return; }
  if (action === "add-cart" || action === "buy-now") { state.cart[state.sku] = (state.cart[state.sku] || 0) + state.quantity; if (action === "buy-now") navigate("checkout"); else feedback("已加入模拟购物车。"); return; }
  if (action === "reminder" || /开启微信提醒|继续授权/.test(target.textContent)) {
    state.reminderRefused = state.reminder === "refuse";
    if (!state.reminderRefused) state.reminders += 1;
    render(); feedback(state.reminderRefused ? "模拟拒绝授权：仍可在订单与站内消息查看进度。" : `模拟授权次数已更新为 ${state.reminders}，不会实际发送通知。`); return;
  }
  if (/联系客服|^客服/.test(target.textContent.trim())) { feedback("模拟客服入口：正式渠道需在实际产品中接入，本次未联系任何人。"); return; }
  if (/^(导航|电话)$/.test(target.textContent.trim())) { feedback(`模拟${target.textContent.trim()}入口：本次不会打开地图或拨出电话。`); return; }
  if (d.go) { if (d.sku) state.sku = d.sku; if (d.go === "pay-ok") { request("payment", () => { state.screen = "pay-ok"; }); return; } if (d.go === "orders") state.orderFilter = "全部"; navigate(d.go); return; }
  if (/取消/.test(target.textContent)) { state.cancelUnpaid = state.screen === "order-pay"; request("cancel", () => { state.screen = "order-cancel"; }); return; }
});
$("navBack").addEventListener("click", () => {
  if (state.busy) return;
  if (state.screen === "legal") { const target = state.legalBack; state.screen = target; render(); return; }
  if (state.screen === "login") { state.screen = state.loginBack; render(); return; }
  if (state.screen === "pickup") { navigate(state.pickupBack); return; }
  if (meta().back) navigate(meta().back);
});
if (isPrivate(state.screen) || state.screen === "profile") state.loggedIn = true;
render();
