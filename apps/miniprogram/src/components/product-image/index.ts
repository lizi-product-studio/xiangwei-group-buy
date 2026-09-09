import { resolveProductImageUrl } from '../../utils/product-image';

Component({
  properties: { src: { type: String, value: '' } },
  data: { resolvedSrc: '', requestSrc: '', loaded: false, failed: false, requestVersion: 0 },
  observers: {
    src(value: string) {
      const resolvedSrc = resolveProductImageUrl(value, getApp<IAppOption>().globalData.apiBaseUrl);
      this.setData({
        resolvedSrc,
        requestSrc: resolvedSrc,
        loaded: false,
        failed: false,
        requestVersion: this.data.requestVersion + 1,
      });
    },
  },
  methods: {
    loadedImage(event: WechatMiniprogram.BaseEvent) {
      if (event.currentTarget.dataset.version === this.data.requestVersion)
        this.setData({ loaded: true, failed: false });
    },
    failedImage(event: WechatMiniprogram.BaseEvent) {
      if (event.currentTarget.dataset.version === this.data.requestVersion)
        this.setData({ failed: true, loaded: false });
    },
    retryImage() {
      if (this.data.resolvedSrc) {
        const separator = this.data.resolvedSrc.includes('?') ? '&' : '?';
        const requestVersion = this.data.requestVersion + 1;
        this.setData({
          requestSrc: `${this.data.resolvedSrc}${separator}retry=${requestVersion}`,
          loaded: false,
          failed: false,
          requestVersion,
        });
      }
    },
  },
});
