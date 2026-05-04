package main

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

type Proxy struct {
	secret string
}

func NewProxy(secret string) *Proxy {
	return &Proxy{secret: secret}
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 路径规范: /{token}/{target_host}/{path...}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 2 {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	// 1. 鉴权校验
	token := parts[0]
	if token != p.secret {
		// 返回 404 伪装成普通不存在页面
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	// 2. 提取目标 Host
	targetHost := parts[1]

	// 3. 提取业务 Path 并进行 L7 反向代理
	restPath := "/"
	if len(parts) > 2 {
		restPath = "/" + strings.Join(parts[2:], "/")
	}
	targetURL, _ := url.Parse(fmt.Sprintf("https://%s%s", targetHost, restPath))

	// 3. 配置反向代理
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = targetURL.Scheme
			req.URL.Host = targetURL.Host
			req.URL.Path = targetURL.Path
			req.URL.RawQuery = targetURL.RawQuery
			req.Host = targetURL.Host

			// 清洗请求头
			req.Header.Del("Connection")
			req.Header.Del("X-Forwarded-For")
			req.Header.Del("X-Forwarded-Proto")
			req.Header.Del("X-Real-IP")
		},
		ModifyResponse: func(resp *http.Response) error {
			// 清洗响应头 (防止 CSP 干扰)
			resp.Header.Del("Content-Security-Policy")
			resp.Header.Del("Content-Security-Policy-Report-Only")
			resp.Header.Del("Clear-Site-Data")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("Proxy Error: %v", err)
			http.Error(w, "Not Found", http.StatusBadGateway)
		},
	}

	proxy.ServeHTTP(w, r)
}

func (p *Proxy) handleConnect(w http.ResponseWriter, r *http.Request) {
	target := strings.TrimSpace(r.Host)
	if target == "" {
		target = strings.TrimSpace(r.URL.Host)
	}
	if target == "" {
		target = strings.TrimSpace(r.URL.Opaque)
	}
	if target == "" {
		http.Error(w, "Missing CONNECT target", http.StatusBadRequest)
		return
	}
	if _, _, err := net.SplitHostPort(target); err != nil {
		target = net.JoinHostPort(target, "443")
	}

	upstream, err := (&net.Dialer{Timeout: 10 * time.Second}).Dial("tcp", target)
	if err != nil {
		http.Error(w, "Dial target failed", http.StatusBadGateway)
		return
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		upstream.Close()
		http.Error(w, "Hijack unsupported", http.StatusInternalServerError)
		return
	}

	client, rw, err := hj.Hijack()
	if err != nil {
		upstream.Close()
		return
	}

	if _, err = rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		client.Close()
		upstream.Close()
		return
	}
	if err = rw.Flush(); err != nil {
		client.Close()
		upstream.Close()
		return
	}

	if n := rw.Reader.Buffered(); n > 0 {
		if _, err := io.CopyN(upstream, rw, int64(n)); err != nil {
			client.Close()
			upstream.Close()
			return
		}
	}

	go proxyStream(upstream, client)
	go proxyStream(client, upstream)
}

func proxyStream(dst net.Conn, src net.Conn) {
	_, _ = io.Copy(dst, bufio.NewReader(src))
	if tcp, ok := dst.(*net.TCPConn); ok {
		_ = tcp.CloseWrite()
	} else {
		_ = dst.Close()
	}
}
