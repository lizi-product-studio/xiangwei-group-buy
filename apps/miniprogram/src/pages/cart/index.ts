import { cartCount, cartGroupKey, clearCart, readCartGroups, removeCartLine, saveMultiCheckoutDraft, setCartGroupSelected, updateCartQuantity, type CartLine, type CartSnapshot } from '../../utils/cart';
import { formatMoney } from '../../utils/format';
import { readPickupPointSelection, type PickupPointSelection } from '../../utils/pickup-point';
import { formatChinaDateTime } from '../../utils/consumer-display';
import { compactPickupAddress } from '../../utils/pickup-label';

interface CartGroupView extends Omit<CartSnapshot, 'items'> {
  groupKey: string;
  selected: boolean;
  itemCount: number;
  totalText: string;
  items: Array<CartLine & { priceText: string; amountText: string }>;
  cutoffText: string;
  arrivalLabel: string;
  pickupPointDisplayAddress: string;
}

Page({
  data: {
    groups: [] as CartGroupView[],
    pickupPoint: null as PickupPointSelection | null,
    pickupPointDisplayAddress: "",
    count: 0,
    selectedCount: 0,
    selectedGroupCount: 0,
    selectedTotal: '0.00',
    allSelected: false,
  },
  onShow() { this.refresh(); },
  refresh() {
    const groups = readCartGroups().map((group): CartGroupView => {
      const key = cartGroupKey(group);
      const itemCount = group.items.reduce((sum, item) => sum + item.quantity, 0);
      const cents = group.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
      return {
        ...group,
        groupKey: key,
        selected: group.selected !== false,
        itemCount,
        totalText: formatMoney(cents),
        cutoffText: group.cutoffAt ? formatChinaDateTime(group.cutoffAt, true) : '以结算核对为准',
        arrivalLabel: group.arrivalText || '预计领取时间以订单通知为准',
        pickupPointDisplayAddress: compactPickupAddress(group.pickupPointName, group.pickupPointAddress),
        items: group.items.map((item) => ({ ...item, priceText: formatMoney(item.unitPriceCents), amountText: formatMoney(item.unitPriceCents * item.quantity) })),
      };
    });
    const selected = groups.filter((group) => group.selected);
    const total = selected.reduce((sum, group) => sum + group.items.reduce((lineSum, item) => lineSum + item.unitPriceCents * item.quantity, 0), 0);
    this.setData({
      groups,
      pickupPoint: readPickupPointSelection(),
      pickupPointDisplayAddress: (() => { const point = readPickupPointSelection(); return compactPickupAddress(point?.name, point?.address); })(),
      count: cartCount(),
      selectedCount: selected.reduce((sum, group) => sum + group.itemCount, 0),
      selectedGroupCount: selected.length,
      selectedTotal: formatMoney(total),
      allSelected: groups.length > 0 && selected.length === groups.length,
    });
  },
  toggleGroup(event: WechatMiniprogram.BaseEvent) {
    const key = event.currentTarget.dataset.key as string;
    const group = this.data.groups.find((item) => item.groupKey === key);
    if (group) setCartGroupSelected(key, !group.selected);
    this.refresh();
  },
  toggleAll() {
    const select = !this.data.allSelected;
    for (const group of this.data.groups) setCartGroupSelected(group.groupKey, select);
    this.refresh();
  },
  openPickup() { void wx.navigateTo({ url: '/pages/pickup-select/index' }); },
  showPickupAddress(event: WechatMiniprogram.BaseEvent) {
    const groupKey = event.currentTarget.dataset.key as string;
    const group = this.data.groups.find((item) => item.groupKey === groupKey);
    if (!group) return;
    void wx.showModal({
      title: group.pickupPointName || "自提点地址",
      content: group.pickupPointAddress || "完整地址暂未提供，请联系平台客服确认",
      showCancel: false,
      confirmText: "知道了",
    });
  },
  changeQuantity(event: WechatMiniprogram.BaseEvent) {
    const skuId = event.currentTarget.dataset.id as string;
    const groupKey = event.currentTarget.dataset.key as string;
    const line = this.data.groups.find((group) => group.groupKey === groupKey)?.items.find((item) => item.skuId === skuId);
    if (!line) return;
    updateCartQuantity(skuId, line.quantity + Number(event.currentTarget.dataset.step), groupKey);
    this.refresh();
  },
  removeLine(event: WechatMiniprogram.BaseEvent) {
    removeCartLine(event.currentTarget.dataset.id as string, event.currentTarget.dataset.key as string);
    this.refresh();
  },
  clearAll() {
    void wx.showModal({ title: '清空购物车？', content: '所有团期和自提点的商品都将移除。', confirmText: '清空', confirmColor: '#d7472f', success: (result) => { if (result.confirm) { clearCart(); this.refresh(); } } });
  },
  checkout() {
    const selected = this.data.groups.filter((group) => group.selected);
    if (!selected.length) return;
    const draftGroups: CartSnapshot[] = selected.map(({
      groupKey, itemCount, totalText, cutoffText, arrivalLabel, pickupPointDisplayAddress, ...snapshot
    }) => {
      void groupKey;
      void itemCount;
      void totalText;
      void cutoffText;
      void arrivalLabel;
      void pickupPointDisplayAddress;
      return snapshot;
    });
    saveMultiCheckoutDraft(draftGroups);
    void wx.navigateTo({ url: '/pages/checkout/index?source=multi' });
  },
});
