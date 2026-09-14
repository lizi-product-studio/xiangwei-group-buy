import { resetProductImageState } from '../../utils/product-image-state';

Component({
  properties: {
    src: { type: String, value: '' },
    // Parents increment this when a wx:for list is filtered back to a prior
    // view. This forces the image state to be reset even when src is identical.
    refreshKey: { type: Number, value: 0 },
  },
  data: { resolvedSrc: '', loaded: false, failed: false, sourceVersion: 0 },
  observers: {
    'src, refreshKey'(value: string) {
      const next = resetProductImageState(value, getApp<IAppOption>().globalData.apiBaseUrl, this.data.sourceVersion);
      const { resolvedSrc, sourceVersion } = next;
      // Clear the old image node first. wx:for may reuse a component whose
      // image has already emitted load/error for the same URL.
      this.setData({ resolvedSrc: '', loaded: false, failed: false, sourceVersion }, () => {
        if (this.data.sourceVersion !== sourceVersion) return;
        this.setData({ resolvedSrc });
      });
    },
  },
  methods: {
    loadedImage(event: WechatMiniprogram.BaseEvent) {
      if (event.currentTarget.dataset.src === this.data.resolvedSrc && Number(event.currentTarget.dataset.version) === this.data.sourceVersion)
        this.setData({ loaded: true });
    },
    failedImage(event: WechatMiniprogram.BaseEvent) {
      if (event.currentTarget.dataset.src === this.data.resolvedSrc && Number(event.currentTarget.dataset.version) === this.data.sourceVersion)
        this.setData({ failed: true, loaded: false });
    },
  },
});
