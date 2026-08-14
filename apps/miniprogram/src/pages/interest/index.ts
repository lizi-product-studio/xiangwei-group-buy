import { api, customerAuth } from '../../utils/api';
import { PRIVACY_NOTICE_VERSION } from '../../config/legal';

Page({
  data: {
    regionText: '',
    contactName: '',
    contactPhone: '',
    privacyAccepted: false,
    privacyVersion: PRIVACY_NOTICE_VERSION,
    submitting: false,
  },

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
      const result = await wx.showModal({ title: '登录后再登记', content: '登录后可保存你的开通意向，并跟进后续通知。', confirmText: '去登录', confirmColor: '#e04c30' });
      if (result.confirm) void wx.switchTab({ url: '/pages/profile/index' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.createServiceAreaInterest({ regionText: regionText.trim(), contactName: contactName.trim(), contactPhone: contactPhone.trim(), privacyAccepted: true, privacyVersion: PRIVACY_NOTICE_VERSION });
      void wx.showModal({ title: '登记成功', content: '我们会结合当地稳定的收单和履约条件安排开通。后续进展将通过小程序服务通知或人工联系告知你。', showCancel: false, confirmText: '知道了', success: () => wx.navigateBack() });
    } catch (error) {
      void wx.showModal({ title: '暂时无法提交', content: error instanceof Error ? error.message : '请稍后再试', showCancel: false });
    } finally {
      this.setData({ submitting: false });
    }
  },

  openPrivacy() { void wx.navigateTo({ url: '/pages/legal/index?document=privacy' }); },
});
