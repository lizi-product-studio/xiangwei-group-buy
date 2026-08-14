import { api, customerAuth } from '../../utils/api';
import { PRIVACY_NOTICE_VERSION } from '../../config/legal';
import { loadServiceAreaContext, type ServiceAreaSelection } from '../../utils/service-area';

interface OrderCounts { pending: number; active: number; ready: number; afterSale: number; }

Page({
  data: {
    loading: true, error: '', userName: '微信用户', loggedIn: false, wechatMode: false, loginLoading: false, privacyAccepted: false, privacyVersion: PRIVACY_NOTICE_VERSION,
    area: null as ServiceAreaSelection | null, orderTotal: 0,
    counts: { pending: 0, active: 0, ready: 0, afterSale: 0 } as OrderCounts,
  },
  onShow() { void this.loadSummary(); void this.loadArea(); },
  async loadArea() { try { this.setData({ area: (await loadServiceAreaContext()).selected }); } catch { this.setData({ area: null }); } },
  async loadSummary() {
    const wechatMode = customerAuth.isWechatMode(); const loggedIn = customerAuth.isLoggedIn();
    this.setData({ loading: loggedIn, error: '', wechatMode, loggedIn, userName: wechatMode ? '微信用户' : '体验用户' });
    if (!loggedIn) return;
    try {
      const [orders, afterSales] = await Promise.all([api.listOrders(), api.listAfterSales()]); const counts: OrderCounts = { pending: 0, active: 0, ready: 0, afterSale: afterSales.filter((item) => ['SUBMITTED', 'PROCESSING'].includes(item.status)).length };
      for (const order of orders) {
        if (order.status === 'PENDING_PAYMENT') counts.pending += 1;
        else if (['PAID_WAITING_CLOSE', 'LOCKED', 'ALLOCATING', 'IN_TRANSIT'].includes(order.status)) counts.active += 1;
        else if (order.status === 'READY_FOR_PICKUP') counts.ready += 1;
      }
      this.setData({ orderTotal: orders.length, counts });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '订单概览加载失败' }); }
    finally { this.setData({ loading: false }); }
  },
  async login() {
    if (this.data.loginLoading) return;
    if (!this.data.privacyAccepted) { void wx.showToast({ title: '请先阅读并同意隐私说明', icon: 'none' }); return; }
    this.setData({ loginLoading: true, error: '' });
    try { await customerAuth.login(PRIVACY_NOTICE_VERSION); await this.loadSummary(); void wx.showToast({ title: '登录成功', icon: 'success' }); }
    catch (error) { this.setData({ error: error instanceof Error ? error.message : '微信登录失败，请重试' }); }
    finally { this.setData({ loginLoading: false }); }
  },
  async logout() { await customerAuth.logout(); await this.loadSummary(); },
  changePrivacy(event: WechatMiniprogram.CheckboxGroupChange) { this.setData({ privacyAccepted: event.detail.value.includes('accepted') }); },
  openOrders(event: WechatMiniprogram.BaseEvent) { wx.setStorageSync('orderFilter', (event.currentTarget.dataset.filter as string | undefined) ?? 'ALL'); void wx.switchTab({ url: '/pages/orders/index' }); },
  openPickup() { void wx.navigateTo({ url: '/pages/pickup-select/index' }); },
  openInterest() { void wx.navigateTo({ url: '/pages/interest/index' }); },
  openMessages() { void wx.navigateTo({ url: '/pages/messages/index' }); },
  openTerms() { void wx.navigateTo({ url: '/pages/legal/index?document=terms' }); },
  openPrivacy() { void wx.navigateTo({ url: '/pages/legal/index?document=privacy' }); },
  showHelp() { void wx.showModal({ title: '下单与集中领取', content: '先选择固定自提点，再选购并支付。平台统一收单、备货和预约车辆；预计到货时间会更新到订单，到货后订单会生成取货码。', showCancel: false, confirmText: '知道了' }); },
  showAbout() { void wx.showModal({ title: '乡味集', content: '统一收单，按团期集中送达。正式运行时使用微信授权登录，订单与取货码仅对本人可见。', showCancel: false, confirmText: '关闭' }); },
});
