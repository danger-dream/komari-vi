#!/bin/bash

# Color definitions for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${NC} $1"
}

log_success() {
    echo -e "${GREEN}${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${NC} $1"
}

log_config() {
    echo -e "${CYAN}[CONFIG]${NC} $1"
}

# Default values
service_name="komari-agent"
target_dir="/opt/komari"
github_proxy=""
install_version=""
endpoint=""
token=""

# Detect OS
os_type=$(uname -s)
case $os_type in
    Darwin)
        os_name="darwin"
        target_dir="/usr/local/komari"  # Use /usr/local on macOS
        # Check if we can write to /usr/local, fallback to user directory
        if [ ! -w "/usr/local" ] && [ "$EUID" -ne 0 ]; then
            target_dir="$HOME/.komari"
            log_info "No write permission to /usr/local, using user directory: $target_dir"
        fi
        ;;
    Linux)
        os_name="linux"
        ;;
    FreeBSD)
        os_name="freebsd"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        os_name="windows"
        target_dir="/c/komari"  # Use C:\komari on Windows
        ;;
    *)
        log_error "Unsupported operating system: $os_type"
        exit 1
        ;;
esac

# Parse install-specific arguments
komari_args=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --install-dir)
            target_dir="$2"
            shift 2
            ;;
        --install-service-name)
            service_name="$2"
            shift 2
            ;;
        --install-ghproxy)
            github_proxy="$2"
            shift 2
            ;;
        --install-version)
            install_version="$2"
            shift 2
            ;;
        -e)
            endpoint="$2"
            komari_args="$komari_args -e $2"
            shift 2
            ;;
        -t)
            token="$2"
            komari_args="$komari_args -t $2"
            shift 2
            ;;
        --install*)
            log_warning "Unknown install parameter: $1"
            shift
            ;;
        *)
            komari_args="$komari_args $1"
            shift
            ;;
    esac
done

komari_args="${komari_args# }"
komari_agent_path="${target_dir}/agent"

# macOS doesn't always require sudo for everything
if [ "$os_name" = "darwin" ] && command -v brew >/dev/null 2>&1; then
    require_root_for_deps=false
else
    require_root_for_deps=true
fi

if [ "$EUID" -ne 0 ] && [ "$require_root_for_deps" = true ]; then
    log_error "Please run as root"
    exit 1
fi

echo -e "${WHITE}===========================================${NC}"
echo -e "${WHITE}    Komari Agent Installation Script     ${NC}"
echo -e "${WHITE}===========================================${NC}"
echo ""
log_config "Installation configuration:"
log_config "  Service name: ${GREEN}$service_name${NC}"
log_config "  Install directory: ${GREEN}$target_dir${NC}"
log_config "  GitHub proxy: ${GREEN}${github_proxy:-"(direct)"}${NC}"
log_config "  Binary arguments: ${GREEN}$komari_args${NC}"
if [ -n "$install_version" ]; then
    log_config "  Specified agent version: ${GREEN}$install_version${NC}"
else
    log_config "  Agent version: ${GREEN}Current${NC}"
fi
echo ""

uninstall_previous() {
    log_step "Checking for previous installation..."
    
    if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "${service_name}.service"; then
        log_info "Stopping and disabling existing systemd service..."
        systemctl stop ${service_name}.service
        systemctl disable ${service_name}.service
        rm -f "/etc/systemd/system/${service_name}.service"
        systemctl daemon-reload
    elif command -v rc-service >/dev/null 2>&1 && [ -f "/etc/init.d/${service_name}" ]; then
        log_info "Stopping and disabling existing OpenRC service..."
        rc-service ${service_name} stop
        rc-update del ${service_name} default
        rm -f "/etc/init.d/${service_name}"
    elif command -v uci >/dev/null 2>&1 && [ -f "/etc/init.d/${service_name}" ]; then
        log_info "Stopping and disabling existing procd service..."
        /etc/init.d/${service_name} stop
        /etc/init.d/${service_name} disable
        rm -f "/etc/init.d/${service_name}"
    elif [ "$os_name" = "darwin" ] && command -v launchctl >/dev/null 2>&1; then
        system_plist="/Library/LaunchDaemons/com.komari.${service_name}.plist"
        user_plist="$HOME/Library/LaunchAgents/com.komari.${service_name}.plist"
        
        if [ -f "$system_plist" ]; then
            log_info "Stopping and removing existing system launchd service..."
            launchctl bootout system "$system_plist" 2>/dev/null || true
            rm -f "$system_plist"
        fi
        
        if [ -f "$user_plist" ]; then
            log_info "Stopping and removing existing user launchd service..."
            launchctl bootout gui/$(id -u) "$user_plist" 2>/dev/null || true
            rm -f "$user_plist"
        fi
    fi
    
    if [ -f "$komari_agent_path" ]; then
        log_info "Removing old binary..."
        rm -f "$komari_agent_path"
    fi
}

uninstall_previous

install_dependencies() {
    log_step "Checking and installing dependencies..."

    local deps="curl"
    local missing_deps=""
    for cmd in $deps; do
        if ! command -v $cmd >/dev/null 2>&1; then
            missing_deps="$missing_deps $cmd"
        fi
    done

    if [ -n "$missing_deps" ]; then
        if command -v apt >/dev/null 2>&1; then
            log_info "Using apt to install dependencies..."
            apt update
            apt install -y $missing_deps
        elif command -v yum >/dev/null 2>&1; then
            log_info "Using yum to install dependencies..."
            yum install -y $missing_deps
        elif command -v apk >/dev/null 2>&1; then
            log_info "Using apk to install dependencies..."
            apk add $missing_deps
        elif command -v brew >/dev/null 2>&1; then
            log_info "Using Homebrew to install dependencies..."
            brew install $missing_deps
        else
            log_error "No supported package manager found (apt/yum/apk/brew)"
            exit 1
        fi
        
        for cmd in $missing_deps; do
            if ! command -v $cmd >/dev/null 2>&1; then
                log_error "Failed to install $cmd"
                exit 1
            fi
        done
        log_success "Dependencies installed successfully"
    else
        log_success "Dependencies already satisfied"
    fi
}

install_dependencies

arch=$(uname -m)
case $arch in
    x86_64)
        arch="amd64"
        ;;
    aarch64|arm64)
        arch="arm64"
        ;;
    i386|i686)
        case $os_name in
            freebsd|linux|windows)
                arch="386"
                ;;
            *)
                log_error "32-bit x86 architecture not supported on $os_name"
                exit 1
                ;;
        esac
        ;;
    armv7*|armv6*)
        case $os_name in
            freebsd|linux)
                arch="arm"
                ;;
            *)
                log_error "32-bit ARM architecture not supported on $os_name"
                exit 1
                ;;
        esac
        ;;
    *)
        log_error "Unsupported architecture: $arch on $os_name"
        exit 1
        ;;
esac
log_info "Detected OS: ${GREEN}$os_name${NC}, Architecture: ${GREEN}$arch${NC}"

if [ -z "$endpoint" ] || [ -z "$token" ]; then
    log_error "Missing required arguments: -e <endpoint> -t <token>"
    exit 1
fi
endpoint="${endpoint%/}"

download_url="${endpoint}/api/public/agent/package?token=${token}&os=${os_name}&arch=${arch}"
if [ -n "$install_version" ]; then
    download_url="${download_url}&version=${install_version}"
fi

file_name="komari-agent-${os_name}-${arch}"
log_step "Creating installation directory: ${GREEN}$target_dir${NC}"
mkdir -p "$target_dir"

log_step "Downloading $file_name from Komari panel..."
log_info "URL: ${CYAN}$download_url${NC}"
if ! curl -fL -o "$komari_agent_path" "$download_url"; then
    log_error "Download failed"
    exit 1
fi

chmod +x "$komari_agent_path"
log_success "Komari-agent installed to ${GREEN}$komari_agent_path${NC}"

log_step "Configuring system service..."

detect_init_system() {
    if [ -f /etc/NIXOS ]; then
        echo "nixos"
        return
    fi
    
    if [ -f /etc/alpine-release ]; then
        if command -v rc-service >/dev/null 2>&1 || [ -f /sbin/openrc-run ]; then
            echo "openrc"
            return
        fi
    fi
    
    local pid1_process=$(ps -p 1 -o comm= 2>/dev/null | tr -d ' ')
    
    if [ "$pid1_process" = "systemd" ] || [ -d /run/systemd/system ]; then
        if command -v systemctl >/dev/null 2>&1; then
            if systemctl list-units >/dev/null 2>&1; then
                echo "systemd"
                return
            fi
        fi
    fi
    
    if [ "$pid1_process" = "openrc-init" ]; then
        if command -v rc-service >/dev/null 2>&1; then
            echo "openrc"
            return
        fi
    fi
    
    if command -v rc-service >/dev/null 2>&1 && [ -f /sbin/openrc-run ]; then
        echo "openrc"
        return
    fi
    
    if [ -d /etc/init.d ] && [ -f /etc/init.d/cron ] && [ ! -f /lib/systemd/systemd ]; then
        if command -v update-rc.d >/dev/null 2>&1 || command -v chkconfig >/dev/null 2>&1; then
            echo "sysv"
            return
        fi
    fi
    
    if [ -f /etc/openwrt_release ] || [ -f /etc/config/system ]; then
        if command -v /etc/init.d >/dev/null 2>&1; then
            echo "procd"
            return
        fi
    fi
    
    if [ "$os_name" = "darwin" ] && command -v launchctl >/dev/null 2>&1; then
        echo "launchd"
        return
    fi
    
    if [ -f /etc/init.d/rcS ] || [ -f /etc/inittab ]; then
        echo "busybox"
        return
    fi
    
    echo "unknown"
}

init_system=$(detect_init_system)
log_info "Detected init system: ${GREEN}$init_system${NC}"

setup_systemd_service() {
    log_step "Setting up systemd service..."
    cat > "/etc/systemd/system/${service_name}.service" << EOF
[Unit]
Description=Komari Agent
After=network.target

[Service]
Type=simple
ExecStart=${komari_agent_path} ${komari_args}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable ${service_name}.service
    systemctl restart ${service_name}.service
}

setup_openrc_service() {
    log_step "Setting up OpenRC service..."
    cat > "/etc/init.d/${service_name}" << EOF
#!/sbin/openrc-run

name="Komari Agent"
description="Komari monitoring agent"
command="${komari_agent_path}"
command_args="${komari_args}"
command_background="yes"
pidfile="/run/${service_name}.pid"

depend() {
    need net
}
EOF

    chmod +x "/etc/init.d/${service_name}"
    rc-update add ${service_name} default
    rc-service ${service_name} restart
}

setup_sysv_service() {
    log_step "Setting up SysV init service..."
    cat > "/etc/init.d/${service_name}" << EOF
#!/bin/sh
### BEGIN INIT INFO
# Provides:          ${service_name}
# Required-Start:    \$network \$remote_fs \$syslog
# Required-Stop:     \$network \$remote_fs \$syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Komari Agent
# Description:       Komari monitoring agent
### END INIT INFO

DAEMON="${komari_agent_path}"
DAEMON_ARGS="${komari_args}"
NAME="${service_name}"
PIDFILE="/var/run/\$NAME.pid"

start() {
    echo "Starting \$NAME..."
    start-stop-daemon --start --background --make-pidfile --pidfile \$PIDFILE --exec \$DAEMON -- \$DAEMON_ARGS
}

stop() {
    echo "Stopping \$NAME..."
    start-stop-daemon --stop --pidfile \$PIDFILE --retry 10
    rm -f \$PIDFILE
}

restart() {
    stop
    start
}

case "\$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        if [ -f \$PIDFILE ]; then
            echo "\$NAME is running."
        else
            echo "\$NAME is not running."
        fi
        ;;
    *)
        echo "Usage: \$0 {start|stop|restart|status}"
        exit 1
        ;;
esac
exit 0
EOF

    chmod +x "/etc/init.d/${service_name}"
    if command -v update-rc.d >/dev/null 2>&1; then
        update-rc.d ${service_name} defaults
    elif command -v chkconfig >/dev/null 2>&1; then
        chkconfig --add ${service_name}
        chkconfig ${service_name} on
    fi
    service ${service_name} restart || "/etc/init.d/${service_name}" restart
}

setup_procd_service() {
    log_step "Setting up procd service (OpenWrt)..."
    cat > "/etc/init.d/${service_name}" << EOF
#!/bin/sh /etc/rc.common

START=99
STOP=15

USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command ${komari_agent_path} ${komari_args}
    procd_set_param respawn
    procd_close_instance
}
EOF

    chmod +x "/etc/init.d/${service_name}"
    /etc/init.d/${service_name} enable
    /etc/init.d/${service_name} restart
}

setup_launchd_service() {
    log_step "Setting up launchd service (macOS)..."

    plist_name="com.komari.${service_name}"
    plist_path="/Library/LaunchDaemons/${plist_name}.plist"
    
    if [ "$EUID" -eq 0 ]; then
        cat > "$plist_path" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${plist_name}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${komari_agent_path}</string>
EOF
        for arg in $komari_args; do
            echo "        <string>$arg</string>" >> "$plist_path"
        done
        cat >> "$plist_path" << EOF
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/${service_name}.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/${service_name}.error.log</string>
</dict>
</plist>
EOF

        chmod 644 "$plist_path"
        launchctl load -w "$plist_path"
        launchctl start "$plist_name"
    else
        user_plist_path="$HOME/Library/LaunchAgents/${plist_name}.plist"
        mkdir -p "$HOME/Library/LaunchAgents"
        
        cat > "$user_plist_path" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${plist_name}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${komari_agent_path}</string>
EOF
        for arg in $komari_args; do
            echo "        <string>$arg</string>" >> "$user_plist_path"
        done
        cat >> "$user_plist_path" << EOF
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/${service_name}.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/${service_name}.error.log</string>
</dict>
</plist>
EOF

        chmod 644 "$user_plist_path"
        launchctl load -w "$user_plist_path"
        launchctl start "$plist_name"
    fi
}

case $init_system in
    systemd)
        setup_systemd_service
        ;;
    openrc)
        setup_openrc_service
        ;;
    sysv)
        setup_sysv_service
        ;;
    procd)
        setup_procd_service
        ;;
    launchd)
        setup_launchd_service
        ;;
    nixos)
        log_warning "NixOS detected. Please configure the service manually using NixOS configuration."
        log_info "Binary installed at: $komari_agent_path"
        log_info "Arguments: $komari_args"
        ;;
    *)
        log_warning "Unknown init system. Please configure the service manually."
        log_info "Binary installed at: $komari_agent_path"
        log_info "Arguments: $komari_args"
        ;;
esac

log_success "Installation completed!"
log_config "Service name: $service_name"
log_config "Binary path: $komari_agent_path"
log_config "Arguments: $komari_args"
