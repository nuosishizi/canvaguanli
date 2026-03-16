import sys
import os
from PyQt5.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QLineEdit, QPushButton, QMessageBox
import subprocess

class CanvaPluginServer(QWidget):
    def __init__(self):
        super().__init__()
        self.initUI()
        
    def initUI(self):
        self.setWindowTitle('Canva 素材本地联通服务')
        self.resize(400, 300)
        
        layout = QVBoxLayout()
        
        layout.addWidget(QLabel('说明：此工具提供本地局域网服务端，替代 ngrok 方便打包。'))
        
        layout.addWidget(QLabel('前端服务端口 (Canva 开发地址端口)'))
        self.port_frontend = QLineEdit('8080')
        layout.addWidget(self.port_frontend)
        
        layout.addWidget(QLabel('后端 API 端口 (数据处理端口)'))
        self.port_backend = QLineEdit('3001')
        layout.addWidget(self.port_backend)
        
        self.start_btn = QPushButton('启动服务')
        self.start_btn.clicked.connect(self.start_server)
        layout.addWidget(self.start_btn)
        
        self.stop_btn = QPushButton('停止服务')
        self.stop_btn.clicked.connect(self.stop_server)
        self.stop_btn.setEnabled(False)
        layout.addWidget(self.stop_btn)
        
        self.setLayout(layout)
        
    def start_server(self):
        # 伪代码：稍后实现
        pass
        
    def stop_server(self):
        # 伪代码：稍后实现
        pass

if __name__ == '__main__':
    app = QApplication(sys.argv)
    ex = CanvaPluginServer()
    ex.show()
    sys.exit(app.exec_())
