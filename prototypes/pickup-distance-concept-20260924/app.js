const app = document.getElementById('app');
const scenarios = document.querySelectorAll('[data-scenario]');
const photo = '../xiangwei-merchandising-concept-20260915/assets/pickup-point.png';
const points = [
  { id: 'market', name: '定兴三中自提点', address: '定兴镇兴华路 · 第三中学南门旁', distance: 0.8, groups: 2, photo: true },
  { id: 'community', name: '槐树社区便民点', address: '定兴镇通兴东路 · 社区服务站', distance: 2.4, groups: 1 },
  { id: 'corner', name: '北街邻里自提点', address: '定兴镇北街 · 文化广场东侧', distance: 0.3, groups: 0 },
  { id: 'riverside', name: '滨河路便民点', address: '定兴镇滨河路 · 东侧停车场旁', distance: 3.1, groups: 0 },
];
const state = { scenario: 'entry', selected: 'market', dialog: null, toast: '', hadCart: true };
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function pointCard(point) {
  const fixed = state.scenario === 'fixed';
  const selected = fixed || state.selected === point.id;
  const canLocate = state.scenario === 'near';
  const status = fixed ? '本团领取点' : point.groups ? `${point.groups} 个团期` : '暂无团购';
  const action = fixed ? '本团领取点' : selected ? '✓ 当前自提点' : '选择此点';
  return `<article class="point-card ${selected ? 'is-selected' : ''}">
    <div class="point-main">
      ${point.photo ? `<img class="point-photo" src="${photo}" alt="定兴三中自提点照片">` : '<span class="point-photo photo-placeholder" aria-hidden="true">⌖</span>'}
      <div class="point-copy">
        <div class="point-title"><strong>${escapeHtml(point.name)}</strong>${selected ? '<span class="selected-badge">已选</span>' : ''}</div>
        <span class="point-address">${escapeHtml(point.address)}</span>
      </div>
    </div>
    <div class="point-bottom">
      <div class="point-meta"><span class="${point.groups ? 'sale' : 'empty'}">${status}</span>${canLocate ? `<span class="distance">距您约 ${point.distance.toFixed(1)} km</span>` : ''}</div>
      <button type="button" class="point-action ${selected ? 'is-current' : ''}" ${selected ? 'disabled' : `data-point="${point.id}"`}>${action}</button>
    </div>
  </article>`;
}

function switchDialog() {
  if (!state.dialog) return '';
  const point = points.find(item => item.id === state.dialog);
  const noSale = point.groups === 0;
  const description = `${noSale ? '该点位目前暂无团购。' : '切换后仅显示该点位的团期。'}${state.hadCart ? '当前购物车将清空。' : ''}`;
  return `<div class="modal-backdrop"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="switch-title">
    <span class="dialog-icon" aria-hidden="true">⌖</span><h3 id="switch-title">${noSale ? '该点位暂未开团' : '切换自提点'}</h3>
    <p>${description}</p><div class="dialog-actions"><button type="button" data-action="cancel">取消</button><button type="button" class="primary" data-action="confirm">${state.hadCart ? '清空并切换' : '确认切换'}</button></div>
  </div></div>`;
}

function locationDialog() {
  if (state.scenario !== 'entry') return '';
  return `<div class="modal-backdrop"><div class="dialog permission-dialog" role="dialog" aria-modal="true" aria-labelledby="location-title">
    <span class="dialog-icon" aria-hidden="true">⌖</span><h3 id="location-title">使用您的位置</h3>
    <p>按距离展示附近自提点</p><div class="dialog-actions"><button type="button" data-action="deny-location">暂不允许</button><button type="button" class="primary" data-action="allow-location">允许使用</button></div>
  </div></div>`;
}

function render() {
  const fixed = state.scenario === 'fixed';
  const denied = state.scenario === 'denied';
  const sorted = denied ? points : [...points].sort((a, b) => a.distance - b.distance);
  const available = sorted.filter(point => point.groups > 0);
  const others = sorted.filter(point => point.groups === 0);
  const locationStatus = fixed ? '<span class="location-status fixed">本团固定点位</span>' : denied ? '<button type="button" class="location-status retry" data-action="retry-location">⌖ 开启定位</button>' : state.scenario === 'entry' ? '<span class="location-status fixed">等待授权</span>' : '<span class="location-status">⌖ 已定位</span>';
  app.innerHTML = `<div class="screen-scroll">
    <div class="safe-status"><span>9:41</span><span>▮▮ &nbsp; ▰ &nbsp; ●</span></div>
    <div class="nav"><button type="button" class="back" data-action="back" aria-label="返回">‹</button>乡味集<span class="capsule" aria-hidden="true">••• &nbsp; ◎</span></div>
    <div class="intro"><span class="intro-kicker">河北 · 定兴县</span><h2>${fixed ? '本团自提点' : '选择自提点'}</h2></div>
    <div class="content">
      <div class="toolbar"><button type="button" class="region" data-action="region" ${fixed ? 'disabled' : ''}>定兴县 <span>⌄</span></button>${locationStatus}</div>
      ${fixed ? `<div class="list-heading"><h3>领取点</h3></div>${pointCard(points[0])}` : `
        <div class="list-heading"><h3>本期可购</h3><span>${available.length} 个</span></div>
        ${available.map(pointCard).join('')}
        <div class="list-heading other-heading"><h3>其他点位</h3><span>${others.length} 个</span></div>
        ${others.map(pointCard).join('')}`}
    </div>
  </div><div class="bottom-bar" aria-hidden="true"><span class="active"><i>⌂</i>首页</span><span><i>▤</i>购物车</span><span><i>♙</i>我的</span></div>
  ${switchDialog()}${locationDialog()}${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ''}`;
  scenarios.forEach(button => button.classList.toggle('active', button.dataset.scenario === state.scenario));
}

function flash(message) {
  state.toast = message;
  render();
  window.setTimeout(() => { state.toast = ''; render(); }, 2200);
}

document.addEventListener('click', event => {
  const scenario = event.target.closest('[data-scenario]');
  if (scenario) { state.scenario = scenario.dataset.scenario; state.dialog = null; state.toast = ''; render(); return; }
  const pointButton = event.target.closest('[data-point]');
  if (pointButton) { state.dialog = pointButton.dataset.point; render(); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'cancel') { state.dialog = null; render(); }
  else if (action === 'confirm' && state.dialog) { state.selected = state.dialog; state.dialog = null; state.hadCart = false; flash('已切换自提点'); }
  else if (action === 'allow-location') { state.scenario = 'near'; render(); }
  else if (action === 'deny-location') { state.scenario = 'denied'; render(); }
  else if (action === 'retry-location') { state.scenario = 'entry'; render(); }
  else if (action === 'region') flash('原型仅展示定兴县');
  else if (action === 'back') flash('原型预览：返回上一页');
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.dialog) { state.dialog = null; render(); } });
render();
