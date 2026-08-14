import { cartCount, clearCart, readCart, removeCartLine, saveCheckoutDraft, updateCartQuantity, type CartLine, type CartSnapshot } from '../../utils/cart';
import { formatMoney } from '../../utils/format';
import { readServiceAreaSelection } from '../../utils/service-area';
import { readPickupPointSelection } from '../../utils/pickup-point';

interface CartView extends Omit<CartSnapshot, 'items'> { items: Array<CartLine & { priceText: string }>; }

Page({
  data: { cart: null as CartView | null, total: '0.00', count: 0, areaMismatch: false },
  onShow() { this.refresh(); },
  refresh() {
    const cart = readCart(); const selected = readServiceAreaSelection();const point=readPickupPointSelection();
    const total = cart?.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) ?? 0;
    const viewCart = cart ? { ...cart, items: cart.items.map((item) => ({ ...item, priceText: formatMoney(item.unitPriceCents) })) } : null;
    this.setData({ cart: viewCart, total: formatMoney(total), count: cartCount(cart), areaMismatch: Boolean(cart&&(!selected||cart.serviceAreaId!==selected.id||!point||cart.pickupPointId!==point.id)) });
  },
  changeQuantity(event: WechatMiniprogram.BaseEvent) { const skuId = event.currentTarget.dataset.id as string; const line = this.data.cart?.items.find((item) => item.skuId === skuId); if (!line) return; updateCartQuantity(skuId, line.quantity + Number(event.currentTarget.dataset.step)); this.refresh(); },
  removeLine(event: WechatMiniprogram.BaseEvent) { removeCartLine(event.currentTarget.dataset.id as string); this.refresh(); },
  clearAll() { void wx.showModal({ title: '清空购物车？', content: '购物车中的商品将全部移除。', confirmText: '清空', confirmColor: '#d7472f', success: (result) => { if (result.confirm) { clearCart(); this.refresh(); } } }); },
  checkout() { const cart = readCart(); if (!cart) return; const selected = readServiceAreaSelection();const point=readPickupPointSelection(); if (!selected || selected.id !== cart.serviceAreaId||!point||point.id!==cart.pickupPointId) { void wx.showModal({ title: '自提点已变化', content: `购物车属于“${cart.pickupPointName??cart.serviceAreaName}”，请切回该自提点或清空后重新选购。`, showCancel: false }); return; } saveCheckoutDraft({ ...cart, source: 'cart' }); void wx.navigateTo({ url: '/pages/checkout/index' }); },
});
