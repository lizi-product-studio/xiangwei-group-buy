import { api, AuthExpiredError, customerAuth, customerErrorMessage } from "../../utils/api";
import { COMMUNITY_QUALITY_TEXT_ONLY_HINT } from "../../utils/community-quality";
import { navigateToCustomerLogin } from "../../utils/auth-navigation";
import { PageActionCoordinator, isOwnedAuthExpiry } from "../../utils/page-action-coordinator";
const actionCoordinator = new PageActionCoordinator();
import { PageLoadCoordinator } from "../../utils/page-load-guard";
import { buildClaimRows, validateSelectedClaimRows, type ClaimRow } from "../../utils/after-sale-claim";
const loadCoordinator = new PageLoadCoordinator();

const REASONS = ["商品质量问题", "商品缺少或错发", "商品破损", "其他问题"];
const CLAIM_REASON: Record<
  string,
  "PICKUP_SHORTAGE" | "PICKUP_DAMAGE" | "QUALITY_CLAIM"
> = {
  商品质量问题: "QUALITY_CLAIM",
  商品缺少或错发: "PICKUP_SHORTAGE",
  商品破损: "PICKUP_DAMAGE",
  其他问题: "QUALITY_CLAIM",
};

Page({
  data: {
    orderId: "",
    reasons: REASONS,
    submitting: false,
    claimRequestId: "",
    loggedIn: false,
    loading: false,
    error: "",
    order: null as OrderDto | null,
    claimRows: [] as ClaimRow[],
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
      loggedIn: customerAuth.isLoggedIn(),
    });
    if (!customerAuth.isLoggedIn()) {
      navigateToCustomerLogin(
        "after-sale",
        `/pages/after-sale/index?orderId=${encodeURIComponent(options.orderId)}`,
        "submit-after-sale",
      );
      this.setData({ loggedIn: false });
      return;
    }
  },
  onShow() {
    actionCoordinator.activate();
    this.setData({ submitting: false });
    loadCoordinator.show();
    if (!customerAuth.isLoggedIn()) {
      this.setData({ loggedIn: false, order: null, claimRows: [] });
      return;
    }
    this.setData({ loggedIn: true });
    if (this.data.orderId) void this.loadOrder();
  },
  async loadOrder() {
    const loadGuard = loadCoordinator.begin(customerAuth.captureSessionEpoch());
    // Never render a previous account's order while the protected read is in
    // flight after a session change.
    this.setData({ order: null, claimRows: [], loading: true, error: "" });
    try {
      const order = await api.getOrder(this.data.orderId);
      if (!loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()) || !customerAuth.isLoggedIn()) return;
      if (
        !["READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"].includes(order.status)
      ) {
        void wx.showModal({
          title: "平台正在处理履约异常",
          content:
            "截单后不支持无理由售后。异常商品会按明细展示退款进度，正常商品可继续领取。",
          showCancel: false,
          success: () => {
            if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch()))
              void wx.navigateBack();
          },
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
      this.setData({
        order,
        claimRows: buildClaimRows(claimableItems),
      });
    } catch (error) {
      const ownExpiry = error instanceof AuthExpiredError &&
        error.sessionWasCleared &&
        error.requestEpoch === loadGuard.epoch &&
        customerAuth.captureSessionEpoch() === loadGuard.epoch + 1;
      if (!ownExpiry && !loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) return;
      if (error instanceof AuthExpiredError) {
        if (!ownExpiry || !loadCoordinator.isLive(loadGuard)) return;
        this.setData({ loggedIn: false, order: null, claimRows: [] });
        navigateToCustomerLogin(
          "after-sale",
          `/pages/after-sale/index?orderId=${encodeURIComponent(this.data.orderId)}`,
          "submit-after-sale",
        );
        return;
      }
      this.setData({ error: customerErrorMessage(error, "售后信息加载失败，请稍后重试") });
    } finally {
      if (loadCoordinator.isCurrent(loadGuard, customerAuth.captureSessionEpoch())) this.setData({ loading: false });
    }
  },
  onHide() { loadCoordinator.hide(); actionCoordinator.invalidate(); },
  onUnload() { loadCoordinator.unload(); actionCoordinator.invalidate(); },
  openLogin() {
    navigateToCustomerLogin(
      'after-sale',
      `/pages/after-sale/index?orderId=${encodeURIComponent(this.data.orderId)}`,
      'submit-after-sale',
    );
  },
  toggleClaimRow(event: WechatMiniprogram.SwitchChange) {
    const index = Number(event.currentTarget.dataset.index);
    const claimRows = this.data.claimRows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, selected: event.detail.value } : row,
    );
    this.setData({ claimRows });
  },
  chooseRowReason(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.currentTarget.dataset.index);
    const claimRows = this.data.claimRows.map((row, rowIndex) =>
      rowIndex === index
        ? { ...row, reasonIndex: Number(event.detail.value) }
        : row,
    );
    this.setData({ claimRows });
  },
  inputRowQuantity(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index);
    const claimRows = this.data.claimRows.map((row, rowIndex) =>
      rowIndex === index
        ? { ...row, quantity: Number(event.detail.value) }
        : row,
    );
    this.setData({ claimRows });
  },
  inputRowDescription(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index);
    const claimRows = this.data.claimRows.map((row, rowIndex) =>
      rowIndex === index
        ? { ...row, description: event.detail.value }
        : row,
    );
    this.setData({ claimRows });
  },
  async submit() {
    if (this.data.submitting) return;
    const action = actionCoordinator.begin(customerAuth.captureSessionEpoch());
    const current = () => actionCoordinator.isCurrent(action, customerAuth.captureSessionEpoch()) && customerAuth.isLoggedIn();
    const order = this.data.order;
    if (
      order &&
      !["READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"].includes(order.status)
    ) {
      if (!current()) return;
      void wx.showToast({ title: "领取商品后才可提交品质售后", icon: "none" });
      return;
    }
    if (!current()) return;
    this.setData({ submitting: true });
    try {
      const validation = validateSelectedClaimRows(this.data.claimRows);
      if (!validation.ok) {
        if (!current()) return;
        void wx.showToast({ title: validation.message, icon: "none" });
        return;
      }
      const selected = validation.selected;
      if (!order || !["READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"].includes(order.status)) return;
      if (!current()) return;
      await api.createCommunityQualityCase(this.data.orderId, {
        clientRequestId: this.data.claimRequestId,
        items: selected.map((row) => ({
          catalogSkuId: row.skuId,
          quantity: row.quantity,
          reason: CLAIM_REASON[REASONS[row.reasonIndex]!] ?? "QUALITY_CLAIM",
          description: row.description.trim(),
        })),
      });
      if (!current()) return;
      void wx.showModal({
        title: "已提交售后申请",
        content: `品质售后已进入待受理，平台会按订单明细处理。${COMMUNITY_QUALITY_TEXT_ONLY_HINT}`,
        showCancel: false,
        success: () => { if (current()) void wx.navigateBack(); },
      });
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        if (!isOwnedAuthExpiry(error, action, customerAuth.captureSessionEpoch()) || !actionCoordinator.isActive(action)) return;
        navigateToCustomerLogin("after-sale", `/pages/after-sale/index?orderId=${encodeURIComponent(this.data.orderId)}`, "submit-after-sale");
        return;
      }
      if (!current()) return;
      void wx.showModal({
        title: "提交失败",
        content: customerErrorMessage(error, "售后申请暂时无法提交，请稍后重试"),
        showCancel: false,
      });
    } finally {
      if (current()) this.setData({ submitting: false });
    }
  },
});
