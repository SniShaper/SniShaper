/**
 * Snishaper Universal Server Engine
 * 
 * 这是一个通用的反向代理脚本（主要适配 Cloudflare Worker 环境）。
 * 它负责接收被 Snishaper 客户端封装的 HTTP 请求，并剥壳后对真实目标发起 fetch。
 */

// 默认的 fallback 密码，推荐在 Cloudflare Dashboard 设置名为 AUTH_SECRET 的环境变量
const DEFAULT_AUTH_SECRET = "CHANGE_ME_IN_PRODUCTION";

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        // path 格式: /{token}/{target_host}/{original_path...}
        // 例: /mysecret/www.google.com/search?q=hello
        const parts = url.pathname.split("/").filter(p => p !== "");

        if (parts.length < 2) {
            return new Response("Not Found", { status: 404 });
        }

        // 1. 鉴权校验
        const token = parts[0];
        const expectedAuth = (env && env.AUTH_SECRET) ? env.AUTH_SECRET : DEFAULT_AUTH_SECRET;

        if (token !== expectedAuth) {
            // 返回 404 伪装成普通不存在页面
            return new Response("Not Found", { status: 404 });
        }

        // 2. 提取并构造目标 URL
        const targetHost = parts[1];
        const restPath = parts.slice(2).join("/");
        const targetUrlStr = `https://${targetHost}/${restPath}${url.search}`;

        let targetUrl;
        try {
            targetUrl = new URL(targetUrlStr);
        } catch (e) {
            return new Response("Not Found", { status: 404 });
        }

        // 3. 构建发往目标网站的新请求头 (移除特定的边缘节点控制头)
        const newHeaders = new Headers(request.headers);
        // 重写 Host 头为真实后端 Host，防止目标网站因 SNI 与 Host 不符报错
        newHeaders.set("Host", targetUrl.host);
        newHeaders.delete("connection");
        newHeaders.delete("x-forwarded-for");
        newHeaders.delete("x-forwarded-proto");
        newHeaders.delete("x-real-ip");

        let fetchOpts = {
            method: request.method,
            headers: newHeaders,
            redirect: "manual", // 让客户端自己处理重定向
            cf: {
                cacheEverything: false,
                cacheTtl: 0
            }
        };

        if (request.method !== "GET" && request.method !== "HEAD") {
            fetchOpts.body = request.body;
        }

        try {
            // 4. 发起代为请求
            const response = await fetch(targetUrl.toString(), fetchOpts);

            // 5. 过滤回显头部，防止安全策略干扰
            const responseHeaders = new Headers(response.headers);
            responseHeaders.delete('content-security-policy');
            responseHeaders.delete('content-security-policy-report-only');
            responseHeaders.delete('clear-site-data');

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
            });
        } catch (e) {
            return new Response("Not Found", { status: 502 });
        }
    }
};
