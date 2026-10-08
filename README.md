# TAOA 淘啊竞品分析工作台

当前版本：**2026-10-08 主站统一 AI 接入版**，配套采集器版本 **1.3.8 / CAT2**。

本仓库由所有者于 2026-10-08 改为公开，用于交付网站和采集器源码。GitHub 更新不等同于线上部署。

## 本次更新

- 同步最新版商品、参数、店铺指标、标题字数、类目处理、JPG 图片打包以及评价/问大家 Excel 下载源码。
- 移除客户个人 API 设置、模型选择和插件个人 AI 调用模块。
- 不再提供独立账号、积分、充值或管理员系统，统一交给 **ai.taoa.cc** 管理。
- 保留资料推送、分析对话、进度、结果校验和建议展示，以及手动资料导出/回复导入。

**主站真实接口尚未接入。** `website/lib/host-ai-adapter.ts` 默认导出 `null`，页面如实显示“待接入主站 AI”并禁用分析发送，不会使用旧 AI 服务或假数据。开发方应在这里适配原站的登录、权限、AI 和权威配额接口。

## 开发交付入口

先阅读以下说明：

- [先读交付说明](00-先读交付说明.txt)
- [ai.taoa.cc 主站 AI 对接说明](01-主站AI对接说明.txt)
- [验证记录与未验证范围](02-验证记录.txt)
- [插件说明](extension/README.txt)
- [历史类目数据来源与边界](extension/CATEGORY-DATA-NOTICE.txt)

目录：`website/` 是 Vinext/React/TypeScript 工作台；`extension/` 是完整采集扩展；`scripts/` 是发布检查与运行包重建工具。`FILE-MANIFEST.json` 是 20261008 交付包内容的 SHA-256 清单，不包含本仓库额外的首页及检查脚本。

## 本地开发

需要 Node.js >=22.13.0 和 npm。本次验证使用 Node.js 26.5.0；首次启动请安装依赖。

```sh
cd website
npm ci
npm run dev -- --host 127.0.0.1
```

在仓库根目录检查：

```sh
node scripts/check-release.mjs
cd website
node --test tests/*.test.mjs
npm run build
npx tsc --noEmit --incremental false
```

在仓库根目录执行 `node scripts/build-extension.mjs` 可重新构建 7 个插件运行包（先安装 website 依赖）。构建后如需发布扩展 ZIP，应由开发方重新打包并更新对应内容清单。

## 接入与上线边界

- 插件 `manifest.json` 和 `background.js` 的工作台地址目前仍是旧公开地址。开发方确定 ai.taoa.cc 分区路径后须配套修改并实测，不要扩大为任意来源。
- 不要覆盖原站根布局/全局样式；复用业务组件并隔离样式。统一鉴权、模型密钥、配额、幂等扣费、断线恢复和管理员权限必须由原站服务端负责。
- 不含密钥、真实环境文件、数据库或采集结果；`.openai/hosting.json` 无项目 ID 和数据库绑定，不关联旧站部署。
- 采集使用用户正常登录的商品页；遇到验证或限制暂停，不绕过限制。历史类目表并非实时全类目，上架时间也不保证可得。
- 已完成 9 项离线测试、类型检查、生产构建和本地页面检查；未完成原站真实 AI/扣费或目标域名商品实采联调。上线前还需依赖安全审计及原站验收。

原版本可通过 Git 提交历史查看；本仓库没有自动部署工作流。
