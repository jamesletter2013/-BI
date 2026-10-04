# TAOA 淘啊竞品分析工作台

公司内部的淘宝/天猫竞品采集与分析工作台。目标仓库：`jamesletter2013/-BI`（私有）。

## 目录

- `website/`：React + TypeScript + Vinext 工作台，保留现有 Sites 项目关联。
- `extension/`：V1.0.12 浏览器采集器源码、运行时与橙色图标，可直接加载该目录。
- `scripts/`：源码包检查和扩展运行时构建。

## 本地启动

需要 Node.js 22.13 或更新版本，以及 npm。

```sh
cd website
npm ci
npm run dev -- --host 127.0.0.1
```

构建与类型检查：

```sh
npm run build
npx tsc --noEmit --incremental false
```

`website/.openai/hosting.json` 关联现有站点，项目 ID 不是密钥。GitHub 仅管理源码；这里没有自动发布工作流，不会改变线上网站权限。不要使用 GitHub Pages 承担服务器端 AI 接口。

## 安装采集器

在支持 Manifest V3 的 Chromium 浏览器中，打开扩展管理，启用开发者模式，选择“加载已解压的扩展程序”，选择 `extension/`。公司正式分发前需在指定浏览器验收。

工作台：https://taoa-competitor-lab.jamesletter2013.chatgpt.site/

- 网站仍使用原访问权限，取得源码不等于取得网站使用权限。
- 扩展目前仅连接上述正式站点，不向 localhost 注入。纯 UI 本地预览不代表采集已经接通。
- 更换域名需同步核对 manifest、background.js、bridge.js 的域名设置，不要开放任意域名。
- 每人使用自己的平台登录状态；采集数据默认保存在各自浏览器，不自动共享。
- 已安装用户先结束采集，再备份并原位升级，保留扩展 ID；不要删除扩展或清空存储。

## 当前功能与边界

商品信息、主图、SKU、详情、参数、评价和问大家独立显示与滚动。问大家优先、评价随后分批读取；受限、未知总量与缺口如实展示，不承诺全量。

一键推送当前资料快照，评价默认仅差评并保留追评，可切换中差评或全部。图片以链接收录，不代表 AI 已看图。现已加入 DeepSeek 官方服务端适配器、模型选择、发送分析和建议回填；仍保留复制 / TXT 导出 / 手动粘贴回复。

**API 默认关闭，尚未进行收费联调。** 管理员在服务端配置密钥并明确启用后，员工才可使用统一接口。包括同源与登录检查、单次长度限制、每日使用次数与重复提交保护。接入方法和扩展其他服务商见 [AI 管理员说明](website/docs/AI-ADMIN.md)。

遇到访问验证、登录或限流暂停，不绕过限制。不上传账号密码、Cookie 或买家身份。新增 AI 接口前需确认服务商、数据外发范围和预算；密钥只放服务端，不提交源码。

## 开发检查

从仓库根目录执行：

```sh
node scripts/check-release.mjs
# 先安装 website 依赖，修改 extension/src 后：
node scripts/build-extension.mjs
```

扩展 README 中旧版本的 `work/...` 命令属于历史工作区，不随本仓库分发；运行时构建使用上面的新命令。

源码快照：2026-10-04；网站源提交 `371ab33201dbccedbf6c63674002da58954d7e53`，扩展 V1.0.12（本次未改）。未包含真实采集数据、密钥、调试截图、历史附件、旧安装包或 node_modules。

## 公司开放前待办

当前保持所有者私密访问，不应直接开放给全公司。需完成密钥配置、小资料真实联调、员工访问与插件安装验收，以及依赖安全更新。2026-10-04 的 `npm audit --omit=dev` 报告 17 项告警（14 high、2 moderate、1 low，含传递依赖和开发工具链），包含现有 React Server Components / Vinext 相关项；本轮没有执行破坏性 `audit fix --force`，也没有据此宣称运行时全部可利用或安全检查已通过。正式多人开放前应逐项确认补丁和运行时可达性。
