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
    subscriptionComplete: false,
    subscriptionOutcome: 'pending' as 'pending' | 'complete' | 'declined',
    reminderText: '订阅后可接收本次订单的发车、到货、领取和退款提醒。',
    enableLabel: '订阅本次提醒',
  },
  onShow() { loadCoordinator.show(); actionCoordinator.activate(); const epoch = customerAuth.captureSessionEpoch(); this.setData({ enabling: false, ...(this.data.cycleEpoch !== epoch ? { cycleEpoch: epoch, cycleRequestedTypes: [], subscriptionComplete: false, subscriptionOutcome: 'pending' } : {}) }); void this.load(); },
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
          ? api.getNotificationPreferences().catch(() => ({
              types: [] as NotificationType[],
              templateIds: {} as Record<string, string>,
            }))
          : Promise.resolve({
              types: [] as NotificationType[],
              templateIds: {} as Record<string, string>,
            }),
      ]);
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
      const remaining = nextSubscriptionRequest(templates, this.data.cycleRequestedTypes);
      const subscriptionComplete = templates.length > 0 && remaining.length === 0;
      const validAcceptedTypes = preferences.types.filter((type) =>
        preferences.templateIds?.[type] === templates.find((item) => item.type === type)?.templateId,
      );
      this.setData({
        messages: messages.map((item) => ({ ...item, createdText: formatDateTime(item.createdAt) })),
        reminderText: !templates.length
          ? '当前未配置微信提醒，请留意站内消息。'
          : subscriptionComplete
            ? validAcceptedTypes.length
              ? '本次订单提醒设置已完成，进度也会保留在订单消息中。'
              : '本次未订阅微信提醒，订单进度仍会保留在这里。'
            : this.data.cycleRequestedTypes.length
              ? '第一步已完成，请完成最后一步。'
              : '微信单次最多确认三类提醒，本次最多需要两步。',
        enableLabel: !templates.length
          ? '仅站内提醒'
          : subscriptionComplete
            ? '本次已完成'
            : this.data.cycleRequestedTypes.length
              ? '完成第2步'
              : '订阅本次提醒',
        subscriptionComplete: !templates.length || subscriptionComplete,
        subscriptionOutcome: !templates.length || (subscriptionComplete && validAcceptedTypes.length === 0)
          ? 'declined'
          : subscriptionComplete
            ? 'complete'
            : 'pending',
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
    if (this.data.subscriptionComplete) return;
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const currentAction = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    if (!currentAction()) return;
    this.setData({ enabling: true });
    try {
      const templates = getApp<IAppOption>().globalData.subscriptionTemplates;
      if (!templates.length) {
        await api.saveNotificationPreferences([]);
        if (!currentAction()) return;
        this.setData({ subscriptionComplete: true, subscriptionOutcome: 'declined', enableLabel: '仅站内提醒' });
        void wx.showToast({ title: '暂未开通订阅提醒，请留意站内订单消息', icon: 'none' });
        return;
      }
      const current = await api.getNotificationPreferences();
      if (!currentAction()) return;
      const requested = nextSubscriptionRequest(templates, this.data.cycleRequestedTypes);
      if (!requested.length) {
        this.setData({ subscriptionComplete: true, enableLabel: '本次已完成' });
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
      const cycleRequestedTypes = Array.from(new Set([...this.data.cycleRequestedTypes, ...requested.map((item) => item.type)]));
      const templateIds = Object.fromEntries(templates.filter((item) => accepted.includes(item.type)).map((item) => [item.type, item.templateId]));
      await api.saveNotificationPreferences(accepted, templateIds);
      if (!currentAction()) return;
      const remaining = nextSubscriptionRequest(templates, cycleRequestedTypes);
      const subscriptionComplete = remaining.length === 0;
      this.setData({
        cycleRequestedTypes,
        reminderText: remaining.length
          ? '第一步已完成，请完成最后一步。'
          : accepted.length
            ? '本次订单提醒设置已完成，进度也会保留在订单消息中。'
            : '本次未订阅微信提醒，订单进度仍会保留在这里。',
        enableLabel: remaining.length ? '完成第2步' : '本次已完成',
        subscriptionComplete,
        subscriptionOutcome: subscriptionComplete
          ? accepted.length ? 'complete' : 'declined'
          : 'pending',
      });
      void wx.showToast({ title: accepted.length ? (remaining.length ? '第一步已保存' : '本次提醒设置完成') : '未授权微信提醒，请留意站内消息', icon: accepted.length ? 'success' : 'none' });
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
