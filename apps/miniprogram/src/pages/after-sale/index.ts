import { api } from "../../utils/api";
import { COMMUNITY_QUALITY_TEXT_ONLY_HINT } from "../../utils/community-quality";

const REASONS = ["商品质量问题", "商品缺少或错发", "领取安排异常", "其他问题"];
const CLAIM_REASON: Record<
  string,
  "PICKUP_SHORTAGE" | "PICKUP_DAMAGE" | "QUALITY_CLAIM"
> = {
  商品质量问题: "QUALITY_CLAIM",
  商品缺少或错发: "PICKUP_SHORTAGE",
  领取安排异常: "PICKUP_DAMAGE",
};

Page({
  data: {
    orderId: "",
    reasons: REASONS,
    reasonIndex: 0,
    description: "",
    submitting: false,
    claimRequestId: "",
    order: null as OrderDto | null,
    claimableItems: [] as Array<
      OrderDto["items"][number] & { label: string; claimableQuantity: number }
    >,
    selectedSkuId: "",
    selectedItemIndex: 0,
    claimQuantity: 0,
    qualityHint: COMMUNITY_QUALITY_TEXT_ONLY_HINT,
  },
  onLoad(options: Record<string, string | undefined>) {
    if (!options.orderId) {
      void wx.showToast({ title: "订单参数缺失", icon: "none" });
      return;
    }
    this.setData({
      orderId: options.orderId,
      claimRequestId: `claim-${options.orderId}-${Date.now()}`,
    });
    void this.loadOrder();
  },
  async loadOrder() {
    try {
      const order = await api.getOrder(this.data.orderId);
      if (
        !["READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"].includes(order.status)
      ) {
        void wx.showModal({
          title: "平台正在处理履约异常",
          content:
            "截单后不支持无理由售后。异常商品会按明细展示退款进度，正常商品可继续领取。",
          showCancel: false,
          success: () => wx.navigateBack(),
        });
        return;
      }
      const claimableItems = order.items
        .map((item) => ({
          ...item,
          claimableQuantity: item.qualityEligibleQuantity ?? 0,
        }))
        .filter((item) => item.claimableQuantity > 0)
        .map((item) => ({
          ...item,
          label: `${item.name}（可申报 ${item.claimableQuantity} 件）`,
        }));
      const first = claimableItems[0];
      this.setData({
        order,
        claimableItems,
        selectedSkuId: first?.skuId ?? "",
        selectedItemIndex: 0,
        claimQuantity: first?.claimableQuantity ?? 0,
      });
    } catch {
      void wx.showToast({ title: "订单信息加载失败", icon: "none" });
    }
  },
  chooseReason(event: WechatMiniprogram.PickerChange) {
    this.setData({ reasonIndex: Number(event.detail.value) });
  },
  chooseItem(event: WechatMiniprogram.PickerChange) {
    const selectedItemIndex = Number(event.detail.value);
    const item = this.data.claimableItems[selectedItemIndex];
    this.setData({
      selectedSkuId: item?.skuId ?? "",
      selectedItemIndex,
      claimQuantity: item?.claimableQuantity ?? 0,
    });
  },
  inputClaimQuantity(event: WechatMiniprogram.Input) {
    this.setData({ claimQuantity: Number(event.detail.value) });
  },
  inputDescription(event: WechatMiniprogram.Input) {
    this.setData({ description: event.detail.value });
  },
  async submit() {
    if (this.data.submitting) return;
    if (this.data.description.trim().length < 5) {
      void wx.showToast({ title: "请至少说明 5 个字", icon: "none" });
      return;
    }
    const order = this.data.order;
    if (
      order &&
      !["READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"].includes(order.status)
    ) {
      void wx.showToast({ title: "领取商品后才可提交品质售后", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      const reason = REASONS[this.data.reasonIndex]!;
      const claimed = this.data.claimableItems.find(
        (item) => item.skuId === this.data.selectedSkuId,
      );
      const claimReason = CLAIM_REASON[reason];
      if (
        claimReason &&
        claimed &&
        order &&
        ["READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"].includes(order.status)
      ) {
        const quantity = this.data.claimQuantity;
        if (
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > claimed.claimableQuantity
        ) {
          void wx.showToast({
            title: `请填写 1 到 ${claimed.claimableQuantity} 的数量`,
            icon: "none",
          });
          return;
        }
        await api.createCommunityQualityCase(this.data.orderId, {
          clientRequestId: this.data.claimRequestId,
          items: [
            {
              catalogSkuId: claimed.skuId,
              quantity,
              reason: claimReason,
              description: this.data.description.trim(),
            },
          ],
        });
      } else {
        void wx.showToast({ title: "请选择具体商品问题", icon: "none" });
        return;
      }
      void wx.showModal({
        title: "已提交售后申请",
        content: `品质售后已进入待受理，平台会按订单明细处理。${COMMUNITY_QUALITY_TEXT_ONLY_HINT}`,
        showCancel: false,
        success: () => wx.navigateBack(),
      });
    } catch (error) {
      void wx.showModal({
        title: "提交失败",
        content: error instanceof Error ? error.message : "请稍后再试",
        showCancel: false,
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
