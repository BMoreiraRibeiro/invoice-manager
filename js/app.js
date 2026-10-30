(() => {
  "use strict";

  const pages = ["dashboard", "capture", "history", "export"];
  const NO_NIF = "999999990"; // "consumidor final": fatura sem NIF do cliente
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
  const normalizeSearch = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-PT").trim();
  const parseMoney = value => { const text = String(value || "").replace(/\s/g, ""); if (text.includes(",")) return Number(text.replace(/\./g, "").replace(",", ".")) || 0; const parts = text.split("."); return Number(parts.length > 2 ? parts.join("") : text) || 0; };
  const normalizeInvoiceNumber = value => String(value || "").toUpperCase().replace(/[^A-Z0-9./ -]/g, "").replace(/\s+/g, " ").trim();
  const documentNumberPattern = /^(FT|FR|FS|NC|ND|RC)\s*[A-Z0-9./ -]*\d[A-Z0-9./ -]*$/i;
  const escapeXml = value => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[<>&'\"]/g,char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char]));

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
  }

  function renderHistory() {
    const query = normalizeSearch($("#history-search").value);
    const visible = invoices.filter(invoice => [invoice.supplier, invoice.vatNumber, invoice.ownVatNumber, invoice.number, invoice.notes, displayDate(invoice.date)].some(value => normalizeSearch(value).includes(query)));
    const list = $("#history-list");
    if (!visible.length) {
      list.innerHTML = '<div class="empty-state compact"><div class="empty-icon">▤</div><h3>Sem faturas para apresentar</h3><p>As faturas guardadas aparecerão aqui.</p></div>';
      return;
    }
    list.innerHTML = visible.map(invoice => `<article class="invoice-row"><div class="invoice-main"><strong>${escapeXml(invoice.supplier)}</strong>${invoice.notes ? `<small class="invoice-notes">${escapeXml(invoice.notes)}</small>` : ""}</div><time class="invoice-date" datetime="${escapeXml(invoice.date)}">${escapeXml(displayDate(invoice.date))}</time><strong class="invoice-total">${money(invoice.total)}</strong><div class="invoice-actions history-actions"><button class="icon-button" data-edit-invoice="${invoice.id}" title="Editar" aria-label="Editar fatura">✎</button><button class="icon-button danger" data-delete-invoice="${invoice.id}" title="Eliminar" aria-label="Eliminar fatura">×</button></div></article>`).join("");
    list.querySelectorAll("[data-edit-invoice]").forEach(button => button.addEventListener("click", () => editInvoice(button.dataset.editInvoice)));
    list.querySelectorAll("[data-delete-invoice]").forEach(button => button.addEventListener("click", async () => { if (confirm("Eliminar esta fatura?")) { await deleteInvoice(button.dataset.deleteInvoice); await refresh(); } }));
  }

  // Lista de pesquisa de fornecedores (substitui o <datalist>, que se comporta mal nos telemóveis).
  let supplierMatches = [];
  let supplierActive = -1;

  function supplierOptions() {
    const options = new Map();
    invoices.forEach(invoice => {
      const name = String(invoice.supplier || "").trim();
      if (!name) return;
      const vatNumber = String(invoice.vatNumber || "").trim();
      const key = `${normalizeSearch(name)}|${vatNumber}`;
      const option = options.get(key) || { name, vatNumber, count: 0 };
      option.count += 1;
      options.set(key, option);
    });
    return [...options.values()];
  }

  function closeSupplierList() {
    const list = $("#supplier-suggestions");
    if (!list) return;
    list.classList.add("hidden");
    $("#invoice-supplier").setAttribute("aria-expanded", "false");
    $("#invoice-supplier").removeAttribute("aria-activedescendant");
    supplierActive = -1;
  }

  function setSupplierActive(index) {
    const options = [...$("#supplier-suggestions").children];
    if (!options.length) return;
    supplierActive = (index + options.length) % options.length;
    options.forEach((option, position) => { option.classList.toggle("is-active", position === supplierActive); option.setAttribute("aria-selected", position === supplierActive ? "true" : "false"); });
    $("#invoice-supplier").setAttribute("aria-activedescendant", options[supplierActive].id);
    options[supplierActive].scrollIntoView?.({ block: "nearest" });
  }

  function updateSupplierSuggestions() {
    const list = $("#supplier-suggestions");
    const input = $("#invoice-supplier");
    if (!list || !input) return;
    if (document.activeElement !== input) return closeSupplierList();
    const query = normalizeSearch(input.value);
    const digits = query.replace(/\D/g, "");
    const startsWith = option => (query && normalizeSearch(option.name).startsWith(query) ? 0 : 1);
    supplierMatches = supplierOptions()
      .filter(option => !query || normalizeSearch(option.name).includes(query) || (digits && option.vatNumber.includes(digits)))
      .sort((a, b) => startsWith(a) - startsWith(b) || b.count - a.count || a.name.localeCompare(b.name, "pt-PT"))
      .slice(0, 30);
    // Sem resultados, ou já escrito por inteiro e é a única opção: não há nada a sugerir.
    if (!supplierMatches.length || (supplierMatches.length === 1 && normalizeSearch(supplierMatches[0].name) === query)) return closeSupplierList();
    list.innerHTML = supplierMatches.map((option, index) => `<span class="supplier-option" role="option" id="supplier-option-${index}" data-index="${index}" aria-selected="false"><strong>${escapeXml(option.name)}</strong><small>${option.vatNumber ? `NIF ${escapeXml(option.vatNumber)} · ` : ""}${option.count} fatura${option.count === 1 ? "" : "s"}</small></span>`).join("");
    supplierActive = -1;
    // Abre para baixo; se não houver espaço (teclado aberto), abre para cima.
    const rect = input.getBoundingClientRect();
    const viewport = window.visualViewport?.height || window.innerHeight;
    const below = viewport - rect.bottom;
    const up = below < 190 && rect.top > below;
    list.classList.toggle("is-up", up);
    list.style.maxHeight = `${Math.max(120, Math.min(280, (up ? rect.top : below) - 16))}px`;
    list.scrollTop = 0;
    list.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  }

  function chooseSupplier(index) {
    const option = supplierMatches[index];
    if (!option) return;
    $("#invoice-supplier").value = option.name;
    if (option.vatNumber) $("#invoice-vat-number").value = option.vatNumber;
    closeSupplierList();
    // No telemóvel, fecha o teclado para o formulário ficar visível.
    if (window.matchMedia?.("(pointer: coarse)").matches) $("#invoice-supplier").blur();
  }

  function fillForm(invoice) {
    $("#invoice-id").value = invoice?.id || "";
    $("#invoice-number").value = invoice?.number || "";
    $("#invoice-date").value = invoice?.date || new Date().toISOString().slice(0, 10);
    $("#invoice-supplier").value = invoice?.supplier || "";
    $("#invoice-vat-number").value = invoice?.vatNumber || "";
    $("#invoice-own-vat-number").value = invoice?.ownVatNumber || "";
    $("#invoice-notes").value = invoice?.notes || "";
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

  // Dígito de controlo do NIF português (módulo 11). Serve para preferir leituras de OCR coerentes.
  function nifChecksumOk(nif) {
    if (!/^\d{9}$/.test(nif)) return false;
    const sum = [...nif.slice(0, 8)].reduce((total, digit, index) => total + Number(digit) * (9 - index), 0);
    const check = 11 - (sum % 11);
    return Number(nif[8]) === (check >= 10 ? 0 : check);
  }

  // Procura NIFs no texto do OCR e separa o do fornecedor (emitente) do do cliente (o NIF próprio).
  // O cliente reconhece-se por palavras como "Cliente", "Adquirente" ou "Exmo(s) Sr(s)" na mesma linha ou na linha anterior.
  function extractNifs(text, knownSupplierNif = "") {
    const pattern = /(NIF|CONTRIBUINTE|CONTRIB)\D{0,15}(\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d[ .-]?\d)/gi;
    const customerHint = /CLIENTE|ADQUIRENTE|EXM[OA]|DESTINAT|COMPRADOR|FATURADO A|FACTURADO A/i;
    const supplierHint = /EMITENTE|FORNECEDOR|VENDEDOR/i;
    const candidates = [];
    let match;
    while ((match = pattern.exec(text))) {
      const nif = match[2].replace(/\D/g, "");
      if (nif === NO_NIF) continue;
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const sameLine = text.slice(lineStart, match.index + match[0].length);
      let role = "unknown";
      if (customerHint.test(sameLine)) role = "customer";
      else if (supplierHint.test(sameLine)) role = "supplier";
      else {
        // Olha até 3 linhas para trás (ex.: "Exmo(s) Sr(s)" / nome / NIF), parando noutro NIF ou numa palavra de emitente.
        for (const earlier of text.slice(0, lineStart).replace(/\n$/, "").split("\n").slice(-3).reverse()) {
          if (/(NIF|CONTRIB)\D{0,15}\d/i.test(earlier) || supplierHint.test(earlier)) break;
          if (customerHint.test(earlier)) { role = "customer"; break; }
        }
      }
      const valid = nifChecksumOk(nif);
      // Com o NIF do fornecedor já conhecido (QR), um NIF válido e diferente é, muito provavelmente, o do cliente.
      if (knownSupplierNif) {
        if (nif === knownSupplierNif) role = "supplier";
        else if (role === "unknown" && valid) role = "customer";
      }
      candidates.push({ nif, role, valid });
    }
    const pick = list => (list.find(item => item.valid) || list[0])?.nif;
    const supplierNif = pick(candidates.filter(item => item.role !== "customer"));
    const ownNif = pick(candidates.filter(item => item.role === "customer" && item.nif !== (supplierNif || knownSupplierNif)));
    return { vatNumber: supplierNif, ownVatNumber: ownNif };
  }

  function parseOcrText(text, known = {}) {
    const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const upper = lines.map(line => line.toLocaleUpperCase("pt-PT"));
    const result = {};
    const dateMatch = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
    if (dateMatch) result.date = `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`;
    const nifs = extractNifs(text, known.vatNumber || "");
    if (nifs.vatNumber) result.vatNumber = nifs.vatNumber;
    if (nifs.ownVatNumber) result.ownVatNumber = nifs.ownVatNumber;
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
    // B = NIF do adquirente (o NIF próprio). 999999990 é "consumidor final": a fatura foi emitida sem NIF.
    const buyer = String(fields.B || "").replace(/\s/g, "").replace(/^PT/i, "");
    if (/^\d{9}$/.test(buyer) && buyer !== NO_NIF && buyer !== result.vatNumber) result.ownVatNumber = buyer;
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
    const ids = { number: "invoice-number", date: "invoice-date", supplier: "invoice-supplier", vatNumber: "invoice-vat-number", ownVatNumber: "invoice-own-vat-number", subtotal: "invoice-subtotal", vat: "invoice-vat", total: "invoice-total" };
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
      applyOcrFields(parseOcrText(result.data.text, qrFields), qrFields);
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
    return { id: $("#invoice-id").value || crypto.randomUUID(), number: normalizeInvoiceNumber($("#invoice-number").value), date: $("#invoice-date").value, supplier: $("#invoice-supplier").value.trim(), vatNumber: $("#invoice-vat-number").value.trim(), ownVatNumber: $("#invoice-own-vat-number").value.replace(/[\s.-]/g, ""), notes: $("#invoice-notes").value.trim(), subtotal: parseMoney($("#invoice-subtotal").value), vat: parseMoney($("#invoice-vat").value), total: parseMoney($("#invoice-total").value), image: selectedImage || null, updatedAt: new Date().toISOString() };
  }

  function validateInvoice(invoice) {
    if (!invoice.date || !invoice.supplier || !invoice.total) return "Preenche a data, o fornecedor e o total.";
    if (invoice.number && !documentNumberPattern.test(invoice.number)) return "O número deve começar por FT, FR, FS, NC, ND ou RC e conter algarismos.";
    if (invoice.number) {
      const numberKey = value => String(value || "").replace(/\s+/g, "").toUpperCase();
      // Ao editar uma fatura que mantém o número, não bloquear (pode já haver repetidas de antes da validação).
      const stored = invoices.find(item => item.id === invoice.id);
      const numberChanged = !stored || numberKey(stored.number) !== numberKey(invoice.number);
      const duplicate = numberChanged && invoices.find(item => item.id !== invoice.id && numberKey(item.number) === numberKey(invoice.number));
      if (duplicate) return `Já existe uma fatura com o número ${duplicate.number} (${duplicate.supplier}, ${displayDate(duplicate.date)}).`;
    }
    if (invoice.vatNumber && !/^\d{9}$/.test(invoice.vatNumber)) return "O NIF deve ter 9 algarismos.";
    if (invoice.ownVatNumber && !/^\d{9}$/.test(invoice.ownVatNumber)) return "O NIF próprio deve ter 9 algarismos.";
    if (invoice.subtotal && invoice.vat && Math.abs(invoice.subtotal + invoice.vat - invoice.total) > 0.03) return "A base tributável + IVA não coincide com o total.";
    return "";
  }

  function updateExport() {
    const mode = $("#export-mode").value;
    $("#export-start-wrap").classList.toggle("hidden", mode !== "dates");
    $("#export-end-wrap").classList.toggle("hidden", mode !== "dates");
    $("#export-supplier-wrap").classList.toggle("hidden", mode !== "supplier");
    $("#export-own-wrap").classList.toggle("hidden", mode !== "own");
    const suppliers = [...new Map(invoices.map(invoice => [invoice.vatNumber || invoice.supplier, invoice])).values()];
    const supplierSelect = $("#export-supplier");
    const chosenSupplier = supplierSelect.value; // a lista é reconstruída; manter a escolha do utilizador
    supplierSelect.innerHTML = '<option value="">Escolher fornecedor</option>' + suppliers.map(invoice => `<option value="${escapeXml(invoice.vatNumber || invoice.supplier)}">${escapeXml(invoice.supplier)}${invoice.vatNumber ? ` · ${escapeXml(invoice.vatNumber)}` : ""}</option>`).join("");
    supplierSelect.value = chosenSupplier;
    // NIFs próprios existentes (com o número de faturas de cada um); mantém a escolha ao reconstruir a lista.
    const ownCounts = new Map();
    invoices.forEach(invoice => { if (invoice.ownVatNumber) ownCounts.set(invoice.ownVatNumber, (ownCounts.get(invoice.ownVatNumber) || 0) + 1); });
    const ownSelect = $("#export-own");
    const chosenOwn = ownSelect.value;
    ownSelect.innerHTML = '<option value="">Escolher NIF próprio</option>' + [...ownCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([nif, count]) => `<option value="${escapeXml(nif)}">${escapeXml(nif)} · ${count} fatura${count === 1 ? "" : "s"}</option>`).join("");
    ownSelect.value = chosenOwn;
    const selected = currentExportInvoices();
    $("#export-count").textContent = selected.length;
    $("#export-total").textContent = money(selected.reduce((sum, invoice) => sum + invoice.total, 0));
  }

  function currentExportInvoices() {
    const mode = $("#export-mode").value;
    if (mode === "dates") return invoices.filter(invoice => (!$("#export-start").value || invoice.date >= inputDate($("#export-start").value)) && (!$("#export-end").value || invoice.date <= inputDate($("#export-end").value)));
    if (mode === "supplier") { const key = $("#export-supplier").value; return key ? invoices.filter(invoice => (invoice.vatNumber || invoice.supplier) === key) : []; }
    if (mode === "own") { const key = $("#export-own").value; return key ? invoices.filter(invoice => invoice.ownVatNumber === key) : []; }
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
    if (mode === "own") return `Faturas-NIF-${safeFilename($("#export-own").value || "proprio")}.xlsx`;
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
    // As colunas novas (NIF próprio e Observações) ficam no fim, para não mudar a posição das que já existiam.
    const header = ["Número da fatura", "Data", "Fornecedor", "NIF", "Base tributável", "IVA", "Total", "NIF próprio", "Observações"];
    const values = [header, ...rows.map(invoice => [invoice.number, displayDate(invoice.date), invoice.supplier, invoice.vatNumber, invoice.subtotal.toFixed(2), invoice.vat.toFixed(2), invoice.total.toFixed(2), invoice.ownVatNumber || "", invoice.notes || ""]), ["", "", "", "", "", "Total", rows.reduce((sum, invoice) => sum + invoice.total, 0).toFixed(2)]];
    const sheetRows = values.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, cellIndex) => `<c r="${String.fromCharCode(65 + cellIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`).join("")}</row>`).join("");
    const files = [{ name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' }, { name: "_rels/.rels", data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' }, { name: "xl/workbook.xml", data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Faturas" sheetId="1" r:id="rId1"/></sheets></workbook>' }, { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' }, { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:I${values.length - 1}"/></worksheet>` }];
    const url = URL.createObjectURL(zip(files)); const link = document.createElement("a"); link.href = url; link.download = exportFilename(); document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  async function refresh() { invoices = await getInvoices(); updateDashboard(); renderHistory(); updateExport(); }

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
  const supplierInput = $("#invoice-supplier");
  const supplierList = $("#supplier-suggestions");
  supplierInput.addEventListener("input", updateSupplierSuggestions);
  supplierInput.addEventListener("focus", () => {
    updateSupplierSuggestions();
    // No telemóvel, sobe o campo para ficar acima do teclado e sobrar espaço para a lista.
    if (window.innerWidth <= 700) setTimeout(() => { if (document.activeElement === supplierInput) supplierInput.scrollIntoView?.({ block: "start", behavior: "smooth" }); }, 300);
  });
  supplierInput.addEventListener("blur", closeSupplierList);
  supplierInput.addEventListener("keydown", event => {
    const open = !supplierList.classList.contains("hidden");
    if (event.key === "ArrowDown") { event.preventDefault(); if (!open) updateSupplierSuggestions(); setSupplierActive(supplierActive + 1); }
    else if (event.key === "ArrowUp" && open) { event.preventDefault(); setSupplierActive(supplierActive - 1); }
    else if (event.key === "Enter" && open && supplierActive >= 0) { event.preventDefault(); chooseSupplier(supplierActive); }
    else if (event.key === "Escape" && open) { event.preventDefault(); closeSupplierList(); }
    else if (event.key === "Tab") closeSupplierList();
  });
  // Manter o foco no campo ao tocar numa sugestão (senão o campo perde o foco e a lista fecha antes do toque).
  supplierList.addEventListener("mousedown", event => event.preventDefault());
  supplierList.addEventListener("click", event => { const option = event.target.closest("[data-index]"); if (option) chooseSupplier(Number(option.dataset.index)); });
  $("#remove-image").addEventListener("click", () => { selectedImage = null; previewZoom = 1; viewerZoom = 1; viewerPan = { x: 0, y: 0 }; $("#image-preview").removeAttribute("src"); $("#image-preview-wrap").classList.add("hidden"); closeImageViewer(); });
  $("#clear-form").addEventListener("click", () => { $("#invoice-form").reset(); $("#invoice-id").value = ""; selectedImage = null; $("#image-preview-wrap").classList.add("hidden"); $("#form-error").textContent = ""; });
  $("#invoice-form").addEventListener("submit", async event => { event.preventDefault(); const invoice = formInvoice(); const error = validateInvoice(invoice); $("#form-error").textContent = error; if (error) return; await saveInvoice(invoice); await refresh(); $("#clear-form").click(); showPage("history"); });
  $("#history-search").addEventListener("input", renderHistory); $("#history-clear").addEventListener("click", () => { $("#history-search").value = ""; renderHistory(); });
  ["#export-mode", "#export-start", "#export-end", "#export-supplier", "#export-own"].forEach(selector => $(selector).addEventListener("change", updateExport));
  // Datas da exportação: coloca as barras automaticamente (dd/mm/aaaa) à medida que se escreve.
  const formatDateTyping = (value, deleting) => {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
    let text = digits.slice(0, 2);
    if (digits.length > 2) text += `/${digits.slice(2, 4)}`;
    if (digits.length > 4) text += `/${digits.slice(4, 8)}`;
    if (!deleting && (digits.length === 2 || digits.length === 4)) text += "/";
    return text;
  };
  ["#export-start", "#export-end"].forEach(selector => $(selector).addEventListener("input", event => {
    const deleting = String(event.inputType || "").startsWith("delete");
    event.target.value = formatDateTyping(event.target.value, deleting);
    event.target.setCustomValidity("");
    if (event.target.value.length === 10 || event.target.value.length === 0) updateExport();
  }));
  ["#export-start", "#export-end"].forEach(selector => $(selector).addEventListener("blur", event => { if (event.target.value && !/^\d{2}\/\d{2}\/\d{4}$/.test(event.target.value)) event.target.setCustomValidity("Usa o formato dia/mês/ano: dd/mm/aaaa."); else event.target.setCustomValidity(""); }));
  $("#export-button").addEventListener("click", exportXlsx);

  const themeButton = $("#theme-toggle"); const savedTheme = localStorage.getItem("invoice-theme"); if (savedTheme === "dark") document.documentElement.dataset.theme = "dark";
  themeButton?.addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; if (next === "dark") document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme; localStorage.setItem("invoice-theme", next); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    // Quando uma nova versão assume o controlo, recarrega uma vez (se não houver dados a meio no formulário).
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloaded || ocrInProgress || $("#invoice-supplier").value || $("#invoice-total").value) return;
      reloaded = true;
      location.reload();
    });
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(console.error));
  }
  const initialPage = location.hash.replace("#", ""); showPage(pages.includes(initialPage) ? initialPage : "dashboard");
  refresh().catch(error => { console.error(error); $("#storage-note").textContent = "Não foi possível abrir o armazenamento local"; });
})();
