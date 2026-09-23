import { api, customerAuth, customerErrorMessage } from '../../utils/api';
import { navigateToCustomerLogin } from '../../utils/auth-navigation';
import { nextSubscriptionRequest, mergeAcceptedSubscriptionTypes } from '../../utils/notification-subscription';
import type { NotificationType } from '../../config/deployment';

Component({
  properties: { management: { type: Boolean, value: false } },
  data: {
    loading: false, busy: false, ready: false, loggedIn: false, complete: false,
    accepted: [] as NotificationType[], requested: [] as NotificationType[],
    epoch: -1, sequence: 0, live: false, error: '',
    label: '订阅订单提醒', copy: '及时接收发车、到货、领取和退款进度。', configured: true,
  },
  lifetimes: {
    attached() { this.setData({ live: true }); void this.load(); },
    detached() { this.invalidate(); },
  },
  pageLifetimes: {
    show() { this.setData({ live: true }); void this.load(); },
    hide() { this.invalidate(); },
  },
  methods: {
    invalidate() { this.setData({ live: false, sequence: this.data.sequence + 1, busy: false }); },
    isCurrent(sequence: number, epoch: number) {
      return this.data.live && this.data.sequence === sequence && customerAuth.captureSessionEpoch() === epoch;
    },
    updateSummary(accepted: NotificationType[], requested: NotificationType[]) {
      const templates = getApp<IAppOption>().globalData.subscriptionTemplates;
      const configured = templates.length > 0;
      const complete = configured && nextSubscriptionRequest(templates, accepted).length === 0;
      // A rejection finishes a round, not consent. Offer missing templates again after round two.
      const exhausted = configured && nextSubscriptionRequest(templates, requested).length === 0;
      const nextRequested = exhausted && !complete ? accepted : requested;
      this.setData({
        accepted, requested: nextRequested, complete, configured,
        label: !configured ? '暂未开通' : complete ? '本次已订阅' : exhausted ? '补充订阅' : nextRequested.length ? '继续订阅（第2步）' : '订阅订单提醒',
        copy: complete ? '可在“我的—订单消息”查看或关闭。微信提醒按次授权，使用后可再次订阅。' : !configured ? '暂未开通微信提醒，订单进度仍可在“我的—订单消息”查看。' : exhausted ? '部分提醒未同意，可补充订阅；不会影响下单和站内消息。' : nextRequested.length ? '还剩最后一步，请确认其余提醒。' : '发车、到货、领取和退款提醒，分两步确认。',
      });
    },
    async load() {
      const epoch = customerAuth.captureSessionEpoch();
      const sequence = this.data.sequence + 1;
      const loggedIn = customerAuth.isLoggedIn();
      this.setData({ sequence, epoch, loggedIn, loading: loggedIn, busy: false, ready: !loggedIn, error: '', ...(this.data.epoch !== epoch ? { accepted: [], requested: [], complete: false } : {}) });
      if (!loggedIn) { this.updateSummary([], []); return; }
      try {
        const preferences = await api.getNotificationPreferences();
        if (!this.isCurrent(sequence, epoch)) return;
        const templates = getApp<IAppOption>().globalData.subscriptionTemplates;
        const accepted = preferences.types.filter(type => preferences.templateIds?.[type] === templates.find(item => item.type === type)?.templateId);
        this.updateSummary(accepted, accepted);
        this.setData({ ready: true });
      } catch (error) {
        if (this.isCurrent(sequence, epoch)) this.setData({ ready: false, error: customerErrorMessage(error, '提醒设置加载失败，请重试') });
      } finally {
        if (this.isCurrent(sequence, epoch)) this.setData({ loading: false });
      }
    },
    async enable() {
      if (!customerAuth.isLoggedIn()) { navigateToCustomerLogin('messages', '/pages/messages/index'); return; }
      if (this.data.busy || this.data.loading || this.data.complete || !this.data.configured) return;
      if (!this.data.ready) { void this.load(); return; }
      const epoch = customerAuth.captureSessionEpoch();
      const sequence = this.data.sequence + 1;
      const templates = getApp<IAppOption>().globalData.subscriptionTemplates;
      const requested = nextSubscriptionRequest(templates, this.data.requested);
      if (!requested.length) return;
      this.setData({ busy: true, sequence, error: '' });
      try {
        // Invoke directly inside the tap handler, before any API await, to retain the user gesture.
        const result = await new Promise<Record<string, string>>((resolve, reject) => wx.requestSubscribeMessage({
          tmplIds: Array.from(new Set(requested.map(item => item.templateId))),
          success: value => resolve(value as unknown as Record<string, string>), fail: reject,
        }));
        if (!this.isCurrent(sequence, epoch)) return;
        const accepted = mergeAcceptedSubscriptionTypes(this.data.accepted, requested, result);
        const templateIds = Object.fromEntries(templates.filter(item => accepted.includes(item.type)).map(item => [item.type, item.templateId]));
        await api.saveNotificationPreferences(accepted, templateIds);
        if (!this.isCurrent(sequence, epoch)) return;
        this.updateSummary(accepted, Array.from(new Set([...this.data.requested, ...requested.map(item => item.type)])));
      } catch (error) {
        if (this.isCurrent(sequence, epoch)) this.setData({ error: customerErrorMessage(error, '订阅未完成，请稍后重试') });
      } finally {
        if (this.isCurrent(sequence, epoch)) this.setData({ busy: false });
      }
    },
    async closeReminders() {
      if (this.data.busy || !customerAuth.isLoggedIn()) return;
      const epoch = customerAuth.captureSessionEpoch();
      const sequence = this.data.sequence + 1;
      this.setData({ busy: true, sequence });
      try {
        await api.saveNotificationPreferences([], {});
        if (!this.isCurrent(sequence, epoch)) return;
        this.updateSummary([], []);
        void wx.showToast({ title: '已关闭平台提醒，站内消息保留', icon: 'none' });
      } catch (error) {
        if (this.isCurrent(sequence, epoch)) this.setData({ error: customerErrorMessage(error, '关闭失败，请重试') });
      } finally { if (this.isCurrent(sequence, epoch)) this.setData({ busy: false }); }
    },
    openMessages() { void wx.navigateTo({ url: '/pages/messages/index' }); },
    openSettings() { void wx.openSetting({ withSubscriptions: true }); },
  },
});
