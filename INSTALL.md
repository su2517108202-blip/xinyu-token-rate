# 安装与排错

本插件是纯 client bundle，**没有构建步骤**，也没有任何运行时依赖。装完刷新页面即可。

## 装之前先确认

```sh
dsh --version          # 需要 0.2.x；本插件在 0.2.2-rc.3 上开发与验证
dsh plugin --help      # 确认 CLI 可用（本机路径通常是 /Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh）
```

## 方式一：本地目录（GUI）

DSH →「插件」页 → 从本地目录安装 → 选中克隆下来的目录。插件自带 `cordis.patch.yml` 与 `dsh.bundle.patch` 声明，安装后自动注册进 profile 层并挂载，**不需要手写配置行**。

## 方式二：命令行

```sh
git clone https://github.com/su2517108202-blip/xinyu-token-rate.git
dsh plugin --profile desktop add link:$PWD/xinyu-token-rate
```

`--profile` 的值取决于你在用哪个 profile（Desktop 应用默认是 `desktop`，纯 Web 部署常见 `web`）。不确定时看 `~/.dsh/profiles/` 下有哪些目录。

装完**刷新浏览器**（Cmd/Ctrl + R）。

## 方式三：固定版本的 git 依赖

```sh
dsh plugin --profile desktop add 'dsh-xinyu-token-rate@github:su2517108202-blip/xinyu-token-rate#v1.2.0'
```

适合想要可复现环境的情形。升级时把 `#v1.2.0` 换掉重装。

## 装完应该看到什么

输入框正上方多出一条 36 px 高的条：最左是三根小柱的状态标记，接着是速率数字与单位，中间是吞吐曲线，右侧是几个读数标签和展开箭头。

## 排错

### 条没出现，也没有报错

1. 确认插件确实是启用状态：插件页里本插件应是「已启用」。
2. **硬刷新**：Cmd/Ctrl + Shift + R。普通刷新偶尔会用缓存的旧 bundle。
3. 打开开发者工具 Console，看有没有 `unknown slot` 或 `conversation.input.dock` 之类的告警——那通常意味着宿主版本太新/太旧，插槽名变了。

### `useConversation is not a function` / 类似的服务缺失错误

宿主版本与插件版本不匹配。本插件只依赖 `@deepseek-ai/dsh-client-locale` 与 `@deepseek-ai/dsh-client-ui-conversation` 两个客户端模块；如果宿主大改了这两者的 API，就会出现这类错误。请对照 [compatibility.json](compatibility.json) 选版本，或反馈宿主版本号。

### 安装时报 pnpm 构建脚本被拦截

某些 profile 里 pnpm 11 会拦截依赖的 build script。本插件**没有依赖**，一般不会触发；若与你已有的其它插件一起装时报错，在对应 profile 目录下执行：

```sh
pnpm approve-builds --all
```

然后重跑安装。

### 速率一直是 `—`

说明当前没有可测的步骤。`—` 出现在三种情况：空闲、出错，以及**解码窗口不足 400 ms 或输出不足 20 token 的极短步骤**（后者是刻意的，避免几十毫秒的窗口算出四位数速率）。

### 首字列带 `≈`

正常。宿主只为实时流记录 `firstTokenTime`，回放历史步骤时没有这个时间戳，插件按输入量估算，因此加 `≈` 标记。实时生成过程中看到的值是真实测量值，不带标记。

### 想彻底卸载

```sh
dsh plugin --profile desktop remove dsh-xinyu-token-rate
```

或者在插件页里禁用。插件不在宿主里留任何数据：它不写文件、不发请求、不注册路由，卸载后唯一残留是 profile 里的一行安装记录。

## 开发时

```sh
# link 安装后，改 client.js 保存即可 —— 宿主 HMR 会推送新 bundle，连刷新都不用
node --check client.js        # 语法自检
npm run bench                 # 需要先导出会话，见 README
```

仓库里没有打包器：`client.js` 就是最终产物，直接写、直接生效。样式全部包在 `@layer xinyu-token-rate` 里，不会污染宿主层叠。
