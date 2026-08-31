import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
import { campaignScheduleError, formatValidationDetails } from "./campaign-form.ts";

describe("campaign creation schedule and validation copy", () => {
  const cutoffAt = dayjs("2026-08-28T13:00:00+08:00");
  const dispatchAt = dayjs("2026-08-28T14:00:00+08:00");
  const arrivalStartAt = dayjs("2026-08-29T06:00:00+08:00");
  const arrivalEndAt = dayjs("2026-08-31T06:04:00+08:00");

  it("enforces every ordered time relation and revalidates dependent fields", () => {
    expect(campaignScheduleError("dispatchAt", cutoffAt, { cutoffAt })).toBe(
      "计划发车时间必须晚于截单时间",
    );
    expect(campaignScheduleError("dispatchAt", dispatchAt, { cutoffAt })).toBeNull();
    expect(
      campaignScheduleError("estimatedArrivalStartAt", cutoffAt, { dispatchAt }),
    ).toBe("预计到货开始时间不能早于计划发车时间");
    expect(
      campaignScheduleError("estimatedArrivalStartAt", arrivalStartAt, { dispatchAt }),
    ).toBeNull();
    expect(
      campaignScheduleError("estimatedArrivalEndAt", dispatchAt, {
        estimatedArrivalStartAt: arrivalStartAt,
      }),
    ).toBe("预计到货结束时间不能早于开始时间");
    expect(
      campaignScheduleError("estimatedArrivalEndAt", arrivalEndAt, {
        estimatedArrivalStartAt: arrivalStartAt,
      }),
    ).toBeNull();
  });

  it("maps the server field issue from the reproduced request", () => {
    expect(
      formatValidationDetails([
        {
          code: "custom",
          path: ["dispatchAt"],
          message: "发车时间必须晚于截团时间",
        },
      ]),
    ).toBe("计划发车时间：发车时间必须晚于截团时间");
    expect(
      formatValidationDetails([
        { path: ["dispatchAt"], message: "发车时间必须晚于截团时间" },
        { path: ["dispatchAt"], message: "发车时间必须晚于截团时间" },
      ]),
    ).toBe("计划发车时间：发车时间必须晚于截团时间");
  });
});
