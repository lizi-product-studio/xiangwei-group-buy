import { api, AuthExpiredError, customerAuth } from '../../utils/api';
import { PRIVACY_NOTICE_VERSION } from '../../config/legal';
import { navigateToCustomerLogin } from '../../utils/auth-navigation';
import { PageActionCoordinator, isOwnedAuthExpiry } from '../../utils/page-action-coordinator';
const actionCoordinator = new PageActionCoordinator();

Page({
  data: {
    regionText: '',
    contactName: '',
    contactPhone: '',
    privacyAccepted: false,
    privacyVersion: PRIVACY_NOTICE_VERSION,
    submitting: false,
  },
  onShow() { actionCoordinator.activate(); this.setData({ submitting: false }); },
  onHide() { actionCoordinator.invalidate(); },
  onUnload() { actionCoordinator.invalidate(); },

  inputValue(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as 'regionText' | 'contactName' | 'contactPhone';
    this.setData({ [field]: event.detail.value });
  },

  changePrivacy(event: WechatMiniprogram.CheckboxGroupChange) {
    this.setData({ privacyAccepted: event.detail.value.includes('accepted') });
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
      await api.createServiceAreaInterest({ regionText: regionText.trim(), contactName: contactName.trim(), contactPhone: contactPhone.trim(), privacyAccepted: true, privacyVersion: PRIVACY_NOTICE_VERSION });
      if (!current()) return;
      void wx.showModal({ title: '登记成功', content: '我们会结合当地稳定的收单和履约条件安排开通。后续进展将按照已批准的通知与隐私规则告知你。', showCancel: false, confirmText: '知道了', success: () => { if (current()) wx.navigateBack(); } });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) || !actionCoordinator.isActive(action)) return;
        navigateToCustomerLogin('service-area-interest', '/pages/interest/index', 'submit-service-area-interest');
        return;
      }
      if (!current()) return;
      void wx.showModal({ title: '暂时无法提交', content: error instanceof Error ? error.message : '请稍后再试', showCancel: false });
    } finally {
      if (current()) this.setData({ submitting: false });
    }
  },

  openPrivacy() { void wx.navigateTo({ url: '/pages/legal/index?document=privacy' }); },
});
