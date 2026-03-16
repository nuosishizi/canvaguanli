import sys
import os
import threading
import json
from PyQt5.QtWidgets import QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, QMessageBox, QTextEdit, QGroupBox, QFormLayout
from PyQt5.QtCore import pyqtSignal, QObject, QTimer
import socket
from werkzeug.serving import make_server

try:
    from server import app as flask_app
except ImportError:
    pass

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
                'port': self.port_backend.text().strip()
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

        port_group = QGroupBox("服务端口配置")
        port_layout = QFormLayout()
        
        saved_port = int(self.config.get('port', '8080') or 8080)
        free_port = self.get_free_port(saved_port)
        
        self.port_backend = QLineEdit(str(free_port))
        port_layout.addRow("通信端口:", self.port_backend)
        port_group.setLayout(port_layout)
        layout.addWidget(port_group)

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
        
    def check_port_in_use(self, port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('localhost', port)) == 0
            
    def run_flask(self, port):
        try:
            os.environ['STANDALONE_DB_HOST'] = self.db_host.text().strip()
            os.environ['STANDALONE_DB_USER'] = self.db_user.text().strip()
            os.environ['STANDALONE_DB_PASS'] = self.db_pass.text().strip()
            
            self.werkzeug_server = make_server('0.0.0.0', port, flask_app)
            self.emitter.log_signal.emit(f"[*] 服务已成功启动于 http://localhost:{port}")
            self.emitter.log_signal.emit(f"[*] Canva 插件的 Development URL 请换成此地址。")
            self.werkzeug_server.serve_forever()
        except Exception as e:
            self.emitter.log_signal.emit(f"[!] 运行异常: {e}")

    def start_server(self):
        if self.start_btn.isEnabled() == False:
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

if __name__ == '__main__':
    app = QApplication(sys.argv)
    ex = CanvaPluginServer()
    ex.show()
    sys.exit(app.exec_())

