export function getEntryBranding(hostname: string) {
  const pickup = hostname === "saas.liziqi.icu";
  return {
    title: pickup ? "乡味集 · 点位工作台" : "乡味集 · 运营管理后台",
    storyTitle: pickup ? "乡味集 · 点位工作台" : "乡味集 · 运营管理后台",
    loginTitle: pickup ? "点位负责人登录" : "乡味集 · 运营管理后台",
    loginBrand: "乡味集",
    loginSection: pickup ? "点位工作台" : "运营后台",
    description: pickup
      ? "使用点位负责人账号登录，处理到货确认与提货核销。"
      : "运营、客服、财务与点位负责人使用各自账号登录。",
    passwordDescription: pickup
      ? "为了继续使用点位工作台，请先完成密码修改。"
      : "为了继续使用后台，请先完成密码修改。",
    workspaceDescription: pickup ? "点位工作台 · 到货与提货" : "社区团购 · 运营管理",
  };
}
