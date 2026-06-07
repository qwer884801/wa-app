# WA n8n 工作流

WA 主链路由 `wa-app` 原生服务闭环；n8n 只作为未来可选自动化增强入口。

当前不保留 WA n8n 工作流定义，避免外部编排继续调用 proxy-runtime `/leases/acquire` 或 `/leases/release`。号码探测、注册、OTP 等待、OTP 提交、登录态检测和长连接恢复均由 `wa-app-service` 的 HTTP/gRPC 原子能力处理。

运行时代理策略：`wa-app` 通过 `PROXY_RUNTIME_API_BASE_URL` 读取 proxy-runtime 固定网关 IN-USER 规则，使用配置的网关用户名拼装代理 URL；业务链路不持有显式动态 IP lease。
