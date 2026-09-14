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
};

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
  return `
    <div class="page">
      <div class="photo-banner"><img src="${IMG.pickup}" alt="" /></div>
      <div class="intro">
        <h2>选择固定自提点</h2>
        <p>先选区县，再选门口的点。一团只对应一个自提点。</p>
      </div>
      <button class="point is-on" type="button" data-go="home">
        <i class="point__pin">${icon("pin", 20)}</i>
        <div class="point__mid">
          <strong>幸福路台站点</strong>
          <p>幸福路 12 号小区门口 · 07:00–20:00<br>点位负责人 周姐 138****2018</p>
        </div>
        <em>已选择</em>
      </button>
      <button class="point" type="button" data-go="home">
        <i class="point__pin">${icon("pin", 20)}</i>
        <div class="point__mid">
          <strong>车站东点</strong>
          <p>东站广场商铺 3 号 · 08:00–19:00<br>点位负责人 李师傅</p>
        </div>
        <em>选择 ${icon("chevron", 16)}</em>
      </button>
      <button class="btn btn--text btn--block" type="button" data-go="interest">所在区县暂未开放？登记开通意向</button>
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
      <button class="float-cart" type="button" data-go="cart">查看购物车 · 2 件<span>本期商品统一结算 ›</span></button>
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
        <div class="stepper"><span>−</span><span>1</span><span>＋</span></div>
        ${btn({ go: "cart", kind: "soft", label: "加入购物车", grow: "sec" })}
        ${btn({ go: "checkout", kind: "primary", iconName: "wallet", label: "立即购买", grow: "pri" })}
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

function renderCart() {
  return `
    <div class="page page--bar">
      <div class="panel cart-head">
        <div class="info-row">
          <span class="info-row__glyph">${icon("shop", 20)}</span>
          <div class="info-row__mid">
            <strong>周末时蔬团</strong>
            <p>幸福路台站点 · 幸福路 12 号小区门口</p>
          </div>
          <button class="text-action" type="button">${icon("trash", 16)}清空</button>
        </div>
      </div>
      <div class="panel">
        ${skuRow({ img: IMG.potato, title: "黄心土豆", spec: "约 3 斤 / 份 · ¥9.90", amount: "× 1" })}
        <div class="qty-row"><span class="remove">删除</span><div class="stepper"><span>−</span><span>1</span><span>＋</span></div></div>
        ${skuRow({ img: IMG.corn, title: "鲜玉米", spec: "4 根 / 份 · ¥12.80", amount: "× 1" })}
        <div class="qty-row"><span class="remove">删除</span><div class="stepper"><span>−</span><span>1</span><span>＋</span></div></div>
      </div>
      <div class="dock">
        <div class="sum"><span>共 2 件</span><b>¥22.70</b></div>
        ${btn({ go: "checkout", kind: "primary", iconName: "wallet", label: "去结算", grow: "pri" })}
      </div>
    </div>`;
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
        ${skuRow({ img: IMG.potato, title: "黄心土豆", spec: "约 3 斤 / 份", amount: "¥9.90 × 1" })}
        ${skuRow({ img: IMG.corn, title: "鲜玉米", spec: "4 根 / 份", amount: "¥12.80 × 1" })}
        <div class="kv"><span>商品小计</span><span>¥22.70</span></div>
        <div class="kv"><span>集中配送</span><span>按团期统一安排</span></div>
      </div>
      ${notice("成团说明", "最少 20 件成团。未成团将全额退款，或顺延一次。截单前取消将原路退款。")}
      <div class="dock">
        <div class="sum"><span>合计</span><b>¥22.70</b></div>
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
        <button class="btn btn--text" type="button" data-go="messages">开启到货提醒</button>
      </div>
    </div>`;
}

function renderOrders() {
  const rows = [
    ["order-pick", IMG.potato, "待领取", "st-go", "黄心土豆等 2 件", "已领 1 / 待领 2"],
    ["order-wait", IMG.greens, "等待成团", "st-wait", "小青菜", "截单前可取消并退款"],
    ["order-pay", IMG.tomato, "待付款", "st-go", "自然熟番茄", "请在 30 分钟内支付"],
    ["order-done", IMG.corn, "已完成", "st-ok", "鲜玉米", "已在自提点领取"],
  ];
  return `
    <div class="page">
      <div class="filter">
        <button class="is-on" type="button">全部</button>
        <button type="button">待付款</button>
        <button type="button">进行中</button>
        <button type="button">待领取</button>
        <button type="button">退款/售后</button>
      </div>
      ${rows
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
      "成团和到店时会通知你。截单前取消将原路全额退款。",
      `<button class="btn btn--mini btn--soft" type="button" data-go="messages">开启到货提醒</button>`,
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
    noticeHtml: notice("备货中", "预计周六早上发往自提点。到店后会再通知你。"),
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
    hint: "到货已确认，可分次领取。已领 1 件，还剩 2 件可领。",
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
    extra: `<div class="panel"><h3>领取凭证</h3><p class="explain">今日 11:20 领取 1 件 · 品质申报截止今晚 11:20</p></div>`,
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
        <p>还可领取 2 件（黄心土豆 1，不含已短少的玉米）</p>
      </div>
      <p class="explain">请勿提前把取货码发给他人。未领完可再来。</p>
    </div>`;
}

function renderAfterSale() {
  return `
    <div class="page page--bar">
      ${notice("售后申请", "领取后 24 小时内可申报品质问题。请按商品如实填写，客服受理后由运营决定、财务退款。")}
      <div class="panel">
        <h3>选择异常商品</h3>
        <label class="claim">
          <img src="${IMG.potato}" alt="" />
          <div><strong>黄心土豆</strong><p>最多 1 件 · 今晚 11:20 截止</p></div>
          <span class="switch on"></span>
        </label>
        <p class="label">问题类型</p>
        <div class="picker">品质问题 ›</div>
        <p class="label">异常数量</p>
        <div class="stepper" style="width:120px"><span>−</span><span>1</span><span>＋</span></div>
        <p class="label">问题说明</p>
        <textarea placeholder="请描述该商品发生的情况（至少 5 个字）"></textarea>
      </div>
      <div class="dock">${btn({ go: "after-progress", kind: "primary", iconName: "clipboard", label: "提交申请" })}</div>
    </div>`;
}

function renderAfterProgress() {
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
      <button class="identity" type="button" data-go="${guest ? "login" : "profile"}">
        <i>${icon("user", 22)}</i>
        <div>
          <strong>${guest ? "欢迎来到乡味集" : "陈阿姨"}</strong>
          <p>${guest ? "登录，查看订单与取货信息" : "好味道，就在家附近"}</p>
        </div>
        <span class="info-row__action">${icon("chevron", 16)}</span>
      </button>
      <div class="panel">
        <div class="section-row" style="margin:0 0 8px"><h2 style="font-size:16px">我的订单</h2><button class="link" type="button" data-go="orders">全部订单 ›</button></div>
        <div class="stat-grid">
          <button type="button" data-go="order-pay"><b>1</b>待付款</button>
          <button type="button" data-go="order-wait"><b>2</b>进行中</button>
          <button type="button" data-go="order-pick"><b>1</b>待领取</button>
          <button type="button" data-go="order-refund"><b>1</b>退款售后</button>
        </div>
      </div>
      <button class="panel loc-card" type="button" data-go="pickup">
        <div class="info-row">
          <span class="info-row__glyph">${icon("pin", 20)}</span>
          <div class="info-row__mid">
            <span class="info-row__kicker">默认自提点</span>
            <strong>${guest ? "请选择固定自提点" : "幸福路台站点"}</strong>
            <p>${guest ? "选好附近点位，逛逛本期团购" : "幸福路 12 号小区门口"}</p>
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
  return `
    <div class="page login">
      <div class="login__hero"><img src="${IMG.hero}" alt="" /></div>
      <p class="login__brand">乡味集</p>
      <h2>好味道，一起分享</h2>
      <p class="muted">登录后查看订单与取货信息</p>
      <label class="consent"><i></i><span>我已阅读并同意《用户服务协议》和《隐私说明》</span></label>
      <button class="btn btn--block" type="button" data-go="profile">微信快捷登录</button>
      <button class="btn btn--text btn--block" type="button" data-go="home">暂不登录，先逛逛</button>
      <p class="explain" style="text-align:center">首次授权手机号后，后续可直接微信登录。不用于营销。</p>
    </div>`;
}

function renderMessages(empty) {
  if (empty) {
    return `
      <div class="page">
        ${notice("订单提醒", "授权后，成团、到货、领取截止会通知你。拒绝后仍可在本页和订单里看进度。", `<button class="btn btn--mini btn--soft" type="button">开启微信提醒</button>`)}
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
      ${notice("订单提醒", "已开启站内消息。还可授权微信订阅，成团和到店时提醒你。", `<button class="btn btn--mini btn--soft" type="button">继续授权</button>`)}
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
  return `
    <div class="page">
      <div class="intro">
        <h2>你所在的区县暂未开放？</h2>
        <p>留下需求，我们优先评估收单和集中领取条件。这不是下单客户名单。</p>
      </div>
      <div class="panel">
        <h3>我的开通意向</h3>
        <div class="kv"><span>城西未覆盖片区</span><span class="pill pill--wait">评估中</span></div>
        <p class="explain">王女士 · 138****2018</p>
      </div>
      <div class="panel form">
        <h3>登记新的开通意向</h3>
        <label>所在省 / 市 / 区县</label>
        <input value="河北省 / 张家口市 / " />
        <label>联系人</label>
        <input placeholder="怎么称呼您" />
        <label>联系电话</label>
        <input placeholder="便于通知开通进展" />
        <p class="explain">信息仅供开通评估与联系，不会用于营销。</p>
        <button class="btn btn--block" type="button">提交开通意向</button>
      </div>
    </div>`;
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
  return `
    <div class="page">
      <div class="chips"><span class="chip is-on">用户服务协议</span><span class="chip">隐私说明</span></div>
      <div class="panel">
        <h3>用户服务协议</h3>
        <p class="explain">「乡味集」提供团购浏览、下单支付、订单查询、固定自提点领取及售后。商品以团期页面、订单页展示的信息为准。</p>
        <p class="explain">下单前请确认团期、数量和固定自提点。到货后凭有效取货码领取。未成团按团期规则原路退款。</p>
      </div>
    </div>`;
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
    ["mine", "我的", "profile", "user"],
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

function render() {
  paintBoard();
  paintChrome();
  $("screen").innerHTML = RENDER[state.screen]();
  $("screen").scrollTop = 0;
}

document.body.addEventListener("click", (event) => {
  const screenBtn = event.target.closest("[data-screen]");
  if (screenBtn) {
    state.screen = screenBtn.dataset.screen;
    render();
    return;
  }
  const go = event.target.closest("[data-go]");
  if (go) {
    if (go.dataset.sku) state.sku = go.dataset.sku;
    state.screen = go.dataset.go;
    render();
  }
});

$("navBack").addEventListener("click", () => {
  const info = meta();
  if (info.back) {
    state.screen = info.back;
    render();
  }
});

render();
