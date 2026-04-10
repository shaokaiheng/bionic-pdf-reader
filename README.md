# Bionic PDF Reader

> 面向 ADHD 用户的 PDF 阅读器，通过 **Bionic Reading** 技术帮助读者保持注意力集中。

## 什么是 Bionic Reading？

Bionic Reading 是一种阅读辅助技术：将每个英文单词 **前半部分字母加粗** 显示。人类大脑擅长模式补全——看到单词开头的加粗部分后，大脑会自动"脑补"完整单词，从而：

- **减少眼球跳动**：视线被加粗部分引导，不再反复回扫
- **提高阅读速度**：大脑快速识别单词，降低逐字阅读的需要
- **增强专注力**：对 ADHD 用户尤其有效，减少走神

**效果示例：**

| 模式 | 文本 |
| --- | --- |
| 原文 | Reading is fundamental to learning |
| Bionic | **Rea**ding **is** **fun**damental **to** **lea**rning |

## 功能特性

| 功能 | 说明 |
| --- | --- |
| PDF 渲染 | 基于 PDF.js，高保真渲染 PDF 页面 |
| Bionic Reading | 英文单词前半部分自动加粗，使用 `-webkit-text-stroke` 合成加粗，保持原始字体比例 |
| 智能区域识别 | 自动检测图片、有色表格等复杂背景区域，跳过 bionic 处理，避免视觉干扰 |
| 颜色保真 | 采样 canvas 像素还原文字原始颜色，黑色保持黑色，彩色保持彩色 |
| 文件管理 | 工具栏打开/关闭文档，支持连续切换不同 PDF |
| 拖拽上传 | 支持拖拽或点击选择 PDF 文件（最大 50 MB） |
| 翻页导航 | 按钮 + 页码输入跳转 |
| 缩放控制 | 50% ~ 300%，支持 Page Width / Page Fit 自适应 |
| 文本搜索 | 全文搜索，高亮匹配结果，支持上下翻页 |
| 侧边栏 | 文档大纲（书签）+ 页面缩略图 |
| 模式切换 | 一键开关 Bionic 效果，关闭后完全恢复原状 |
| 强度调节 | 4 级加粗强度可调 |
| 暗色主题 | 减少屏幕亮度刺激，对 ADHD 用户更友好 |

## 技术栈

- **后端**：Python 3 + Flask
- **前端**：原生 JavaScript (ES Modules) + PDF.js 4.x
- **样式**：纯 CSS（无框架依赖）

## 快速开始

### 环境要求

- Python 3.8+
- 现代浏览器（Chrome、Firefox、Edge）

### 一键启动

**Windows** — 双击 `start.bat`

**macOS / Linux** — 终端执行：

```bash
chmod +x start.sh
./start.sh
```

脚本会自动创建虚拟环境、安装依赖、启动服务并打开浏览器。

### 手动启动

```bash
# 1. 创建虚拟环境
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动应用
python app.py
```

启动后浏览器访问 `http://localhost:5000`。

## 使用说明

1. 打开浏览器访问 `http://localhost:5000`（一键启动脚本会自动打开）
2. 拖拽 PDF 文件到页面中央，或点击 **Choose PDF** / 工具栏文件夹图标选择文件
3. PDF 加载后显示第一页，使用工具栏切换 **Bionic** 开关
4. 拖动 **Intensity** 滑块调整加粗强度（1-4 级）
5. 点击工具栏 **X** 按钮关闭当前文档，可随时打开新文件

### 键盘快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + O` | 打开文件 |
| `Ctrl + W` | 关闭当前文档 |
| `Ctrl + F` | 搜索文本 |

## 项目结构

```
bionic-pdf-reader/
├── app.py                  # Flask 应用入口，处理上传和文件服务
├── requirements.txt        # Python 依赖（Flask, Werkzeug）
├── start.bat               # Windows 一键启动脚本
├── start.sh                # macOS/Linux 一键启动脚本
├── templates/
│   └── viewer.html         # 阅读器页面模板
├── static/
│   ├── css/
│   │   └── viewer.css      # 阅读器样式（暗色主题、bionic 渲染样式）
│   ├── js/
│   │   └── viewer.js       # 前端核心：PDF 渲染 + Bionic Reading + 颜色采样
│   └── pdfjs/              # PDF.js 库文件
└── uploads/                # PDF 上传存储目录
```

## 核心算法

### Bionic 文本处理

位于 `static/js/viewer.js` 中的 `bionicify()` 函数：

```javascript
function bionicify(text) {
  return text.replace(/[a-zA-Z]+/g, (word) => {
    const boldLen = Math.ceil(word.length / 2);
    return `<span class="bionic-b">${word.slice(0, boldLen)}</span>${word.slice(boldLen)}`;
  });
}
```

加粗使用 CSS `-webkit-text-stroke` 实现合成加粗，不改变字符宽度，保持 PDF 原始字体比例。

### 颜色采样

从 canvas 像素中采样文字前景色，使用三层策略消除 ClearType 亚像素渲染的色偏：

1. **页面背景参考**：从页面左右边缘采样背景色
2. **高差异像素群均值**：取差异 ≥ 60% 最大值的像素群，排除抗锯齿边缘
3. **饱和度钳位**：低饱和度暗色归为纯黑，低饱和度亮色归为纯白

### 复杂背景跳过

通过 `shouldSkipBionic()` 检测文字区域背景：统计区域内与页面背景色匹配的像素比例（`bgFrac`），低于 35% 时判定为图片或有色表格区域，跳过 bionic 处理。

## 设计决策

1. **纯前端 PDF 渲染**：使用 PDF.js 在浏览器端渲染，无需服务端转换，保护用户隐私
2. **合成加粗方案**：使用 `-webkit-text-stroke` 替代 `<b>` 标签，避免字体宽度变化导致的文字错位
3. **Canvas + TextLayer 双层覆盖**：canvas 上用背景色覆盖原始文字区域，textLayer span 设置背景色遮盖残影，确保无重影
4. **智能区域识别**：基于像素背景匹配率跳过复杂区域，避免在图片/表格上产生视觉干扰
5. **暗色主题**：减少屏幕亮度刺激，对 ADHD 用户更友好
6. **最少依赖**：仅依赖 Flask 和 PDF.js，降低维护成本

## License

MIT
