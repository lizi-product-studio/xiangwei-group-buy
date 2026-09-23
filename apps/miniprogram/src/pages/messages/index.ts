import { api, AuthExpiredError, customerAuth, customerErrorMessage } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { navigateToCustomerLogin } from '../../utils/auth-navigation';
import { PageLoadCoordinator } from '../../utils/page-load-guard';
import { PageActionCoordinator, isOwnedAuthExpiry } from '../../utils/page-action-coordinator';
type MessageView = { id: string; orderId: string; title: string; content: string; status: string; readAt: string | null; createdText: string };
const loadCoordinator = new PageLoadCoordinator();
const actionCoordinator = new PageActionCoordinator();

Page({
  data: {
    loading: true,
    error: '',
    messages: [] as MessageView[],
  },
  onShow() { loadCoordinator.show(); actionCoordinator.activate(); void this.load(); },
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
  async openOrder(event: WechatMiniprogram.BaseEvent) {
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const currentAction = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    const id = event.currentTarget.dataset.orderId as string;
    const notificationId = event.currentTarget.dataset.id as string;
    try {
      await api.markNotificationRead(notificationId);
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) && actionCoordinator.isActive(action))
          navigateToCustomerLogin('messages', '/pages/messages/index');
        return;
      }
      // A failed read marker must not block an otherwise accessible order.
    }
    if (!currentAction()) return;
    void wx.navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(id)}` });
  },
});
