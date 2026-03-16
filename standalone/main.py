import sys
import os
import threading
import json
import subprocess
from PyQt5.QtWidgets import QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, QMessageBox, QTextEdit, QGroupBox, QFormLayout, QCheckBox, QSystemTrayIcon, QMenu, QAction, QStyle
from PyQt5.QtCore import pyqtSignal, QObject, QTimer
import socket
from werkzeug.serving import make_server

try:
    from server import app as flask_app
except ImportError as e:
    flask_app = None
    print(f"[!] 导入 server 失败: {e}")

class SignalEmitter(QObject):
    log_signal = pyqtSignal(str)

class StreamRedirector(object):
    def __init__(self, emitter):
        self.emitter = emitter

    def write(self, text):
        if text.strip():
            self.emitter.log_signal.emit(text.strip())

    def flush(self):
        pass

class CanvaPluginServer(QWidget):
    def __init__(self):
        super().__init__()
        self.server_thread = None
        self.werkzeug_server = None
        self.force_exit = False
        self.tray_icon = None
        self.has_shown_tray_hint = False
        self.emitter = SignalEmitter()
        self.emitter.log_signal.connect(self.append_log)
        
        sys.stdout = StreamRedirector(self.emitter)
        sys.stderr = StreamRedirector(self.emitter)

        # 使得配置文件保存在用户目录，兼容 Mac 上的 App 沙盒环境与 Windows
        self.config_file = os.path.join(os.path.expanduser('~'), '.canva_tools_config.json')
        self.config = self.load_config()
        self.initUI()

        # 如果存在配置，自动启动！
        if self.config:
            QTimer.singleShot(500, self.start_server)

    def load_config(self):
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def save_config(self):
        try:
            self.config = {
                'db_host': self.db_host.text().strip(),
                'db_user': self.db_user.text().strip(),
                'db_pass': self.db_pass.text().strip(),
                'port': self.port_backend.text().strip(),
                'auto_start': self.auto_start_checkbox.isChecked() if hasattr(self, 'auto_start_checkbox') else True,
                'canva_app_id': self.canva_app_id_input.text().strip() if hasattr(self, 'canva_app_id_input') else self.config.get('canva_app_id', ''),
            }
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[ERROR] 保存配置失败: {e}")

    def get_free_port(self, start_port):
        port = start_port
        while self.check_port_in_use(port):
            port += 1
        return port

    def initUI(self):
        self.setWindowTitle('Canva 素材本地联通服务 (免配置独立版)')
        self.resize(550, 600)

        layout = QVBoxLayout()

        instruction = QLabel('说明：打开软件自动驻留后台运行，无需多余操作，直接使用即可。所有日志只保留最新100条。')
        instruction.setWordWrap(True)
        layout.addWidget(instruction)
        
        db_group = QGroupBox("数据库登录信息 (留空即不使用数据库)")
        db_layout = QFormLayout()
        
        self.db_host = QLineEdit(self.config.get('db_host', ''))
        self.db_user = QLineEdit(self.config.get('db_user', ''))
        self.db_pass = QLineEdit(self.config.get('db_pass', ''))
        self.db_pass.setEchoMode(QLineEdit.Password)
        
        db_layout.addRow("Host:", self.db_host)
        db_layout.addRow("User:", self.db_user)
        db_layout.addRow("Pass:", self.db_pass)
        db_group.setLayout(db_layout)
        layout.addWidget(db_group)

        # ── Canva 应用绑定 ──────────────────────────────────
        canva_group = QGroupBox("Canva 应用绑定")
        canva_layout = QFormLayout()

        self.canva_app_id_input = QLineEdit(self.config.get('canva_app_id', ''))
        self.canva_app_id_input.setPlaceholderText("例: AAFevuEFx08 （从 Canva 开发者后台复制）")
        self.canva_app_id_input.setEchoMode(QLineEdit.Password)
        canva_layout.addRow("App ID:", self.canva_app_id_input)

        saved_app_id = self.config.get('canva_app_id', '')
        self.canva_bind_status_label = QLabel(
            "✓ 已绑定（已隐藏）" if saved_app_id else "未绑定（入库请求将被拒绝）"
        )
        self.canva_bind_status_label.setStyleSheet(
            "color: #388e3c;" if saved_app_id else "color: #d32f2f;"
        )
        canva_layout.addRow("状态:", self.canva_bind_status_label)

        canva_btn_row = QHBoxLayout()
        bind_btn = QPushButton("绑定应用")
        bind_btn.clicked.connect(self.on_bind_canva_app)
        canva_btn_row.addWidget(bind_btn)
        open_dev_btn = QPushButton("打开开发者后台 ↗")
        open_dev_btn.clicked.connect(self.open_canva_dev_portal)
        canva_btn_row.addWidget(open_dev_btn)
        canva_btn_widget = QWidget()
        canva_btn_widget.setLayout(canva_btn_row)
        canva_layout.addRow("", canva_btn_widget)

        canva_group.setLayout(canva_layout)
        layout.addWidget(canva_group)
        # ───────────────────────────────────────────────────

        port_group = QGroupBox("服务端口配置")
        port_layout = QFormLayout()
        
        saved_port = int(self.config.get('port', '8080') or 8080)
        free_port = self.get_free_port(saved_port)
        
        self.port_backend = QLineEdit(str(free_port))
        port_layout.addRow("通信端口:", self.port_backend)
        port_group.setLayout(port_layout)
        layout.addWidget(port_group)

        self.auto_start_checkbox = QCheckBox("开机自动运行（默认开启）")
        self.auto_start_checkbox.setChecked(bool(self.config.get('auto_start', True)))
        self.auto_start_checkbox.stateChanged.connect(self.on_auto_start_changed)
        layout.addWidget(self.auto_start_checkbox)

        btn_layout = QHBoxLayout()
        self.start_btn = QPushButton('启动服务')
        self.start_btn.setMinimumHeight(40)
        self.start_btn.setStyleSheet("background-color: #4CAF50; color: white;")
        self.start_btn.clicked.connect(self.start_server)
        btn_layout.addWidget(self.start_btn)

        self.stop_btn = QPushButton('停止服务')
        self.stop_btn.setMinimumHeight(40)
        self.stop_btn.clicked.connect(self.stop_server)
        self.stop_btn.setEnabled(False)
        btn_layout.addWidget(self.stop_btn)
        
        layout.addLayout(btn_layout)

        layout.addWidget(QLabel('运行日志 (仅保留最新100条):'))
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        layout.addWidget(self.log_area)

        self.setLayout(layout)

        self.setup_tray_icon()
        self.apply_startup_setting(self.auto_start_checkbox.isChecked(), silent=True)
        
        if free_port != saved_port:
            self.append_log(f"[*] 提示: 原配置端口 {saved_port} 已被占用，自动为您分配了空闲端口 {free_port}")

    def append_log(self, text):
        doc = self.log_area.document()
        if doc.blockCount() > 100:
            cursor = self.log_area.textCursor()
            cursor.movePosition(cursor.Start)
            cursor.select(cursor.BlockUnderCursor)
            cursor.removeSelectedText()
            cursor.deleteChar() # 删除换行符
            
        self.log_area.append(text)
        self.log_area.verticalScrollBar().setValue(self.log_area.verticalScrollBar().maximum())

    def setup_tray_icon(self):
        if not QSystemTrayIcon.isSystemTrayAvailable():
            self.append_log("[!] 当前系统不支持托盘功能，关闭窗口后程序将退出。")
            return

        self.tray_icon = QSystemTrayIcon(self)
        self.tray_icon.setIcon(self.style().standardIcon(QStyle.SP_ComputerIcon))
        self.tray_icon.setToolTip("Canva 素材本地联通服务")

        tray_menu = QMenu(self)
        show_action = QAction("显示主窗口", self)
        show_action.triggered.connect(self.show_main_window)
        tray_menu.addAction(show_action)

        tray_menu.addSeparator()

        exit_action = QAction("退出程序", self)
        exit_action.triggered.connect(self.exit_application)
        tray_menu.addAction(exit_action)

        self.tray_icon.setContextMenu(tray_menu)
        self.tray_icon.activated.connect(self.on_tray_activated)
        self.tray_icon.show()

    def on_bind_canva_app(self):
        app_id = self.canva_app_id_input.text().strip()
        if not app_id:
            self.canva_bind_status_label.setText("请先填写 App ID")
            self.canva_bind_status_label.setStyleSheet("color: #d32f2f;")
            return
        self.save_config()
        self.canva_bind_status_label.setText("✓ 已绑定（已隐藏）")
        self.canva_bind_status_label.setStyleSheet("color: #388e3c;")
        self.append_log("[*] Canva App 已绑定。")
        QMessageBox.information(
            self, "绑定成功",
            f"已成功绑定 Canva App。\n\n"
            f"服务器将仅接受来自该 App 的入库请求。\n\n"
            f"如何获取 App ID：\n"
            f"  1. 打开 canva.com → 开发者后台\n"
            f"  2. 进入您的 App → 复制 App ID"
        )

    def open_canva_dev_portal(self):
        import webbrowser
        webbrowser.open("https://www.canva.com/developers/apps")

    def on_tray_activated(self, reason):
        if reason in (QSystemTrayIcon.Trigger, QSystemTrayIcon.DoubleClick):
            self.show_main_window()

    def show_main_window(self):
        self.show()
        self.showNormal()
        self.raise_()
        self.activateWindow()

    def exit_application(self):
        self.force_exit = True
        if self.werkzeug_server:
            self.stop_server()
        if self.tray_icon:
            self.tray_icon.hide()
        QApplication.instance().quit()

    def on_auto_start_changed(self, _state):
        self.apply_startup_setting(self.auto_start_checkbox.isChecked())
        self.save_config()

    def get_startup_command(self):
        if getattr(sys, 'frozen', False):
            return f'"{sys.executable}" --background'
        script_path = os.path.abspath(__file__)
        return f'"{sys.executable}" "{script_path}" --background'

    def get_startup_args(self):
        if getattr(sys, 'frozen', False):
            return [sys.executable, "--background"]
        script_path = os.path.abspath(__file__)
        return [sys.executable, script_path, "--background"]

    def apply_startup_setting(self, enabled, silent=False):
        try:
            if sys.platform.startswith("win"):
                self.set_windows_startup(enabled)
            elif sys.platform == "darwin":
                self.set_macos_startup(enabled)
            else:
                if not silent:
                    self.append_log("[*] 当前系统暂不支持自动写入开机启动项。")
                return

            if not silent:
                self.append_log(f"[*] 开机自启动已{'启用' if enabled else '关闭'}。")
        except Exception as e:
            self.append_log(f"[!] 设置开机自启动失败: {e}")

    def set_windows_startup(self, enabled):
        import winreg

        run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
        value_name = "CanvaToolsLocalServer"

        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, run_key) as key:
            if enabled:
                winreg.SetValueEx(key, value_name, 0, winreg.REG_SZ, self.get_startup_command())
            else:
                try:
                    winreg.DeleteValue(key, value_name)
                except FileNotFoundError:
                    pass

    def set_macos_startup(self, enabled):
        import plistlib

        label = "com.canvatools.localserver"
        launch_agents_dir = os.path.join(os.path.expanduser("~"), "Library", "LaunchAgents")
        os.makedirs(launch_agents_dir, exist_ok=True)
        plist_path = os.path.join(launch_agents_dir, f"{label}.plist")

        if enabled:
            plist_data = {
                "Label": label,
                "ProgramArguments": self.get_startup_args(),
                "RunAtLoad": True,
                "KeepAlive": False,
            }
            with open(plist_path, "wb") as f:
                plistlib.dump(plist_data, f)

            subprocess.run(["launchctl", "unload", plist_path], capture_output=True, check=False)
            subprocess.run(["launchctl", "load", plist_path], capture_output=True, check=False)
        else:
            subprocess.run(["launchctl", "unload", plist_path], capture_output=True, check=False)
            if os.path.exists(plist_path):
                os.remove(plist_path)
        
    def check_port_in_use(self, port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('localhost', port)) == 0
            
    def run_flask(self, port):
        try:
            os.environ['STANDALONE_DB_HOST'] = self.db_host.text().strip()
            os.environ['STANDALONE_DB_USER'] = self.db_user.text().strip()
            os.environ['STANDALONE_DB_PASS'] = self.db_pass.text().strip()
            os.environ['STANDALONE_APP_ID'] = self.canva_app_id_input.text().strip() if hasattr(self, 'canva_app_id_input') else ''
            
            self.werkzeug_server = make_server('0.0.0.0', port, flask_app)
            self.emitter.log_signal.emit(f"[*] 服务已成功启动于 http://localhost:{port}")
            self.emitter.log_signal.emit(f"[*] Canva 插件的 Development URL 请换成此地址。")
            self.werkzeug_server.serve_forever()
        except Exception as e:
            self.emitter.log_signal.emit(f"[!] 运行异常: {e}")

    def start_server(self):
        if self.start_btn.isEnabled() == False:
            return

        if flask_app is None:
            QMessageBox.critical(self, "错误", "后端模块加载失败，请先安装依赖后重试。")
            self.append_log("[!] 启动失败：后端模块 server 导入失败。")
            return

        try:
            port = int(self.port_backend.text())
        except ValueError:
            QMessageBox.warning(self, "错误", "端口必须为数字！")
            return
            
        if self.check_port_in_use(port):
            QMessageBox.warning(self, "端口冲突", f"端口 {port} 已被占用，请修改！")
            self.append_log(f"[!] 启动失败，端口 {port} 占用。")
            return
            
        self.save_config()
            
        self.start_btn.setEnabled(False)
        self.start_btn.setText(f"● 运行中 (端口: {port})")
        self.start_btn.setStyleSheet("background-color: #2E7D32; color: white;")
        self.stop_btn.setEnabled(True)
        self.port_backend.setEnabled(False)
        self.log_area.clear()
        self.append_log(f"[*] 准备启动服务...")

        self.server_thread = threading.Thread(target=self.run_flask, args=(port,), daemon=True)
        self.server_thread.start()

    def stop_server(self):
        if self.werkzeug_server:
            self.werkzeug_server.shutdown()
            self.werkzeug_server = None

        self.start_btn.setEnabled(True)
        self.start_btn.setText("启动服务")
        self.start_btn.setStyleSheet("background-color: #4CAF50; color: white;")
        self.stop_btn.setEnabled(False)
        self.port_backend.setEnabled(True)
        self.append_log("[*] 服务已停止。")

    def closeEvent(self, event):
        if self.force_exit or self.tray_icon is None:
            event.accept()
            return

        event.ignore()
        self.hide()
        if not self.has_shown_tray_hint:
            self.tray_icon.showMessage(
                "Canva 本地服务",
                "程序已最小化到托盘，右键托盘图标可重新打开或退出。",
                QSystemTrayIcon.Information,
                3000,
            )
            self.has_shown_tray_hint = True

if __name__ == '__main__':
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    ex = CanvaPluginServer()
    if "--background" in sys.argv:
        ex.hide()
    else:
        ex.show()
    sys.exit(app.exec_())

