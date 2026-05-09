#!/bin/sh
set -e

mkdir -p /workspace /run/sshd /etc/ssh/sshd_config.d /etc/ssh/authorized_keys

SSH_PASSWORD_AUTH=yes

if command -v usermod >/dev/null 2>&1; then
    usermod -d /workspace root || true
fi

if [ -n "$OPENCODE_SERVER_PASSWORD" ]; then
    echo "root:$OPENCODE_SERVER_PASSWORD" | chpasswd
fi

if [ -n "$USER_SSH_PUBLIC_KEY" ]; then
    SSH_PASSWORD_AUTH=no
    touch /etc/ssh/authorized_keys/root
    chmod 600 /etc/ssh/authorized_keys/root
    chown root:root /etc/ssh/authorized_keys/root
    if ! grep -qxF "$USER_SSH_PUBLIC_KEY" /etc/ssh/authorized_keys/root 2>/dev/null; then
        printf '%s\n' "$USER_SSH_PUBLIC_KEY" >> /etc/ssh/authorized_keys/root
    fi
fi

cat > /etc/ssh/sshd_config.d/gitterm.conf <<EOF
PubkeyAuthentication yes
AuthorizedKeysFile /etc/ssh/authorized_keys/%u
PasswordAuthentication ${SSH_PASSWORD_AUTH}
KbdInteractiveAuthentication no
PermitRootLogin yes
UsePAM no
AllowTcpForwarding yes
AllowAgentForwarding yes
X11Forwarding no
ClientAliveInterval 30
ClientAliveCountMax 6
Subsystem sftp internal-sftp
EOF

ssh-keygen -A

echo "Starting sshd on port 22..."
/usr/sbin/sshd -D -e &
SSHD_PID="$!"

sleep 1
if ! kill -0 "$SSHD_PID" 2>/dev/null; then
    echo "sshd failed to stay running" >&2
    exit 1
fi

exec /server-entrypoint.sh "$@"
