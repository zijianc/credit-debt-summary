const config = require('../../utils/config');

const confidenceText = {
  high: '高',
  medium: '中',
  low: '低',
};

function formatMoney(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fileNameFromPath(filePath, fallback) {
  return filePath.split('/').pop() || fallback;
}

function mimeFromName(name, fallback) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return fallback;
}

function readFileAsDataUrl(filePath, mimeType) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve(`data:${mimeType};base64,${res.data}`),
      fail: () => reject(new Error('读取文件失败。')),
    });
  });
}

function compressImage(filePath) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality: 78,
      success: (res) => resolve(res.tempFilePath),
      fail: () => resolve(filePath),
    });
  });
}

Page({
  data: {
    files: [],
    mode: 'fast',
    isReading: false,
    isAnalyzing: false,
    canAnalyze: false,
    error: '',
    result: null,
    totalText: '0.00',
    itemCount: 0,
    reviewCount: 0,
    items: [],
    warnings: [],
  },

  setMode(event) {
    this.setData({
      mode: event.currentTarget.dataset.mode,
      result: null,
      error: '',
    });
  },

  async takePhoto() {
    await this.chooseImages(['camera']);
  },

  async chooseAlbum() {
    await this.chooseImages(['album']);
  },

  chooseImages(sourceType) {
    const remaining = config.maxImages - this.data.files.filter((file) => file.kind === 'image').length;
    if (remaining <= 0) {
      this.setData({ error: `最多上传 ${config.maxImages} 张照片。` });
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      wx.chooseMedia({
        count: remaining,
        mediaType: ['image'],
        sourceType,
        sizeType: ['compressed'],
        camera: 'back',
        success: async (res) => {
          await this.addImageFiles(res.tempFiles || []);
          resolve();
        },
        fail: () => resolve(),
      });
    });
  },

  chooseWechatPdf() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf'],
      success: async (res) => {
        await this.addPdfFiles(res.tempFiles || []);
      },
    });
  },

  async addImageFiles(tempFiles) {
    this.setData({ isReading: true, error: '', result: null });
    try {
      const current = this.data.files.filter((file) => file.kind === 'image').length;
      if (current + tempFiles.length > config.maxImages) {
        throw new Error(`最多上传 ${config.maxImages} 张照片。`);
      }

      const nextFiles = [];
      for (const [index, file] of tempFiles.entries()) {
        const compressedPath = await compressImage(file.tempFilePath);
        const name = fileNameFromPath(compressedPath, `照片-${Date.now()}-${index}.jpg`);
        const type = mimeFromName(name, 'image/jpeg');
        const dataUrl = await readFileAsDataUrl(compressedPath, type);
        nextFiles.push({
          id: `${Date.now()}-${Math.random()}-${index}`,
          kind: 'image',
          name,
          type,
          dataUrl,
        });
      }

      this.updateFiles(this.data.files.concat(nextFiles));
    } catch (error) {
      this.setData({ error: error.message || '读取图片失败。' });
    } finally {
      this.setData({ isReading: false });
    }
  },

  async addPdfFiles(tempFiles) {
    this.setData({ isReading: true, error: '', result: null });
    try {
      const nextFiles = [];
      for (const [index, file] of tempFiles.entries()) {
        const name = file.name || fileNameFromPath(file.path, `征信报告-${Date.now()}-${index}.pdf`);
        if (!name.toLowerCase().endsWith('.pdf')) {
          throw new Error('请选择 PDF 文件。');
        }

        const dataUrl = await readFileAsDataUrl(file.path, 'application/pdf');
        nextFiles.push({
          id: `${Date.now()}-${Math.random()}-${index}`,
          kind: 'pdf',
          name,
          type: 'application/pdf',
          dataUrl,
        });
      }

      this.updateFiles(this.data.files.concat(nextFiles));
    } catch (error) {
      this.setData({ error: error.message || '读取 PDF 失败。' });
    } finally {
      this.setData({ isReading: false });
    }
  },

  updateFiles(files) {
    this.setData({
      files,
      canAnalyze: files.length > 0,
      result: null,
      totalText: '0.00',
      itemCount: 0,
      reviewCount: 0,
      items: [],
      warnings: [],
    });
  },

  removeFile(event) {
    const id = event.currentTarget.dataset.id;
    this.updateFiles(this.data.files.filter((file) => file.id !== id));
  },

  clearAll() {
    this.updateFiles([]);
    this.setData({
      error: '',
      result: null,
    });
  },

  analyze() {
    if (!this.data.canAnalyze || this.data.isAnalyzing) return;

    this.setData({ isAnalyzing: true, error: '' });
    wx.request({
      url: `${config.apiBaseUrl}/api/analyze-report`,
      method: 'POST',
      timeout: 90000,
      header: {
        'Content-Type': 'application/json',
      },
      data: {
        mode: this.data.mode,
        files: this.data.files.map((file) => ({
          name: file.name,
          type: file.type,
          dataUrl: file.dataUrl,
        })),
      },
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          this.setData({
            error: res.data && res.data.error ? res.data.error : `后端请求失败：${res.statusCode}`,
          });
          return;
        }

        this.applyResult(res.data.summary);
      },
      fail: () => {
        this.setData({
          error: '无法连接后端。请确认域名 HTTPS、微信合法域名和服务器接口已配置。',
        });
      },
      complete: () => {
        this.setData({ isAnalyzing: false });
      },
    });
  },

  applyResult(summary) {
    const items = (summary && summary.items ? summary.items : []).map((item) => ({
      ...item,
      amountText: formatMoney(item.amount),
      confidenceText: confidenceText[item.confidence] || '中',
    }));
    const warnings = summary && Array.isArray(summary.warnings) ? summary.warnings : [];

    this.setData({
      result: summary,
      totalText: formatMoney(summary && summary.total),
      itemCount: items.length,
      reviewCount: items.filter((item) => item.confidence !== 'high').length,
      items,
      warnings,
    });
  },
});
