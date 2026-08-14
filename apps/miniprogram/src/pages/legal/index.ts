import { PRIVACY_NOTICE_VERSION } from '../../config/legal';

type LegalDocument = 'terms' | 'privacy';

const titles: Record<LegalDocument, string> = {
  terms: '用户服务协议',
  privacy: '隐私说明',
};

Page({
  data: {
    document: 'privacy' as LegalDocument,
    title: titles.privacy,
    privacyVersion: PRIVACY_NOTICE_VERSION,
  },

  onLoad(options: Record<string, string | undefined>) {
    const document: LegalDocument = options.document === 'terms' ? 'terms' : 'privacy';
    this.setData({ document, title: titles[document] });
    wx.setNavigationBarTitle({ title: titles[document] });
  },

  selectDocument(event: WechatMiniprogram.BaseEvent) {
    const document = event.currentTarget.dataset.document === 'terms' ? 'terms' : 'privacy';
    this.setData({ document, title: titles[document] });
    wx.setNavigationBarTitle({ title: titles[document] });
  },
});
