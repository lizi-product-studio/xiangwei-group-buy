const icon = (name) => {
  const paths = {
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.9 9A7 7 0 0 1 18 6.2L20 12M4 12l2.1 5.8A7 7 0 0 0 18.2 15"/>',
    arrow: '<path d="M5 12h14m0 0-5-5m5 5-5 5"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
    close: '<path d="M5 5 19 19M19 5 5 19"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => `¥${Number(v).toFixed(2)}`;
const maskPhone = p => p ? `${p.slice(0,3)}****${p.slice(-4)}` : '未绑定';

const navigation = [
  ['工作台', [['overview','工作台']]],
  ['商品与营销', [['products','商品列表'],['categories','分类管理'],['campaigns','团期管理'],['banners','首页轮播']]],
  ['订单与售后', [['orders','订单列表'],['cancellations','取消申请'],['quality','品质售后'],['differences','履约差异']]],
  ['履约', [['logistics','发货与运输'],['arrival','到货异常']]],
  ['区域与自提点', [['areas','区域管理'],['sites','自提点管理']]],
  ['用户与通知', [['users','用户管理'],['notifications','通知处理']]],
  ['财务', [['refunds','退款待办'],['refund-records','退款记录'],['ledger','账务流水']]],
  ['系统', [['staff','员工管理'],['roles','角色与权限'],['audit','操作日志']]],
  ['原型说明', [['spec','设计规范']]],
];
const users = [
  {id:1,name:'林女士',phone:'13800006821',status:'正常',created:'2026-09-08 10:25',orders:8,verified:true},
  {id:2,name:'周先生',phone:'13900002764',status:'正常',created:'2026-09-10 17:42',orders:4,verified:true},
  {id:3,name:'李女士',phone:'13700003618',status:'正常',created:'2026-09-14 09:08',orders:3,verified:true},
  {id:4,name:'陈先生',phone:'13600009403',status:'停用',created:'2026-09-19 15:21',orders:1,verified:false},
];
const orders = [
  {id:'XW202609230001',userId:1,name:'林女士',phone:'13800006821',campaign:'秋日邻里好物',point:'定兴三中自提点',amount:48.60,status:'待领取',created:'2026-09-23 09:12',paid:'2026-09-23 09:15',item:'橡皮 · 2 件'},
  {id:'XW202609230002',userId:2,name:'周先生',phone:'13900002764',campaign:'秋日邻里好物',point:'定兴三中自提点',amount:26.80,status:'待成团',created:'2026-09-23 08:34',paid:'2026-09-23 08:36',item:'鲜鸡蛋 · 1 盒'},
  {id:'XW202609220018',userId:3,name:'李女士',phone:'13700003618',campaign:'周末鲜食团',point:'繁兴街自提点',amount:62.00,status:'已完成',created:'2026-09-22 18:20',paid:'2026-09-22 18:24',item:'蔬菜礼包 · 1 份'},
  {id:'XW202609220014',userId:1,name:'林女士',phone:'13800006821',campaign:'周末鲜食团',point:'繁兴街自提点',amount:19.90,status:'退款中',created:'2026-09-22 13:16',paid:'2026-09-22 13:18',item:'水果组合 · 1 份'},
  {id:'XW202609210011',userId:4,name:'陈先生',phone:'13600009403',campaign:'秋日邻里好物',point:'定兴三中自提点',amount:12.50,status:'待付款',created:'2026-09-21 11:03',paid:'',item:'鲜玉米 · 2 根'},
  {id:'XW202609200008',userId:2,name:'周先生',phone:'13900002764',campaign:'周末鲜食团',point:'繁兴街自提点',amount:35.00,status:'已取消',created:'2026-09-20 14:02',paid:'2026-09-20 14:05',item:'手作面包 · 2 份'},
];
const plans = [
  {id:'L-01',campaign:'秋日邻里好物',point:'定兴三中自提点',status:'待登记',campaignStatus:'已锁单',carrier:'',driver:''},
  {id:'L-02',campaign:'周末鲜食团',point:'繁兴街自提点',status:'待发车',campaignStatus:'已锁单',carrier:'平台自送',driver:'王师傅'},
  {id:'L-03',campaign:'洗米',point:'定兴三中自提点',status:'待登记',campaignStatus:'已取消',carrier:'',driver:''},
  {id:'L-04',campaign:'测试专用',point:'繁兴街自提点',status:'待登记',campaignStatus:'已取消',carrier:'',driver:''},
  {id:'L-05',campaign:'上周家庭好物',point:'定兴三中自提点',status:'已到货',campaignStatus:'已完成',carrier:'平台自送',driver:'刘师傅'},
];
const labels = Object.fromEntries(navigation.flatMap(([group, items]) => items.map(([key, label]) => [key,{group,label}])));
const state = {
  page: 'orders', modal: null, toast: '', scenario: 'normal', logisticsScenario: 'all',
  orderFilters: {key:'',status:'',campaign:'',point:'',dateType:'created',from:'',to:''},
  userFilters: {key:'',status:''}, orderPage: 1, orderPageSize: 5, refreshing:false,
};
let toastTimer;
function showToast(message) {
  state.toast = message; render(); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {state.toast=''; render();}, 3000);
}
const status = value => {
  const style = ['待领取','已完成','正常','已锁单','已到货'].includes(value) ? 'green'
    : ['待成团','待付款','待登记','待发车','退款中'].includes(value) ? 'amber'
    : value === '已取消' ? 'gray' : value === '停用' ? 'red' : 'gray';
  return `<span class="status status-${style}">${esc(value)}</span>`;
};
function pageHead(kicker, title, desc, extra='') {
  return `<header class="page-head"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${extra || '<div class="page-note"><span class="note-dot"></span>示例数据 · 仅供确认设计</div>'}</header>`;
}
function shell(content) {
  const current = labels[state.page] || {group:'',label:''};
  return `<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">乡</div><div><strong>乡味集</strong><span>运营管理后台</span></div></div><div class="side-scroll">${navigation.map(([group, items]) => `<div class="nav-group"><div class="nav-label">${esc(group)}</div>${items.map(([key,label]) => `<button class="nav-button ${state.page===key?'active':''}" data-page="${key}" ${state.page===key?'aria-current="page"':''}>${esc(label)}</button>`).join('')}</div>`).join('')}</div><div class="side-footer"><div class="avatar">管</div><div><strong>管理员</strong><small>超级管理员 · 演示视角</small></div></div></aside><div class="workspace"><div class="topbar"><div class="crumb"><span>${esc(current.group)}</span><span class="crumb-divider">/</span><strong>${esc(current.label)}</strong></div><div class="top-right"><span class="prototype-pill">设计提案 · 非真实数据</span><button class="top-refresh" data-action="refresh" aria-label="刷新页面" title="刷新当前页">↻</button></div></div><main class="main">${content}</main></div></div>${state.modal?modal():''}${state.toast?`<div class="toast" role="status">${esc(state.toast)}</div>`:''}`;
}
function filteredOrders() {
  const f = state.orderFilters;
  if (state.scenario === 'empty') return [];
  return orders.filter(o => {
    const needle = f.key.trim().toLowerCase();
    if (needle && ![o.id,String(o.userId),o.phone,o.name].some(v => v.toLowerCase().includes(needle))) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.campaign && o.campaign !== f.campaign) return false;
    if (f.point && o.point !== f.point) return false;
    const date = (f.dateType === 'paid' ? o.paid : o.created).slice(0,10);
    if (f.from && (!date || date < f.from)) return false;
    if (f.to && (!date || date > f.to)) return false;
    return true;
  });
}
function option(value, label, current) { return `<option value="${esc(value)}" ${current===value?'selected':''}>${esc(label)}</option>`; }
function renderOrders() {
  const f = state.orderFilters, values = filteredOrders();
  const start = (state.orderPage-1)*state.orderPageSize, shown = values.slice(start,start+state.orderPageSize);
  const totalPages = Math.max(1,Math.ceil(values.length/state.orderPageSize));
  return `${pageHead('订单 · ORDER MANAGEMENT','订单列表','订单查询、联系用户与导出，在一个清晰的工作入口完成。')}
    <div class="scenario-bar"><strong>查看状态</strong><button class="chip ${state.scenario==='normal'?'active':''}" data-scenario="normal">正常列表</button><button class="chip ${state.scenario==='empty'?'active':''}" data-scenario="empty">空数据</button><button class="chip ${state.scenario==='loading'?'active':''}" data-scenario="loading">首次加载</button></div>
    <section class="panel"><div class="panel-head"><strong>筛选订单</strong><span>筛选结果与导出范围保持一致</span></div>
      <div class="filters">
        <div class="field"><label for="order-key">关键词</label><input id="order-key" placeholder="订单号 / 用户ID / 手机号" value="${esc(f.key)}" /></div>
        <div class="field"><label for="order-status">订单状态</label><select id="order-status">${option('','全部状态',f.status)}${['待付款','待成团','待领取','已完成','退款中','已取消'].map(v=>option(v,v,f.status)).join('')}</select></div>
        <div class="field"><label for="order-campaign">团期</label><select id="order-campaign">${option('','全部团期',f.campaign)}${['秋日邻里好物','周末鲜食团'].map(v=>option(v,v,f.campaign)).join('')}</select></div>
        <div class="field"><label for="order-point">自提点</label><select id="order-point">${option('','全部自提点',f.point)}${['定兴三中自提点','繁兴街自提点'].map(v=>option(v,v,f.point)).join('')}</select></div>
        <div class="field"><label for="order-date-type">时间范围</label><div class="date-wrap"><select id="order-date-type" aria-label="时间类型">${option('created','下单',f.dateType)}${option('paid','支付',f.dateType)}</select><input id="order-from" aria-label="开始日期" type="date" value="${esc(f.from)}" /><span>—</span><input id="order-to" aria-label="结束日期" type="date" value="${esc(f.to)}" /></div></div>
        <div class="filter-actions"><button class="btn btn-primary" data-action="search-orders">${icon('search')}查询</button><button class="btn btn-quiet" data-action="reset-orders">重置</button></div>
      </div></section>
    <section class="panel"><div class="toolbar"><div class="toolbar-summary">${state.refreshing?'正在刷新，列表保持可见 · ':''}共 <b>${values.length}</b> 笔匹配订单 · ${state.scenario==='loading'?'加载预览':`第 ${Math.min(state.orderPage,totalPages)} / ${totalPages} 页`}</div><div class="toolbar-actions"><button class="btn" data-action="export-orders" ${values.length===0?'disabled':''}>${icon('download')}导出筛选结果</button></div></div>
      ${state.scenario==='loading'?`<div style="height:290px;padding-top:3px"><div class="skeleton wide"></div><div class="skeleton medium"></div><div class="skeleton wide"></div><div class="skeleton short"></div></div>`:
      values.length===0?empty('没有符合条件的订单','调整筛选条件后重试；真实系统不会把加载失败显示成空数据。'):
      `<div class="table-scroll"><table aria-label="订单列表"><thead><tr><th style="width:23%">订单 / 用户</th><th style="width:18%">商品</th><th style="width:13%">团期 / 自提点</th><th style="width:13%">下单时间</th><th style="width:10%" class="text-right">实付金额</th><th style="width:10%">状态</th><th style="width:13%">操作</th></tr></thead><tbody>${shown.map(o=>`<tr><td><span class="cell-main mono">${esc(o.id)}</span><span class="cell-sub">用户ID ${o.userId} · ${esc(maskPhone(o.phone))}</span></td><td><span class="cell-main">${esc(o.item)}</span></td><td><span class="cell-main">${esc(o.campaign)}</span><span class="cell-sub">${esc(o.point)}</span></td><td class="mono">${esc(o.created)}</td><td class="text-right money mono">${money(o.amount)}</td><td>${status(o.status)}</td><td><div class="actions"><button class="btn btn-sm" data-action="order-detail" data-id="${esc(o.id)}">查看详情 ${icon('arrow')}</button></div></td></tr>`).join('')}</tbody></table></div>
      <div class="pagination"><span>每页 ${state.orderPageSize} 笔 · 共 ${values.length} 笔</span><div class="pages"><button class="page-btn" data-action="order-prev" ${state.orderPage<=1?'disabled':''}>‹</button><button class="page-btn current">${Math.min(state.orderPage,totalPages)}</button><button class="page-btn" data-action="order-next" ${state.orderPage>=totalPages?'disabled':''}>›</button></div></div>`}</section>`;
}
function empty(title, desc) { return `<div class="empty"><div class="empty-icon">⌕</div><strong>${esc(title)}</strong><span>${esc(desc)}</span></div>`; }
function filteredUsers() {
  const {key,status:filterStatus} = state.userFilters;
  return users.filter(u => (!key || [String(u.id),u.name,u.phone].some(v=>v.includes(key.trim()))) && (!filterStatus || u.status===filterStatus));
}
function renderUsers() {
  const f=state.userFilters, values=filteredUsers();
  return `${pageHead('用户 · CUSTOMER MANAGEMENT','用户管理','列表方便检索，详情满足客服联系需要。')}
    <div class="overview"><div class="metric"><label>用户总数</label><strong>4<small>示例</small></strong></div><div class="metric"><label>手机号已认证</label><strong>3</strong></div><div class="metric"><label>待跟进用户</label><strong class="brand-number">1</strong></div></div>
    <section class="panel"><div class="panel-head"><strong>用户查询</strong><span>完整手机号仅在授权详情中展示</span></div><div class="filters user-filters"><div class="field"><label for="user-key">关键词</label><input id="user-key" placeholder="用户ID / 姓名 / 手机号" value="${esc(f.key)}" /></div><div class="field"><label for="user-status">账号状态</label><select id="user-status">${option('','全部状态',f.status)}${option('正常','正常',f.status)}${option('停用','停用',f.status)}</select></div><div class="filter-actions"><button class="btn btn-primary" data-action="search-users">${icon('search')}查询</button><button class="btn btn-quiet" data-action="reset-users">重置</button></div></div>
      <div class="toolbar"><div class="toolbar-summary">共 <b>${values.length}</b> 位用户</div><div class="toolbar-actions"><span class="page-note">详情查看会留下访问记录</span></div></div>
      ${values.length===0?empty('没有匹配的用户','换一个用户ID或手机号再试。'):`<div class="table-scroll"><table aria-label="用户列表"><thead><tr><th style="width:12%">用户ID</th><th style="width:20%">姓名</th><th style="width:20%">手机号</th><th style="width:17%">注册时间</th><th style="width:13%">订单数</th><th style="width:10%">状态</th><th style="width:15%">操作</th></tr></thead><tbody>${values.map(u=>`<tr><td><span class="cell-main mono">${u.id}</span></td><td><span class="cell-main">${esc(u.name)}</span></td><td class="mono">${esc(maskPhone(u.phone))}</td><td class="mono">${esc(u.created)}</td><td class="mono">${u.orders}</td><td>${status(u.status)}</td><td><div class="actions"><button class="btn btn-sm" data-action="user-detail" data-id="${u.id}">查看详情 ${icon('arrow')}</button></div></td></tr>`).join('')}</tbody></table></div><div class="pagination"><span>显示 ${values.length} 位用户</span><span>用户ID从 1 开始，不复用</span></div>`}</section>`;
}
function visiblePlans() {
  if (state.logisticsScenario==='cancelled') return plans.filter(p=>p.campaignStatus==='已取消');
  if (state.logisticsScenario==='normal') return plans.filter(p=>!['已取消','已完成'].includes(p.campaignStatus));
  if (state.logisticsScenario==='empty') return [];
  return plans;
}
function renderLogistics() {
  const list=visiblePlans();
  return `${pageHead('履约 · DELIVERY WORKFLOW','发货与运输','任务按团期状态展示，不能做的事不再留给用户点完后报错。')}
    <div class="scenario-bar"><strong>对比状态</strong>${[['all','全部'],['normal','可操作团期'],['cancelled','已取消'],['empty','空数据'],['loading','首次加载']].map(([key,label])=>`<button class="chip ${state.logisticsScenario===key?'active':''}" data-logistics-scenario="${key}">${label}</button>`).join('')}</div>
    <div class="workflow-note">${icon('info')}<span><strong>状态决定操作：</strong>已取消或已完成的团期只留记录与原因，不提供登记、编辑、发车入口。</span></div>
    <section class="panel"><div class="panel-head"><strong>发货任务</strong><span>当前展示 ${list.length} 个团期</span></div>
      ${state.logisticsScenario==='loading'?`<div style="height:320px;padding-top:8px"><div class="skeleton wide"></div><div class="skeleton medium"></div><div class="skeleton wide"></div><div class="skeleton short"></div></div>`:
      list.length===0?empty('暂无发货任务','任务状态与权限已核对，创建团期后会在这里显示。'):
      `<div class="table-scroll"><table aria-label="发货任务"><thead><tr><th style="width:25%">团期</th><th style="width:16%">团期状态</th><th style="width:18%">运输状态</th><th style="width:20%">自提点</th><th style="width:18%">下一步</th><th style="width:23%">操作</th></tr></thead><tbody>${list.map(p=>{
        const terminal=['已取消','已完成'].includes(p.campaignStatus);
        const next=p.campaignStatus==='已取消'?'团期已取消':p.campaignStatus==='已完成'?'履约已结束':p.status==='待登记'?'登记运输信息':p.status==='待发车'?'复核后发车':'等待自提点到货';
        return `<tr class="${terminal?'is-terminal':''}"><td><span class="cell-main">${esc(p.campaign)}</span><span class="cell-sub">团期 ${esc(p.id)}</span></td><td>${status(p.campaignStatus)}</td><td>${terminal?'<span class="empty-dash">—</span>':status(p.status)}${!terminal&&p.carrier?`<span class="cell-sub">${esc(p.carrier)} · ${esc(p.driver)}</span>`:''}</td><td>${esc(p.point)}</td><td>${terminal?`<span class="cell-sub" style="margin-top:0">${esc(next)}</span>`:`<span class="cell-main">${esc(next)}</span>`}</td><td><div class="actions">${terminal?'<span class="empty-dash">—</span>':p.status==='待登记'?`<button class="btn btn-sm" data-action="register" data-id="${p.id}">登记运输信息</button>`:p.status==='待发车'?`<button class="btn btn-sm" data-action="edit-transport" data-id="${p.id}">编辑运输</button><button class="btn btn-primary btn-sm" data-action="dispatch" data-id="${p.id}">确认发车</button>`:'<span class="empty-dash">—</span>'}</div></td></tr>`;
      }).join('')}</tbody></table></div><div class="pagination"><span>终态保留可追溯记录，不再显示无效操作</span><span>每行最多一个强调操作</span></div>`}</section>
    <div class="logic-list"><div class="logic-card"><small>01 · LIST</small><strong>先判断再操作</strong><p>列表直接显示团期终态，避免先填信息、到最后才被阻止。</p></div><div class="logic-card"><small>02 · REVIEW</small><strong>发车前再复核</strong><p>有效团期发车前展示订单与运输摘要，再执行不可逆的发车动作。</p></div><div class="logic-card"><small>03 · SERVER</small><strong>接口仍校验</strong><p>页面拦截改善体验，服务端校验负责防止旧页面或并发状态绕过。</p></div></div>`;
}
function renderSpec() {
  return `${pageHead('DESIGN SYSTEM · 01','设计规范','先统一按钮、信息层级和状态呈现，再应用到所有页面。')}
    <div class="spec-grid"><section class="spec-card"><h2>按钮层级</h2><p>同一操作区只突出一个决定性动作；普通操作克制，危险操作单独确认。</p><div class="spec-actions"><button class="btn btn-primary" data-action="spec-toast">确认发车</button><button class="btn" data-action="spec-toast">编辑运输</button><button class="btn btn-quiet" data-action="spec-toast">重置筛选</button><button class="btn btn-danger" data-action="spec-toast">停用</button></div></section>
    <section class="spec-card"><h2>品牌与状态颜色</h2><p>品牌红只表示主操作；绿表示已完成，琥珀表示待办，灰表示终态或不适用。</p><div class="swatches"><div class="swatch"><i style="background:#bb432f"></i><b>品牌红</b>#BB432F</div><div class="swatch"><i style="background:#276a4d"></i><b>完成绿</b>#276A4D</div><div class="swatch"><i style="background:#936416"></i><b>待办琥珀</b>#936416</div><div class="swatch"><i style="background:#f0f2ef"></i><b>终态灰</b>#F0F2EF</div></div></section>
    <section class="spec-card"><h2>表格与布局</h2><p>页面标题、筛选、结果、分页形成固定顺序，操作列保持左对齐并尽量简短。</p><div class="spec-rule"><b>控件高度</b><span>主按钮 / 输入框 36–40 px</span></div><div class="spec-rule"><b>内容对齐</b><span>文字左、金额右、状态不跳行</span></div><div class="spec-rule"><b>页面间距</b><span>8 px 基础网格 · 24 px 主区间距</span></div><div class="spec-rule"><b>信息密度</b><span>主信息一行，辅助信息一行</span></div></section>
    <section class="spec-card"><h2>加载与异常</h2><p>首次加载用稳定骨架保留版面；刷新不遮挡已有数据；出错明确说明并提供重试。</p><div class="skeleton wide" style="margin:12px 0"></div><div class="skeleton medium" style="margin:12px 0"></div><div class="spec-rule"><b>取消 / 完成团期</b><span>文字提示，不展示无效按钮</span></div></section></div>`;
}
function renderPlaceholder() {
  const page=labels[state.page];
  return `${pageHead('INFORMATION ARCHITECTURE','菜单结构预览',`这里展示“${page.label}”在导航中的归属；本轮重点打磨订单、用户与发货三个核心流程。`)}<div class="placeholder-page"><strong>${esc(page.label)}</strong>当前是导航结构预览页。点击左侧「订单列表」「用户管理」「发货与运输」或「设计规范」，可以操作完整的示例流程。正式实现阶段会按确认后的共同规范覆盖此页面。</div>`;
}
function modal() {
  const m=state.modal;
  let title='', kicker='', body='', footer='';
  if (m.type==='order') {
    const o=orders.find(v=>v.id===m.id); if(!o) return '';
    kicker='ORDER DETAILS'; title=`订单详情 · ${o.id}`;
    body=`<div class="detail-grid"><div class="detail-item"><label>订单状态</label><strong>${status(o.status)}</strong></div><div class="detail-item"><label>实付金额</label><strong class="money">${money(o.amount)}</strong></div><div class="detail-item"><label>用户ID / 姓名</label><strong>${o.userId} · ${esc(o.name)}</strong></div><div class="detail-item"><label>联系电话</label><strong class="mono">${esc(o.phone)}</strong></div><div class="detail-item"><label>团期</label><strong>${esc(o.campaign)}</strong></div><div class="detail-item"><label>自提点</label><strong>${esc(o.point)}</strong></div><div class="detail-item"><label>下单时间</label><strong class="mono">${esc(o.created)}</strong></div><div class="detail-item"><label>支付时间</label><strong class="mono">${esc(o.paid||'未支付')}</strong></div><div class="detail-item full"><label>商品</label><strong>${esc(o.item)}</strong></div></div><p class="detail-note">完整电话供已获授权的客服、运营联系用户；正式系统记录这次详情访问。</p>`;
    footer=`<button class="btn" data-action="close-modal">关闭</button>`;
  } else if (m.type==='user') {
    const u=users.find(v=>v.id===Number(m.id)); if(!u) return '';
    kicker='CUSTOMER DETAILS'; title=`用户详情 · ID ${u.id}`;
    body=`<div class="detail-grid"><div class="detail-item"><label>用户ID</label><strong class="mono">${u.id}</strong></div><div class="detail-item"><label>账号状态</label><strong>${status(u.status)}</strong></div><div class="detail-item"><label>姓名</label><strong>${esc(u.name)}</strong></div><div class="detail-item"><label>手机号</label><strong class="mono">${esc(u.phone)}</strong></div><div class="detail-item"><label>手机号认证</label><strong>${u.verified?'已认证':'未认证'}</strong></div><div class="detail-item"><label>注册时间</label><strong class="mono">${esc(u.created)}</strong></div><div class="detail-item full"><label>累计订单</label><strong>${u.orders} 笔</strong></div></div><h3 class="detail-title">近期订单</h3>${orders.filter(o=>o.userId===u.id).slice(0,3).map(o=>`<div class="spec-rule"><b class="mono">${esc(o.id)}</b><span>${status(o.status)} &nbsp; ${money(o.amount)}</span></div>`).join('')||'<div class="spec-rule">暂无订单</div>'}<p class="detail-note">查看完整手机号需要“用户联系方式查看”权限；正式系统记录操作者与查看时间。</p>`;
    footer=`<button class="btn" data-action="close-modal">关闭</button>`;
  } else if (m.type==='register') {
    const p=plans.find(v=>v.id===m.id); if(!p)return '';
    kicker='DELIVERY PLAN'; title=`${p.status==='待登记'?'登记':'编辑'}运输信息`;
    body=`<div class="modal-summary"><strong>${esc(p.campaign)}</strong> · ${esc(p.point)}<br>团期状态：${esc(p.campaignStatus)}，可登记运输信息。</div><form id="transport-form" class="modal-form" style="margin-top:18px"><div class="field"><label for="carrier">运输方式</label><select id="carrier" required>${option('平台自送','平台自送',p.carrier||'平台自送')}${option('第三方承运','第三方承运',p.carrier)}</select></div><div class="field"><label for="driver">司机姓名</label><input id="driver" placeholder="请输入司机姓名" value="${esc(p.driver)}" required /></div><div class="field"><label for="plate">车牌号</label><input id="plate" placeholder="例如：冀F·12345" /></div></form>`;
    footer=`<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-transport" data-id="${p.id}">保存运输信息</button>`;
  } else if (m.type==='dispatch') {
    const p=plans.find(v=>v.id===m.id); if(!p)return '';
    kicker='FINAL REVIEW'; title='发车前复核';
    body=`<div class="modal-summary">发车会使本团进入运输履约。请先核对团期和运输信息，再确认。</div><div class="detail-grid" style="margin-top:11px"><div class="detail-item"><label>团期</label><strong>${esc(p.campaign)}</strong></div><div class="detail-item"><label>团期状态</label><strong>${status(p.campaignStatus)}</strong></div><div class="detail-item"><label>送达自提点</label><strong>${esc(p.point)}</strong></div><div class="detail-item"><label>运输方式 / 司机</label><strong>${esc(p.carrier)} · ${esc(p.driver)}</strong></div></div>`;
    footer=`<button class="btn" data-action="close-modal">返回修改</button><button class="btn btn-primary" data-action="confirm-dispatch" data-id="${p.id}">确认发车</button>`;
  }
  return `<div class="dialog-backdrop" data-action="backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dialog-head"><div><span>${esc(kicker)}</span><h2>${esc(title)}</h2></div><button class="close" data-action="close-modal" aria-label="关闭">×</button></div><div class="dialog-body">${body}</div><div class="dialog-footer">${footer}</div></section></div>`;
}
function render() {
  const content=state.page==='orders'?renderOrders():state.page==='users'?renderUsers():state.page==='logistics'?renderLogistics():state.page==='spec'?renderSpec():renderPlaceholder();
  document.getElementById('app').innerHTML=shell(content);
}
function csvCell(v) {
  const str=String(v??'');
  const safe=/^[=+@\-]/.test(str)?`'${str}`:str;
  return `"${safe.replace(/"/g,'""')}"`;
}
function exportOrders() {
  const rows=filteredOrders();
  if (!rows.length) return;
  const header=['订单号','用户ID','手机号','团期','自提点','金额','状态','下单时间','支付时间'];
  const lines=[header,...rows.map(o=>[o.id,o.userId,o.phone,o.campaign,o.point,o.amount.toFixed(2),o.status,o.created,o.paid])];
  const blob=new Blob(['\ufeff'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url;a.download='乡味集-订单筛选示例.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  showToast(`已导出 ${rows.length} 笔示例订单；正式系统将由服务端按权限导出。`);
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if (!button) {
    if (event.target.classList?.contains('dialog-backdrop')) {state.modal=null;render();}
    return;
  }
  if (button.dataset.page) {state.page=button.dataset.page;state.modal=null;render();window.scrollTo(0,0);return;}
  if (button.dataset.scenario) {state.scenario=button.dataset.scenario;state.orderPage=1;render();return;}
  if (button.dataset.logisticsScenario) {state.logisticsScenario=button.dataset.logisticsScenario;render();return;}
  const a=button.dataset.action, id=button.dataset.id;
  if (!a) return;
  if (a==='close-modal') {state.modal=null;render();}
  else if (a==='refresh') {state.refreshing=true;render();setTimeout(()=>{state.refreshing=false;render();showToast('示例数据已刷新，原有列表没有被遮挡。');},550);}
  else if (a==='search-orders') {state.orderFilters={key:document.getElementById('order-key').value,status:document.getElementById('order-status').value,campaign:document.getElementById('order-campaign').value,point:document.getElementById('order-point').value,dateType:document.getElementById('order-date-type').value,from:document.getElementById('order-from').value,to:document.getElementById('order-to').value};state.orderPage=1;render();}
  else if (a==='reset-orders') {state.orderFilters={key:'',status:'',campaign:'',point:'',dateType:'created',from:'',to:''};state.orderPage=1;state.scenario='normal';render();}
  else if (a==='order-next') {state.orderPage+=1;render();}
  else if (a==='order-prev') {state.orderPage-=1;render();}
  else if (a==='export-orders') exportOrders();
  else if (a==='order-detail') {state.modal={type:'order',id};render();}
  else if (a==='search-users') {state.userFilters={key:document.getElementById('user-key').value,status:document.getElementById('user-status').value};render();}
  else if (a==='reset-users') {state.userFilters={key:'',status:''};render();}
  else if (a==='user-detail') {state.modal={type:'user',id};render();}
  else if (a==='register'||a==='edit-transport') {const p=plans.find(v=>v.id===id);if(p&&!['已取消','已完成'].includes(p.campaignStatus)){state.modal={type:'register',id};render();}}
  else if (a==='dispatch') {const p=plans.find(v=>v.id===id);if(p&&p.campaignStatus==='已锁单'){state.modal={type:'dispatch',id};render();}}
  else if (a==='save-transport') {const p=plans.find(v=>v.id===id),form=document.getElementById('transport-form');if(!p||!form.reportValidity())return;p.carrier=document.getElementById('carrier').value;p.driver=document.getElementById('driver').value;p.status='待发车';state.modal=null;render();showToast('运输信息已保存（仅修改本地演示数据）。');}
  else if (a==='confirm-dispatch') {const p=plans.find(v=>v.id===id);if(!p||p.campaignStatus!=='已锁单')return;p.status='运输中';state.modal=null;render();showToast('批次已发车（仅修改本地演示数据）。');}
  else if (a==='spec-toast') showToast('设计样式示例，不会操作业务数据。');
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.modal){state.modal=null;render();}});
render();
