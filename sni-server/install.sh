#!/bin/bash
# sni-server 一键部署脚本 (集成 Caddy & Cloudflare Tunnel)

set -e

# 1. 鉴权配置
echo -n "请输入鉴权密码 (直接回车将随机生成): "
read input_secret
if [ -z "$input_secret" ]; then
    AUTH_SECRET="SNI_$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 16 | head -n 1)"
else
    AUTH_SECRET="$input_secret"
fi

LISTEN_PORT=443
INSTALL_DIR="/opt/sni-server"

echo "Using Auth Secret: $AUTH_SECRET"
echo "=== Snishaper VPS Server (sni-server) Installer ==="

# 1. 基础环境检查
if [[ $EUID -ne 0 ]]; then
   echo "此脚本必须以 root 权限运行"
   exit 1
fi

# 2. 安装 Caddy
if ! command -v caddy &> /dev/null; then
    echo "正在安装 Caddy..."
    apt install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt update
    apt install -y caddy
fi

# 3. 安装 sni-server 二进制文件 (此处假设已编译或下载)
mkdir -p $INSTALL_DIR
# TODO: 实际环境中这里应该是下载 release 二进制文件
# cp ./sni-server $INSTALL_DIR/

# 4. 创建系统服务
cat <<EOF > /etc/systemd/system/sni-server.service
[Unit]
Description=Snishaper VPS Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/sni-server -port $LISTEN_PORT -secret $AUTH_SECRET
Restart=always
Environment=AUTH_SECRET=$AUTH_SECRET

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sni-server
# systemctl start sni-server

echo "=== 安装完成 ==="
echo "Auth Secret: $AUTH_SECRET"
echo "Listening: $LISTEN_PORT"
echo "--------------------------------------------------"
echo "URL Path 规范: /{Token}/{TargetHost}/{Path}"
echo "示例请求: https://your.domain.com/$AUTH_SECRET/www.google.com/"
echo "--------------------------------------------------"
echo "提示: 如果使用 Cloudflare Tunnel，请运行 'cloudflared tunnel run --token YOUR_TOKEN'"
echo "并将隧道指向 http://localhost:$LISTEN_PORT"
echo "Caddy 配置建议: caddy reverse-proxy --from your.domain.com --to localhost:$LISTEN_PORT"
