/**
 * Bionic PDF Reader - Full Viewer
 * Uses PDF.js PDFViewer component for complete PDF viewing + Bionic Reading overlay.
 */

import * as pdfjsLib from "/static/pdfjs/pdf.mjs";
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
} from "/static/pdfjs/pdf_viewer.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/pdfjs/pdf.worker.mjs";

// ============================================================
// DOM refs
// ============================================================
const uploadArea = document.getElementById("uploadArea");
const viewerDiv = document.getElementById("viewer");
const viewerContainer = document.getElementById("viewerContainer");
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const outlineView = document.getElementById("outlineView");
const thumbnailView = document.getElementById("thumbnailView");
const pageNumberInput = document.getElementById("pageNumber");
const numPagesSpan = document.getElementById("numPages");
const prevBtn = document.getElementById("previous");
const nextBtn = document.getElementById("next");
const zoomIn = document.getElementById("zoomIn");
const zoomOut = document.getElementById("zoomOut");
const scaleSelect = document.getElementById("scaleSelect");
const searchInput = document.getElementById("searchInput");
const findPrevBtn = document.getElementById("findPrevious");
const findNextBtn = document.getElementById("findNext");
const findMsg = document.getElementById("findMsg");
const bionicToggle = document.getElementById("bionicToggle");
const bionicIntensity = document.getElementById("bionicIntensity");
const openFileBtn = document.getElementById("openFile");
const closeFileBtn = document.getElementById("closeFile");
const fileNameSpan = document.getElementById("fileName");

// ============================================================
// PDF.js viewer setup
// ============================================================
const eventBus = new EventBus();

const linkService = new PDFLinkService({ eventBus });

const findController = new PDFFindController({ eventBus, linkService });

const pdfViewer = new PDFViewer({
  container: viewerContainer,
  viewer: viewerDiv,
  eventBus,
  linkService,
  findController,
  textLayerMode: 2, // enable text layer (selectable)
  annotationMode: 2, // enable annotations (links, etc.)
});
linkService.setViewer(pdfViewer);

let pdfDoc = null;
let bionicEnabled = false;

// ============================================================
// Bionic Reading
// ============================================================
function bionicify(text) {
  return text.replace(/[a-zA-Z]+/g, (word) => {
    const boldLen = Math.ceil(word.length / 2);
    return `<span class="bionic-b">${word.slice(0, boldLen)}</span>${word.slice(boldLen)}`;
  });
}

/**
 * 从页面左右边缘采样背景色（页边距几乎不会有文字）。
 */
function samplePageBg(pixels, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  const stepY = Math.max(1, Math.floor(h / 30));
  for (let y = 0; y < h; y += stepY) {
    for (const x of [0, 1, 2, w - 3, w - 2, w - 1]) {
      if (x < 0 || x >= w) continue;
      const off = (y * w + x) * 4;
      r += pixels[off]; g += pixels[off + 1]; b += pixels[off + 2]; n++;
    }
  }
  return n > 0
    ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
    : [255, 255, 255];
}

/**
 * 检测文字区域是否处于非页面背景上（图片内、有色表格单元格等），应跳过 bionic。
 * 核心指标：文字区域内有多少像素与页面背景色匹配（bgFrac）。
 * 普通文字 bgFrac ≥ 0.5（大部分像素是页面背景）；
 * 有色区域 bgFrac < 0.35（大部分像素是其他颜色）。
 */
function shouldSkipBionic(pixels, canvasW, canvasH, rx, ry, rw, rh, pageBg) {
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(canvasW, Math.ceil(rx + rw));
  const y1 = Math.min(canvasH, Math.ceil(ry + rh));
  if (x1 <= x0 || y1 <= y0) return false;

  const stepX = Math.max(1, Math.floor((x1 - x0) / 20));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 6));

  let bgClose = 0, total = 0;
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const off = (y * canvasW + x) * 4;
      const dist = Math.abs(pixels[off] - pageBg[0])
                 + Math.abs(pixels[off + 1] - pageBg[1])
                 + Math.abs(pixels[off + 2] - pageBg[2]);
      if (dist < 50) bgClose++;
      total++;
    }
  }
  if (total < 5) return false;

  const bgFrac = bgClose / total;

  if (window._bionicDebug) {
    if (!window._bionicDebugData) window._bionicDebugData = [];
    window._bionicDebugData.push({ bgFrac: +bgFrac.toFixed(3), rx: Math.round(rx), ry: Math.round(ry), rw: Math.round(rw), skip: bgFrac < 0.35 });
  }

  // 仅当 < 35% 像素匹配页面背景时跳过
  // 即：文字明确处于非页面背景色的区域（有色单元格、图片内部等）
  return bgFrac < 0.35;
}

/**
 * 在文字区域内采样前景色。
 * 使用页面背景色作为参考基准，收集高差异像素群取均值，
 * 消除 ClearType 亚像素渲染带来的单像素色偏。
 */
function sampleTextColor(pixels, canvasW, canvasH, rx, ry, rw, rh, pageBg) {
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(canvasW, Math.ceil(rx + rw));
  const y1 = Math.min(canvasH, Math.ceil(ry + rh));
  if (x1 <= x0 || y1 <= y0) return null;

  // 密集采样（步长≤4px），确保充分覆盖文字像素
  const stepX = Math.max(1, Math.min(4, Math.floor((x1 - x0) / 16)));
  const stepY = Math.max(1, Math.min(4, Math.floor((y1 - y0) / 6)));

  // 计算区域均色，判断是否需要用局部背景替代页面背景
  let avgR = 0, avgG = 0, avgB = 0, total = 0;
  const samples = [];
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const off = (y * canvasW + x) * 4;
      const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
      samples.push(r, g, b);
      avgR += r; avgG += g; avgB += b; total++;
    }
  }
  if (total === 0) return null;
  avgR /= total; avgG /= total; avgB /= total;

  // 若区域均色与页面背景差异大（有色背景区域），改用区域均色作参考
  const regionDiff = Math.abs(avgR - pageBg[0]) + Math.abs(avgG - pageBg[1]) + Math.abs(avgB - pageBg[2]);
  const refR = regionDiff < 80 ? pageBg[0] : avgR;
  const refG = regionDiff < 80 ? pageBg[1] : avgG;
  const refB = regionDiff < 80 ? pageBg[2] : avgB;

  // 找最大差异值
  let maxDiff = 0;
  for (let i = 0; i < samples.length; i += 3) {
    const diff = Math.abs(samples[i] - refR) + Math.abs(samples[i+1] - refG) + Math.abs(samples[i+2] - refB);
    if (diff > maxDiff) maxDiff = diff;
  }
  if (maxDiff < 40) return null;

  // 取差异 ≥ 60% 最大值的像素群均值（核心文字像素，排除抗锯齿边缘）
  const minDiff = maxDiff * 0.6;
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let i = 0; i < samples.length; i += 3) {
    const diff = Math.abs(samples[i] - refR) + Math.abs(samples[i+1] - refG) + Math.abs(samples[i+2] - refB);
    if (diff >= minDiff) {
      sumR += samples[i]; sumG += samples[i+1]; sumB += samples[i+2]; count++;
    }
  }
  if (count === 0) return null;

  let cr = Math.round(sumR / count);
  let cg = Math.round(sumG / count);
  let cb = Math.round(sumB / count);

  // 用 RGB 通道范围（近似饱和度）区分「ClearType 伪影的黑色」和「真正的彩色」
  // ClearType 亚像素渲染会让黑色文字产生 rgb(40,15,30) 之类的低饱和度暗色
  // 真正的彩色文字（蓝色链接等）有高饱和度：rgb(0,0,200) 范围 = 200
  const maxC = Math.max(cr, cg, cb);
  const minC = Math.min(cr, cg, cb);
  const range = maxC - minC;

  if (maxC < 80 && range < 50) { cr = 0; cg = 0; cb = 0; }
  else if (minC > 200 && range < 50) { cr = 255; cg = 255; cb = 255; }

  return [cr, cg, cb];
}

async function applyBionic() {
  if (!bionicEnabled) {
    viewerDiv.classList.remove("bionic-active");
    viewerDiv.className = viewerDiv.className.replace(/bionic-intensity-\d/g, "");
    // 恢复 textLayer span 原始状态
    viewerDiv.querySelectorAll(".textLayer span[data-bionic-original]").forEach((span) => {
      span.textContent = span.getAttribute("data-bionic-original");
      span.style.color = "";
      span.style.backgroundColor = "";
      span.removeAttribute("data-bionic-original");
    });
    viewerDiv.querySelectorAll(".page canvas").forEach((canvas) => {
      if (canvas._bionicOrigData) {
        const ctx = canvas.getContext("2d");
        ctx.putImageData(canvas._bionicOrigData, 0, 0);
        delete canvas._bionicOrigData;
      }
      delete canvas._bionicProcessed;
    });
    return;
  }

  viewerDiv.classList.add("bionic-active");
  viewerDiv.className = viewerDiv.className.replace(/bionic-intensity-\d/g, "");
  viewerDiv.classList.add(`bionic-intensity-${bionicIntensity.value}`);

  if (!pdfDoc) return;



  const scale = pdfViewer.currentScale;

  for (const pageDiv of viewerDiv.querySelectorAll(".page")) {
    const canvas = pageDiv.querySelector("canvas");
    const textLayer = pageDiv.querySelector(".textLayer");
    if (!canvas || !textLayer) continue;
    if (canvas._bionicProcessed) continue;

    const pageNum = parseInt(pageDiv.dataset.pageNumber);
    if (!pageNum) continue;

    const imgW = canvas.width;
    const imgH = canvas.height;

    const ctx = canvas.getContext("2d");
    let imgPixels;
    try {
      const origData = ctx.getImageData(0, 0, imgW, imgH);
      canvas._bionicOrigData = origData;
      imgPixels = origData.data;
    } catch (e) { continue; }

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const textContent = await page.getTextContent();
    const pixelRatio = imgW / viewport.width;

    // 整页背景色（用于遮盖 canvas 文字和 span 背景）
    const pageBg = samplePageBg(imgPixels, imgW, imgH);
    const pageBgCss = `rgb(${pageBg[0]},${pageBg[1]},${pageBg[2]})`;
    const bgLum = 0.299 * pageBg[0] + 0.587 * pageBg[1] + 0.114 * pageBg[2];
    const fallbackColor = bgLum > 128 ? "rgb(0,0,0)" : "rgb(255,255,255)";

    // 为每个有文字的 item 采样文字颜色，构建 colorQueue
    // 同时检测复杂背景（图片/表格），构建 skipQueue
    const colorQueue = [];
    const skipQueue = [];
    const coverRects = [];
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontSize = Math.sqrt(tx[0] ** 2 + tx[1] ** 2);
      const w = item.width > 0 ? item.width * scale : fontSize * item.str.length * 0.6;
      const pxX = tx[4] * pixelRatio;
      const pxY = (tx[5] - fontSize) * pixelRatio;
      const pxW = w * pixelRatio;
      const pxH = fontSize * 1.15 * pixelRatio;

      const skip = shouldSkipBionic(imgPixels, imgW, imgH, pxX, pxY, pxW, pxH, pageBg);
      skipQueue.push(skip);

      colorQueue.push(skip ? null : sampleTextColor(imgPixels, imgW, imgH, pxX, pxY, pxW, pxH, pageBg));
      coverRects.push(skip ? null : [tx[4], tx[5] - fontSize, w, fontSize * 1.15]);
    }

    // 用页面背景色在 canvas 上覆盖纯文本区域（消除重影），跳过复杂背景区域
    ctx.save();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = pageBgCss;
    for (const rect of coverRects) {
      if (!rect) continue;
      ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
    }
    ctx.restore();
    canvas._bionicProcessed = true;

    // 遍历 textLayer 中所有 span（querySelectorAll 能找到 .markedContent 内嵌套的 span）
    // classList.length > 0 过滤掉 .markedContent 包裹器和 .highlight 搜索高亮等
    let ci = 0;
    textLayer.querySelectorAll("span").forEach((span) => {
      if (span.getAttribute("data-bionic-original")) return;
      if (span.classList.length > 0) return;
      const text = span.textContent;
      if (!text || !text.trim()) return;

      // 跳过复杂背景区域（图片/表格中的文字）
      if (ci < skipQueue.length && skipQueue[ci]) {
        ci++;
        return;
      }

      span.setAttribute("data-bionic-original", text);

      // 用页面背景色作为 span 背景，遮住 canvas 上的原始文字
      span.style.backgroundColor = pageBgCss;

      // 用采样到的文字色，或回退到黑/白
      if (ci < colorQueue.length) {
        const tc = colorQueue[ci++];
        span.style.color = tc
          ? `rgb(${tc[0]},${tc[1]},${tc[2]})`
          : fallbackColor;
      } else {
        span.style.color = fallbackColor;
      }

      // 应用 bionic 格式（合成加粗不改变字符宽度，无需调整 scaleX）
      span.innerHTML = bionicify(text);
    });
  }

}

// ============================================================
// PDF loading
// ============================================================
async function loadPDF(data) {
  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: "/static/pdfjs/cmaps/",
    cMapPacked: true,
  });

  pdfDoc = await loadingTask.promise;

  pdfViewer.setDocument(pdfDoc);
  linkService.setDocument(pdfDoc, null);

  numPagesSpan.textContent = pdfDoc.numPages;
  pageNumberInput.max = pdfDoc.numPages;
  pageNumberInput.value = 1;

  uploadArea.style.display = "none";
  viewerDiv.style.display = "";
  closeFileBtn.disabled = false;

  // Build outline
  buildOutline();
  // Build thumbnails
  buildThumbnails();
}

function closePDF() {
  if (!pdfDoc) return;

  // 关闭 bionic
  if (bionicEnabled) {
    bionicEnabled = false;
    bionicToggle.checked = false;
    applyBionic();
  }

  // 清理 PDF.js viewer
  pdfViewer.setDocument(null);
  linkService.setDocument(null, null);
  pdfDoc.destroy();
  pdfDoc = null;

  // 重置 UI
  viewerDiv.style.display = "none";
  viewerDiv.innerHTML = "";
  uploadArea.style.display = "";
  numPagesSpan.textContent = "-";
  pageNumberInput.value = 1;
  pageNumberInput.max = 1;
  outlineView.innerHTML = "";
  thumbnailView.innerHTML = "";
  searchInput.value = "";
  findMsg.textContent = "";
  fileNameSpan.textContent = "";
  closeFileBtn.disabled = true;
  fileInput.value = "";

  // 收起侧边栏
  sidebar.classList.add("hidden");
}

// ============================================================
// Outline / Bookmarks
// ============================================================
async function buildOutline() {
  const outline = await pdfDoc.getOutline();
  outlineView.innerHTML = "";
  if (!outline || outline.length === 0) {
    outlineView.innerHTML = '<div class="outline-empty">No outline available</div>';
    return;
  }
  outlineView.appendChild(createOutlineTree(outline));
}

function createOutlineTree(items) {
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const div = document.createElement("div");
    div.className = "outline-item";
    div.textContent = item.title;
    div.addEventListener("click", (e) => {
      e.stopPropagation();
      if (item.dest) {
        linkService.goToDestination(item.dest);
      }
    });
    frag.appendChild(div);

    if (item.items && item.items.length > 0) {
      const children = document.createElement("div");
      children.className = "outline-children";
      children.appendChild(createOutlineTree(item.items));
      frag.appendChild(children);
    }
  }
  return frag;
}

// ============================================================
// Thumbnails
// ============================================================
async function buildThumbnails() {
  thumbnailView.innerHTML = "";
  const thumbScale = 0.2;
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const vp = page.getViewport({ scale: thumbScale });

    const wrapper = document.createElement("div");
    wrapper.className = "thumb-wrapper";
    wrapper.dataset.page = i;

    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const label = document.createElement("div");
    label.className = "thumb-label";
    label.textContent = i;

    wrapper.appendChild(canvas);
    wrapper.appendChild(label);
    wrapper.addEventListener("click", () => {
      pdfViewer.currentPageNumber = i;
    });
    thumbnailView.appendChild(wrapper);
  }
}

function updateActiveThumbnail(pageNum) {
  thumbnailView.querySelectorAll(".thumb-wrapper").forEach((w) => {
    w.classList.toggle("active", parseInt(w.dataset.page) === pageNum);
  });
}

// ============================================================
// Events
// ============================================================

// Page changes
eventBus.on("pagechanging", (evt) => {
  pageNumberInput.value = evt.pageNumber;
  updateActiveThumbnail(evt.pageNumber);
});

// After each page renders, apply bionic if enabled
eventBus.on("textlayerrendered", () => {
  if (bionicEnabled) {
    applyBionic();
  }
});

// Scale changes
eventBus.on("scalechanged", (evt) => {
  // update select if it matches a preset
  const opts = Array.from(scaleSelect.options);
  const match = opts.find((o) => parseFloat(o.value) === evt.scale);
  if (match) scaleSelect.value = match.value;
});

// Find results
eventBus.on("updatefindmatchescount", (evt) => {
  const { current, total } = evt.matchesCount;
  findMsg.textContent = total > 0 ? `${current} / ${total}` : "";
});
eventBus.on("updatefindcontrolstate", (evt) => {
  if (evt.state === 1) findMsg.textContent = "Not found";
});

// --- Navigation ---
prevBtn.addEventListener("click", () => { pdfViewer.currentPageNumber--; });
nextBtn.addEventListener("click", () => { pdfViewer.currentPageNumber++; });
pageNumberInput.addEventListener("change", () => {
  const p = parseInt(pageNumberInput.value);
  if (p >= 1 && p <= pdfDoc.numPages) pdfViewer.currentPageNumber = p;
});

// --- Zoom ---
zoomIn.addEventListener("click", () => {
  pdfViewer.currentScale = Math.min(pdfViewer.currentScale + 0.25, 5);
  scaleSelect.value = "";
});
zoomOut.addEventListener("click", () => {
  pdfViewer.currentScale = Math.max(pdfViewer.currentScale - 0.25, 0.25);
  scaleSelect.value = "";
});
scaleSelect.addEventListener("change", () => {
  const val = scaleSelect.value;
  if (val === "page-width") {
    pdfViewer.currentScaleValue = "page-width";
  } else if (val === "page-fit") {
    pdfViewer.currentScaleValue = "page-fit";
  } else {
    pdfViewer.currentScale = parseFloat(val);
  }
});

// --- Sidebar ---
sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("hidden");
});
document.querySelectorAll(".sidebar-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".sidebar-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".sidebar-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab + "Panel").classList.add("active");
  });
});

// --- Search ---
function dispatchFind(type) {
  eventBus.dispatch("find", {
    source: this,
    type,
    query: searchInput.value,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: type === "findprevious",
  });
}
searchInput.addEventListener("input", () => dispatchFind("find"));
findNextBtn.addEventListener("click", () => dispatchFind("findagain"));
findPrevBtn.addEventListener("click", () => dispatchFind("findprevious"));
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    dispatchFind(e.shiftKey ? "findprevious" : "findagain");
    e.preventDefault();
  }
});

// --- Bionic ---
bionicToggle.addEventListener("change", () => {
  bionicEnabled = bionicToggle.checked;
  applyBionic();
});
bionicIntensity.addEventListener("input", () => {
  if (bionicEnabled) applyBionic();
});

// --- File open / close ---
openFileBtn.addEventListener("click", () => fileInput.click());
closeFileBtn.addEventListener("click", closePDF);

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (pdfDoc) closePDF();
  fileNameSpan.textContent = file.name;
  file.arrayBuffer().then(loadPDF);
});
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type === "application/pdf") {
    if (pdfDoc) closePDF();
    fileNameSpan.textContent = file.name;
    file.arrayBuffer().then(loadPDF);
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

// --- Keyboard shortcuts ---
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "o") {
    e.preventDefault();
    fileInput.click();
    return;
  }
  if (!pdfDoc) return;
  if (e.target.tagName === "INPUT") return;
  if (e.ctrlKey && e.key === "f") {
    e.preventDefault();
    searchInput.focus();
  }
  if (e.ctrlKey && e.key === "w") {
    e.preventDefault();
    closePDF();
  }
});
