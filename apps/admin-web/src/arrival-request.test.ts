import { describe, expect, it } from "vitest";
import { buildCommunityArrivalRequest } from "./App.tsx";

type ArrivalForm = Parameters<typeof buildCommunityArrivalRequest>[0];

const form: ArrivalForm = {
  receivedBy: "点位负责人",
  confirmationNote: "现场清点完成",
  items: [
    {
      catalogSkuId: "sku-1",
      expectedQuantity: 2,
      receivedQuantity: 1,
      rejectedQuantity: 0,
      shortQuantity: 1,
      damagedQuantity: 0,
      evidenceNote: "少一件",
    },
  ],
};

describe("community arrival request", () => {
  it("omits emergencyReason for a normal pickup-manager confirmation", () => {
    const payload = buildCommunityArrivalRequest(form);
    expect(payload).not.toHaveProperty("emergencyReason");
    expect(payload.items[0]).toMatchObject({
      reason: "SHORT_RECEIPT",
      evidenceNote: "少一件",
    });
  });

  it("includes a trimmed emergency reason only for the emergency proxy", () => {
    expect(buildCommunityArrivalRequest(form, "  负责人失联  ")).toMatchObject({
      emergencyReason: "负责人失联",
    });
  });

  it("rejects an unbalanced quantity or an undocumented difference before request submission", () => {
    const item = form.items[0]!;
    expect(() =>
      buildCommunityArrivalRequest({
        ...form,
        items: [{ ...item, receivedQuantity: 2 }],
      }),
    ).toThrow("数量之和必须等于应到数量");
    expect(() =>
      buildCommunityArrivalRequest({
        ...form,
        items: [{ ...item, evidenceNote: " " }],
      }),
    ).toThrow("必须填写差异说明");
  });
});
