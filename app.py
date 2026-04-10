"""
Bionic PDF Reader - 帮助 ADHD 用户专注阅读的 PDF 阅读器

通过对英文单词前半部分字母加粗（Bionic Reading 技术），
引导视觉焦点，帮助读者保持注意力集中。
"""

import os
import uuid

from flask import Flask, render_template, request, send_from_directory, jsonify

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = os.path.join(os.path.dirname(__file__), "uploads")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB 上传限制

ALLOWED_EXTENSIONS = {"pdf"}


def allowed_file(filename: str) -> bool:
    """检查文件扩展名是否为 PDF。"""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route("/")
def index():
    """渲染 PDF 阅读器页面。"""
    return render_template("viewer.html")


@app.route("/upload", methods=["POST"])
def upload_pdf():
    """
    处理 PDF 文件上传。

    Returns:
        JSON 响应，包含上传后的文件 ID 和访问路径。
        成功时返回 {"fileId": "<uuid>", "url": "/pdf/<uuid>.pdf"}
        失败时返回 {"error": "<错误信息>"} 和对应的 HTTP 状态码。
    """
    if "file" not in request.files:
        return jsonify({"error": "未找到上传文件"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "未选择文件"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "仅支持 PDF 文件"}), 400

    file_id = str(uuid.uuid4())
    filename = f"{file_id}.pdf"
    file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))

    return jsonify({"fileId": file_id, "url": f"/pdf/{filename}"})


@app.route("/pdf/<filename>")
def serve_pdf(filename: str):
    """提供已上传的 PDF 文件供前端渲染。"""
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


if __name__ == "__main__":
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    app.run(debug=True, port=5000)
