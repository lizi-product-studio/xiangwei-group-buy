# 首页与登录页分享

- run_id / task_id：TASK-20260908-MINI-SHARE；attempt 1；局部修改。
- confirmed：用户要求首页、登录页面增加分享并更新。只改两页分享入口与回调，保留登录、协议、区域及商品逻辑。
- 两页 onLoad 调用 showShareMenu，开启 shareAppMessage / shareTimeline；缺少该接口时不阻断原页面。
- 好友分享固定标题“乡味集｜好味道，一起分享”，路径分别为 /pages/home/index、/pages/login/index；朋友圈使用同一标题与空 query，不携带当前 source、token、手机号或跳转意图。不增加图片资产或页面按钮。
- 定向验证：分享两页2项、首页2项、登录13项，共17/17 PASS；mini typecheck、git diff --check PASS。
- 接口依据：已安装微信官方 miniprogram-api-typings 4.0.6 的 showShareMenu、onShareAppMessage、onShareTimeline 定义；[微信 Page 文档](https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareTimeline)、[腾讯云官方分享说明](https://docs.cloudbase.net/recipes/add-share-with-params-miniprogram)。朋友圈打开可能处于单页模式，部分 API 不可用；菜单和能力取决于微信客户端及平台支持，不能承诺所有终端都能分享或在单页模式完成登录。
- 本轮仅当前分支 Git 同步，不部署服务器、不上传微信渠道。真实设备的菜单、转发和接收页面效果待用户使用更新版本验证；B候选仍维持交接未发布状态。
