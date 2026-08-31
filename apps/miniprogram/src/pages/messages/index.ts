import { api, AuthExpiredError, customerAuth } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { navigateToCustomerLogin } from '../../utils/auth-navigation';
import { consumeCancelReturnSuppression } from '../../utils/auth-intent';
import { notificationEnableDecision } from '../../utils/notification-guard';
import { PageLoadCoordinator } from '../../utils/page-load-guard';
import { PageActionCoordinator, isOwnedAuthExpiry } from '../../utils/page-action-coordinator';

type MessageView = { id: string; orderId: string; title: string; content: string; status: string; readAt: string | null; createdText: string };
const loadCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();

Page({
  data: { loading: true, error: '', messages: [] as MessageView[], enabling: false },
  onShow() { loadCoordinator.show(); actionCoordinator.activate(); this.setData({ enabling: false }); void this.load(); },
  async load() {
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    // Do not leave the previous account's messages visible while a new
    // identity is being checked or fetched.
    this.setData({ loading: true, error: '', messages: [] });
    if (!customerAuth.isLoggedIn()) {
      this.setData({ loading: false, error: '登录后可查看订单消息', messages: [] });
      if (consumeCancelReturnSuppression({ source: 'messages', returnUrl: '/pages/messages/index' })) return;
      navigateToCustomerLogin('messages', '/pages/messages/index');
      return;
    }
    try {
      const messages = await api.listNotifications();
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
      this.setData({ messages: messages.map((item) => ({ ...item, createdText: formatDateTime(item.createdAt) })) });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(loadGuard)) return;
        this.setData({ messages: [], error: error.message, loading: false });
        navigateToCustomerLogin('messages', '/pages/messages/index');
        return;
      }
      this.setData({ error: error instanceof Error ? error.message : '消息加载失败' });
    }
    finally { if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false }); }
  },
  onHide() { loadCoordinator.hide(); actionCoordinator.invalidate(); },
  onUnload() { loadCoordinator.unload(); actionCoordinator.invalidate(); },
  openLogin() {
    navigateToCustomerLogin('messages', '/pages/messages/index');
  },
  async enable() {
    const loggedIn = customerAuth.isLoggedIn();
    const decision = notificationEnableDecision(loggedIn, this.data.enabling);
    if (decision === 'LOGIN_REQUIRED') {
      navigateToCustomerLogin('messages', '/pages/messages/index');
      return;
    }
    if (decision === 'BUSY') return;
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const currentAction = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    if (!currentAction()) return;
    this.setData({ enabling: true });
    try {
      const templates = getApp<IAppOption>().globalData.subscriptionTemplates;
      if (!templates.length) {
        await api.saveNotificationPreferences([]);
        if (!currentAction()) return;
        void wx.showToast({ title: '暂未配置微信提醒，将由客服人工通知', icon: 'none' });
        return;
      }
      const result = await new Promise<Record<string, string>>((resolve, reject) => wx.requestSubscribeMessage({
        tmplIds: templates.map((item) => item.templateId),
        success: (value) => resolve(value as unknown as Record<string, string>),
        fail: reject,
      }));
      if (!currentAction()) return;
      const accepted = templates.filter((item) => result[item.templateId] === 'accept').map((item) => item.type);
      await api.saveNotificationPreferences(accepted);
      if (!currentAction()) return;
      void wx.showToast({ title: accepted.length ? '已开启本次订单提醒' : '未授权微信提醒，将由客服人工通知', icon: accepted.length ? 'success' : 'none' });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) || !actionCoordinator.isActive(action)) return;
        navigateToCustomerLogin('messages', '/pages/messages/index');
        return;
      }
      if (!currentAction()) return;
      void wx.showToast({ title: error instanceof Error ? error.message : '提醒设置失败', icon: 'none' });
    }
    finally { if (currentAction()) this.setData({ enabling: false }); }
  },
  async openOrder(event: WechatMiniprogram.BaseEvent) {
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const currentAction = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    const id = event.currentTarget.dataset.orderId as string;
    const notificationId = event.currentTarget.dataset.id as string;
    try { await api.markNotificationRead(notificationId); } catch { /* reading must not block the order view */ }
    if (!currentAction()) return;
    void wx.navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(id)}` });
  },
});
