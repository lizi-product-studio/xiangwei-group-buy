import { api, customerAuth } from '../../utils/api';
import { formatDateTime } from '../../utils/format';

type MessageView = { id: string; orderId: string; title: string; content: string; status: string; readAt: string | null; createdText: string };

Page({
  data: { loading: true, error: '', messages: [] as MessageView[], enabling: false },
  onShow() { void this.load(); },
  async load() {
    if (!customerAuth.isLoggedIn()) { this.setData({ loading: false, error: '登录后可查看订单消息' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const messages = await api.listNotifications();
      this.setData({ messages: messages.map((item) => ({ ...item, createdText: formatDateTime(item.createdAt) })) });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '消息加载失败' }); }
    finally { this.setData({ loading: false }); }
  },
  async enable() {
    if (this.data.enabling) return;
    this.setData({ enabling: true });
    try {
      const templates = getApp<IAppOption>().globalData.subscriptionTemplates;
      if (!templates.length) {
        await api.saveNotificationPreferences([]);
        void wx.showToast({ title: '暂未配置微信提醒，将由客服人工通知', icon: 'none' });
        return;
      }
      const result = await new Promise<Record<string, string>>((resolve, reject) => wx.requestSubscribeMessage({
        tmplIds: templates.map((item) => item.templateId),
        success: (value) => resolve(value as unknown as Record<string, string>),
        fail: reject,
      }));
      const accepted = templates.filter((item) => result[item.templateId] === 'accept').map((item) => item.type);
      await api.saveNotificationPreferences(accepted);
      void wx.showToast({ title: accepted.length ? '已开启本次订单提醒' : '未授权微信提醒，将由客服人工通知', icon: accepted.length ? 'success' : 'none' });
    } catch (error) { void wx.showToast({ title: error instanceof Error ? error.message : '提醒设置失败', icon: 'none' }); }
    finally { this.setData({ enabling: false }); }
  },
  async openOrder(event: WechatMiniprogram.BaseEvent) {
    const id = event.currentTarget.dataset.orderId as string;
    const notificationId = event.currentTarget.dataset.id as string;
    try { await api.markNotificationRead(notificationId); } catch { /* reading must not block the order view */ }
    void wx.navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(id)}` });
  },
});
