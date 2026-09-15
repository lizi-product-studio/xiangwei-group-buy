import { api, customerAuth, customerErrorMessage } from "../../utils/api";

Page({
  data: { loading: true, saving: false, error: "", displayName: "", avatarUrl: "", avatarRef: "", phoneNumber: "", profileVersion: 0 },
  onLoad() { void this.loadProfile(); },
  async loadProfile() {
    if (!customerAuth.isLoggedIn()) { void wx.redirectTo({ url: "/pages/login/index?source=profile" }); return; }
    try {
      const profile = await api.getMyProfile();
      const avatarUrl = profile.avatarUrl ? await api.downloadMyProfileImage(profile.avatarUrl).catch(() => "") : "";
      this.setData({ displayName: profile.displayName ?? "", avatarRef: profile.avatarUrl ?? "", avatarUrl, phoneNumber: profile.phoneNumber ?? "未绑定手机号", profileVersion: profile.profileVersion, loading: false });
    } catch (error) { this.setData({ loading: false, error: customerErrorMessage(error, "资料加载失败，请稍后重试") }); }
  },
  onNameInput(event: WechatMiniprogram.Input) { this.setData({ displayName: event.detail.value }); },
  async chooseAvatar(event: { detail: { avatarUrl: string } }) {
    const path = event.detail.avatarUrl;
    if (!path) return;
    this.setData({ saving: true, error: "" });
    try {
      const result = await api.uploadProfileImage(path);
      this.setData({ avatarRef: result.imageUrl, avatarUrl: path });
      void wx.showToast({ title: "头像已上传", icon: "success" });
    } catch (error) { this.setData({ error: customerErrorMessage(error, "头像上传失败，请稍后重试") }); }
    finally { this.setData({ saving: false }); }
  },
  async saveProfile() {
    const displayName = this.data.displayName.trim();
    if (!displayName) { this.setData({ error: "请输入姓名" }); return; }
    this.setData({ saving: true, error: "" });
    try {
      const profile = await api.updateMyProfile({ displayName, avatarUrl: this.data.avatarRef || null, expectedVersion: this.data.profileVersion });
      this.setData({ profileVersion: profile.profileVersion, displayName: profile.displayName ?? displayName, avatarRef: profile.avatarUrl ?? this.data.avatarRef });
      void wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) { this.setData({ error: customerErrorMessage(error, "保存失败，请刷新后重试") }); }
    finally { this.setData({ saving: false }); }
  },
  async authorizePhone(event: WechatMiniprogram.ButtonGetPhoneNumber) {
    const code = event.detail?.code;
    if (event.detail?.errMsg !== "getPhoneNumber:ok" || !code) { this.setData({ error: "手机号授权未完成，可稍后重试" }); return; }
    this.setData({ saving: true, error: "" });
    try {
      const profile = await api.rebindMyPhone(code, this.data.profileVersion);
      this.setData({ profileVersion: profile.profileVersion, phoneNumber: profile.phoneNumber ?? "已绑定" });
      void wx.showToast({ title: "手机号已更新", icon: "success" });
    } catch (error) { this.setData({ error: customerErrorMessage(error, "手机号更新失败，请稍后重试") }); }
    finally { this.setData({ saving: false }); }
  },
});
