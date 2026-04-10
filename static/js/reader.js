/**
 * Bionic PDF Reader - 前端核心模块
 *
 * 功能：
 * 1. PDF 文件上传与加载
 * 2. 使用 PDF.js 逐页渲染 PDF
 * 3. 提取文本层并应用 Bionic Reading 效果
 * 4. 翻页、缩放、Bionic 模式切换等交互控制
 *
 * Bionic Reading 原理：
 * 将每个英文单词的前半部分字母加粗显示，利用大脑的模式补全能力，
 * 引导眼球快速定位到单词的起始位置，从而帮助 ADHD 用户保持阅读专注。
 */

// ============================================================
// PDF.js 初始化
// ============================================================

const pdfjsLib = await import(
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs"
);

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs";

// ============================================================
// DOM 元素引用
// ============================================================

const uploadArea = document.getElementById("upload-area");
const readerArea = document.getElementById("reader-area");
const pdfContainer = document.getElementById("pdf-container");
const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("drop-zone");
const loadingOverlay = document.getElementById("loading-overlay");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageInfo = document.getElementById("page-info");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomLevel = document.getElementById("zoom-level");
const bionicToggle = document.getElementById("bionic-toggle");
const boldIntensity = document.getElementById("bold-intensity");

// ============================================================
// 应用状态
// ============================================================

let pdfDoc = null;       // 当前加载的 PDF 文档对象
let currentPage = 1;     // 当前页码（从 1 开始）
let totalPages = 0;      // 总页数
let scale = 1.5;         // 渲染缩放比例
let bionicEnabled = true; // Bionic 模式是否启用
let rendering = false;   // 是否正在渲染中（防止重复渲染）

// ============================================================
// Bionic Reading 核心算法
// ============================================================

/**
 * 将文本转换为 Bionic Reading 格式的 HTML。
 *
 * 算法逻辑：
 * - 对每个英文单词，计算需要加粗的字母数量 = ceil(单词长度 / 2)
 * - 前半部分包裹在 <b> 标签中
 * - 非英文字符（中文、标点等）保持原样
 *
 * @param {string} text - 原始文本
 * @returns {string} 包含 <b> 标签的 HTML 字符串
 *
 * @example
 *   bionicify("Hello World")  // => "<b>Hel</b>lo <b>Wor</b>ld"
 *   bionicify("Reading")      // => "<b>Rea</b>ding"
 *   bionicify("a")            // => "<b>a</b>"
 */
function bionicify(text) {
  // 匹配连续的英文字母序列作为"单词"
  return text.replace(/[a-zA-Z]+/g, (word) => {
    const boldLen = Math.ceil(word.length / 2);
    const boldPart = word.slice(0, boldLen);
    const normalPart = word.slice(boldLen);
    return `<b>${boldPart}</b>${normalPart}`;
  });
}

/**
 * 从 canvas 像素数据中采样文字区域的前景色和背景色。
 *
 * 策略：用区域上下边缘像素估算背景色，
 * 然后在区域内部找与背景色差异最大的像素作为文字色。
 */
function sampleRegionColors(pixels, canvasW, canvasH, rx, ry, rw, rh) {
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(canvasW, Math.ceil(rx + rw));
  const y1 = Math.min(canvasH, Math.ceil(ry + rh));

  if (x1 <= x0 || y1 <= y0) return { text: [0, 0, 0], bg: [255, 255, 255] };

  const stepX = Math.max(1, Math.floor((x1 - x0) / 8));

  // 1) 采样上下边缘像素作为背景色
  let bgR = 0, bgG = 0, bgB = 0, bgN = 0;
  for (const row of [y0, Math.min(y1 - 1, canvasH - 1)]) {
    for (let x = x0; x < x1; x += stepX) {
      const off = (row * canvasW + x) * 4;
      bgR += pixels[off]; bgG += pixels[off + 1]; bgB += pixels[off + 2];
      bgN++;
    }
  }
  if (bgN === 0) return { text: [0, 0, 0], bg: [255, 255, 255] };
  bgR = Math.round(bgR / bgN);
  bgG = Math.round(bgG / bgN);
  bgB = Math.round(bgB / bgN);

  // 2) 在区域内找与背景色差异最大的像素作为文字色
  const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
  let maxDiff = 0;
  let tR = bgR, tG = bgG, tB = bgB;

  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const off = (y * canvasW + x) * 4;
      const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
      const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
      if (diff > maxDiff) {
        maxDiff = diff;
        tR = r; tG = g; tB = b;
      }
    }
  }

  // 3) 差异过小则根据背景亮度推断文字色
  if (maxDiff < 30) {
    const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
    return {
      text: bgLum > 128 ? [0, 0, 0] : [255, 255, 255],
      bg: [bgR, bgG, bgB],
    };
  }

  return { text: [tR, tG, tB], bg: [bgR, bgG, bgB] };
}

// ============================================================
// PDF 渲染
// ============================================================

/**
 * 渲染指定页码的 PDF 页面到容器中。
 *
 * 流程：
 * 1. 获取页面对象和视口尺寸
 * 2. 创建 canvas 并渲染页面图像
 * 3. 提取文本内容，创建 Bionic 文本覆盖层
 * 4. 更新页码信息和按钮状态
 *
 * @param {number} pageNum - 要渲染的页码（1-based）
 */
async function renderPage(pageNum) {
  if (rendering) return;
  rendering = true;

  pdfContainer.innerHTML = "";

  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // --- 创建页面容器 ---
  const wrapper = document.createElement("div");
  wrapper.className = "pdf-page-wrapper";
  if (bionicEnabled) {
    wrapper.classList.add("bionic-active");
  }
  wrapper.classList.add(`bionic-intensity-${boldIntensity.value}`);
  wrapper.style.width = `${viewport.width}px`;
  wrapper.style.height = `${viewport.height}px`;

  // --- 创建并渲染 canvas ---
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");

  wrapper.appendChild(canvas);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const textContent = await page.getTextContent();

  // --- 采样颜色并遮盖 canvas 原始文字（仅 bionic 模式） ---
  const itemColors = new Map();

  if (bionicEnabled) {
    const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const imgPixels = fullImageData.data;
    const imgW = canvas.width;
    const imgH = canvas.height;

    // 为每个文字项采样颜色
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === "") continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
      const w = item.width > 0 ? item.width * scale : fontSize * item.str.length * 0.6;
      itemColors.set(item, sampleRegionColors(imgPixels, imgW, imgH,
        tx[4], tx[5] - fontSize, w, fontSize * 1.15));
    }

    // 用采样到的背景色精确遮盖 canvas 上的原始文字
    ctx.save();
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === "") continue;
      const colors = itemColors.get(item);
      if (!colors) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
      const w = item.width > 0 ? item.width * scale : fontSize * item.str.length * 0.6;
      ctx.fillStyle = `rgb(${colors.bg[0]},${colors.bg[1]},${colors.bg[2]})`;
      ctx.fillRect(tx[4], tx[5] - fontSize, w, fontSize * 1.15);
    }
    ctx.restore();
  }

  // --- 创建文本覆盖层 ---
  const textLayer = document.createElement("div");
  textLayer.className = "bionic-text-layer";
  wrapper.appendChild(textLayer);

  pdfContainer.appendChild(wrapper);

  const spanEntries = [];

  for (const item of textContent.items) {
    if (!item.str || item.str.trim() === "") continue;

    const span = document.createElement("span");

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
    const targetWidth = item.width > 0 ? item.width * scale : 0;

    // 使用 PDF 原生字体
    const fontStyle = textContent.styles[item.fontName];
    const fontFamily = fontStyle?.fontFamily || "sans-serif";

    span.style.left = `${tx[4]}px`;
    span.style.top = `${tx[5] - fontSize}px`;
    span.style.fontSize = `${fontSize}px`;
    span.style.fontFamily = fontFamily;
    span.style.height = `${fontSize * 1.2}px`;
    span.style.lineHeight = `${fontSize * 1.2}px`;

    if (bionicEnabled) {
      span.innerHTML = bionicify(item.str);
      const colors = itemColors.get(item);
      if (colors) {
        span.style.color = `rgb(${colors.text[0]},${colors.text[1]},${colors.text[2]})`;
        span.style.backgroundColor = `rgb(${colors.bg[0]},${colors.bg[1]},${colors.bg[2]})`;
      }
    } else {
      span.textContent = item.str;
    }

    textLayer.appendChild(span);
    if (targetWidth > 0 && bionicEnabled) {
      spanEntries.push({ span, targetWidth });
    }
  }

  // 使用离屏元素精确测量文字真实宽度，不受 overflow:hidden 影响
  if (spanEntries.length > 0) {
    const measurer = document.createElement("span");
    measurer.style.cssText = "position:absolute;visibility:hidden;white-space:pre;top:-9999px;left:-9999px;";
    document.body.appendChild(measurer);

    for (const { span, targetWidth } of spanEntries) {
      // 复制 span 的字体属性到测量元素
      measurer.style.fontSize = span.style.fontSize;
      measurer.style.fontFamily = span.style.fontFamily;
      measurer.style.fontWeight = "";
      measurer.innerHTML = span.innerHTML;

      const actualWidth = measurer.getBoundingClientRect().width;
      if (actualWidth > targetWidth) {
        const sx = targetWidth / actualWidth;
        span.style.transformOrigin = "left top";
        span.style.transform = `scaleX(${sx})`;
      }
    }

    document.body.removeChild(measurer);
  }

  // --- 更新 UI 状态 ---
  currentPage = pageNum;
  pageInfo.textContent = `${currentPage} / ${totalPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;

  rendering = false;
}

// ============================================================
// 文件加载
// ============================================================

/**
 * 从 File 对象加载 PDF 文档。
 * 先上传到服务端获取 URL，再用 PDF.js 加载。
 * 也支持直接从本地 ArrayBuffer 加载以减少延迟。
 *
 * @param {File} file - 用户选择的 PDF 文件
 */
async function loadPDF(file) {
  loadingOverlay.style.display = "flex";

  try {
    // 直接从本地文件读取，无需等待上传完成
    const arrayBuffer = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    totalPages = pdfDoc.numPages;

    // 同时上传到服务端（后台，不阻塞渲染）
    const formData = new FormData();
    formData.append("file", file);
    fetch("/upload", { method: "POST", body: formData });

    // 切换到阅读界面
    uploadArea.style.display = "none";
    readerArea.style.display = "flex";

    await renderPage(1);
  } catch (err) {
    console.error("PDF 加载失败:", err);
    alert("PDF 加载失败，请确认文件格式正确。");
  } finally {
    loadingOverlay.style.display = "none";
  }
}

// ============================================================
// 事件绑定
// ============================================================

// --- 文件选择 ---
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadPDF(file);
});

// --- 拖拽上传 ---
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type === "application/pdf") {
    loadPDF(file);
  }
});

// --- 翻页 ---
prevPageBtn.addEventListener("click", () => {
  if (currentPage > 1) renderPage(currentPage - 1);
});

nextPageBtn.addEventListener("click", () => {
  if (currentPage < totalPages) renderPage(currentPage + 1);
});

// 键盘快捷键翻页
document.addEventListener("keydown", (e) => {
  if (!pdfDoc) return;
  if (e.key === "ArrowLeft" || e.key === "PageUp") {
    if (currentPage > 1) renderPage(currentPage - 1);
  } else if (e.key === "ArrowRight" || e.key === "PageDown") {
    if (currentPage < totalPages) renderPage(currentPage + 1);
  }
});

// --- 缩放 ---
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;

zoomInBtn.addEventListener("click", () => {
  if (scale < ZOOM_MAX) {
    scale = Math.min(scale + ZOOM_STEP, ZOOM_MAX);
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    if (pdfDoc) renderPage(currentPage);
  }
});

zoomOutBtn.addEventListener("click", () => {
  if (scale > ZOOM_MIN) {
    scale = Math.max(scale - ZOOM_STEP, ZOOM_MIN);
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    if (pdfDoc) renderPage(currentPage);
  }
});

// 初始缩放显示
zoomLevel.textContent = `${Math.round(scale * 100)}%`;

// --- Bionic 模式切换 ---
bionicToggle.addEventListener("change", () => {
  bionicEnabled = bionicToggle.checked;
  if (pdfDoc) renderPage(currentPage);
});

// --- 加粗强度调节 ---
boldIntensity.addEventListener("input", () => {
  if (pdfDoc) renderPage(currentPage);
});

// --- 阻止全局拖拽默认行为 ---
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());
