import { transitionCampaign } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";

/** Close a fulfilling campaign once every order has reached a settled state. */
export async function completeCampaignIfSettled(
  store: Pick<
    CommerceStore,
    | "getCampaignForUpdate"
    | "listOrdersByCampaign"
    | "listOrderDeliveryFacts"
    | "getOrderRefundByOrder"
    | "saveCampaign"
  >,
  campaignId: string,
): Promise<boolean> {
  const campaign = await store.getCampaignForUpdate(campaignId);
  if (!campaign || campaign.status !== "FULFILLING") return false;
  const orders = await store.listOrdersByCampaign(campaignId);
  if (orders.some((order) => !["COMPLETED", "REFUNDED", "CANCELLED"].includes(order.status))) return false;
  const orderIds = new Set(orders.map((order) => order.id));
  const [facts, orderRefunds] = await Promise.all([
    store.listOrderDeliveryFacts([...orderIds]),
    Promise.all(orders.map((order) => store.getOrderRefundByOrder(order.id))),
  ]);
  const allocationExceptionIds = new Set(
    facts.allocations
      .filter((allocation) => orderIds.has(allocation.orderId))
      .map((allocation) => allocation.exceptionId),
  );
  if (
    facts.partialRefunds.some((refund) => refund.status !== "SUCCEEDED") ||
    orderRefunds.some((refund) => refund && refund.status !== "SUCCEEDED") ||
    facts.qualityCases.some((value) => !["REJECTED", "RESOLVED"].includes(value.status)) ||
    facts.exceptions.some((value) =>
      (value.orderId !== null ? orderIds.has(value.orderId) : allocationExceptionIds.has(value.id)) &&
      value.status !== "RESOLVED",
    )
  )
    return false;
  campaign.status = transitionCampaign(campaign.status, "COMPLETED");
  await store.saveCampaign(campaign);
  return true;
}
