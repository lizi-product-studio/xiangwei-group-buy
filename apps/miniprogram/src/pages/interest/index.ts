import { api, AuthExpiredError, customerAuth, customerErrorMessage } from '../../utils/api';
import { PRIVACY_NOTICE_VERSION } from '../../config/legal';
import { navigateToCustomerLogin } from '../../utils/auth-navigation';
import { PageActionCoordinator, isOwnedAuthExpiry } from '../../utils/page-action-coordinator';
const actionCoordinator = new PageActionCoordinator();
type InterestView = {
  id: string;
  regionText: string;
  contactName: string;
  maskedContactPhone: string;
  status: 'NEW' | 'CONTACTED' | 'CLOSED';
  statusText: string;
  statusNote: string | null;
  statusChangedAt: string | null;
  createdAt: string;
};

Page({
  data: {
    regionText: '',
    contactName: '',
    contactPhone: '',
    privacyAccepted: false,
    privacyVersion: PRIVACY_NOTICE_VERSION,
    submitting: false,
    loading: false,
    loadError: '',
    editingId: '',
    interests: [] as InterestView[],
  },
  onShow() {
    actionCoordinator.activate();
    this.setData({ submitting: false });
    if (customerAuth.isLoggedIn()) void this.loadInterests();
  },
  onHide() { actionCoordinator.invalidate(); },
  onUnload() { actionCoordinator.invalidate(); },

  inputValue(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as 'regionText' | 'contactName' | 'contactPhone';
    this.setData({ [field]: event.detail.value });
  },

  changePrivacy(event: WechatMiniprogram.CheckboxGroupChange) {
    this.setData({ privacyAccepted: event.detail.value.includes('accepted') });
  },

  async loadInterests() {
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const current = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    this.setData({ loading: true, loadError: '' });
    try {
      const interests = await api.listOwnServiceAreaInterests();
      if (current()) this.setData({
        interests: interests.map((item) => ({
          ...item,
          statusText:
            item.status === 'NEW'
              ? '待处理'
              : item.status === 'CONTACTED'
                ? '已联系'
                : item.statusNote === '用户主动撤回开通意向'
                  ? '已撤回'
                  : '已关闭',
        })),
      });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) && actionCoordinator.isActive(action))
          navigateToCustomerLogin('service-area-interest', '/pages/interest/index');
        return;
      }
      if (current()) this.setData({ loading: false, loadError: customerErrorMessage(error, '意向记录加载失败，请稍后重试') });
    } finally {
      if (current()) this.setData({ loading: false });
    }
  },

  startEdit(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    const value = this.data.interests.find((item) => item.id === id);
    if (!value || value.status !== 'NEW') return;
    this.setData({
      editingId: id,
      regionText: value.regionText,
      contactName: value.contactName,
      contactPhone: '',
      privacyAccepted: false,
    });
  },

  cancelEdit() {
    this.setData({
      editingId: '',
      regionText: '',
      contactName: '',
      contactPhone: '',
      privacyAccepted: false,
    });
  },

  withdraw(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    void wx.showModal({
      title: '撤回开通意向',
      content: '撤回后平台将停止按该意向联系你；依法需要的审计记录仍会保留。',
      confirmText: '确认撤回',
      success: (result) => {
        if (!result.confirm) return;
        void this.confirmWithdraw(id);
      },
    });
  },

  async confirmWithdraw(id: string) {
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const current = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    try {
      await api.withdrawOwnServiceAreaInterest(id);
      if (!current()) return;
      await this.loadInterests();
      void wx.showToast({ title: '意向已撤回', icon: 'success' });
    } catch (error) {
      if (!current()) return;
      void wx.showToast({ title: customerErrorMessage(error, '撤回失败，请稍后重试'), icon: 'none' });
    }
  },

  async submit() {
    const { regionText, contactName, contactPhone, privacyAccepted, submitting } = this.data;
    if (submitting) return;
    if (!regionText.trim() || !contactName.trim() || !contactPhone.trim()) {
      void wx.showToast({ title: '请填写所在地区和联系方式', icon: 'none' });
      return;
    }
    if (!privacyAccepted) {
      void wx.showToast({ title: '请先阅读并同意隐私说明', icon: 'none' });
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(contactPhone.trim())) {
      void wx.showToast({ title: '请输入有效的中国大陆手机号', icon: 'none' });
      return;
    }
    if (!customerAuth.isLoggedIn()) {
      navigateToCustomerLogin(
        'service-area-interest',
        '/pages/interest/index',
        'submit-service-area-interest',
      );
      return;
    }
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const current = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    this.setData({ submitting: true });
    try {
      if (!current()) return;
      const payload = { regionText: regionText.trim(), contactName: contactName.trim(), contactPhone: contactPhone.trim(), privacyAccepted: true as const, privacyVersion: PRIVACY_NOTICE_VERSION };
      if (this.data.editingId)
        await api.updateOwnServiceAreaInterest(this.data.editingId, payload);
      else
        await api.createServiceAreaInterest(payload);
      if (!current()) return;
      const wasEditing = Boolean(this.data.editingId);
      this.cancelEdit();
      await this.loadInterests();
      void wx.showModal({ title: wasEditing ? '更正成功' : '登记成功', content: wasEditing ? '尚未处理的开通意向已更新。' : '我们会结合当地稳定的收单和履约条件安排开通。后续进展将按照已批准的通知与隐私规则告知你。', showCancel: false, confirmText: '知道了' });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) || !actionCoordinator.isActive(action)) return;
        navigateToCustomerLogin('service-area-interest', '/pages/interest/index', 'submit-service-area-interest');
        return;
      }
      if (!current()) return;
      void wx.showModal({ title: '暂时无法提交', content: customerErrorMessage(error, '开通意向暂时无法提交，请稍后重试'), showCancel: false });
    } finally {
      if (current()) this.setData({ submitting: false });
    }
  },

  openPrivacy() { void wx.navigateTo({ url: '/pages/legal/index?document=privacy' }); },
});
