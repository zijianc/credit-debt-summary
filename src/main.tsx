import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AlertTriangle, BrainCircuit, FileText, Lock, RotateCcw, RotateCw, UploadCloud, X } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { DebtItem, DebtSummary, parseDebtReport } from './lib/debtParser';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type UploadedAsset = {
  name: string;
  type: string;
  dataUrl: string;
};

type UploadedImage = {
  id: string;
  name: string;
  image: HTMLImageElement;
  rotation: 0 | 90 | 180 | 270;
};

type AiTrace = {
  mode?: 'accurate' | 'fast';
  visionModel: string | null;
  reasoningModel: string;
  usedOcr: boolean;
};

const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 2,
});

const accurateImageMaxSide = 2200;
const fastImageMaxSide = 1800;
const maxUploadImages = 6;

function formatMoney(value: number) {
  return currencyFormatter.format(value);
}

function confidenceLabel(confidence: DebtItem['confidence']) {
  if (confidence === 'high') return '高';
  if (confidence === 'medium') return '中';
  return '低';
}

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isImage(file: File) {
  return file.type.startsWith('image/');
}

async function readPdfText(file: File) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    pages.push(pageText);
  }

  return pages.join('\n');
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.82) {
  return canvas.toDataURL('image/jpeg', quality);
}

function drawImageToCanvas(image: HTMLImageElement, rotation: 0 | 90 | 180 | 270, maxSide = accurateImageMaxSide) {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const rotatedWidth = rotation === 90 || rotation === 270 ? sourceHeight : sourceWidth;
  const rotatedHeight = rotation === 90 || rotation === 270 ? sourceWidth : sourceHeight;
  const scale = Math.min(1, maxSide / Math.max(rotatedWidth, rotatedHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rotatedWidth * scale));
  canvas.height = Math.max(1, Math.round(rotatedHeight * scale));
  const context = canvas.getContext('2d');

  if (!context) throw new Error('无法读取图片。');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(image, (-sourceWidth * scale) / 2, (-sourceHeight * scale) / 2, sourceWidth * scale, sourceHeight * scale);

  return canvas;
}

async function renderPdfPagesAsImages(file: File) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const assets: UploadedAsset[] = [];
  const pageCount = Math.min(pdf.numPages, 3);

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.4, 1800 / baseViewport.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext('2d');

    if (!context) throw new Error('无法渲染 PDF 页面。');
    await page.render({ canvasContext: context, viewport }).promise;
    assets.push({
      name: `${file.name}-page-${pageNumber}.jpg`,
      type: 'image/jpeg',
      dataUrl: canvasToJpeg(canvas),
    });
  }

  return assets;
}

async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  URL.revokeObjectURL(url);
  return image;
}

function makeImageAsset(
  image: HTMLImageElement,
  fileName: string,
  rotation: 0 | 90 | 180 | 270,
  options?: {
    maxSide?: number;
    quality?: number;
  },
): UploadedAsset {
  const canvas = drawImageToCanvas(image, rotation, options?.maxSide);
  return {
    name: `${fileName}-r${rotation}.jpg`,
    type: 'image/jpeg',
    dataUrl: canvasToJpeg(canvas, options?.quality),
  };
}

async function analyzeWithAi(payload: { mode?: 'accurate' | 'fast'; text?: string; files?: UploadedAsset[] }) {
  const response = await fetch('/api/analyze-report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || 'AI 分析失败。请确认后端环境变量已配置。');
  }

  return data as {
    summary: DebtSummary;
    modelTrace: AiTrace;
  };
}

function App() {
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [aiSummary, setAiSummary] = useState<DebtSummary | null>(null);
  const [aiTrace, setAiTrace] = useState<AiTrace | null>(null);
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [analysisMode, setAnalysisMode] = useState<'accurate' | 'fast'>('accurate');
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [showTextInput, setShowTextInput] = useState(false);

  const localSummary: DebtSummary = useMemo(() => parseDebtReport(rawText), [rawText]);
  const summary = aiSummary || localSummary;
  const sourceLabel = aiSummary ? 'AI模型复核' : '本地规则';

  function setMode(mode: 'accurate' | 'fast') {
    setAnalysisMode(mode);
    setAiSummary(null);
    setAiTrace(null);
    setError('');
  }

  async function runAiAnalysis(payload: { mode?: 'accurate' | 'fast'; text?: string; files?: UploadedAsset[] }, options?: { preferPayloadFiles?: boolean }) {
    setIsAiAnalyzing(true);
    setError('');

    try {
      const files =
        !options?.preferPayloadFiles && uploadedImages.length > 0
          ? uploadedImages.map((item) =>
              makeImageAsset(item.image, item.name, item.rotation, {
                maxSide: analysisMode === 'fast' ? fastImageMaxSide : accurateImageMaxSide,
                quality: analysisMode === 'fast' ? 0.78 : 0.82,
              }),
            )
          : payload.files;
      const result = await analyzeWithAi({ ...payload, files, mode: analysisMode });
      setAiSummary(result.summary);
      setAiTrace(result.modelTrace);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 分析失败。');
    } finally {
      setIsAiAnalyzing(false);
    }
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;

    setError('');
    setFileName(files.length === 1 ? files[0].name : `${files.length} 个文件`);
    setIsReading(true);
    setAiSummary(null);
    setAiTrace(null);

    try {
      const imageFiles = files.filter(isImage);
      const pdfFiles = files.filter(isPdf);

      if (pdfFiles.length > 0 && files.length > 1) {
        throw new Error('PDF 请单独上传；多张照片可以一次选择或追加上传。');
      }

      if (imageFiles.length > 0) {
        if (imageFiles.length !== files.length) {
          throw new Error('多选时请只选择图片文件。');
        }
        if (uploadedImages.length + imageFiles.length > maxUploadImages) {
          throw new Error(`最多上传 ${maxUploadImages} 张照片。`);
        }

        const newImages = await Promise.all(
          imageFiles.map(async (file) => ({
            id: `${file.name}:${file.lastModified}:${crypto.randomUUID()}`,
            name: file.name,
            image: await loadImage(file),
            rotation: 0 as const,
          })),
        );
        const nextImages = [...uploadedImages, ...newImages];
        setRawText('');
        setShowTextInput(false);
        setUploadedImages(nextImages);
        setUploadedAssets(
          nextImages.map((item) =>
            makeImageAsset(item.image, item.name, item.rotation, {
              maxSide: accurateImageMaxSide,
              quality: 0.82,
            }),
          ),
        );
        setFileName(`${nextImages.length} 张图片`);
        return;
      }

      const file = files[0];
      if (isPdf(file)) {
        const text = await readPdfText(file);
        setRawText(text);
        setShowTextInput(Boolean(text.trim()));
        setUploadedImages([]);
        setUploadedAssets([]);

        if (!text.trim()) {
          const pdfImages = await renderPdfPagesAsImages(file);
          setUploadedAssets(pdfImages);
          await runAiAnalysis({ files: pdfImages }, { preferPayloadFiles: true });
        }
        return;
      }

      throw new Error('支持 PDF、JPG、PNG、WebP 等图片格式。');
    } catch (err) {
      setRawText('');
      setError(err instanceof Error ? err.message : '读取文件失败。');
    } finally {
      setIsReading(false);
    }
  }

  function clearReport() {
    setFileName('');
    setRawText('');
    setUploadedAssets([]);
    setAiSummary(null);
    setAiTrace(null);
    setUploadedImages([]);
    setShowTextInput(false);
    setError('');
  }

  function canRunAi() {
    return Boolean(rawText.trim() || uploadedAssets.length > 0 || uploadedImages.length > 0);
  }

  function rotateImage(id: string, delta: -90 | 90) {
    const nextImages = uploadedImages.map((item) =>
      item.id === id
        ? {
            ...item,
            rotation: (((item.rotation + delta) % 360) + 360) % 360 as 0 | 90 | 180 | 270,
          }
        : item,
    );
    setUploadedImages(nextImages);
    setUploadedAssets(
      nextImages.map((item) =>
        makeImageAsset(item.image, item.name, item.rotation, {
          maxSide: accurateImageMaxSide,
          quality: 0.82,
        }),
      ),
    );
    setAiSummary(null);
    setAiTrace(null);
    setError('');
  }

  function removeImage(id: string) {
    const nextImages = uploadedImages.filter((item) => item.id !== id);
    setUploadedImages(nextImages);
    setUploadedAssets(
      nextImages.map((item) =>
        makeImageAsset(item.image, item.name, item.rotation, {
          maxSide: accurateImageMaxSide,
          quality: 0.82,
        }),
      ),
    );
    setFileName(nextImages.length > 0 ? `${nextImages.length} 张图片` : '');
    setAiSummary(null);
    setAiTrace(null);
    setError('');
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="panel input-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">本地 + AI 复核</p>
              <h1>征信欠款统计</h1>
            </div>
            <span className="privacy-badge">
              <Lock size={15} />
              Key 仅后端
            </span>
          </div>

          <label className="upload-zone">
            <input
              type="file"
              accept="application/pdf,.pdf,image/*"
              multiple
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files || []);
                if (files.length > 0) void handleFiles(files);
                event.currentTarget.value = '';
              }}
            />
            <UploadCloud size={28} />
            <span>{isReading ? '正在读取...' : '拍照或选择征信照片'}</span>
            <small>{fileName || `可多选，最多 ${maxUploadImages} 张；PDF 也支持`}</small>
          </label>

          {uploadedImages.length > 0 && (
            <div className="image-review">
              <div className="image-review-heading">
                <span>{uploadedImages.length} 张照片</span>
                <small>可继续追加</small>
              </div>
              <div className="image-list">
                {uploadedImages.map((item, index) => {
                  const preview = makeImageAsset(item.image, item.name, item.rotation, {
                    maxSide: 900,
                    quality: 0.76,
                  });

                  return (
                    <div className="image-card" key={item.id}>
                      <div className="image-toolbar">
                        <span>{index + 1}</span>
                        <button className="icon-button" type="button" onClick={() => rotateImage(item.id, -90)} aria-label={`${item.name} 向左旋转`}>
                          <RotateCcw size={17} />
                        </button>
                        <strong>{item.rotation}°</strong>
                        <button className="icon-button" type="button" onClick={() => rotateImage(item.id, 90)} aria-label={`${item.name} 向右旋转`}>
                          <RotateCw size={17} />
                        </button>
                        <button className="icon-button" type="button" onClick={() => removeImage(item.id)} aria-label={`移除 ${item.name}`}>
                          <X size={17} />
                        </button>
                      </div>
                      <img src={preview.dataUrl} alt={`待识别征信报告 ${index + 1}`} />
                      <small>{item.name}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="action-row">
            <div className="segmented-control" aria-label="AI分析模式">
              <button className={analysisMode === 'accurate' ? 'active' : ''} type="button" onClick={() => setMode('accurate')}>
                精准
              </button>
              <button className={analysisMode === 'fast' ? 'active' : ''} type="button" onClick={() => setMode('fast')}>
                快速
              </button>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={!canRunAi() || isAiAnalyzing}
              onClick={() => void runAiAnalysis({ text: rawText, files: uploadedAssets })}
            >
              <BrainCircuit size={17} />
              {isAiAnalyzing ? '正在统计...' : '开始统计欠款'}
            </button>
            <span className="source-pill">{sourceLabel}</span>
          </div>

          <div className="secondary-actions">
            <button className="ghost-button" type="button" onClick={() => setShowTextInput((value) => !value)}>
              <FileText size={16} />
              {showTextInput ? '收起文字' : '粘贴文字'}
            </button>
            {(rawText || uploadedAssets.length > 0) && (
              <button className="ghost-button" type="button" onClick={clearReport}>
                <X size={16} />
                清空
              </button>
            )}
          </div>

          {showTextInput && (
            <>
              <div className="textarea-row">
                <label htmlFor="reportText">报告文本</label>
              </div>
              <textarea
                id="reportText"
                value={rawText}
                onChange={(event) => {
                  setError('');
                  setFileName('');
                  setUploadedAssets([]);
                  setUploadedImages([]);
                  setAiSummary(null);
                  setAiTrace(null);
                  setRawText(event.target.value);
                }}
                placeholder="也可以把征信报告中的文字粘贴到这里，再点击开始统计欠款。"
              />
            </>
          )}

          {aiTrace && (
            <div className="notice trace">
              <BrainCircuit size={17} />
              <span>
                {aiTrace.usedOcr ? `OCR：${aiTrace.visionModel}；` : ''}
                归纳：{aiTrace.reasoningModel}
              </span>
            </div>
          )}
          {error && (
            <div className="notice error">
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
          )}
          <div className="notice">
            <FileText size={17} />
            <span>图片和扫描件会发送到你自己的后端，再调用百炼模型；API Key 不会进入浏览器代码。</span>
          </div>
        </div>

        <div className="panel result-panel">
          <div className="summary-grid">
            <div className="metric primary">
              <span>欠款合计</span>
              <strong>{formatMoney(summary.total)}</strong>
            </div>
            <div className="metric">
              <span>识别条目</span>
              <strong>{summary.items.length}</strong>
            </div>
            <div className="metric">
              <span>需复核</span>
              <strong>{summary.items.filter((item) => item.confidence !== 'high').length}</strong>
            </div>
          </div>

          {summary.items.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>金额</th>
                    <th>可信度</th>
                    <th>依据</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.items.map((item) => (
                    <tr key={item.id}>
                      <td data-label="类型">{item.kind}</td>
                      <td data-label="金额">{formatMoney(item.amount)}</td>
                      <td data-label="可信度">
                        <span className={`confidence ${item.confidence}`}>{confidenceLabel(item.confidence)}</span>
                      </td>
                      <td data-label="依据">{item.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <FileText size={34} />
              <p>上传 PDF、图片或粘贴文本后，这里会显示识别到的欠款。</p>
            </div>
          )}

          {summary.warnings.length > 0 && (
            <div className="warning-list">
              {summary.warnings.map((warning) => (
                <div className="notice warning" key={warning}>
                  <AlertTriangle size={17} />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
