import { api, AuthExpiredError, customerAuth } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { navigateToCustomerLogin } from '../../utils/auth-navigation';
import { consumeCancelReturnSuppression } from '../../utils/auth-intent';
import { notificationEnableDecision } from '../../utils/notification-guard';
import { PageLoadCoordinator } from '../../utils/page-load-guard';
import { PageActionCoordinator, isOwnedAuthExpiry } from '../../utils/page-action-coordinator';
import {
  mergeAcceptedSubscriptionTypes,
  nextSubscriptionRequest,
} from '../../utils/notification-subscription';

type MessageView = { id: string; orderId: string; title: string; content: string; status: string; readAt: string | null; createdText: string };
const loadCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();

Page({
  data: {
    loading: true,
    error: '',
    messages: [] as MessageView[],
    enabling: false,
    reminderText: '微信每次最多授权三类模板；完成后可继续授权退款提醒。',
    enableLabel: '授权订单提醒',
  },
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
      const templates = getApp<IAppOption>().globalData.subscriptionTemplates;
      const [messages, preferences] = await Promise.all([
        api.listNotifications(),
        templates.length
          ? api.getNotificationPreferences().catch(() => ({ types: [] }))
          : Promise.resolve({ types: [] }),
      ]);
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
      const remaining = nextSubscriptionRequest(templates, preferences.types);
      this.setData({
        messages: messages.map((item) => ({ ...item, createdText: formatDateTime(item.createdAt) })),
        reminderText: !templates.length
          ? '当前未配置微信提醒，请留意站内消息。'
          : remaining.length
            ? preferences.types.length
              ? '已有部分提醒授权；请继续授权剩余提醒。'
              : '微信每次最多授权三类模板；完成后可继续授权退款提醒。'
            : '订单提醒授权已完成；站内消息仍会保留。',
        enableLabel: !templates.length
          ? '仅站内提醒'
          : remaining.length
            ? preferences.types.length ? '继续授权' : '授权订单提醒'
            : '已完成',
      });
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
      const current = await api.getNotificationPreferences();
      if (!currentAction()) return;
      const requested = nextSubscriptionRequest(templates, current.types);
      if (!requested.length) {
        void wx.showToast({ title: '订单提醒已全部授权', icon: 'success' });
        return;
      }
      const result = await new Promise<Record<string, string>>((resolve, reject) => wx.requestSubscribeMessage({
        tmplIds: Array.from(new Set(requested.map((item) => item.templateId))),
        success: (value) => resolve(value as unknown as Record<string, string>),
        fail: reject,
      }));
      if (!currentAction()) return;
      const accepted = mergeAcceptedSubscriptionTypes(current.types, requested, result);
      await api.saveNotificationPreferences(accepted);
      if (!currentAction()) return;
      const remaining = nextSubscriptionRequest(templates, accepted);
      this.setData({
        reminderText: remaining.length
          ? '本组提醒已处理；请继续授权剩余提醒。'
          : '订单提醒授权已完成；站内消息仍会保留。',
        enableLabel: remaining.length ? '继续授权' : '已完成',
      });
      void wx.showToast({ title: accepted.length ? (remaining.length ? '本组授权已保存' : '订单提醒已授权') : '未授权微信提醒，请留意站内消息', icon: accepted.length ? 'success' : 'none' });
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
