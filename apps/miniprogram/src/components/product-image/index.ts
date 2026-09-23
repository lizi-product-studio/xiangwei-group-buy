import { resetProductImageState } from '../../utils/product-image-state';

const DEFAULT_ASPECT_RATIO_STYLE = 'aspect-ratio: 1.65 / 1;';

Component({
  properties: {
    src: { type: String, value: '' },
    label: { type: String, value: '商品图片' },
    imageMode: { type: String, value: 'aspectFill' },
    autoAspect: { type: Boolean, value: false },
    // Parents increment this when a wx:for list is filtered back to a prior
    // view. This forces the image state to be reset even when src is identical.
    refreshKey: { type: Number, value: 0 },
  },
  data: { resolvedSrc: '', loaded: false, failed: false, sourceVersion: 0, imageAspectStyle: '' },
  observers: {
    'src, refreshKey'(value: string) {
      const next = resetProductImageState(value, getApp<IAppOption>().globalData.apiBaseUrl, this.data.sourceVersion);
      const { resolvedSrc, sourceVersion } = next;
      // Clear the old image node first. wx:for may reuse a component whose
      // image has already emitted load/error for the same URL.
      this.setData({ resolvedSrc: '', loaded: false, failed: false, sourceVersion, imageAspectStyle: this.data.autoAspect ? DEFAULT_ASPECT_RATIO_STYLE : '' }, () => {
        if (this.data.sourceVersion !== sourceVersion) return;
        this.setData({ resolvedSrc });
      });
    },
  },
  methods: {
    loadedImage(event: WechatMiniprogram.ImageLoad) {
      if (event.currentTarget.dataset.src !== this.data.resolvedSrc || Number(event.currentTarget.dataset.version) !== this.data.sourceVersion) return;
      const detail = event.detail as { width?: number; height?: number };
      const imageAspectStyle = this.data.autoAspect && detail.width && detail.height
        ? `aspect-ratio: ${detail.width} / ${detail.height};`
        : this.data.imageAspectStyle;
      this.setData({ loaded: true, imageAspectStyle });
    },
    failedImage(event: WechatMiniprogram.ImageError) {
      if (event.currentTarget.dataset.src === this.data.resolvedSrc && Number(event.currentTarget.dataset.version) === this.data.sourceVersion)
        this.setData({ failed: true, loaded: false, imageAspectStyle: this.data.autoAspect ? DEFAULT_ASPECT_RATIO_STYLE : '' });
    },
  },
});
