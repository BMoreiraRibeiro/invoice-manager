(() => {
  "use strict";

  const pages = ["dashboard", "capture", "history", "export"];
  const database = { name: "invoice-manager", version: 1, store: "invoices" };
  let invoices = [];
  let selectedImage = null;
  let ocrInProgress = false;
  let previewZoom = 1;
  let viewerZoom = 1;
  let viewerPan = { x: 0, y: 0 };

  const $ = selector => document.querySelector(selector);
  const money = value => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
  const displayDate = value => { const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || ""); };
  const inputDate = value => { const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || ""); };
  const parseMoney = value => { const text = String(value || "").replace(/\s/g, ""); if (text.includes(",")) return Number(text.replace(/\./g, "").replace(",", ".")) || 0; const parts = text.split("."); return Number(parts.length > 2 ? parts.join("") : text) || 0; };
  const normalizeInvoiceNumber = value => String(value || "").toUpperCase().replace(/[^A-Z0-9./ -]/g, "").replace(/\s+/g, " ").trim();
  const documentNumberPattern = /^(FT|FR|FS|NC|ND|RC)\s*[A-Z0-9./ -]*\d[A-Z0-9./ -]*$/i;
  const escapeXml = value => String(value ?? "").replace(/[<>&'\"]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char]));

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(database.name, database.version);
      request.onupgradeneeded = () => request.result.createObjectStore(database.store, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getInvoices() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(database.store, "readonly").objectStore(database.store).getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => String(b.date).localeCompare(String(a.date))));
      request.onerror = () => reject(request.error);
    });
  }

  async function saveInvoice(invoice) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(database.store, "readwrite").objectStore(database.store).put(invoice);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteInvoice(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(database.store, "readwrite").objectStore(database.store).delete(id);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }

  function showPage(name) {
    if (!pages.includes(name)) return;
    document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === `page-${name}`));
    document.querySelectorAll("[data-page]").forEach(button => button.classList.toggle("active", button.dataset.page === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
    history.replaceState(null, "", `#${name}`);
    if (name === "history") renderHistory();
    if (name === "export") updateExport();
  }

  function updateDashboard() {
    const total = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const vat = invoices.reduce((sum, invoice) => sum + invoice.vat, 0);
    const month = new Date().toISOString().slice(0, 7);
    $("#stat-count").textContent = invoices.length;
    $("#stat-total").textContent = money(total);
    $("#stat-vat").textContent = money(vat);
    $("#stat-month").textContent = invoices.filter(invoice => invoice.date.startsWith(month)).length;
    const empty = $("#page-dashboard .empty-state");
    if (invoices.length) {
      empty.innerHTML = `<div class="recent-list">${invoices.slice(0, 5).map(invoice => `<div class="recent-row"><span><strong>${escapeXml(invoice.supplier)}</strong><small>${escapeXml(displayDate(invoice.date))} · ${escapeXml(invoice.number || "Sem número")}</small></span><strong>${money(invoice.total)}</strong></div>`).join("")}</div>`;
    } else {
      empty.innerHTML = '<div class="empty-icon">▤</div><h3>Ainda não existem faturas</h3><p>Quando começares a registar faturas, encontrarás aqui um resumo da tua atividade.</p><button class="secondary-button" data-page="capture">Registar primeira fatura</button>';
      empty.querySelector("[data-page]").addEventListener("click", () => showPage("capture"));
    }
  }

  function renderHistory() {
    const query = $("#history-search").value.trim().toLocaleLowerCase("pt-PT");
    const visible = invoices.filter(invoice => [invoice.supplier, invoice.vatNumber, invoice.number].some(value => String(value || "").toLocaleLowerCase("pt-PT").includes(query)));
    const list = $("#history-list");
    if (!visible.length) {
      list.innerHTML = '<div class="empty-state compact"><div class="empty-icon">▤</div><h3>Sem faturas para apresentar</h3><p>As faturas guardadas aparecerão aqui.</p></div>';
      return;
    }
    list.innerHTML = visible.map(invoice => `<article class="invoice-row"><div class="invoice-main"><strong>${escapeXml(invoice.supplier)}</strong><span>${escapeXml(displayDate(invoice.date))} · ${escapeXml(invoice.number || "Sem número")}</span><small>NIF ${escapeXml(invoice.vatNumber || "não indicado")} · IVA ${money(invoice.vat)}</small></div><strong class="invoice-total">${money(invoice.total)}</strong><div class="invoice-actions"><label class="select-invoice"><input type="checkbox" data-select-invoice="${invoice.id}"> Exportar</label><button class="icon-button" data-edit-invoice="${invoice.id}" title="Editar">✎</button><button class="icon-button danger" data-delete-invoice="${invoice.id}" title="Eliminar">×</button></div></article>`).join("");
    list.querySelectorAll("[data-edit-invoice]").forEach(button => button.addEventListener("click", () => editInvoice(button.dataset.editInvoice)));
    list.querySelectorAll("[data-delete-invoice]").forEach(button => button.addEventListener("click", async () => { if (confirm("Eliminar esta fatura?")) { await deleteInvoice(button.dataset.deleteInvoice); await refresh(); } }));
  }

  function updateSupplierSuggestions(query = "") {
    const suggestions = $("#supplier-suggestions");
    if (!suggestions) return;
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-PT");
    const unique = new Map();
    invoices.forEach(invoice => {
      const supplier = String(invoice.supplier || "").trim();
      if (supplier && !unique.has(supplier.toLocaleLowerCase("pt-PT"))) unique.set(supplier.toLocaleLowerCase("pt-PT"), { name: supplier, vatNumber: invoice.vatNumber });
    });
    suggestions.innerHTML = [...unique.values()].filter(item => !normalizedQuery || `${item.name} ${item.vatNumber || ""}`.toLocaleLowerCase("pt-PT").includes(normalizedQuery)).sort((a, b) => a.name.localeCompare(b.name, "pt-PT")).map(item => `<option value="${escapeXml(item.name)}"${item.vatNumber ? ` label="NIF ${escapeXml(item.vatNumber)}"` : ""}></option>`).join("");
  }

  function fillForm(invoice) {
    $("#invoice-id").value = invoice?.id || "";
    $("#invoice-number").value = invoice?.number || "";
    $("#invoice-date").value = invoice?.date || new Date().toISOString().slice(0, 10);
    $("#invoice-supplier").value = invoice?.supplier || "";
    $("#invoice-vat-number").value = invoice?.vatNumber || "";
    $("#invoice-subtotal").value = invoice ? String(invoice.subtotal).replace(".", ",") : "";
    $("#invoice-vat").value = invoice ? String(invoice.vat).replace(".", ",") : "";
    $("#invoice-total").value = invoice ? String(invoice.total).replace(".", ",") : "";
    if (invoice?.image instanceof Blob) {
      $("#image-preview").src = URL.createObjectURL(invoice.image);
      $("#image-preview-wrap").classList.remove("hidden");
    }
  }

  function editInvoice(id) {
    const invoice = invoices.find(item => item.id === id);
    if (!invoice) return;
    fillForm(invoice);
    selectedImage = invoice.image || null;
    showPage("capture");
  }

  function setOcrStatus(message, state = "") {
    const status = $("#ocr-status");
    status.textContent = message;
    status.className = `ocr-status${state ? ` is-${state}` : ""}`;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(image.src); resolve(image); };
      image.onerror = reject;
      image.src = URL.createObjectURL(file);
    });
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível preparar a imagem.")), "image/jpeg", 0.9));
  }

  async function cropDocument(file) {
    const image = await loadImage(file);
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const sample = (x, y) => { const index = (y * canvas.width + x) * 4; return [pixels[index], pixels[index + 1], pixels[index + 2]]; };
    const corners = [sample(2, 2), sample(canvas.width - 3, 2), sample(2, canvas.height - 3), sample(canvas.width - 3, canvas.height - 3)];
    const background = corners.reduce((sum, color) => sum.map((value, index) => value + color[index]), [0, 0, 0]).map(value => value / corners.length);
    const distance = (x, y) => { const index = (y * canvas.width + x) * 4; return Math.abs(pixels[index] - background[0]) + Math.abs(pixels[index + 1] - background[1]) + Math.abs(pixels[index + 2] - background[2]); };
    let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
    for (let y = 0; y < canvas.height; y += 4) for (let x = 0; x < canvas.width; x += 4) if (distance(x, y) > 42) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    const width = right - left; const height = bottom - top;
    if (width > canvas.width * 0.55 && height > canvas.height * 0.55) {
      const padding = Math.round(Math.min(canvas.width, canvas.height) * 0.025);
      const cropped = document.createElement("canvas");
      const cropLeft = Math.max(0, left - padding); const cropTop = Math.max(0, top - padding); const cropRight = Math.min(canvas.width, right + padding); const cropBottom = Math.min(canvas.height, bottom + padding);
      cropped.width = cropRight - cropLeft; cropped.height = cropBottom - cropTop;
      cropped.getContext("2d").drawImage(canvas, cropLeft, cropTop, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
      return canvasBlob(cropped);
    }
    return canvasBlob(canvas);
  }

  function findMoney(line) {
    const matches = line.match(/\b\d{1,3}(?:[. ]\d{3})*(?:,\d{2})\b|\b\d+(?:[.,]\d{2})\b/g);
    return matches?.map(parseMoney).filter(value => value > 0) || [];
  }

  function parseOcrText(text) {
    const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const upper = lines.map(line => line.toLocaleUpperCase("pt-PT"));
    const result = {};
    const dateMatch = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
    if (dateMatch) result.date = `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`;
    const nifMatch = text.match(/(?:NIF|CONTRIBUINTE|CONTRIB)\D{0,15}(\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d)/i);
    if (nifMatch) result.vatNumber = nifMatch[1].replace(/\D/g, "");
    const numberMatch = text.match(/\b(FT|FR|FS|NC|ND|RC)\s*[:#./-]?\s*([A-Z0-9][A-Z0-9 ./-]*\d[A-Z0-9 ./-]*)\b/i);
    if (numberMatch) result.number = `${numberMatch[1].toUpperCase()} ${numberMatch[2]}`.replace(/\s+/g, " ").trim();
    const totalIndex = upper.findIndex(line => /TOTAL(?: A PAGAR| ILÍQUIDO| LÍQUIDO)?|VALOR A PAGAR/.test(line));
    const vatIndex = upper.findIndex(line => /\bIVA\b|IMPOSTO/.test(line));
    const subtotalIndex = upper.findIndex(line => /BASE TRIBUT|SUBTOTAL|INCIDÊNCIA/.test(line));
    if (totalIndex >= 0) result.total = findMoney(lines[totalIndex])[0] || findMoney(lines[Math.min(totalIndex + 1, lines.length - 1)])[0] || 0;
    if (vatIndex >= 0) result.vat = findMoney(lines[vatIndex])[0] || findMoney(lines[Math.min(vatIndex + 1, lines.length - 1)])[0] || 0;
    if (subtotalIndex >= 0) result.subtotal = findMoney(lines[subtotalIndex])[0] || findMoney(lines[Math.min(subtotalIndex + 1, lines.length - 1)])[0] || 0;
    const supplier = lines.slice(0, Math.max(1, Math.min(5, lines.length))).find(line => !/FATURA|RECIBO|NIF|CONTRIB|TOTAL|IVA|DATA|TAXA|PÁGINA/i.test(line) && /[A-Za-zÀ-ÿ]{3}/.test(line));
    if (supplier) result.supplier = supplier;
    return result;
  }

  function parseQrPayload(payload) {
    const fields = {};
    String(payload).split(/[\r\n;*]+/).map(part => part.trim()).filter(Boolean).forEach(part => {
      const match = part.match(/^([A-Z](?:\d)?)\s*[:=]\s*(.+)$/i);
      if (match) fields[match[1].toUpperCase()] = match[2].trim();
    });
    const result = {};
    if (fields.A && /^\d{9}$/.test(fields.A.replace(/\D/g, ""))) result.vatNumber = fields.A.replace(/\D/g, "");
    if (fields.F) {
      const date = fields.F.match(/^(\d{4})(\d{2})(\d{2})$/) || fields.F.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})$/);
      if (date) result.date = `${date[1]}-${date[2]}-${date[3]}`;
    }
    const qrNumber = fields.G?.match(/\b(FT|FR|FS|NC|ND|RC)\s*[:#./-]?\s*([A-Z0-9][A-Z0-9 ./-]*\d[A-Z0-9 ./-]*)\b/i);
    if (qrNumber) result.number = `${qrNumber[1].toUpperCase()} ${qrNumber[2]}`.replace(/\s+/g, " ").trim();
    if (fields.N) result.vat = parseMoney(fields.N);
    if (fields.O) result.total = parseMoney(fields.O);
    const bases = Object.entries(fields).filter(([key]) => /^I[2-8]$/.test(key) && !["I4", "I6", "I8"].includes(key)).map(([, value]) => parseMoney(value)).filter(value => value > 0);
    if (bases.length) result.subtotal = bases.reduce((sum, value) => sum + value, 0);
    return { fields: result, raw: payload };
  }

  async function readQr(file) {
    const image = await loadImage(file);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if ("BarcodeDetector" in window) {
      try {
        const detector = new BarcodeDetector({ formats: ["qr_code"] });
        const codes = await detector.detect(canvas);
        if (codes[0]?.rawValue) return parseQrPayload(codes[0].rawValue);
      } catch (error) {
        console.warn("BarcodeDetector indisponível:", error);
      }
    }
    if (window.jsQR) {
      const code = window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
      if (code?.data) return parseQrPayload(code.data);
    }
    return null;
  }

  async function tryQr(file) {
    setOcrStatus("A procurar o código QR…");
    const qr = await readQr(file);
    if (!qr) return null;
    setOcrStatus(`Código QR lido: ${Object.keys(qr.fields).length} campo${Object.keys(qr.fields).length === 1 ? "" : "s"}. Confirma e completa o fornecedor.`, "success");
    return qr.fields;
  }

  function applyOcrFields(fields, lockedFields = {}) {
    const ids = { number: "invoice-number", date: "invoice-date", supplier: "invoice-supplier", vatNumber: "invoice-vat-number", subtotal: "invoice-subtotal", vat: "invoice-vat", total: "invoice-total" };
    for (const [field, value] of Object.entries(fields)) if (value && ids[field] && !lockedFields[field]) $(`#${ids[field]}`).value = typeof value === "number" ? String(value).replace(".", ",") : value;
    const found = Object.keys({ ...fields, ...lockedFields }).filter(field => fields[field] || lockedFields[field]).length;
    setOcrStatus(found ? `Reconhecimento concluído: ${found} campo${found === 1 ? "" : "s"} preenchido${found === 1 ? "" : "s"}. Confirma e corrige os dados.` : "Não foi possível reconhecer campos com confiança. Preenche-os manualmente.", found ? "success" : "");
  }

  async function processImage(file) {
    if (!file || ocrInProgress) return;
    ocrInProgress = true;
    setOcrStatus("A procurar dados fiscais no código QR…");
    try {
      let qrFields = {};
      try { qrFields = await tryQr(file) || {}; } catch (error) { console.warn("Leitura QR falhou:", error); }
      if (Object.keys(qrFields).length) applyOcrFields(qrFields);
      selectedImage = await cropDocument(file);
      $("#image-preview").src = URL.createObjectURL(selectedImage);
      $("#image-preview-wrap").classList.remove("hidden");
      if (!window.Tesseract) throw new Error("OCR indisponível: abre a aplicação com ligação à Internet uma vez para carregar o motor.");
      setOcrStatus(Object.keys(qrFields).length ? "QR lido. A procurar apenas os dados em falta no texto…" : "A reconhecer o texto da fatura…");
      const worker = await window.Tesseract.createWorker("por", 1, { logger: message => { if (message.status === "recognizing text") setOcrStatus(`A reconhecer o texto… ${Math.round((message.progress || 0) * 100)}%`); } });
      const result = await worker.recognize(selectedImage);
      await worker.terminate();
      applyOcrFields(parseOcrText(result.data.text), qrFields);
    } catch (error) {
      console.error("OCR da fatura falhou:", error);
      setOcrStatus(error.message || "Não foi possível ler a imagem. Preenche os dados manualmente.", "error");
    } finally {
      ocrInProgress = false;
    }
  }

  function readFile(file) {
    if (!file) return;
    processImage(file);
  }

  function setPreviewZoom(value) {
    previewZoom = Math.min(3, Math.max(1, value));
    $("#image-preview").style.transform = `scale(${previewZoom})`;
  }

  function updateViewerImage() {
    $("#image-viewer-image").style.transform = `translate3d(${viewerPan.x}px, ${viewerPan.y}px, 0) scale(${viewerZoom})`;
  }

  function openImageViewer() {
    if (!selectedImage && !$("#image-preview").src) return;
    $("#image-viewer-image").src = $("#image-preview").src;
    viewerZoom = 1;
    viewerPan = { x: 0, y: 0 };
    updateViewerImage();
    $("#image-viewer").classList.remove("hidden");
  }

  function closeImageViewer() {
    $("#image-viewer").classList.add("hidden");
  }

  function changeViewerZoom(value) {
    viewerZoom = Math.min(4, Math.max(1, value));
    if (viewerZoom === 1) viewerPan = { x: 0, y: 0 };
    updateViewerImage();
  }

  function enableViewerPan() {
    const viewport = $("#image-viewer-viewport");
    let dragging = false;
    let start = { x: 0, y: 0 };
    viewport.addEventListener("pointerdown", event => { if (viewerZoom <= 1) return; dragging = true; start = { x: event.clientX - viewerPan.x, y: event.clientY - viewerPan.y }; viewport.classList.add("is-dragging"); viewport.setPointerCapture(event.pointerId); });
    viewport.addEventListener("pointermove", event => { if (!dragging) return; viewerPan = { x: event.clientX - start.x, y: event.clientY - start.y }; updateViewerImage(); });
    viewport.addEventListener("pointerup", () => { dragging = false; viewport.classList.remove("is-dragging"); });
    viewport.addEventListener("pointercancel", () => { dragging = false; viewport.classList.remove("is-dragging"); });
  }

  async function readQrFile(file) {
    if (!file || ocrInProgress) return;
    ocrInProgress = true;
    try {
      const fields = await tryQr(file);
      if (fields) { applyOcrFields(fields); selectedImage = file; $("#image-preview").src = URL.createObjectURL(file); $("#image-preview-wrap").classList.remove("hidden"); }
      else setOcrStatus("Não foi encontrado um código QR legível. Fotografa o QR de frente e com boa luz.", "error");
    } catch (error) {
      setOcrStatus(error.message || "Não foi possível ler o código QR.", "error");
    } finally {
      ocrInProgress = false;
    }
  }

  function formInvoice() {
    return { id: $("#invoice-id").value || crypto.randomUUID(), number: normalizeInvoiceNumber($("#invoice-number").value), date: $("#invoice-date").value, supplier: $("#invoice-supplier").value.trim(), vatNumber: $("#invoice-vat-number").value.trim(), subtotal: parseMoney($("#invoice-subtotal").value), vat: parseMoney($("#invoice-vat").value), total: parseMoney($("#invoice-total").value), image: selectedImage || null, updatedAt: new Date().toISOString() };
  }

  function validateInvoice(invoice) {
    if (!invoice.date || !invoice.supplier || !invoice.total) return "Preenche a data, o fornecedor e o total.";
    if (invoice.number && !documentNumberPattern.test(invoice.number)) return "O número deve começar por FT, FR, FS, NC, ND ou RC e conter algarismos.";
    if (invoice.vatNumber && !/^\d{9}$/.test(invoice.vatNumber)) return "O NIF deve ter 9 algarismos.";
    if (invoice.subtotal && invoice.vat && Math.abs(invoice.subtotal + invoice.vat - invoice.total) > 0.03) return "A base tributável + IVA não coincide com o total.";
    return "";
  }

  function updateExport() {
    const mode = $("#export-mode").value;
    $("#export-start-wrap").classList.toggle("hidden", mode !== "dates");
    $("#export-end-wrap").classList.toggle("hidden", mode !== "dates");
    $("#export-supplier-wrap").classList.toggle("hidden", mode !== "supplier");
    const suppliers = [...new Map(invoices.map(invoice => [invoice.vatNumber || invoice.supplier, invoice])).values()];
    $("#export-supplier").innerHTML = '<option value="">Escolher fornecedor</option>' + suppliers.map(invoice => `<option value="${escapeXml(invoice.vatNumber || invoice.supplier)}">${escapeXml(invoice.supplier)}${invoice.vatNumber ? ` · ${escapeXml(invoice.vatNumber)}` : ""}</option>`).join("");
    const selected = currentExportInvoices();
    $("#export-summary").textContent = `${selected.length} fatura${selected.length === 1 ? "" : "s"} · ${money(selected.reduce((sum, invoice) => sum + invoice.total, 0))}`;
  }

  function currentExportInvoices() {
    const mode = $("#export-mode").value;
    if (mode === "selected") return invoices.filter(invoice => document.querySelector(`[data-select-invoice="${invoice.id}"]`)?.checked);
    if (mode === "dates") return invoices.filter(invoice => (!$("#export-start").value || invoice.date >= inputDate($("#export-start").value)) && (!$("#export-end").value || invoice.date <= inputDate($("#export-end").value)));
    if (mode === "supplier") { const key = $("#export-supplier").value; return key ? invoices.filter(invoice => (invoice.vatNumber || invoice.supplier) === key) : []; }
    return invoices;
  }

  function safeFilename(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "Filtro";
  }

  function exportFilename() {
    const mode = $("#export-mode").value;
    const today = displayDate(new Date().toISOString().slice(0, 10)).replaceAll("/", "-");
    if (mode === "dates") {
      const start = safeFilename($("#export-start").value || "Sem-inicio");
      const end = safeFilename($("#export-end").value || "Sem-fim");
      return `Faturas-${start}-a-${end}.xlsx`;
    }
    if (mode === "supplier") return `Faturas-${safeFilename($("#export-supplier").selectedOptions[0]?.textContent || "Fornecedor")}.xlsx`;
    if (mode === "selected") return `Faturas-Selecionadas-${today}.xlsx`;
    return `Faturas-Todas-${today}.xlsx`;
  }

  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) { crc ^= byte; for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ -1) >>> 0;
  }

  function zip(files) {
    const encoder = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
    const u16 = value => [value & 255, value >>> 8]; const u32 = value => [value & 255, value >>> 8, value >>> 16, value >>> 24];
    files.forEach(file => { const name = encoder.encode(file.name); const data = encoder.encode(file.data); const crc = crc32(data); const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name, ...data]); chunks.push(local); central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name])); offset += local.length; });
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(central.reduce((sum, item) => sum + item.length, 0)), ...u32(offset), ...u16(0)]);
    return new Blob([...chunks, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function exportXlsx() {
    const rows = currentExportInvoices();
    if (!rows.length) return alert("Não existem faturas para exportar com estes critérios.");
    const header = ["Número da fatura", "Data", "Fornecedor", "NIF", "Base tributável", "IVA", "Total"];
    const values = [header, ...rows.map(invoice => [invoice.number, displayDate(invoice.date), invoice.supplier, invoice.vatNumber, invoice.subtotal.toFixed(2), invoice.vat.toFixed(2), invoice.total.toFixed(2)]), ["", "", "", "", "", "Total", rows.reduce((sum, invoice) => sum + invoice.total, 0).toFixed(2)]];
    const sheetRows = values.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, cellIndex) => `<c r="${String.fromCharCode(65 + cellIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`).join("")}</row>`).join("");
    const files = [{ name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' }, { name: "_rels/.rels", data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' }, { name: "xl/workbook.xml", data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Faturas" sheetId="1" r:id="rId1"/></sheets></workbook>' }, { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' }, { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:G${values.length - 1}"/></worksheet>` }];
    const url = URL.createObjectURL(zip(files)); const link = document.createElement("a"); link.href = url; link.download = exportFilename(); document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  async function refresh() { invoices = await getInvoices(); updateDashboard(); renderHistory(); updateExport(); updateSupplierSuggestions(); }

  document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
  $("#invoice-camera").addEventListener("change", event => readFile(event.target.files[0]));
  $("#invoice-image").addEventListener("change", event => readFile(event.target.files[0]));
  $("#invoice-qr").addEventListener("change", event => readQrFile(event.target.files[0]));
  $("#open-image-viewer").addEventListener("click", openImageViewer);
  $("#close-image-viewer").addEventListener("click", closeImageViewer);
  $("[data-close-viewer]").addEventListener("click", closeImageViewer);
  $("#viewer-zoom-out").addEventListener("click", () => changeViewerZoom(viewerZoom - 0.25));
  $("#viewer-zoom-reset").addEventListener("click", () => changeViewerZoom(1));
  $("#viewer-zoom-in").addEventListener("click", () => changeViewerZoom(viewerZoom + 0.25));
  enableViewerPan();
  $("#invoice-number").addEventListener("input", event => { event.target.value = normalizeInvoiceNumber(event.target.value); });
  $("#invoice-supplier").addEventListener("input", event => updateSupplierSuggestions(event.target.value));
  $("#remove-image").addEventListener("click", () => { selectedImage = null; previewZoom = 1; viewerZoom = 1; viewerPan = { x: 0, y: 0 }; $("#image-preview").removeAttribute("src"); $("#image-preview-wrap").classList.add("hidden"); closeImageViewer(); });
  $("#clear-form").addEventListener("click", () => { $("#invoice-form").reset(); $("#invoice-id").value = ""; selectedImage = null; $("#image-preview-wrap").classList.add("hidden"); $("#form-error").textContent = ""; });
  $("#invoice-form").addEventListener("submit", async event => { event.preventDefault(); const invoice = formInvoice(); const error = validateInvoice(invoice); $("#form-error").textContent = error; if (error) return; await saveInvoice(invoice); await refresh(); $("#clear-form").click(); showPage("history"); });
  $("#history-search").addEventListener("input", renderHistory); $("#history-clear").addEventListener("click", () => { $("#history-search").value = ""; renderHistory(); });
  ["#export-mode", "#export-start", "#export-end", "#export-supplier"].forEach(selector => $(selector).addEventListener("change", updateExport));
  ["#export-start", "#export-end"].forEach(selector => $(selector).addEventListener("blur", event => { if (event.target.value && !/^\d{2}\/\d{2}\/\d{4}$/.test(event.target.value)) event.target.setCustomValidity("Usa o formato dia/mês/ano: dd/mm/aaaa."); else event.target.setCustomValidity(""); }));
  $("#export-button").addEventListener("click", exportXlsx);

  const themeButton = $("#theme-toggle"); const savedTheme = localStorage.getItem("invoice-theme"); if (savedTheme === "dark") document.documentElement.dataset.theme = "dark";
  themeButton?.addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; if (next === "dark") document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme; localStorage.setItem("invoice-theme", next); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(console.error));
  const initialPage = location.hash.replace("#", ""); showPage(pages.includes(initialPage) ? initialPage : "dashboard");
  refresh().catch(error => { console.error(error); $("#storage-note").textContent = "Não foi possível abrir o armazenamento local"; });
})();
