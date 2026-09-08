import { api, AuthExpiredError, customerAuth, customerErrorMessage } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { navigateToCustomerLogin } from '../../utils/auth-navigation';
import { notificationEnableDecision } from '../../utils/notification-guard';
import { PageLoadCoordinator } from '../../utils/page-load-guard';
import { PageActionCoordinator, isOwnedAuthExpiry } from '../../utils/page-action-coordinator';
import {
  mergeAcceptedSubscriptionTypes,
  nextSubscriptionRequest,
} from '../../utils/notification-subscription';

import type { NotificationType } from '../../config/deployment';

type MessageView = { id: string; orderId: string; title: string; content: string; status: string; readAt: string | null; createdText: string };
const loadCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();

Page({
  data: {
    loading: true,
    error: '',
    messages: [] as MessageView[],
    enabling: false,
    cycleRequestedTypes: [] as NotificationType[],
    cycleEpoch: -1,
    reminderText: '每次最多订阅三种模板，五种提醒需分组订阅；接受一次不代表无限次通知。',
    enableLabel: '授权订单提醒',
  },
  onShow() { loadCoordinator.show(); actionCoordinator.activate(); const epoch = customerAuth.captureSessionEpoch(); this.setData({ enabling: false, ...(this.data.cycleEpoch !== epoch ? { cycleEpoch: epoch, cycleRequestedTypes: [] } : {}) }); void this.load(); },
  async load() {
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    // Do not leave the previous account's messages visible while a new
    // identity is being checked or fetched.
    this.setData({ loading: true, error: '', messages: [] });
    if (!customerAuth.isLoggedIn()) {
      this.setData({ loading: false, error: '登录后可查看订单消息', messages: [] });
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
      const remaining = nextSubscriptionRequest(templates, this.data.cycleRequestedTypes);
      this.setData({
        messages: messages.map((item) => ({ ...item, createdText: formatDateTime(item.createdAt) })),
        reminderText: !templates.length
          ? '当前未配置微信提醒，请留意站内消息。'
          : remaining.length
            ? preferences.types.length
              ? '已有部分提醒授权；请继续授权剩余提醒。'
              : '每次最多订阅三种模板，五种提醒需分组订阅；接受一次不代表无限次通知。'
            : '本轮订阅已完成；需要更多提醒时可主动再次订阅。',
        enableLabel: !templates.length
          ? '仅站内提醒'
          : remaining.length
            ? preferences.types.length ? '继续授权' : '授权订单提醒'
            : '再次订阅',
      });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(loadGuard)) return;
        this.setData({ messages: [], error: customerErrorMessage(error), loading: false });
        navigateToCustomerLogin('messages', '/pages/messages/index');
        return;
      }
      this.setData({ error: customerErrorMessage(error, '消息加载失败，请稍后重试') });
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
      const requested = nextSubscriptionRequest(templates, this.data.cycleRequestedTypes.length === 7 ? [] : this.data.cycleRequestedTypes);
      if (!requested.length) {
        this.setData({ cycleRequestedTypes: [] });
        return;
      }
      const result = await new Promise<Record<string, string>>((resolve, reject) => wx.requestSubscribeMessage({
        tmplIds: Array.from(new Set(requested.map((item) => item.templateId))),
        success: (value) => resolve(value as unknown as Record<string, string>),
        fail: reject,
      }));
      if (!currentAction()) return;
      const validCurrent = current.types.filter((type) => current.templateIds?.[type] === templates.find((item) => item.type === type)?.templateId);
      const accepted = mergeAcceptedSubscriptionTypes(validCurrent, requested, result);
      const cycleRequestedTypes = Array.from(new Set([...(this.data.cycleRequestedTypes.length === 7 ? [] : this.data.cycleRequestedTypes), ...requested.map((item) => item.type)]));
      const templateIds = Object.fromEntries(templates.filter((item) => accepted.includes(item.type)).map((item) => [item.type, item.templateId]));
      await api.saveNotificationPreferences(accepted, templateIds);
      if (!currentAction()) return;
      const remaining = nextSubscriptionRequest(templates, cycleRequestedTypes);
      this.setData({
        cycleRequestedTypes,
        reminderText: remaining.length
          ? '本组提醒已处理；请继续授权剩余提醒。'
          : '本轮订阅已完成；需要更多提醒时可主动再次订阅。',
        enableLabel: remaining.length ? '继续授权' : '再次订阅',
      });
      void wx.showToast({ title: accepted.length ? (remaining.length ? '本组授权已保存' : '订单提醒已授权') : '未授权微信提醒，请留意站内消息', icon: accepted.length ? 'success' : 'none' });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) || !actionCoordinator.isActive(action)) return;
        navigateToCustomerLogin('messages', '/pages/messages/index');
        return;
      }
      if (!currentAction()) return;
      void wx.showToast({ title: customerErrorMessage(error, '提醒设置失败，请稍后重试'), icon: 'none' });
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
