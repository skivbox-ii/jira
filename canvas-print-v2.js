/**
 * CanvasPrint v2 - Библиотека для печати и экспорта Canvas
 * Светлая тема (стили из print.html)
 * 
 * Использование:
 *   const printer = new CanvasPrint(canvas);
 *   printer.open();
 */

(function(global) {
  'use strict';

  // Размеры бумаги в мм
  const PAPER_SIZES = {
    'A4': { width: 210, height: 297, label: 'A4 (210×297 мм)' },
    'A3': { width: 297, height: 420, label: 'A3 (297×420 мм)' },
    'A2': { width: 420, height: 594, label: 'A2 (420×594 мм)' },
    'A1': { width: 594, height: 841, label: 'A1 (594×841 мм)' },
    'A0': { width: 841, height: 1189, label: 'A0 (841×1189 мм)' },
    'Letter': { width: 216, height: 279, label: 'Letter (216×279 мм)' },
    'Legal': { width: 216, height: 356, label: 'Legal (216×356 мм)' },
    'Tabloid': { width: 279, height: 432, label: 'Tabloid (279×432 мм)' },
  };

  const MM_TO_PX = 3.7795275591; // 96 DPI
  const PAGE_DISPLAY_SIZE = 200;

  // CSS стили - светлая тема из print.html
  const MODAL_STYLES = `
    .cp-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: cp-fade-in 0.2s ease-out;
    }

    @keyframes cp-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes cp-slide-up {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .cp-modal {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      width: calc(100vw - 40px);
      max-width: 1200px;
      height: calc(100vh - 40px);
      max-height: 800px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: cp-slide-up 0.3s ease-out;
    }

    .cp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
    }

    .cp-title {
      font-size: 18px;
      font-weight: 600;
      color: #2563eb;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .cp-title svg {
      width: 24px;
      height: 24px;
    }

    .cp-close {
      width: 36px;
      height: 36px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      border-radius: 6px;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .cp-close:hover {
      background: #f8fafc;
      color: #ef4444;
      border-color: #fecaca;
    }

    .cp-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .cp-sidebar {
      width: 260px;
      background: #ffffff;
      border-right: 1px solid #e2e8f0;
      padding: 16px;
      overflow-y: auto;
      flex-shrink: 0;
    }

    .cp-section {
      margin-bottom: 20px;
    }

    .cp-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 10px;
      letter-spacing: 0.5px;
    }

    .cp-select, .cp-input {
      width: 100%;
      padding: 8px 12px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      color: #1e293b;
      font-size: 14px;
      outline: none;
      transition: all 0.15s;
      margin-bottom: 8px;
    }

    .cp-select:focus, .cp-input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .cp-radio-group {
      display: flex;
      gap: 8px;
    }

    .cp-radio-btn {
      flex: 1;
      padding: 8px 12px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      color: #64748b;
      font-size: 13px;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }

    .cp-radio-btn:hover {
      background: #f8fafc;
    }

    .cp-radio-btn.active {
      background: #eff6ff;
      border-color: #2563eb;
      color: #2563eb;
    }

    .cp-info {
      padding: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 13px;
      color: #475569;
    }

    .cp-info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .cp-info-row:last-child {
      margin-bottom: 0;
    }

    .cp-info-value {
      font-weight: 600;
      color: #2563eb;
    }

    .cp-viewport {
      flex: 1;
      position: relative;
      overflow: hidden;
      background: #f1f5f9;
    }

    .cp-print-area {
      position: absolute;
      transform-origin: 0 0;
    }

    .cp-page {
      position: absolute;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
      overflow: hidden;
    }

    .cp-page-border {
      position: absolute;
      inset: 0;
      border: 2px solid #2563eb;
      pointer-events: none;
      z-index: 10;
    }

    .cp-page-label {
      position: absolute;
      top: 6px;
      left: 6px;
      font-size: 11px;
      font-weight: 600;
      color: #2563eb;
      background: rgba(255, 255, 255, 0.9);
      padding: 3px 8px;
      border-radius: 4px;
      z-index: 11;
      border: 1px solid rgba(37, 99, 235, 0.2);
    }

    .cp-schema-container {
      position: absolute;
      cursor: grab;
      transform-origin: 0 0;
    }

    .cp-schema-container:active {
      cursor: grabbing;
    }

    .cp-schema-container canvas {
      display: block;
    }

    .cp-controls {
      position: absolute;
      bottom: 20px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 0;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .cp-ctrl-btn {
      width: 40px;
      height: 40px;
      border: none;
      background: transparent;
      color: #1e293b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .cp-ctrl-btn svg {
      width: 20px;
      height: 20px;
    }

    .cp-ctrl-btn:hover {
      background: #f8fafc;
    }

    .cp-scale-display {
      padding: 8px;
      text-align: center;
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
    }

    .cp-pages-indicator {
      position: absolute;
      top: 16px;
      right: 16px;
      padding: 8px 14px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 14px;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .cp-pages-indicator strong {
      color: #2563eb;
      font-size: 16px;
    }

    .cp-hint {
      position: absolute;
      bottom: 20px;
      left: 20px;
      padding: 10px 14px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      color: #64748b;
      max-width: 320px;
      line-height: 1.5;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      transition: opacity 0.2s;
    }

    .cp-hint.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .cp-hint code {
      background: #eff6ff;
      padding: 2px 6px;
      border-radius: 3px;
      color: #2563eb;
      font-size: 11px;
    }

    .cp-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      background: #ffffff;
      border-top: 1px solid #e2e8f0;
    }

    .cp-footer-info {
      font-size: 13px;
      color: #64748b;
    }

    .cp-footer-info strong {
      color: #2563eb;
    }

    .cp-actions {
      display: flex;
      gap: 8px;
    }

    .cp-btn {
      padding: 8px 16px;
      border: 1px solid transparent;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }

    .cp-btn svg {
      width: 16px;
      height: 16px;
    }

    .cp-btn-secondary {
      background: #ffffff;
      border-color: #e2e8f0;
      color: #1e293b;
    }

    .cp-btn-secondary:hover {
      background: #f8fafc;
    }

    .cp-btn-primary {
      background: #2563eb;
      color: #ffffff;
    }

    .cp-btn-primary:hover {
      background: #1d4ed8;
    }

    .cp-dropdown {
      position: relative;
    }

    .cp-dropdown-menu {
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 4px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      min-width: 160px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      display: none;
      z-index: 1000;
    }

    .cp-dropdown-menu.show {
      display: block;
    }

    .cp-dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      color: #1e293b;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .cp-dropdown-item:hover {
      background: #f8fafc;
    }

    .cp-dropdown-item svg {
      width: 16px;
      height: 16px;
      color: #64748b;
    }

    .cp-loading {
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.9);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      z-index: 100;
    }

    .cp-loading.show {
      display: flex;
    }

    .cp-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #e2e8f0;
      border-top-color: #2563eb;
      border-radius: 50%;
      animation: cp-spin 1s linear infinite;
    }

    @keyframes cp-spin {
      to { transform: rotate(360deg); }
    }

    .cp-loading-text {
      color: #64748b;
      font-size: 14px;
    }

    /* Crop selection styles */
    .cp-crop-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      cursor: crosshair;
      z-index: 50;
      display: none;
    }

    .cp-crop-overlay.active {
      display: block;
    }

    .cp-crop-canvas {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .cp-crop-hint {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 16px 24px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      color: #1e293b;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      pointer-events: none;
    }

    .cp-crop-hint code {
      background: #eff6ff;
      padding: 2px 6px;
      border-radius: 3px;
      color: #2563eb;
      font-size: 12px;
    }

    .cp-crop-badge {
      position: absolute;
      top: 16px;
      left: 16px;
      padding: 6px 12px;
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      color: #92400e;
      display: none;
      z-index: 20;
    }

    .cp-crop-badge.show {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .cp-ctrl-btn.crop-active {
      background: #dbeafe;
      color: #2563eb;
    }

    .cp-viewport.selecting {
      cursor: crosshair;
    }

    .cp-selection-rect {
      position: absolute;
      border: 2px dashed #2563eb;
      background: rgba(37, 99, 235, 0.1);
      pointer-events: none;
      z-index: 51;
    }
  `;

  // Иконки SVG
  const ICONS = {
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/></svg>',
    zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M8 11h6"/></svg>',
    fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>',
    fitMax: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8V4h16v4"/><rect x="6" y="8" width="12" height="12" rx="1"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
    crop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2v4H2M18 22v-4h4M2 6h16v12M22 18V6H6"/></svg>',
    cropReset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>',
  };

  class CanvasPrint {
    constructor(canvas, options = {}) {
      this.sourceCanvas = canvas;
      this.options = {
        paperSize: 'A4',
        orientation: 'landscape',
        margins: 10,
        dpi: 300,
        ...options
      };

      this.state = {
        schemaScale: 1,
        schemaX: 0,
        schemaY: 0,
        pageSizeMm: { width: 0, height: 0 },
        viewScale: 1,
        viewX: 0,
        viewY: 0,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        activePages: [],
        gridCols: 1,
        gridRows: 1,
        gridStartCol: 0,
        gridStartRow: 0,
        // Crop selection state
        cropRect: null,           // { x, y, width, height } в координатах исходного канваса
        isSelectingCrop: false,   // режим выделения активен
        selectionStart: null,     // { x, y } начало выделения
        selectionCurrent: null,   // { x, y } текущая позиция при выделении
      };

      this.elements = {};
      this.boundHandlers = {};
    }

    open() {
      this._injectStyles();
      this._createModal();
      this._bindEvents();
      this._updatePageSize();
      this._fitSchemaToOnePage();
      this._render();
    }

    close() {
      if (this.elements.overlay) {
        this.elements.overlay.remove();
      }
      this._cleanup();
    }

    static print(canvas, options) {
      const printer = new CanvasPrint(canvas, options);
      printer.open();
      return printer;
    }

    _injectStyles() {
      if (document.getElementById('canvas-print-styles-v2')) return;
      
      const style = document.createElement('style');
      style.id = 'canvas-print-styles-v2';
      style.textContent = MODAL_STYLES;
      document.head.appendChild(style);
    }

    _createModal() {
      const overlay = document.createElement('div');
      overlay.className = 'cp-overlay';
      overlay.innerHTML = this._getModalHTML();
      document.body.appendChild(overlay);

      this.elements = {
        overlay,
        modal: overlay.querySelector('.cp-modal'),
        viewport: overlay.querySelector('.cp-viewport'),
        printArea: overlay.querySelector('.cp-print-area'),
        paperSelect: overlay.querySelector('#cp-paper-size'),
        orientationBtns: overlay.querySelectorAll('.cp-orientation-btn'),
        marginInput: overlay.querySelector('#cp-margins'),
        dpiSelect: overlay.querySelector('#cp-dpi'),
        scaleDisplay: overlay.querySelector('.cp-scale-display'),
        pagesIndicator: overlay.querySelector('.cp-pages-count'),
        infoPages: overlay.querySelector('#cp-info-pages'),
        infoSize: overlay.querySelector('#cp-info-size'),
        infoScale: overlay.querySelector('#cp-info-scale'),
        footerInfo: overlay.querySelector('.cp-footer-info'),
        loading: overlay.querySelector('.cp-loading'),
        loadingText: overlay.querySelector('.cp-loading-text'),
        exportDropdown: overlay.querySelector('.cp-dropdown-menu'),
        hint: overlay.querySelector('.cp-hint'),
        cropOverlay: overlay.querySelector('.cp-crop-overlay'),
        cropBadge: overlay.querySelector('.cp-crop-badge'),
        cropSelectBtn: overlay.querySelector('[data-action="crop-select"]'),
        cropResetBtn: overlay.querySelector('[data-action="crop-reset"]'),
      };

      const canvasCopy = document.createElement('canvas');
      canvasCopy.width = this.sourceCanvas.width;
      canvasCopy.height = this.sourceCanvas.height;
      const ctx = canvasCopy.getContext('2d');
      ctx.drawImage(this.sourceCanvas, 0, 0);
      this.elements.canvas = canvasCopy;
    }

    _getModalHTML() {
      return `
        <div class="cp-modal">
          <div class="cp-header">
            <div class="cp-title">
              ${ICONS.print}
              Schema Viewer
            </div>
            <button class="cp-close" data-action="close">${ICONS.close}</button>
          </div>

          <div class="cp-body">
            <div class="cp-sidebar">
              <div class="cp-section">
                <div class="cp-section-title">Размер бумаги</div>
                <select class="cp-select" id="cp-paper-size">
                  ${Object.entries(PAPER_SIZES).map(([key, val]) => 
                    `<option value="${key}" ${key === this.options.paperSize ? 'selected' : ''}>${val.label}</option>`
                  ).join('')}
                </select>
              </div>

              <div class="cp-section">
                <div class="cp-section-title">Ориентация</div>
                <div class="cp-radio-group">
                  <button class="cp-radio-btn cp-orientation-btn ${this.options.orientation === 'landscape' ? 'active' : ''}" data-value="landscape">
                    ⬌ Альбомная
                  </button>
                  <button class="cp-radio-btn cp-orientation-btn ${this.options.orientation === 'portrait' ? 'active' : ''}" data-value="portrait">
                    ⬍ Книжная
                  </button>
                </div>
              </div>

              <div class="cp-section">
                <div class="cp-section-title">Поля (мм)</div>
                <input type="number" class="cp-input" id="cp-margins" value="${this.options.margins}" min="0" max="50">
              </div>

              <div class="cp-section">
                <div class="cp-section-title">Качество</div>
                <select class="cp-select" id="cp-dpi">
                  <option value="72">72 DPI (экран)</option>
                  <option value="150" ${this.options.dpi === 150 ? 'selected' : ''}>150 DPI (быстро)</option>
                  <option value="300" ${this.options.dpi === 300 ? 'selected' : ''}>300 DPI (качественно)</option>
                  <option value="600">600 DPI (максимум)</option>
                </select>
              </div>

              <div class="cp-section">
                <div class="cp-section-title">Информация</div>
                <div class="cp-info">
                  <div class="cp-info-row">
                    <span>Страниц:</span>
                    <span class="cp-info-value" id="cp-info-pages">1</span>
                  </div>
                  <div class="cp-info-row">
                    <span>Размер схемы:</span>
                    <span class="cp-info-value" id="cp-info-size">-</span>
                  </div>
                  <div class="cp-info-row">
                    <span>Масштаб печати:</span>
                    <span class="cp-info-value" id="cp-info-scale">100%</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="cp-viewport">
              <div class="cp-print-area"></div>

              <div class="cp-pages-indicator">
                Страниц: <strong class="cp-pages-count">1</strong>
              </div>

              <div class="cp-controls">
                <button class="cp-ctrl-btn" data-action="scale-up" title="Увеличить схему">${ICONS.zoomIn}</button>
                <div class="cp-scale-display">100%</div>
                <button class="cp-ctrl-btn" data-action="scale-down" title="Уменьшить схему">${ICONS.zoomOut}</button>
                <button class="cp-ctrl-btn" data-action="fit-one" title="Вписать в 1 страницу" style="border-top: 1px solid #e2e8f0;">${ICONS.fit}</button>
                <button class="cp-ctrl-btn" data-action="fit-max" title="Вписать максимально">${ICONS.fitMax}</button>
                <button class="cp-ctrl-btn" data-action="reset" title="Сбросить позицию">${ICONS.reset}</button>
                <button class="cp-ctrl-btn" data-action="crop-select" title="Выбрать область (Ctrl)" style="border-top: 1px solid #e2e8f0;">${ICONS.crop}</button>
                <button class="cp-ctrl-btn" data-action="crop-reset" title="Сбросить выделение">${ICONS.cropReset}</button>
              </div>
              
              <div class="cp-crop-badge">
                ${ICONS.crop}
                <span>Выбрана область</span>
              </div>

              <div class="cp-hint">
                <strong>Управление:</strong><br>
                <code>Колесо мыши</code> — масштаб печати<br>
                <code>Перетаскивание</code> — позиция схемы<br>
                <code>Ctrl</code> — выбрать область
              </div>
              
              <div class="cp-crop-overlay">
                <div class="cp-crop-hint">
                  <strong>Режим выбора области</strong><br>
                  Выделите мышкой нужную часть схемы<br>
                  <code>Esc</code> — отмена
                </div>
              </div>

              <div class="cp-loading">
                <div class="cp-spinner"></div>
                <div class="cp-loading-text">Подготовка...</div>
              </div>
            </div>
          </div>

          <div class="cp-footer">
            <div class="cp-footer-info">
              Схема будет разбита на <strong id="cp-pages-footer">1</strong> страниц(ы)
            </div>
            <div class="cp-actions">
              <div class="cp-dropdown">
                <button class="cp-btn cp-btn-secondary" data-action="export-toggle">
                  ${ICONS.download}
                  Экспорт
                  ${ICONS.chevron}
                </button>
                <div class="cp-dropdown-menu">
                  <div class="cp-dropdown-item" data-action="export-pdf">
                    ${ICONS.pdf}
                    Экспорт PDF
                  </div>
                  <div class="cp-dropdown-item" data-action="export-png">
                    ${ICONS.image}
                    Экспорт PNG
                  </div>
                  <div class="cp-dropdown-item" data-action="export-jpeg">
                    ${ICONS.image}
                    Экспорт JPEG
                  </div>
                  <div class="cp-dropdown-item" data-action="export-webp">
                    ${ICONS.image}
                    Экспорт WebP
                  </div>
                  <div class="cp-dropdown-item" data-action="export-single-png">
                    ${ICONS.image}
                    PNG (одним файлом)
                  </div>
                </div>
              </div>
              <button class="cp-btn cp-btn-primary" data-action="print">
                ${ICONS.print}
                Печать
              </button>
            </div>
          </div>
        </div>
      `;
    }

    _bindEvents() {
      const { overlay, viewport, paperSelect, orientationBtns, marginInput, dpiSelect } = this.elements;

      overlay.querySelectorAll('[data-action="close"]').forEach(btn => {
        btn.addEventListener('click', () => this.close());
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.close();
      });

      this.boundHandlers.keydown = (e) => {
        if (e.key === 'Escape') {
          if (this.state.isSelectingCrop) {
            this._exitCropMode();
          } else {
            this.close();
          }
        }
        if (e.key === 'Control' && !this.state.isSelectingCrop) {
          this._enterCropMode();
        }
      };
      
      this.boundHandlers.keyup = (e) => {
        // На keyup Ctrl - ничего не делаем, выход только по Escape или по завершению выделения
      };
      
      document.addEventListener('keydown', this.boundHandlers.keydown);
      document.addEventListener('keyup', this.boundHandlers.keyup);

      paperSelect.addEventListener('change', () => {
        this.options.paperSize = paperSelect.value;
        this._updatePageSize();
        this._fitSchemaToOnePage();
        this._render();
      });

      orientationBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          orientationBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.options.orientation = btn.dataset.value;
          this._updatePageSize();
          this._fitSchemaToOnePage();
          this._render();
        });
      });

      marginInput.addEventListener('change', () => {
        this.options.margins = parseInt(marginInput.value) || 0;
        this._updatePageSize();
        this._fitSchemaToOnePage();
        this._render();
      });

      dpiSelect.addEventListener('change', () => {
        this.options.dpi = parseInt(dpiSelect.value);
      });

      overlay.querySelector('[data-action="scale-up"]').addEventListener('click', () => this._changeSchemaScale(1.2));
      overlay.querySelector('[data-action="scale-down"]').addEventListener('click', () => this._changeSchemaScale(0.8));
      overlay.querySelector('[data-action="fit-one"]').addEventListener('click', () => this._fitSchemaToOnePage());
      overlay.querySelector('[data-action="fit-max"]').addEventListener('click', () => this._fitSchemaMaxToTop());
      overlay.querySelector('[data-action="reset"]').addEventListener('click', () => this._resetPosition());
      
      // Crop selection buttons
      this.elements.cropSelectBtn.addEventListener('click', () => this._enterCropMode());
      this.elements.cropResetBtn.addEventListener('click', () => this._resetCrop());

      this.boundHandlers.wheel = (e) => {
        e.preventDefault();
        let factor;
        if (e.ctrlKey) {
          factor = e.deltaY > 0 ? 0.999 : 1.001;
        } else {
          factor = e.deltaY > 0 ? 0.92 : 1.08;
        }
        this._changeSchemaScaleAtPoint(factor, e.clientX, e.clientY);
      };
      viewport.addEventListener('wheel', this.boundHandlers.wheel, { passive: false });

      this.boundHandlers.mousedown = (e) => {
        if (e.button !== 0) return;
        this.state.isDragging = true;
        this.state.dragStartX = e.clientX;
        this.state.dragStartY = e.clientY;
        this.state.dragStartSchemaX = this.state.schemaX;
        this.state.dragStartSchemaY = this.state.schemaY;
        viewport.style.cursor = 'grabbing';
        if (this.elements.hint) {
          this.elements.hint.classList.add('hidden');
        }
      };

      this.boundHandlers.mousemove = (e) => {
        if (!this.state.isDragging) return;
        
        const dx = e.clientX - this.state.dragStartX;
        const dy = e.clientY - this.state.dragStartY;
        
        const pageDisplayW = this._getPageDisplayWidth();
        const pageDisplayH = this._getPageDisplayHeight();
        
        this.state.schemaX = this.state.dragStartSchemaX + (dx / this.state.viewScale) / pageDisplayW;
        this.state.schemaY = this.state.dragStartSchemaY + (dy / this.state.viewScale) / pageDisplayH;
        
        this._render();
      };

      this.boundHandlers.mouseup = () => {
        this.state.isDragging = false;
        viewport.style.cursor = 'grab';
        if (this.elements.hint) {
          this.elements.hint.classList.remove('hidden');
        }
      };

      viewport.addEventListener('mousedown', this.boundHandlers.mousedown);
      document.addEventListener('mousemove', this.boundHandlers.mousemove);
      document.addEventListener('mouseup', this.boundHandlers.mouseup);
      
      // Crop selection mouse handlers
      this.boundHandlers.cropMousedown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        
        const rect = this.elements.cropOverlay.getBoundingClientRect();
        this.state.selectionStart = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        this.state.selectionCurrent = { ...this.state.selectionStart };
        
        // Create selection rectangle
        const selRect = document.createElement('div');
        selRect.className = 'cp-selection-rect';
        this.elements.cropOverlay.appendChild(selRect);
        this.elements.selectionRect = selRect;
        
        // Hide the hint when starting selection
        const cropHint = this.elements.cropOverlay.querySelector('.cp-crop-hint');
        if (cropHint) cropHint.style.display = 'none';
      };
      
      this.boundHandlers.cropMousemove = (e) => {
        if (!this.state.selectionStart || !this.state.isSelectingCrop) return;
        
        const rect = this.elements.cropOverlay.getBoundingClientRect();
        this.state.selectionCurrent = {
          x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
          y: Math.max(0, Math.min(rect.height, e.clientY - rect.top))
        };
        
        this._updateSelectionRect();
      };
      
      this.boundHandlers.cropMouseup = (e) => {
        if (!this.state.selectionStart || !this.state.isSelectingCrop) return;
        
        const rect = this.elements.cropOverlay.getBoundingClientRect();
        this.state.selectionCurrent = {
          x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
          y: Math.max(0, Math.min(rect.height, e.clientY - rect.top))
        };
        
        this._applyCropSelection();
      };
      
      this.elements.cropOverlay.addEventListener('mousedown', this.boundHandlers.cropMousedown);
      document.addEventListener('mousemove', this.boundHandlers.cropMousemove);
      document.addEventListener('mouseup', this.boundHandlers.cropMouseup);

      overlay.querySelector('[data-action="export-toggle"]').addEventListener('click', (e) => {
        e.stopPropagation();
        this.elements.exportDropdown.classList.toggle('show');
      });

      document.addEventListener('click', () => {
        this.elements.exportDropdown.classList.remove('show');
      });

      overlay.querySelector('[data-action="export-pdf"]').addEventListener('click', () => this._exportPDF());
      overlay.querySelector('[data-action="export-png"]').addEventListener('click', () => this._exportImages('png'));
      overlay.querySelector('[data-action="export-jpeg"]').addEventListener('click', () => this._exportImages('jpeg'));
      overlay.querySelector('[data-action="export-webp"]').addEventListener('click', () => this._exportImages('webp'));
      overlay.querySelector('[data-action="export-single-png"]').addEventListener('click', () => this._exportSingleImage());

      overlay.querySelector('[data-action="print"]').addEventListener('click', () => this._print());

      viewport.style.cursor = 'grab';
    }

    _cleanup() {
      if (this.boundHandlers.keydown) {
        document.removeEventListener('keydown', this.boundHandlers.keydown);
      }
      if (this.boundHandlers.keyup) {
        document.removeEventListener('keyup', this.boundHandlers.keyup);
      }
      if (this.boundHandlers.mousemove) {
        document.removeEventListener('mousemove', this.boundHandlers.mousemove);
      }
      if (this.boundHandlers.mouseup) {
        document.removeEventListener('mouseup', this.boundHandlers.mouseup);
      }
      if (this.boundHandlers.cropMousemove) {
        document.removeEventListener('mousemove', this.boundHandlers.cropMousemove);
      }
      if (this.boundHandlers.cropMouseup) {
        document.removeEventListener('mouseup', this.boundHandlers.cropMouseup);
      }
    }

    _updatePageSize() {
      const paper = PAPER_SIZES[this.options.paperSize];
      let width = paper.width - this.options.margins * 2;
      let height = paper.height - this.options.margins * 2;

      if (this.options.orientation === 'landscape') {
        [width, height] = [height, width];
      }

      this.state.pageSizeMm = { width, height };
    }

    _getPageDisplayWidth() {
      const { pageSizeMm } = this.state;
      const aspectRatio = pageSizeMm.width / pageSizeMm.height;
      return PAGE_DISPLAY_SIZE * aspectRatio;
    }

    _getPageDisplayHeight() {
      return PAGE_DISPLAY_SIZE;
    }

    _fitSchemaToOnePage() {
      const { pageSizeMm, cropRect } = this.state;
      
      // Use cropRect dimensions if set, otherwise full canvas
      const sourceW = cropRect ? cropRect.width : this.elements.canvas.width;
      const sourceH = cropRect ? cropRect.height : this.elements.canvas.height;
      
      const canvasAspect = sourceW / sourceH;
      const pageAspect = pageSizeMm.width / pageSizeMm.height;
      
      const schemaWidthMm = sourceW / MM_TO_PX;
      const schemaHeightMm = sourceH / MM_TO_PX;
      
      let fitScale;
      if (canvasAspect > pageAspect) {
        fitScale = pageSizeMm.width / schemaWidthMm;
      } else {
        fitScale = pageSizeMm.height / schemaHeightMm;
      }
      
      this.state.schemaScale = fitScale * 0.95;
      this.state.schemaX = 0;
      this.state.schemaY = 0;
      
      this._render();
    }

    _resetPosition() {
      this.state.schemaX = 0;
      this.state.schemaY = 0;
      this._render();
    }

    // ==================== Crop Selection Methods ====================
    
    _enterCropMode() {
      this.state.isSelectingCrop = true;
      this.state.selectionStart = null;
      this.state.selectionCurrent = null;
      
      this.elements.cropOverlay.classList.add('active');
      this.elements.cropSelectBtn.classList.add('crop-active');
      this.elements.viewport.classList.add('selecting');
      
      // Show the hint
      const cropHint = this.elements.cropOverlay.querySelector('.cp-crop-hint');
      if (cropHint) cropHint.style.display = 'block';
      
      // Render the full schema on the overlay (without crop)
      this._renderCropOverlay();
    }
    
    _exitCropMode() {
      this.state.isSelectingCrop = false;
      this.state.selectionStart = null;
      this.state.selectionCurrent = null;
      
      this.elements.cropOverlay.classList.remove('active');
      this.elements.cropSelectBtn.classList.remove('crop-active');
      this.elements.viewport.classList.remove('selecting');
      
      // Remove selection rectangle if exists
      if (this.elements.selectionRect) {
        this.elements.selectionRect.remove();
        this.elements.selectionRect = null;
      }
      
      // Clear the crop canvas
      const cropCanvas = this.elements.cropOverlay.querySelector('.cp-crop-canvas');
      if (cropCanvas) cropCanvas.remove();
    }
    
    _resetCrop() {
      this.state.cropRect = null;
      this.elements.cropBadge.classList.remove('show');
      this._fitSchemaToOnePage();
      this._render();
    }
    
    _renderCropOverlay() {
      // Remove existing crop canvas
      let cropCanvas = this.elements.cropOverlay.querySelector('.cp-crop-canvas');
      if (cropCanvas) cropCanvas.remove();
      
      // Create new canvas for crop overlay
      cropCanvas = document.createElement('canvas');
      cropCanvas.className = 'cp-crop-canvas';
      
      const overlayRect = this.elements.cropOverlay.getBoundingClientRect();
      cropCanvas.width = overlayRect.width;
      cropCanvas.height = overlayRect.height;
      
      const ctx = cropCanvas.getContext('2d');
      
      // Fill with semi-transparent background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
      
      // Draw the full original canvas (scaled to fit)
      const sourceCanvas = this.elements.canvas;
      const padding = 40;
      const availW = cropCanvas.width - padding * 2;
      const availH = cropCanvas.height - padding * 2;
      
      const scaleX = availW / sourceCanvas.width;
      const scaleY = availH / sourceCanvas.height;
      const scale = Math.min(scaleX, scaleY);
      
      const drawW = sourceCanvas.width * scale;
      const drawH = sourceCanvas.height * scale;
      const drawX = (cropCanvas.width - drawW) / 2;
      const drawY = (cropCanvas.height - drawH) / 2;
      
      // Store these for coordinate conversion
      this._cropOverlayParams = { drawX, drawY, drawW, drawH, scale };
      
      // Clear the area where we'll draw the schema
      ctx.clearRect(drawX, drawY, drawW, drawH);
      
      // Draw the schema
      ctx.drawImage(sourceCanvas, drawX, drawY, drawW, drawH);
      
      // Draw existing cropRect if present
      if (this.state.cropRect) {
        const crop = this.state.cropRect;
        const rectX = drawX + crop.x * scale;
        const rectY = drawY + crop.y * scale;
        const rectW = crop.width * scale;
        const rectH = crop.height * scale;
        
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(rectX, rectY, rectW, rectH);
        ctx.setLineDash([]);
      }
      
      this.elements.cropOverlay.insertBefore(cropCanvas, this.elements.cropOverlay.firstChild);
    }
    
    _updateSelectionRect() {
      if (!this.elements.selectionRect || !this.state.selectionStart) return;
      
      const start = this.state.selectionStart;
      const current = this.state.selectionCurrent;
      
      const x = Math.min(start.x, current.x);
      const y = Math.min(start.y, current.y);
      const w = Math.abs(current.x - start.x);
      const h = Math.abs(current.y - start.y);
      
      this.elements.selectionRect.style.left = x + 'px';
      this.elements.selectionRect.style.top = y + 'px';
      this.elements.selectionRect.style.width = w + 'px';
      this.elements.selectionRect.style.height = h + 'px';
    }
    
    _applyCropSelection() {
      if (!this.state.selectionStart || !this.state.selectionCurrent) {
        this._exitCropMode();
        return;
      }
      
      const start = this.state.selectionStart;
      const current = this.state.selectionCurrent;
      
      // Calculate selection rectangle in overlay coordinates
      const selX = Math.min(start.x, current.x);
      const selY = Math.min(start.y, current.y);
      const selW = Math.abs(current.x - start.x);
      const selH = Math.abs(current.y - start.y);
      
      // Minimum selection size
      if (selW < 10 || selH < 10) {
        this._exitCropMode();
        return;
      }
      
      // Convert to canvas coordinates
      const params = this._cropOverlayParams;
      if (!params) {
        this._exitCropMode();
        return;
      }
      
      // Calculate crop rect in source canvas coordinates
      const cropX = (selX - params.drawX) / params.scale;
      const cropY = (selY - params.drawY) / params.scale;
      const cropW = selW / params.scale;
      const cropH = selH / params.scale;
      
      // Clamp to canvas bounds
      const sourceCanvas = this.elements.canvas;
      const clampedX = Math.max(0, Math.min(sourceCanvas.width, cropX));
      const clampedY = Math.max(0, Math.min(sourceCanvas.height, cropY));
      const clampedW = Math.max(10, Math.min(sourceCanvas.width - clampedX, cropW));
      const clampedH = Math.max(10, Math.min(sourceCanvas.height - clampedY, cropH));
      
      // Set crop rect
      this.state.cropRect = {
        x: clampedX,
        y: clampedY,
        width: clampedW,
        height: clampedH
      };
      
      this.elements.cropBadge.classList.add('show');
      
      this._exitCropMode();
      this._fitSchemaToOnePage();
      this._render();
    }

    _fitSchemaMaxToTop() {
      const { pageSizeMm, gridCols, gridRows, cropRect } = this.state;
      
      // Use cropRect dimensions if set, otherwise full canvas
      const sourceW = cropRect ? cropRect.width : this.elements.canvas.width;
      const sourceH = cropRect ? cropRect.height : this.elements.canvas.height;
      
      const cols = gridCols || 1;
      const rows = gridRows || 1;
      
      const totalWidthMm = pageSizeMm.width * cols;
      const totalHeightMm = pageSizeMm.height * rows;
      
      const schemaWidthMm = sourceW / MM_TO_PX;
      const schemaHeightMm = sourceH / MM_TO_PX;
      
      const scaleX = totalWidthMm / schemaWidthMm;
      const scaleY = totalHeightMm / schemaHeightMm;
      const fitScale = Math.min(scaleX, scaleY) * 0.98;
      
      this.state.schemaScale = fitScale;
      
      const schemaWidthInPages = (schemaWidthMm * fitScale) / pageSizeMm.width;
      const startCol = (cols - schemaWidthInPages) / 2;
      
      this.state.schemaX = startCol;
      this.state.schemaY = 0.01;
      
      this._render();
    }

    _changeSchemaScale(factor) {
      const newScale = Math.max(0.1, Math.min(10, this.state.schemaScale * factor));
      this.state.schemaScale = newScale;
      this._render();
    }

    _changeSchemaScaleAtPoint(factor, clientX, clientY) {
      const { viewport } = this.elements;
      const rect = viewport.getBoundingClientRect();
      
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      
      const oldScale = this.state.schemaScale;
      const newScale = Math.max(0.1, Math.min(10, oldScale * factor));
      
      const scaleFactor = newScale / oldScale;
      
      const pageDisplayW = this._getPageDisplayWidth();
      const pageDisplayH = this._getPageDisplayHeight();
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const mouseOffsetX = (mouseX - centerX) / this.state.viewScale / pageDisplayW;
      const mouseOffsetY = (mouseY - centerY) / this.state.viewScale / pageDisplayH;
      
      this.state.schemaScale = newScale;
      
      this.state.schemaX -= mouseOffsetX * (1 - 1/scaleFactor);
      this.state.schemaY -= mouseOffsetY * (1 - 1/scaleFactor);
      
      this._render();
    }

    _calculateActivePages() {
      const { schemaScale, schemaX, schemaY, pageSizeMm, cropRect } = this.state;
      
      // Use cropRect dimensions if set, otherwise full canvas
      const sourceW = cropRect ? cropRect.width : this.elements.canvas.width;
      const sourceH = cropRect ? cropRect.height : this.elements.canvas.height;
      
      const schemaWidthMm = (sourceW / MM_TO_PX) * schemaScale;
      const schemaHeightMm = (sourceH / MM_TO_PX) * schemaScale;
      
      const schemaLeftPage = schemaX;
      const schemaTopPage = schemaY;
      const schemaRightPage = schemaX + schemaWidthMm / pageSizeMm.width;
      const schemaBottomPage = schemaY + schemaHeightMm / pageSizeMm.height;
      
      const startCol = Math.floor(schemaLeftPage);
      const endCol = Math.ceil(schemaRightPage) - 1;
      const startRow = Math.floor(schemaTopPage);
      const endRow = Math.ceil(schemaBottomPage) - 1;
      
      const pages = [];
      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          pages.push({ row, col });
        }
      }
      
      this.state.activePages = pages;
      this.state.gridStartCol = startCol;
      this.state.gridStartRow = startRow;
      this.state.gridCols = endCol - startCol + 1;
      this.state.gridRows = endRow - startRow + 1;
      
      return pages;
    }

    _render() {
      const { viewport, printArea, canvas, scaleDisplay, pagesIndicator, infoPages, infoSize, infoScale, footerInfo } = this.elements;
      const { schemaScale, schemaX, schemaY, pageSizeMm, cropRect } = this.state;
      
      this._calculateActivePages();
      const { activePages, gridCols, gridRows, gridStartCol, gridStartRow } = this.state;
      
      // Use cropRect dimensions if set, otherwise full canvas
      const sourceW = cropRect ? cropRect.width : canvas.width;
      const sourceH = cropRect ? cropRect.height : canvas.height;
      
      const totalPages = activePages.length;
      
      scaleDisplay.textContent = Math.round(schemaScale * 100) + '%';
      pagesIndicator.textContent = totalPages;
      infoPages.textContent = `${totalPages} (${gridCols}×${gridRows})`;
      infoSize.textContent = `${Math.round(sourceW)} × ${Math.round(sourceH)} px`;
      infoScale.textContent = Math.round(schemaScale * 100) + '%';
      footerInfo.innerHTML = `Схема будет разбита на <strong>${totalPages}</strong> страниц(ы)`;
      
      const pageDisplayW = this._getPageDisplayWidth();
      const pageDisplayH = this._getPageDisplayHeight();
      
      const gridWidth = gridCols * pageDisplayW;
      const gridHeight = gridRows * pageDisplayH;
      
      const viewportRect = viewport.getBoundingClientRect();
      const padding = 60;
      const availableW = viewportRect.width - padding * 2;
      const availableH = viewportRect.height - padding * 2;
      
      const viewScaleX = availableW / gridWidth;
      const viewScaleY = availableH / gridHeight;
      this.state.viewScale = Math.min(viewScaleX, viewScaleY, 2);
      
      const scaledGridW = gridWidth * this.state.viewScale;
      const scaledGridH = gridHeight * this.state.viewScale;
      const offsetX = (viewportRect.width - scaledGridW) / 2;
      const offsetY = (viewportRect.height - scaledGridH) / 2;
      
      printArea.innerHTML = '';
      printArea.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${this.state.viewScale})`;
      printArea.style.width = gridWidth + 'px';
      printArea.style.height = gridHeight + 'px';
      
      for (const page of activePages) {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'cp-page';
        
        const localCol = page.col - gridStartCol;
        const localRow = page.row - gridStartRow;
        
        pageDiv.style.left = (localCol * pageDisplayW) + 'px';
        pageDiv.style.top = (localRow * pageDisplayH) + 'px';
        pageDiv.style.width = pageDisplayW + 'px';
        pageDiv.style.height = pageDisplayH + 'px';
        
        const border = document.createElement('div');
        border.className = 'cp-page-border';
        pageDiv.appendChild(border);
        
        const label = document.createElement('div');
        label.className = 'cp-page-label';
        label.textContent = `${localRow + 1}-${localCol + 1}`;
        pageDiv.appendChild(label);
        
        printArea.appendChild(pageDiv);
      }
      
      const schemaContainer = document.createElement('div');
      schemaContainer.className = 'cp-schema-container';
      
      const schemaWidthMm = (sourceW / MM_TO_PX) * schemaScale;
      const schemaHeightMm = (sourceH / MM_TO_PX) * schemaScale;
      const schemaDisplayW = (schemaWidthMm / pageSizeMm.width) * pageDisplayW;
      const schemaDisplayH = (schemaHeightMm / pageSizeMm.height) * pageDisplayH;
      
      const schemaDisplayX = (schemaX - gridStartCol) * pageDisplayW;
      const schemaDisplayY = (schemaY - gridStartRow) * pageDisplayH;
      
      schemaContainer.style.left = schemaDisplayX + 'px';
      schemaContainer.style.top = schemaDisplayY + 'px';
      schemaContainer.style.width = schemaDisplayW + 'px';
      schemaContainer.style.height = schemaDisplayH + 'px';
      
      // Create canvas showing only the cropped region (or full canvas)
      const displayCanvas = document.createElement('canvas');
      displayCanvas.width = sourceW;
      displayCanvas.height = sourceH;
      const ctx = displayCanvas.getContext('2d');
      
      if (cropRect) {
        // Draw only the cropped region
        ctx.drawImage(
          this.elements.canvas,
          cropRect.x, cropRect.y, cropRect.width, cropRect.height,
          0, 0, sourceW, sourceH
        );
      } else {
        // Draw full canvas
        ctx.drawImage(this.elements.canvas, 0, 0);
      }
      
      displayCanvas.style.width = '100%';
      displayCanvas.style.height = '100%';
      schemaContainer.appendChild(displayCanvas);
      
      printArea.appendChild(schemaContainer);
    }

    _showLoading(text) {
      this.elements.loading.classList.add('show');
      this.elements.loadingText.textContent = text;
    }

    _hideLoading() {
      this.elements.loading.classList.remove('show');
    }

    _getPageCanvases() {
      const { canvas } = this.elements;
      const { schemaScale, schemaX, schemaY, pageSizeMm, activePages, gridStartCol, gridStartRow, cropRect } = this.state;
      
      const pages = [];
      
      // Use cropRect dimensions if set, otherwise full canvas
      const sourceX = cropRect ? cropRect.x : 0;
      const sourceY = cropRect ? cropRect.y : 0;
      const sourceW = cropRect ? cropRect.width : canvas.width;
      const sourceH = cropRect ? cropRect.height : canvas.height;
      
      const schemaWidthMm = (sourceW / MM_TO_PX) * schemaScale;
      const schemaHeightMm = (sourceH / MM_TO_PX) * schemaScale;
      
      const pageWidthPx = pageSizeMm.width * MM_TO_PX;
      const pageHeightPx = pageSizeMm.height * MM_TO_PX;
      
      for (const page of activePages) {
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = pageWidthPx;
        pageCanvas.height = pageHeightPx;
        
        const ctx = pageCanvas.getContext('2d');
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageWidthPx, pageHeightPx);
        
        const pageLeftMm = page.col * pageSizeMm.width;
        const pageTopMm = page.row * pageSizeMm.height;
        
        const schemaLeftMm = schemaX * pageSizeMm.width;
        const schemaTopMm = schemaY * pageSizeMm.height;
        
        const offsetXMm = schemaLeftMm - pageLeftMm;
        const offsetYMm = schemaTopMm - pageTopMm;
        
        const offsetXPx = offsetXMm * MM_TO_PX;
        const offsetYPx = offsetYMm * MM_TO_PX;
        
        const schemaOnPageW = schemaWidthMm * MM_TO_PX;
        const schemaOnPageH = schemaHeightMm * MM_TO_PX;
        
        ctx.drawImage(
          canvas,
          sourceX, sourceY, sourceW, sourceH,
          offsetXPx, offsetYPx, schemaOnPageW, schemaOnPageH
        );
        
        pages.push({
          canvas: pageCanvas,
          row: page.row - gridStartRow,
          col: page.col - gridStartCol,
          width: pageWidthPx,
          height: pageHeightPx
        });
      }
      
      return pages;
    }

    async _exportPDF() {
      this._showLoading('Создание PDF...');
      this.elements.exportDropdown.classList.remove('show');

      try {
        if (!window.jspdf) {
          await this._loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');
        }

        const { jsPDF } = window.jspdf;
        const paper = PAPER_SIZES[this.options.paperSize];
        let pageW = paper.width;
        let pageH = paper.height;

        if (this.options.orientation === 'landscape') {
          [pageW, pageH] = [pageH, pageW];
        }

        const pdf = new jsPDF({
          orientation: this.options.orientation,
          unit: 'mm',
          format: [pageW, pageH]
        });

        const pages = this._getPageCanvases();
        const margin = this.options.margins;

        for (let i = 0; i < pages.length; i++) {
          this.elements.loadingText.textContent = `Страница ${i + 1} из ${pages.length}...`;

          if (i > 0) {
            pdf.addPage([pageW, pageH], this.options.orientation);
          }

          const page = pages[i];
          
          const scaleFactor = this.options.dpi / 96;
          const scaledCanvas = document.createElement('canvas');
          scaledCanvas.width = page.width * scaleFactor;
          scaledCanvas.height = page.height * scaleFactor;
          const ctx = scaledCanvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
          ctx.drawImage(page.canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

          const imgData = scaledCanvas.toDataURL('image/jpeg', 0.95);
          pdf.addImage(imgData, 'JPEG', margin, margin, pageW - margin * 2, pageH - margin * 2);
        }

        pdf.save('schema.pdf');
      } catch (error) {
        console.error('PDF export error:', error);
        alert('Ошибка при создании PDF: ' + error.message);
      } finally {
        this._hideLoading();
      }
    }

    async _exportImages(format) {
      this._showLoading(`Создание ${format.toUpperCase()}...`);
      this.elements.exportDropdown.classList.remove('show');

      try {
        const pages = this._getPageCanvases();
        const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;

        for (let i = 0; i < pages.length; i++) {
          this.elements.loadingText.textContent = `Изображение ${i + 1} из ${pages.length}...`;

          const page = pages[i];
          const blob = await new Promise(resolve => page.canvas.toBlob(resolve, mimeType, 0.95));
          
          const link = document.createElement('a');
          link.download = `schema_${page.row + 1}-${page.col + 1}.${format}`;
          link.href = URL.createObjectURL(blob);
          link.click();
          URL.revokeObjectURL(link.href);

          if (pages.length > 1) {
            await new Promise(r => setTimeout(r, 300));
          }
        }
      } catch (error) {
        console.error('Image export error:', error);
        alert('Ошибка при создании изображений: ' + error.message);
      } finally {
        this._hideLoading();
      }
    }

    async _exportSingleImage() {
      this._showLoading('Создание PNG...');
      this.elements.exportDropdown.classList.remove('show');

      try {
        const { cropRect } = this.state;
        let exportCanvas;
        
        if (cropRect) {
          // Export only cropped region
          exportCanvas = document.createElement('canvas');
          exportCanvas.width = cropRect.width;
          exportCanvas.height = cropRect.height;
          const ctx = exportCanvas.getContext('2d');
          ctx.drawImage(
            this.elements.canvas,
            cropRect.x, cropRect.y, cropRect.width, cropRect.height,
            0, 0, cropRect.width, cropRect.height
          );
        } else {
          exportCanvas = this.elements.canvas;
        }
        
        const blob = await new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'));
        
        const link = document.createElement('a');
        link.download = 'schema.png';
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
      } catch (error) {
        console.error('Image export error:', error);
        alert('Ошибка при создании изображения: ' + error.message);
      } finally {
        this._hideLoading();
      }
    }

    async _print() {
      this._showLoading('Подготовка к печати...');

      try {
        const pages = this._getPageCanvases();
        const paper = PAPER_SIZES[this.options.paperSize];
        let pageW = paper.width;
        let pageH = paper.height;

        if (this.options.orientation === 'landscape') {
          [pageW, pageH] = [pageH, pageW];
        }

        const printContainer = document.createElement('div');
        printContainer.id = 'cp-print-container';
        printContainer.style.cssText = 'display: none;';

        const printStyle = document.createElement('style');
        printStyle.textContent = `
          @media print {
            body > *:not(#cp-print-container) { display: none !important; }
            #cp-print-container { display: block !important; }
            @page { 
              size: ${pageW}mm ${pageH}mm; 
              margin: ${this.options.margins}mm; 
            }
            .cp-print-page {
              page-break-after: always;
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .cp-print-page:last-child { page-break-after: auto; }
            .cp-print-page canvas {
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
            }
          }
        `;

        for (const page of pages) {
          const pageDiv = document.createElement('div');
          pageDiv.className = 'cp-print-page';
          pageDiv.appendChild(page.canvas);
          printContainer.appendChild(pageDiv);
        }

        document.head.appendChild(printStyle);
        document.body.appendChild(printContainer);

        await new Promise(r => setTimeout(r, 100));

        this._hideLoading();
        window.print();

        setTimeout(() => {
          printContainer.remove();
          printStyle.remove();
        }, 1000);

      } catch (error) {
        console.error('Print error:', error);
        alert('Ошибка при печати: ' + error.message);
        this._hideLoading();
      }
    }

    _loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
  }

  global.CanvasPrint = CanvasPrint;

})(typeof window !== 'undefined' ? window : this);

