import { api, AuthExpiredError, customerAuth, customerErrorMessage } from '../../utils/api';
import { formatDateTime } from '../../utils/format';
import { pickupDeadlineText, qualityDeadlineText } from '../../utils/consumer-display';
import { navigateToCustomerLogin } from '../../utils/auth-navigation';
import { PageLoadCoordinator } from '../../utils/page-load-guard';
const loadCoordinator = new PageLoadCoordinator();

Page({
  data: {
    orderId: '',
    code: '',
    expiresText: '',
    pickupDeadlineText: pickupDeadlineText(),
    latestQualityDeadlineText: '',
    loading: true,
    error: '',
  },
  onLoad(options: Record<string, string | undefined>) {
    loadCoordinator.show();
    const orderId = options.orderId ?? '';
    this.setData({ orderId });
    if (!orderId) {
      this.setData({ loading: false, error: '订单参数缺失' });
      return;
    }
    if (!customerAuth.isLoggedIn()) {
      navigateToCustomerLogin(
        'pickup-code',
        `/pages/pickup-code/index?orderId=${encodeURIComponent(orderId)}`,
      );
      this.setData({ loading: false, error: '登录后可查看取货码' });
      return;
    }
  },
  onShow() {
    loadCoordinator.show();
    if (!this.data.orderId) return;
    if (!customerAuth.isLoggedIn()) {
      this.setData({ code: '', expiresText: '', pickupDeadlineText: pickupDeadlineText(), latestQualityDeadlineText: '', loading: false, error: '登录后可查看取货码' });
      return;
    }
    void this.loadPickupCode();
  },
  openLogin() {
    navigateToCustomerLogin(
      'pickup-code',
      `/pages/pickup-code/index?orderId=${encodeURIComponent(this.data.orderId)}`,
    );
  },
  async loadPickupCode() {
    const orderId = this.data.orderId;
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    this.setData({ code: '', expiresText: '', latestQualityDeadlineText: '', loading: true, error: '' });
    try {
      const [result, order] = await Promise.all([api.getPickupCode(orderId), api.getOrder(orderId)]);
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
      const latest = (order.pickupReceipts ?? [])[0];
      this.setData({
        code: result.code,
        expiresText: formatDateTime(result.expiresAt),
        pickupDeadlineText: pickupDeadlineText(order.pickupDeadlineAt ?? order.pickupWindow?.deadlineAt),
        latestQualityDeadlineText: latest ? qualityDeadlineText(latest.qualityDeadlineAt) : '',
      });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(loadGuard)) return;
        navigateToCustomerLogin(
          'pickup-code',
          `/pages/pickup-code/index?orderId=${encodeURIComponent(orderId)}`,
        );
        return;
      }
      this.setData({ error: customerErrorMessage(error, '取货码加载失败，请稍后重试') });
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false });
    }
  },
  onHide() { loadCoordinator.hide(); },
  onUnload() { loadCoordinator.unload(); },
});
