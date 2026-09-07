import { resolveProductImageUrl } from '../../utils/product-image';

Component({
  properties: { src: { type: String, value: '' } },
  data: { resolvedSrc: '', loaded: false, failed: false },
  observers: {
    src(value: string) {
      this.setData({
        resolvedSrc: resolveProductImageUrl(value, getApp<IAppOption>().globalData.apiBaseUrl),
        loaded: false,
        failed: false,
      });
    },
  },
  methods: {
    loadedImage(event: WechatMiniprogram.BaseEvent) {
      if (event.currentTarget.dataset.src === this.data.resolvedSrc)
        this.setData({ loaded: true });
    },
    failedImage(event: WechatMiniprogram.BaseEvent) {
      if (event.currentTarget.dataset.src === this.data.resolvedSrc)
        this.setData({ failed: true, loaded: false });
    },
  },
});
