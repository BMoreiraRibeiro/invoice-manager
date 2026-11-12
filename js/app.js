(() => {
  "use strict";

  const pages = ["dashboard", "capture", "history", "export", "manage"];
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

  // Faturas arquivadas ficam no histórico, mas deixam de entrar nos totais e (por defeito) na exportação.
  const isArchived = invoice => invoice.archived === true;
  const archivedCopy = invoice => ({ ...invoice, archived: true, archivedAt: new Date().toISOString() });
  const restoredCopy = invoice => { const copy = { ...invoice }; delete copy.archived; delete copy.archivedAt; return copy; };

  // Grava várias alterações e remoções numa única transação: ou ficam todas, ou nenhuma.
  async function writeInvoices(changes = [], removals = []) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(database.store, "readwrite");
      const store = transaction.objectStore(database.store);
      changes.forEach(invoice => store.put(invoice));
      removals.forEach(id => store.delete(id));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
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
    if (name === "manage") updateManage();
  }

  const monthLabel = key => {
    const [year, month] = key.split("-").map(Number);
    const text = new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
    return text.charAt(0).toLocaleUpperCase("pt-PT") + text.slice(1);
  };

  function updateDashboard() {
    const active = invoices.filter(invoice => !isArchived(invoice));
    // Meses com faturas ativas, do mais recente para o mais antigo; mantém o mês escolhido se ainda existir.
    const monthCounts = new Map();
    active.forEach(invoice => { const key = String(invoice.date).slice(0, 7); if (/^\d{4}-\d{2}$/.test(key)) monthCounts.set(key, (monthCounts.get(key) || 0) + 1); });
    const monthSelect = $("#dashboard-month");
    const chosenMonth = monthSelect.value;
    monthSelect.innerHTML = '<option value="all">Todos os meses</option>' + [...monthCounts.keys()].sort().reverse().map(key => `<option value="${key}">${escapeXml(monthLabel(key))} · ${monthCounts.get(key)} fatura${monthCounts.get(key) === 1 ? "" : "s"}</option>`).join("");
    monthSelect.value = monthCounts.has(chosenMonth) ? chosenMonth : "all";
    const inPeriod = invoice => monthSelect.value === "all" || String(invoice.date).startsWith(monthSelect.value);
    const shown = active.filter(inPeriod);
    const archivedCount = invoices.filter(invoice => isArchived(invoice) && inPeriod(invoice)).length;
    const total = shown.reduce((sum, invoice) => sum + invoice.total, 0);
    const vat = shown.reduce((sum, invoice) => sum + invoice.vat, 0);
    const month = new Date().toISOString().slice(0, 7); // o cartão "Este mês" é sempre o mês atual
    $("#stat-count").textContent = shown.length;
    $("#stat-total").textContent = money(total);
    $("#stat-vat").textContent = money(vat);
    $("#stat-month").textContent = active.filter(invoice => invoice.date.startsWith(month)).length;
    $("#stat-foot-count").textContent = archivedCount ? `Documentos ativos · ${archivedCount} arquivada${archivedCount === 1 ? "" : "s"}` : "Documentos ativos";
  }

  let historyFilter = "all"; // all | active | archived

  function renderHistory() {
    const query = normalizeSearch($("#history-search").value);
    const archivedTotal = invoices.filter(isArchived).length;
    $("#count-all").textContent = invoices.length;
    $("#count-active").textContent = invoices.length - archivedTotal;
    $("#count-archived").textContent = archivedTotal;
    document.querySelectorAll("#history-filters .chip").forEach(chip => { const on = chip.dataset.filter === historyFilter; chip.classList.toggle("active", on); chip.setAttribute("aria-pressed", String(on)); });
    const byState = invoice => historyFilter === "all" || (historyFilter === "archived") === isArchived(invoice);
    const visible = invoices.filter(invoice => byState(invoice) && [invoice.supplier, invoice.vatNumber, invoice.ownVatNumber, invoice.number, invoice.notes, displayDate(invoice.date)].some(value => normalizeSearch(value).includes(query)));
    const list = $("#history-list");
    if (!visible.length) {
      const message = historyFilter === "archived" && !query ? "Ainda não arquivaste nenhuma fatura." : "As faturas guardadas aparecerão aqui.";
      list.innerHTML = `<div class="empty-state compact"><div class="empty-icon">▤</div><h3>Sem faturas para apresentar</h3><p>${message}</p></div>`;
      return;
    }
    list.innerHTML = visible.map(invoice => `<article class="invoice-row${isArchived(invoice) ? " is-archived" : ""}"><div class="invoice-main"><strong>${escapeXml(invoice.supplier)}</strong>${isArchived(invoice) ? '<small class="invoice-tag">Arquivada</small>' : ""}${invoice.notes ? `<small class="invoice-notes">${escapeXml(invoice.notes)}</small>` : ""}</div><time class="invoice-date" datetime="${escapeXml(invoice.date)}">${escapeXml(displayDate(invoice.date))}</time><strong class="invoice-total">${money(invoice.total)}</strong><div class="invoice-actions history-actions"><button class="icon-button" data-archive-invoice="${invoice.id}" title="${isArchived(invoice) ? "Repor (tirar do arquivo)" : "Arquivar"}" aria-label="${isArchived(invoice) ? "Repor fatura arquivada" : "Arquivar fatura"}">${isArchived(invoice) ? "↺" : "▣"}</button><button class="icon-button" data-edit-invoice="${invoice.id}" title="Editar" aria-label="Editar fatura">✎</button><button class="icon-button danger" data-delete-invoice="${invoice.id}" title="Eliminar" aria-label="Eliminar fatura">×</button></div></article>`).join("");
    list.querySelectorAll("[data-archive-invoice]").forEach(button => button.addEventListener("click", async () => {
      const invoice = invoices.find(item => item.id === button.dataset.archiveInvoice);
      if (!invoice) return;
      await writeInvoices([isArchived(invoice) ? restoredCopy(invoice) : archivedCopy(invoice)]);
      await refresh();
    }));
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

  async function cropDocumentLegacy(file) {
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

  function isConvexQuad(quad) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = quad[i], [x2, y2] = quad[(i + 1) % 4], [x3, y3] = quad[(i + 2) % 4];
      const cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2);
      if (Math.abs(cross) < 1e-6) return false;
      if (!sign) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false;
    }
    return true;
  }

  // Mostra a fotografia com 4 cantos arrastáveis. Devolve os cantos (0..1: SE, SD, ID, IE) ou null para não recortar.
  function openCropEditor(file, detected) {
    return new Promise(resolve => {
      const src = URL.createObjectURL(file);
      const editor = $("#crop-editor"), image = $("#crop-image"), handles = [...document.querySelectorAll("#crop-stage .crop-handle")];
      let quad = detected.quad.map(point => point.slice());
      const hint = $("#crop-hint");
      const baseHint = detected.found ? "Recorte detetado automaticamente. Arrasta os cantos para ajustar." : "Não foi possível detetar o papel. Arrasta os cantos para o marcar.";
      const draw = () => {
        handles.forEach((handle, index) => { handle.style.left = `${quad[index][0] * 100}%`; handle.style.top = `${quad[index][1] * 100}%`; });
        $("#crop-polygon").setAttribute("points", quad.map(point => `${point[0] * 100},${point[1] * 100}`).join(" "));
      };
      const clamp = value => Math.min(1, Math.max(0, value));
      handles.forEach((handle, index) => {
        handle.onpointerdown = event => { event.preventDefault(); handle.dataset.dragging = "1"; handle.setPointerCapture?.(event.pointerId); };
        handle.onpointermove = event => {
          if (!handle.dataset.dragging) return;
          const box = image.getBoundingClientRect();
          if (!box.width || !box.height) return;
          quad[index] = [clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height)];
          hint.textContent = baseHint;
          draw();
        };
        const stop = () => { delete handle.dataset.dragging; };
        handle.onpointerup = stop; handle.onpointercancel = stop;
      });
      const finish = result => { editor.classList.add("hidden"); image.removeAttribute("src"); URL.revokeObjectURL(src); resolve(result); };
      $("#crop-apply").onclick = () => {
        if (!isConvexQuad(quad)) { hint.textContent = "Os cantos estão cruzados. Ajusta-os para formarem um retângulo."; return; }
        finish(quad);
      };
      $("#crop-detect").onclick = () => { quad = detected.quad.map(point => point.slice()); hint.textContent = baseHint; draw(); };
      $("#crop-skip").onclick = () => finish(null);
      hint.textContent = baseHint;
      image.onload = draw;
      image.src = src;
      draw();
      editor.classList.remove("hidden");
    });
  }

  async function cropDocument(file) {
    if (!window.DocCrop) return cropDocumentLegacy(file);
    const image = await loadImage(file);
    const naturalWidth = image.naturalWidth || image.width, naturalHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, 3000 / Math.max(naturalWidth, naturalHeight));
    const full = document.createElement("canvas");
    full.width = Math.max(1, Math.round(naturalWidth * scale)); full.height = Math.max(1, Math.round(naturalHeight * scale));
    const fullContext = full.getContext("2d", { willReadFrequently: true });
    fullContext.drawImage(image, 0, 0, full.width, full.height);
    const smallScale = Math.min(1, 400 / Math.max(full.width, full.height));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(full.width * smallScale)); small.height = Math.max(1, Math.round(full.height * smallScale));
    const smallContext = small.getContext("2d", { willReadFrequently: true });
    smallContext.drawImage(full, 0, 0, small.width, small.height);
    let detected;
    try { detected = window.DocCrop.detectQuad(smallContext.getImageData(0, 0, small.width, small.height).data, small.width, small.height); }
    catch (error) { console.warn("Deteção do papel falhou:", error); detected = { quad: window.DocCrop.DEFAULT_QUAD.map(point => point.slice()), found: false }; }
    setOcrStatus("Ajusta o recorte da fatura e carrega em “Usar recorte”.");
    const quad = await openCropEditor(file, detected);
    if (!quad) return canvasBlob(full);
    setOcrStatus("A endireitar a fatura…");
    await new Promise(resolve => setTimeout(resolve, 20)); // deixa o ecrã atualizar antes do cálculo
    const points = quad.map(([x, y]) => [x * full.width, y * full.height]);
    const size = window.DocCrop.outputSize(points);
    const output = document.createElement("canvas");
    output.width = size.width; output.height = size.height;
    const outputContext = output.getContext("2d");
    const result = outputContext.createImageData(size.width, size.height);
    result.data.set(window.DocCrop.warp(fullContext.getImageData(0, 0, full.width, full.height).data, full.width, full.height, points, size.width, size.height));
    outputContext.putImageData(result, 0, 0);
    return canvasBlob(output);
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
    const stored = invoices.find(item => item.id === $("#invoice-id").value);
    const archiveState = stored && isArchived(stored) ? { archived: true, archivedAt: stored.archivedAt } : {}; // editar não tira a fatura do arquivo
    return { ...archiveState, id: $("#invoice-id").value || crypto.randomUUID(), number: normalizeInvoiceNumber($("#invoice-number").value), date: $("#invoice-date").value, supplier: $("#invoice-supplier").value.trim(), vatNumber: $("#invoice-vat-number").value.trim(), ownVatNumber: $("#invoice-own-vat-number").value.replace(/[\s.-]/g, ""), notes: $("#invoice-notes").value.trim(), subtotal: parseMoney($("#invoice-subtotal").value), vat: parseMoney($("#invoice-vat").value), total: parseMoney($("#invoice-total").value), image: selectedImage || null, updatedAt: new Date().toISOString() };
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

  // Âmbito de seleção partilhado pela exportação e pelo menu Gerir: todas, intervalo de datas, fornecedor ou NIF próprio.
  // `prefix` é "export" ou "manage" (os campos têm os mesmos nomes nas duas páginas).
  function readScope(prefix) {
    return { mode: $(`#${prefix}-mode`).value, start: $(`#${prefix}-start`).value, end: $(`#${prefix}-end`).value, supplier: $(`#${prefix}-supplier`).value, own: $(`#${prefix}-own`).value };
  }

  function filterScope(pool, scope) {
    const completeDate = value => (/^\d{2}\/\d{2}\/\d{4}$/.test(value) ? inputDate(value) : ""); // datas a meio de escrever não filtram
    if (scope.mode === "dates") { const from = completeDate(scope.start); const to = completeDate(scope.end); return pool.filter(invoice => (!from || invoice.date >= from) && (!to || invoice.date <= to)); }
    if (scope.mode === "supplier") return scope.supplier ? pool.filter(invoice => (invoice.vatNumber || invoice.supplier) === scope.supplier) : [];
    if (scope.mode === "own") return scope.own ? pool.filter(invoice => invoice.ownVatNumber === scope.own) : [];
    return pool;
  }

  // Mostra só os campos da modalidade escolhida e reconstrói as listas de fornecedores e NIFs próprios
  // a partir das faturas em causa (`pool`), mantendo a escolha do utilizador.
  function fillScope(prefix, pool) {
    const mode = $(`#${prefix}-mode`).value;
    $(`#${prefix}-start-wrap`).classList.toggle("hidden", mode !== "dates");
    $(`#${prefix}-end-wrap`).classList.toggle("hidden", mode !== "dates");
    $(`#${prefix}-supplier-wrap`).classList.toggle("hidden", mode !== "supplier");
    $(`#${prefix}-own-wrap`).classList.toggle("hidden", mode !== "own");
    const suppliers = [...new Map(pool.map(invoice => [invoice.vatNumber || invoice.supplier, invoice])).values()];
    const supplierSelect = $(`#${prefix}-supplier`);
    const chosenSupplier = supplierSelect.value; // a lista é reconstruída; manter a escolha do utilizador
    supplierSelect.innerHTML = '<option value="">Escolher fornecedor</option>' + suppliers.map(invoice => `<option value="${escapeXml(invoice.vatNumber || invoice.supplier)}">${escapeXml(invoice.supplier)}${invoice.vatNumber ? ` · ${escapeXml(invoice.vatNumber)}` : ""}</option>`).join("");
    supplierSelect.value = chosenSupplier;
    if (supplierSelect.selectedIndex < 0) supplierSelect.selectedIndex = 0; // a escolha deixou de existir
    // NIFs próprios existentes, com o número de faturas de cada um.
    const ownCounts = new Map();
    pool.forEach(invoice => { if (invoice.ownVatNumber) ownCounts.set(invoice.ownVatNumber, (ownCounts.get(invoice.ownVatNumber) || 0) + 1); });
    const ownSelect = $(`#${prefix}-own`);
    const chosenOwn = ownSelect.value;
    ownSelect.innerHTML = '<option value="">Escolher NIF próprio</option>' + [...ownCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([nif, count]) => `<option value="${escapeXml(nif)}">${escapeXml(nif)} · ${count} fatura${count === 1 ? "" : "s"}</option>`).join("");
    ownSelect.value = chosenOwn;
    if (ownSelect.selectedIndex < 0) ownSelect.selectedIndex = 0;
  }

  // Exportação: só faturas ativas, a menos que se marque "Incluir faturas arquivadas".
  const exportPool = () => ($("#export-archived").checked ? invoices : invoices.filter(invoice => !isArchived(invoice)));

  function updateExport() {
    fillScope("export", exportPool());
    const selected = currentExportInvoices();
    $("#export-count").textContent = selected.length;
    $("#export-total").textContent = money(selected.reduce((sum, invoice) => sum + invoice.total, 0));
    // O PDF leva uma página por fatura que tenha imagem; avisa quantas ficam de fora.
    const withImage = selected.filter(invoice => invoice.image).length;
    $("#export-pdf-note").textContent = !selected.length ? "" : !withImage ? "Nenhuma das faturas selecionadas tem imagem para o PDF." : withImage === selected.length ? `O PDF terá ${withImage} página${withImage === 1 ? "" : "s"}, uma por fatura.` : `O PDF terá ${withImage} página${withImage === 1 ? "" : "s"}: ${selected.length - withImage} fatura${selected.length - withImage === 1 ? " sem imagem fica" : "s sem imagem ficam"} de fora.`;
    $("#export-pdf-button").disabled = !withImage;
  }

  function currentExportInvoices() {
    return filterScope(exportPool(), readScope("export"));
  }

  // Menu Gerir: arquivar, repor ou eliminar várias faturas, com os mesmos âmbitos da exportação.
  const manageState = { action: "archive" };
  const MANAGE_TEXT = {
    archive: { icon: "▣", verb: "Arquivar", label: "Faturas a arquivar", done: ["arquivada", "arquivadas"], help: "Arquivar mantém as faturas no histórico, mas deixam de entrar nos totais do início e na exportação." },
    restore: { icon: "↺", verb: "Repor", label: "Faturas a repor", done: ["reposta", "repostas"], help: "Repor devolve as faturas arquivadas ao estado ativo." },
    delete: { icon: "×", verb: "Eliminar", label: "Faturas a eliminar", done: ["eliminada", "eliminadas"], help: "Eliminar remove as faturas de forma definitiva. Se precisares delas, exporta primeiro." }
  };

  function managePool() {
    if (manageState.action === "archive") return invoices.filter(invoice => !isArchived(invoice));
    if (manageState.action === "restore") return invoices.filter(isArchived);
    const state = $("#manage-state").value;
    if (state === "active") return invoices.filter(invoice => !isArchived(invoice));
    if (state === "archived") return invoices.filter(isArchived);
    return invoices;
  }

  function updateManage() {
    const text = MANAGE_TEXT[manageState.action];
    document.querySelectorAll("#manage-action .segment").forEach(button => { const on = button.dataset.action === manageState.action; button.classList.toggle("active", on); button.setAttribute("aria-pressed", String(on)); });
    $("#manage-state-wrap").classList.toggle("hidden", manageState.action !== "delete");
    $("#manage-help").textContent = text.help;
    $("#manage-count-label").textContent = text.label;
    const pool = managePool();
    fillScope("manage", pool);
    const selected = filterScope(pool, readScope("manage"));
    $("#manage-count").textContent = selected.length;
    $("#manage-total").textContent = money(selected.reduce((sum, invoice) => sum + invoice.total, 0));
    const button = $("#manage-button");
    button.disabled = !selected.length;
    button.classList.toggle("is-danger", manageState.action === "delete");
    $("#manage-button-icon").textContent = text.icon;
    $("#manage-button-text").textContent = selected.length ? `${text.verb} ${selected.length} fatura${selected.length === 1 ? "" : "s"}` : text.verb;
  }

  async function runManage() {
    const action = manageState.action;
    const text = MANAGE_TEXT[action];
    const selected = filterScope(managePool(), readScope("manage"));
    if (!selected.length) return;
    const subject = `${selected.length} fatura${selected.length === 1 ? "" : "s"} (${money(selected.reduce((sum, invoice) => sum + invoice.total, 0))})`;
    if (action === "archive" && !confirm(`Arquivar ${subject}?\n\nFicam no histórico, mas deixam de entrar nos totais e na exportação.`)) return;
    if (action === "restore" && !confirm(`Repor ${subject}?`)) return;
    if (action === "delete") {
      if (!confirm(`Eliminar ${subject} de forma definitiva?\n\nEsta ação não pode ser desfeita.`)) return;
      if (selected.length > 1 && !confirm(`Confirmas? Vão ser eliminadas ${selected.length} faturas.`)) return;
    }
    const status = $("#manage-status");
    try {
      if (action === "delete") await writeInvoices([], selected.map(invoice => invoice.id));
      else await writeInvoices(selected.map(action === "archive" ? archivedCopy : restoredCopy));
    } catch (error) {
      console.error(error);
      status.textContent = "Não foi possível concluir a ação. Nada foi alterado.";
      return;
    }
    await refresh();
    status.textContent = `${selected.length} ${text.done[selected.length === 1 ? 0 : 1]}.`;
  }

  function safeFilename(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "Filtro";
  }

  // O Excel e o PDF da mesma seleção têm o mesmo nome, só muda a extensão.
  function exportFilename(extension = "xlsx") {
    const mode = $("#export-mode").value;
    const today = displayDate(new Date().toISOString().slice(0, 10)).replaceAll("/", "-");
    if (mode === "dates") {
      const start = safeFilename($("#export-start").value || "Sem-inicio");
      const end = safeFilename($("#export-end").value || "Sem-fim");
      return `Faturas-${start}-a-${end}.${extension}`;
    }
    if (mode === "supplier") return `Faturas-${safeFilename($("#export-supplier").selectedOptions[0]?.textContent || "Fornecedor")}.${extension}`;
    if (mode === "own") return `Faturas-NIF-${safeFilename($("#export-own").value || "proprio")}.${extension}`;
    return `Faturas-Todas-${today}.${extension}`;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
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
    downloadBlob(zip(files), exportFilename("xlsx"));
  }

  // ---- PDF com as imagens das faturas (uma por página) ----
  // O PDF é gerado aqui, sem bibliotecas: as imagens JPEG entram tal como estão guardadas.
  const blobBytes = blob => (blob.arrayBuffer ? blob.arrayBuffer() : new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob); })).then(buffer => new Uint8Array(buffer));

  // Dimensões e tipo de um JPEG, lidos do cabeçalho (SOF). Devolve null se não for um JPEG que o PDF aceite diretamente.
  function jpegInfo(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null; // chegou aos dados sem encontrar o cabeçalho
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) { // baseline, sequencial estendido ou progressivo
        const info = { precision: bytes[offset + 4], height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8], components: bytes[offset + 9] };
        return info.precision === 8 && info.width > 0 && info.height > 0 && (info.components === 1 || info.components === 3) ? info : null;
      }
      if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return null; // outros modos de compressão
      offset += 2 + length;
    }
    return null;
  }

  // Orientação EXIF (1 = normal). Os visualizadores de PDF ignoram-na, por isso uma foto rodada tem de ser reconvertida.
  function exifOrientation(bytes) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (marker === 0xe1 && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 && bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66) { // "Exif"
        const tiff = offset + 10;
        const little = bytes[tiff] === 0x49;
        const u16 = position => (little ? bytes[position] | (bytes[position + 1] << 8) : (bytes[position] << 8) | bytes[position + 1]);
        const u32 = position => (little ? (bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16) | (bytes[position + 3] << 24)) >>> 0 : ((bytes[position] << 24) | (bytes[position + 1] << 16) | (bytes[position + 2] << 8) | bytes[position + 3]) >>> 0);
        const entries = u16(tiff + u32(tiff + 4));
        for (let index = 0; index < entries; index++) {
          const entry = tiff + u32(tiff + 4) + 2 + index * 12;
          if (u16(entry) === 0x0112) return u16(entry + 8);
        }
        return 1;
      }
      if (marker === 0xda) break;
      offset += 2 + length;
    }
    return 1;
  }

  // Imagem pronta para o PDF: JPEG direto quando possível; qualquer outro formato (PNG, WebP, rodado por EXIF, CMYK...) é reconvertido.
  async function jpegPage(blob) {
    let bytes = await blobBytes(blob);
    let info = jpegInfo(bytes);
    if (!info || exifOrientation(bytes) !== 1) {
      const image = await loadImage(blob);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, image.naturalWidth || image.width); canvas.height = Math.max(1, image.naturalHeight || image.height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); // PNG com transparência
      context.drawImage(image, 0, 0);
      bytes = await blobBytes(await canvasBlob(canvas));
      info = jpegInfo(bytes);
    }
    return info ? { bytes, width: info.width, height: info.height, components: info.components } : null;
  }

  // Monta o PDF: uma página A4 por imagem (deitada se a imagem for mais larga do que alta), centrada e com margens.
  function buildPdf(pages) {
    const chunks = []; const offsets = []; let length = 0;
    const ascii = text => { const out = new Uint8Array(text.length); for (let index = 0; index < text.length; index++) out[index] = text.charCodeAt(index) & 255; return out; };
    const push = data => { const chunk = typeof data === "string" ? ascii(data) : data; chunks.push(chunk); length += chunk.length; };
    const object = (number, body) => { offsets[number] = length; push(`${number} 0 obj\n${body}\nendobj\n`); };
    const A4 = [595.28, 841.89]; const margin = 28.35; // 10 mm
    push("%PDF-1.4\n"); push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, `<< /Type /Pages /Kids [${pages.map((page, index) => `${3 + index * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`);
    pages.forEach((page, index) => {
      const [pageWidth, pageHeight] = page.width > page.height ? [A4[1], A4[0]] : A4;
      const scale = Math.min((pageWidth - 2 * margin) / page.width, (pageHeight - 2 * margin) / page.height);
      const drawWidth = page.width * scale; const drawHeight = page.height * scale;
      const content = `q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${((pageWidth - drawWidth) / 2).toFixed(2)} ${((pageHeight - drawHeight) / 2).toFixed(2)} cm /Im0 Do Q`;
      const base = 3 + index * 3;
      object(base, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>`);
      object(base + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      offsets[base + 2] = length;
      push(`${base + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /${page.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`);
      push(page.bytes); push("\nendstream\nendobj\n");
    });
    const size = 3 + pages.length * 3;
    const xref = length;
    push(`xref\n0 ${size}\n0000000000 65535 f \n`);
    for (let number = 1; number < size; number++) push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: "application/pdf" });
  }

  async function exportPdf() {
    const selected = currentExportInvoices();
    if (!selected.length) return alert("Não existem faturas para exportar com estes critérios.");
    const withImage = selected.filter(invoice => invoice.image);
    if (!withImage.length) return alert("Nenhuma das faturas selecionadas tem imagem.");
    const button = $("#export-pdf-button");
    const note = $("#export-pdf-note");
    const label = button.innerHTML;
    button.disabled = true;
    const pages = []; let unreadable = 0;
    try {
      for (const [index, invoice] of withImage.entries()) {
        button.textContent = `A gerar PDF… ${index + 1}/${withImage.length}`;
        await new Promise(resolve => setTimeout(resolve)); // deixa o ecrã atualizar o progresso
        try { const page = await jpegPage(invoice.image); if (page) pages.push(page); else unreadable++; } catch (error) { console.error(error); unreadable++; }
      }
      if (!pages.length) { note.textContent = "Não foi possível ler as imagens das faturas selecionadas."; return; }
      downloadBlob(buildPdf(pages), exportFilename("pdf"));
      const skipped = selected.length - pages.length;
      note.textContent = `PDF gerado com ${pages.length} página${pages.length === 1 ? "" : "s"}.${skipped ? ` ${skipped} fatura${skipped === 1 ? " ficou" : "s ficaram"} de fora (${selected.length - withImage.length} sem imagem${unreadable ? `, ${unreadable} com imagem ilegível` : ""}).` : ""}`;
    } finally {
      button.disabled = false;
      button.innerHTML = label;
    }
  }

  async function refresh() { invoices = await getInvoices(); updateDashboard(); renderHistory(); updateExport(); updateManage(); }

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
  // Datas: coloca as barras automaticamente (dd/mm/aaaa) à medida que se escreve.
  const formatDateTyping = (value, deleting) => {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
    let text = digits.slice(0, 2);
    if (digits.length > 2) text += `/${digits.slice(2, 4)}`;
    if (digits.length > 4) text += `/${digits.slice(4, 8)}`;
    if (!deleting && (digits.length === 2 || digits.length === 4)) text += "/";
    return text;
  };
  // Liga os campos de âmbito (modalidade, datas, fornecedor, NIF próprio) de uma página: "export" ou "manage".
  function bindScope(prefix, update) {
    [`#${prefix}-mode`, `#${prefix}-start`, `#${prefix}-end`, `#${prefix}-supplier`, `#${prefix}-own`].forEach(selector => $(selector).addEventListener("change", update));
    [`#${prefix}-start`, `#${prefix}-end`].forEach(selector => {
      $(selector).addEventListener("input", event => {
        const deleting = String(event.inputType || "").startsWith("delete");
        event.target.value = formatDateTyping(event.target.value, deleting);
        event.target.setCustomValidity("");
        if (event.target.value.length === 10 || event.target.value.length === 0) update();
      });
      $(selector).addEventListener("blur", event => { if (event.target.value && !/^\d{2}\/\d{2}\/\d{4}$/.test(event.target.value)) event.target.setCustomValidity("Usa o formato dia/mês/ano: dd/mm/aaaa."); else event.target.setCustomValidity(""); });
    });
  }
  bindScope("export", updateExport);
  $("#export-archived").addEventListener("change", updateExport);
  $("#export-button").addEventListener("click", exportXlsx);
  $("#export-pdf-button").addEventListener("click", exportPdf);
  bindScope("manage", () => { $("#manage-status").textContent = ""; updateManage(); });
  $("#manage-state").addEventListener("change", () => { $("#manage-status").textContent = ""; updateManage(); });
  document.querySelectorAll("#manage-action .segment").forEach(button => button.addEventListener("click", () => { manageState.action = button.dataset.action; $("#manage-status").textContent = ""; updateManage(); }));
  $("#manage-button").addEventListener("click", runManage);
  $("#dashboard-month").addEventListener("change", updateDashboard);
  document.querySelectorAll("#history-filters .chip").forEach(chip => chip.addEventListener("click", () => { historyFilter = chip.dataset.filter; renderHistory(); }));

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
