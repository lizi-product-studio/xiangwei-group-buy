/* global document, clearTimeout, setTimeout, setInterval */
const ASSETS = {
  hero: "./assets/hero-field.png",
  pickup: "./assets/pickup-point.png",
  potato: "./assets/potato.png",
  corn: "./assets/corn.png",
  greens: "./assets/greens.png",
  tomato: "./assets/tomato.png",
};

const ICONS = {
  home: '<path d="M3.5 11.2 12 4l8.5 7.2v8.3a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  cart: '<path d="M3 4h2.2l2 10.2h10.6l2-7H6"/><circle cx="9" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.6 3.6-5.2 7-5.2s5.8 1.6 7 5.2"/>',
  share: '<path d="M14 5h5v5"/><path d="m19 5-8 8"/><path d="M17 13v5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18V8a1.5 1.5 0 0 1 1.5-1.5h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/>',
  refresh: '<path d="M20 6v5h-5"/><path d="M18.2 15.5a7.5 7.5 0 1 1-.4-7.5L20 11"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2"/><path d="M3.5 10h17"/><circle cx="16.5" cy="14.5" r="1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  box: '<path d="m4 8 8-4 8 4v9l-8 4-8-4z"/><path d="m4 8 8 4 8-4M12 12v9"/>',
  refund: '<path d="M7 7H4v-3"/><path d="M4.5 7A8 8 0 1 1 4 15"/><path d="M9 11h6M9 15h6"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-2zM14 18h2v2h-2z"/>',
  message: '<path d="M4 6h16v11H9l-5 3z"/><path d="M8 10h8M8 13h5"/>',
  location: '<path d="M12 21s6-6.4 6-11a6 6 0 1 0-12 0c0 4.6 6 11 6 11z"/><circle cx="12" cy="10" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 3.5 2.5c-.7.4-1 1-1 1.8V14M12 17h.01"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
};

function icon(name, size = 22) {
  return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const products = [
  { id: "potato", category: "时蔬", title: "坝上黄心土豆", spec: "约 3 斤 / 份", price: "9.90", sold: 15, remain: 45, arrival: "预计到点 9月17—19日", image: ASSETS.potato },
  { id: "corn", category: "鲜食", title: "定兴鲜食甜玉米", spec: "4 根 / 份", price: "12.80", sold: 18, remain: 32, arrival: "预计到点 9月17—19日", image: ASSETS.corn },
  { id: "greens", category: "时蔬", title: "当季鲜嫩小青菜", spec: "250g / 份", price: "6.90", sold: 22, remain: 18, arrival: "预计到点 9月17—19日", image: ASSETS.greens },
  { id: "tomato", category: "鲜食", title: "自然熟沙瓤番茄", spec: "约 500g / 份", price: "8.60", sold: 11, remain: 29, arrival: "预计到点 9月17—19日", image: ASSETS.tomato },
];

const categories = ["全部", "时蔬", "鲜食", "粮油", "熟食", "日用"];
const allCategoryNames = ["时蔬", "鲜食", "粮油干调", "熟食肉蛋", "水产冻品", "乳品糕点", "方便速食", "休闲零食", "日用百货"];
const slides = [
  { image: ASSETS.hero, eyebrow: "本周团购", title: "乡野鲜收\n一起带回家", note: "固定自提点 · 集中到货" },
  { image: ASSETS.corn, eyebrow: "繁兴街限定", title: "鲜食玉米\n今天开团", note: "四根一份 · 数量有限" },
  { image: ASSETS.potato, eyebrow: "产地上新", title: "黄心土豆\n绵软粉糯", note: "预计 9月17—19日到点" },
];

const state = { view: "home", category: "全部", sideCategory: "时蔬", slide: 0, cart: 2, loggedIn: true, displayName: "栗子" };
const phone = document.getElementById("phonePreview");
const admin = document.getElementById("adminPreview");
const screen = document.getElementById("phoneScreen");
const tabbar = document.getElementById("tabbar");
const dialog = document.getElementById("bannerDialog");
const profileDialog = document.getElementById("profileDialog");
const logoutDialog = document.getElementById("logoutDialog");
const toast = document.getElementById("toast");

function productCard(product, compact = false) {
  return `
    <article class="product-card${compact ? " is-compact" : ""}">
      <img src="${product.image}" alt="${product.title}" />
      <div class="product-body">
        <h3>${product.title}</h3>
        <p class="product-spec">${product.spec}</p>
        <span class="arrival-window">${product.arrival}</span>
        <div class="product-bottom">
          <div><div class="price"><small>¥</small><strong>${product.price}</strong></div><p class="stock">已售 ${product.sold} · 剩余 ${product.remain}</p></div>
          <button class="add-cart${compact ? " add-cart--compact" : ""}" data-action="add-cart" data-product="${product.id}">${icon("cart", 15)}<span>加入购物车</span></button>
        </div>
      </div>
    </article>`;
}

function pickupBar() {
  return `
    <div class="pickup-bar">
      <img class="pickup-image" src="${ASSETS.pickup}" alt="繁兴街自提点" />
      <div class="pickup-copy"><small>当前固定自提点</small><strong>繁兴街 ›</strong><span>河北省保定市定兴县固城镇繁兴大街</span></div>
      <button class="icon-button" data-action="share" aria-label="分享">${icon("share", 20)}</button>
    </div>`;
}

function searchBar() {
  return `<div class="search-bar">${icon("search", 17)}<span>搜索本期商品</span><button aria-label="搜索">${icon("search", 18)}</button></div>`;
}

function renderCarousel() {
  return `
    <div class="carousel" aria-label="首页轮播">
      <div class="carousel-track" style="transform:translateX(-${state.slide * 100}%)">
        ${slides.map(slide => `<article class="slide"><img src="${slide.image}" alt="${slide.title.replace("\n", "")}"/><div class="slide-copy"><small>${slide.eyebrow}</small><strong>${slide.title.replace("\n", "<br>")}</strong><span>${slide.note}</span></div></article>`).join("")}
      </div>
      <div class="carousel-dots">${slides.map((_, index) => `<button class="${index === state.slide ? "is-active" : ""}" data-slide="${index}" aria-label="查看第 ${index + 1} 张"></button>`).join("")}</div>
    </div>`;
}

function renderHome() {
  const visible = state.category === "全部" ? products : products.filter(product => product.category === state.category);
  screen.innerHTML = `
    <section class="home-page">
      <div class="home-top">${pickupBar()}${searchBar()}${renderCarousel()}</div>
      <div class="category-strip">${categories.map(name => `<button class="${name === state.category ? "is-active" : ""}" data-category="${name}">${name}</button>`).join("")}</div>
      <div class="campaign-summary"><div><b>本期团购</b><span>今晚 21:00 截单 · 最少 20 件成团</span></div><em>已支付 66 件</em></div>
      <div class="product-list">${visible.map(product => productCard(product)).join("")}</div>
    </section>`;
}

function renderCategory() {
  const visible = products.filter(product => state.sideCategory === "时蔬" ? product.category === "时蔬" : state.sideCategory === "鲜食" ? product.category === "鲜食" : true);
  screen.innerHTML = `
    <section class="category-page">
      <div class="category-search">${searchBar()}</div>
      <div class="category-layout">
        <aside class="category-sidebar">${allCategoryNames.map(name => `<button class="${name === state.sideCategory ? "is-active" : ""}" data-side-category="${name}">${name}</button>`).join("")}</aside>
        <div class="category-products">${visible.map(product => productCard(product, true)).join("")}</div>
      </div>
    </section>`;
}

function renderMine() {
  if (!state.loggedIn) {
    screen.innerHTML = `
      <section class="mine-page">
        <div class="profile-hero profile-hero--guest"><div class="profile-row"><div class="avatar">乡</div><div><b>欢迎来到乡味集</b><span>登录后查看订单、取货码和个人资料</span></div></div></div>
        <div class="mine-content mine-content--guest">
          <article class="mine-card guest-login-card"><span>${icon("user", 28)}</span><h2>当前未登录</h2><p>重新登录后，历史订单和固定自提点仍会恢复。</p><button class="primary-button" data-action="sign-in">手机号快捷登录</button></article>
          <article class="mine-card"><div class="mine-card-title"><h2>仍可使用</h2></div><div class="service-grid"><button data-action="privacy"><i>${icon("doc")}</i><span><b>隐私与协议</b><small>用户协议与隐私说明</small></span></button><button data-action="help"><i>${icon("help")}</i><span><b>帮助中心</b><small>下单、到货与领取说明</small></span></button></div></article>
        </div>
      </section>`;
    return;
  }
  screen.innerHTML = `
    <section class="mine-page">
      <div class="profile-hero"><div class="profile-row"><div class="avatar">${state.displayName.slice(0, 1)}</div><div><b>${state.displayName}</b><span>138****8000 · 手机号已验证</span></div><button class="profile-edit-button" data-action="edit-profile">编辑资料</button></div></div>
      <div class="mine-content">
        <article class="mine-card"><div class="mine-card-title"><h2>我的订单</h2><button>查看全部订单 ›</button></div><div class="order-shortcuts"><button><i>${icon("wallet")}</i>待付款</button><button><i>${icon("clock")}</i>等待成团</button><button><i>${icon("box")}</i>待领取</button><button><i>${icon("refund")}</i>退款/售后</button></div></article>
        <article class="mine-card point-card"><img src="${ASSETS.pickup}" alt="繁兴街自提点"><div><b>繁兴街自提点</b><span>繁兴大街 · 每日 09:00—20:00<br>点位负责人 栗子 · 电话联系</span></div></article>
        <article class="mine-card"><div class="mine-card-title"><h2>常用服务</h2></div><div class="service-grid"><button><i>${icon("qr")}</i><span><b>取货码</b><small>到点出示领取</small></span></button><button><i>${icon("message")}</i><span><b>订单消息</b><small>发车与到货提醒</small></span></button><button><i>${icon("location")}</i><span><b>切换自提点</b><small>当前繁兴街</small></span></button><button><i>${icon("help")}</i><span><b>帮助与客服</b><small>下单领取说明</small></span></button></div></article>
        <article class="mine-card account-card"><div class="mine-card-title"><h2>账号与设置</h2></div><div class="service-grid"><button data-action="edit-profile"><i>${icon("user")}</i><span><b>个人资料</b><small>头像、姓名与手机号</small></span></button><button data-action="privacy"><i>${icon("doc")}</i><span><b>隐私与协议</b><small>用户协议与隐私说明</small></span></button></div><button class="logout-button" data-action="logout">退出当前账号</button></article>
      </div>
    </section>`;
}

function renderTabbar() {
  const tabs = [
    { id: "home", icon: "home", label: "首页" },
    { id: "category", icon: "grid", label: "分类" },
    { id: "cart", icon: "cart", label: "购物车" },
    { id: "mine", icon: "user", label: "我的" },
  ];
  tabbar.innerHTML = tabs.map(tab => `<button class="${state.view === tab.id ? "is-active" : ""}" data-view="${tab.id}"><span class="tab-icon-wrap">${icon(tab.icon, 23)}${tab.id === "cart" ? `<em>${state.cart}</em>` : ""}</span>${tab.label}</button>`).join("");
}

function render() {
  const isAdmin = state.view === "admin";
  phone.hidden = isAdmin;
  admin.hidden = !isAdmin;
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("is-active", button.dataset.view === state.view));
  if (isAdmin) return;
  if (state.view === "category") renderCategory();
  else if (state.view === "mine") renderMine();
  else renderHome();
  renderTabbar();
}

let toastTimer;
function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
}

document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    const requested = viewButton.dataset.view;
    if (requested === "cart") { notify(`购物车中有 ${state.cart} 件商品`); return; }
    state.view = requested;
    render();
    return;
  }
  const categoryButton = event.target.closest("[data-category]");
  if (categoryButton) { state.category = categoryButton.dataset.category; renderHome(); return; }
  const sideButton = event.target.closest("[data-side-category]");
  if (sideButton) { state.sideCategory = sideButton.dataset.sideCategory; renderCategory(); return; }
  const slideButton = event.target.closest("[data-slide]");
  if (slideButton) { state.slide = Number(slideButton.dataset.slide); renderHome(); return; }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === "add-cart") { state.cart += 1; renderTabbar(); notify("已加入本期购物车"); }
  if (action === "share") notify("原型：调起微信分享面板");
  if (["create-banner", "edit-banner"].includes(action)) dialog.showModal();
  if (action === "preview-banner") { state.view = "home"; render(); notify("已切换到消费者首页预览"); }
  if (action === "pause-banner") notify("原型：轮播已停用，历史配置保留");
  if (action === "save-banner") notify("原型：轮播配置已保存");
  if (action === "edit-profile") {
    document.getElementById("profileName").value = state.displayName;
    document.getElementById("profileAvatar").textContent = state.displayName.slice(0, 1);
    profileDialog.showModal();
  }
  if (action === "change-avatar") notify("原型：选择并裁剪新头像");
  if (action === "change-phone") notify("原型：调用微信手机号重新验证，不能手工输入");
  if (action === "save-profile") {
    const nextName = document.getElementById("profileName").value.trim();
    if (nextName) state.displayName = nextName;
    renderMine();
    notify("个人资料已保存");
  }
  if (action === "logout") logoutDialog.showModal();
  if (action === "confirm-logout") { state.loggedIn = false; renderMine(); notify("已退出当前账号"); }
  if (action === "sign-in") { state.loggedIn = true; renderMine(); notify("原型：已恢复登录状态"); }
  if (action === "privacy") notify("原型：打开隐私与协议");
  if (action === "help") notify("原型：打开帮助与客服");
});

setInterval(() => {
  if (state.view !== "home" || document.hidden) return;
  state.slide = (state.slide + 1) % slides.length;
  renderHome();
}, 4500);

render();
