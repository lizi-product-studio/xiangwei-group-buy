const app = document.getElementById('app');
const assets = '../xiangwei-merchandising-concept-20260915/assets/';
const groups = [
  {
    id: 'school', point: '定兴三中自提点', area: '定兴县', address: '兴华路 · 第三中学南门旁',
    campaign: '周五鲜食团', cutoff: '9月30日 20:00', pickup: '10月2日 16:00—20:00',
    product: '本地鲜甜玉米 4根装', detail: '现采现发 · 4根装', price: 1280, image: `${assets}corn.png`, code: '583 214',
  },
  {
    id: 'community', point: '槐树社区便民点', area: '定兴县', address: '通兴东路 · 社区服务站',
    campaign: '周六蔬菜团', cutoff: '10月1日 20:00', pickup: '10月3日 16:00—20:00',
    product: '新鲜小青菜 500g', detail: '当日采摘 · 500g', price: 690, image: `${assets}greens.png`, code: '906 741',
  },
];
const points = [
  { id: 'school', name: '定兴三中自提点', address: '定兴镇兴华路 · 第三中学南门旁', distance: 0.8, campaigns: 2, photo: true },
  { id: 'community', name: '槐树社区便民点', address: '定兴镇通兴东路 · 社区服务站', distance: 2.4, campaigns: 1 },
  { id: 'corner', name: '北街邻里自提点', address: '定兴镇北街 · 文化广场东侧', distance: 0.3, campaigns: 0 },
  { id: 'riverside', name: '滨河路便民点', address: '定兴镇滨河路 · 东侧停车场旁', distance: 3.1, campaigns: 0 },
];
const state = {
  page: 'shop', point: 'school', cart: { school: 1, community: 0 },
  selected: { school: true, community: true }, dialog: '', pendingPoint: '', paid: false, paidLines: [], refundCommunity: false, toast: '',
};
const money = cents => `¥${(cents / 100).toFixed(2)}`;
const count = () => Object.values(state.cart).reduce((sum, qty) => sum + qty, 0);
const cartGroups = () => groups.filter(group => state.cart[group.id] > 0);
const checkoutGroups = () => cartGroups().filter(group => state.selected[group.id]);
const paidGroups = () => state.paidLines.map(line => ({ ...groups.find(group => group.id === line.id), quantity: line.quantity }));
const total = selectedOnly => (selectedOnly ? checkoutGroups() : cartGroups()).reduce((sum, group) => sum + group.price * state.cart[group.id], 0);

function header() {
  const title = { shop: '乡味集', pickup: '乡味集', cart: '购物车', checkout: '确认订单', orders: '我的订单' }[state.page];
  return `<div class="safe-status"><span>9:41</span><span>▮▮ &nbsp; ▰ &nbsp; ●</span></div><div class="nav">${state.page === 'checkout' ? '<button class="back" data-action="cart" aria-label="返回购物车">‹</button>' : state.page === 'pickup' ? '<button class="back" data-action="shop" aria-label="返回首页">‹</button>' : ''}${title}<span class="capsule" aria-hidden="true">••• &nbsp; ◎</span></div>`;
}

function shop() {
  const group = groups.find(item => item.id === state.point);
  const point = points.find(item => item.id === state.point);
  return `<div class="shop-hero"><span>乡味集 · 本期团购</span><h2>好味道，到点领取</h2></div>
    <div class="content shop-content">
      <button class="pickup-switch" data-action="pick-point"><span class="pickup-mark">⌖</span><span><small>当前自提点</small><strong>${point.name}</strong></span><b>切换 ›</b></button>
      ${group ? `
      <div class="section-heading"><h3>${group.campaign}</h3><small>截单 ${group.cutoff}</small></div>
      <article class="product-card"><img src="${group.image}" alt="${group.product}"><div class="product-info"><h3>${group.product}</h3><p>${group.detail}</p><div class="product-bottom"><b>${money(group.price)}</b><button data-action="add" data-id="${group.id}">加入购物车</button></div></div></article>
      <div class="pickup-note"><span>⌖</span><span>${group.pickup}<br>${group.address}</span></div>` : '<div class="empty-state">该点位暂未开团<button data-action="pick-point">选择其他自提点</button></div>'}
    </div>`;
}

function pointCard(point) {
  const current = state.point === point.id;
  return `<article class="point-card ${current ? 'is-selected' : ''}"><div class="point-main">
    ${point.photo ? `<img class="point-photo" src="${assets}pickup-point.png" alt="${point.name}照片">` : '<span class="point-photo photo-placeholder" aria-hidden="true">⌖</span>'}
    <div class="point-copy"><div class="point-title"><strong>${point.name}</strong>${current ? '<span class="selected-badge">已选</span>' : ''}</div><span class="point-address">${point.address}</span></div></div>
    <div class="point-bottom"><div class="point-meta"><span class="${point.campaigns ? 'sale' : 'empty'}">${point.campaigns ? `${point.campaigns} 个团期` : '暂无团购'}</span><span class="distance">距您约 ${point.distance.toFixed(1)} km</span></div>
    <button class="point-action ${current ? 'is-current' : ''}" ${current ? 'disabled' : `data-action="select-point" data-id="${point.id}"`}>${current ? '✓ 当前自提点' : '选择此点'}</button></div></article>`;
}

function pickup() {
  const sorted = [...points].sort((a, b) => a.distance - b.distance);
  const available = sorted.filter(point => point.campaigns > 0);
  const others = sorted.filter(point => !point.campaigns);
  return `<div class="intro"><span class="intro-kicker">河北 · 定兴县</span><h2>选择自提点</h2></div><div class="content pickup-content">
    <div class="toolbar"><button class="region" data-action="region">定兴县 <span>⌄</span></button><span class="location-status">⌖ 已定位</span></div>
    <div class="list-heading"><h3>本期可购</h3><span>${available.length} 个</span></div>${available.map(pointCard).join('')}
    <div class="list-heading other-heading"><h3>其他点位</h3><span>${others.length} 个</span></div>${others.map(pointCard).join('')}
  </div>`;
}

function cartGroup(group) {
  const qty = state.cart[group.id];
  return `<article class="group-card">
    <div class="group-head"><button class="group-check ${state.selected[group.id] ? 'checked' : ''}" data-action="toggle" data-id="${group.id}" aria-label="${state.selected[group.id] ? '取消选择' : '选择'}${group.point}">${state.selected[group.id] ? '✓' : ''}</button><div><strong>${group.point}</strong><small>${group.campaign} · ${group.pickup}</small></div></div>
    <div class="cart-product"><img src="${group.image}" alt="${group.product}"><div><b>${group.product}</b><small>${group.detail}</small><span>${money(group.price)}</span></div><div class="quantity"><button data-action="minus" data-id="${group.id}" aria-label="减少${group.product}数量">−</button><span>${qty}</span><button data-action="plus" data-id="${group.id}" aria-label="增加${group.product}数量">+</button></div></div>
    <div class="group-foot"><span>小计 ${money(group.price * qty)}</span><button data-action="remove" data-id="${group.id}">移除</button></div>
  </article>`;
}

function cart() {
  const active = cartGroups();
  return `<div class="content cart-content"><div class="page-heading"><h2>购物车</h2><span>${count()} 件商品</span></div>
    ${active.length ? active.map(cartGroup).join('') : '<div class="empty-state">购物车还是空的<button data-action="shop">去逛团购</button></div>'}
  </div>${active.length ? `<div class="pay-bar"><div><small>已选 ${checkoutGroups().length} 组</small><b>${money(total(true))}</b></div><button data-action="checkout" ${checkoutGroups().length ? '' : 'disabled'}>去结算</button></div>` : ''}`;
}

function checkoutCard(group, index) {
  return `<article class="checkout-card"><div class="checkout-head"><span>订单 ${index + 1}</span><b>${group.point}</b></div><div class="checkout-sub">${group.campaign} · ${group.pickup}</div><div class="checkout-item"><img src="${group.image}" alt="${group.product}"><span>${group.product}<small>×${state.cart[group.id]}</small></span><b>${money(group.price * state.cart[group.id])}</b></div></article>`;
}

function checkout() {
  const selected = checkoutGroups();
  return `<div class="content checkout-content"><div class="page-heading"><h2>确认订单</h2></div><div class="split-notice"><b>${selected.length} 个团期 · ${new Set(selected.map(group => group.point)).size} 处自提</b><span>付款前请核对每处领取时间</span></div>
    ${selected.map(checkoutCard).join('')}<div class="total-line"><span>合计</span><b>${money(total(true))}</b></div>
  </div><div class="pay-bar"><div><small>一次支付</small><b>${money(total(true))}</b></div><button data-action="pay">确认并支付</button></div>`;
}

function orderCard(group, index) {
  const refunded = group.id === 'community' && state.refundCommunity;
  return `<article class="order-card"><div class="order-top"><span>订单 ${index + 1}</span><b class="${refunded ? 'refunded' : ''}">${refunded ? '已退款' : '待提货'}</b></div><h3>${group.point}</h3><p>${group.campaign} · ${group.pickup}</p><div class="order-item"><img src="${group.image}" alt="${group.product}"><span>${group.product} ×${group.quantity}</span><strong>${money(group.price * group.quantity)}</strong></div><div class="code"><small>${refunded ? '提货码已失效' : '提货码'}</small><b>${refunded ? '— — — — — —' : group.code}</b></div></article>`;
}

function orders() {
  if (!state.paid) return '<div class="content"><div class="page-heading"><h2>我的订单</h2></div><div class="empty-state">暂无本次演示订单<button data-action="cart">查看购物车</button></div></div>';
  const selected = paidGroups();
  return `<div class="content orders-content"><div class="success-head"><span class="success-icon">✓</span><h2>支付成功</h2><p>一次付款 · ${selected.length} 张订单</p></div>
    ${selected.map(orderCard).join('')}
    ${selected.some(group => group.id === 'community') && !state.refundCommunity ? '<button class="demo-action" data-action="refund">模拟第 2 团取消</button>' : ''}
    ${state.refundCommunity ? `<div class="refund-note">第 2 团已单独退款 ${money(groups[1].price * (selected.find(group => group.id === 'community')?.quantity ?? 0))}；第 1 团仍可正常提货。</div>` : ''}
    <button class="reset-action" data-action="reset">重新体验</button>
  </div>`;
}

function switchDialog() {
  if (state.dialog !== 'switch') return '';
  const point = points.find(item => item.id === state.pendingPoint);
  return `<div class="modal-backdrop"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="switch-title"><span class="dialog-icon">⌖</span><h3 id="switch-title">${point.campaigns ? '切换自提点' : '该点位暂未开团'}</h3><p>${point.campaigns ? '切换后显示该点位的团期。' : '切换后可查看点位信息。'}购物车中的商品会保留，结算时分别确认领取地点。</p><div class="dialog-actions"><button data-action="close">取消</button><button class="primary" data-action="confirm-switch">确认切换</button></div></div></div>`;
}

function payDialog() {
  if (state.dialog !== 'pay') return '';
  const selected = checkoutGroups();
  return `<div class="modal-backdrop"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="pay-title"><span class="dialog-icon">⌖</span><h3 id="pay-title">确认领取地点</h3><p>本次商品需在 ${new Set(selected.map(group => group.point)).size} 处分别领取：</p><div class="dialog-points">${selected.map(group => `<div><b>${group.point}</b><span>${group.pickup}</span></div>`).join('')}</div><div class="dialog-actions"><button data-action="close">再看看</button><button class="primary" data-action="confirm-pay">模拟支付 ${money(total(true))}</button></div></div></div>`;
}

function bottomNav() {
  if (state.page === 'checkout') return '';
  return `<div class="bottom-bar"><button class="${state.page === 'shop' ? 'active' : ''}" data-action="shop"><i>⌂</i>首页</button><button class="${state.page === 'cart' ? 'active' : ''}" data-action="cart"><i>▤</i>购物车${count() ? `<em>${count()}</em>` : ''}</button><button class="${state.page === 'orders' ? 'active' : ''}" data-action="orders"><i>♙</i>订单</button></div>`;
}

function render() {
  const content = { shop, pickup, cart, checkout, orders }[state.page]();
  app.dataset.page = state.page;
  app.innerHTML = `<div class="screen-scroll">${header()}${content}</div>${bottomNav()}${switchDialog()}${payDialog()}${state.toast ? `<div class="toast" role="status">${state.toast}</div>` : ''}`;
}

function flash(message) {
  state.toast = message;
  render();
  window.setTimeout(() => { state.toast = ''; app.querySelector('.toast')?.remove(); }, 2100);
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const action = control.dataset.action;
  const id = control.dataset.id;
  if (action === 'close') { state.dialog = ''; render(); }
  else if (action === 'pick-point') { state.page = 'pickup'; render(); }
  else if (action === 'select-point') { state.pendingPoint = id; state.dialog = 'switch'; render(); }
  else if (action === 'confirm-switch') { state.point = state.pendingPoint; state.pendingPoint = ''; state.dialog = ''; state.page = 'shop'; flash('已切换自提点'); }
  else if (action === 'region') flash('原型仅展示定兴县');
  else if (action === 'add') { state.cart[id] = Math.min(9, state.cart[id] + 1); state.selected[id] = true; flash('已加入购物车'); }
  else if (action === 'toggle') { state.selected[id] = !state.selected[id]; render(); }
  else if (action === 'plus') { state.cart[id] = Math.min(9, state.cart[id] + 1); render(); }
  else if (action === 'minus') { state.cart[id] = Math.max(1, state.cart[id] - 1); render(); }
  else if (action === 'remove') { state.cart[id] = 0; render(); }
  else if (action === 'checkout' && checkoutGroups().length) { state.page = 'checkout'; render(); }
  else if (action === 'pay') { state.dialog = 'pay'; render(); }
  else if (action === 'confirm-pay') { state.paidLines = checkoutGroups().map(group => ({ id: group.id, quantity: state.cart[group.id] })); state.paidLines.forEach(line => { state.cart[line.id] = 0; }); state.dialog = ''; state.paid = true; state.page = 'orders'; render(); }
  else if (action === 'refund') { state.refundCommunity = true; render(); }
  else if (action === 'reset') { state.page = 'shop'; state.point = 'school'; state.cart = { school: 1, community: 0 }; state.selected = { school: true, community: true }; state.paid = false; state.paidLines = []; state.refundCommunity = false; state.dialog = ''; render(); }
  else if (['shop', 'cart', 'orders'].includes(action)) { state.page = action; state.dialog = ''; render(); }
});
render();
