(() => {
  "use strict";

  const pages = ["dashboard", "capture", "history", "export"];
  const database = { name: "invoice-manager", version: 1, store: "invoices" };
  let invoices = [];
  let selectedImage = null;

  const $ = selector => document.querySelector(selector);
  const money = value => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
  const parseMoney = value => Number(String(value || "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".")) || 0;
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
      empty.innerHTML = `<div class="recent-list">${invoices.slice(0, 5).map(invoice => `<div class="recent-row"><span><strong>${escapeXml(invoice.supplier)}</strong><small>${escapeXml(invoice.date)} · ${escapeXml(invoice.number || "Sem número")}</small></span><strong>${money(invoice.total)}</strong></div>`).join("")}</div>`;
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
    list.innerHTML = visible.map(invoice => `<article class="invoice-row"><div class="invoice-main"><strong>${escapeXml(invoice.supplier)}</strong><span>${escapeXml(invoice.date)} · ${escapeXml(invoice.number || "Sem número")}</span><small>NIF ${escapeXml(invoice.vatNumber || "não indicado")} · IVA ${money(invoice.vat)}</small></div><strong class="invoice-total">${money(invoice.total)}</strong><div class="invoice-actions"><label class="select-invoice"><input type="checkbox" data-select-invoice="${invoice.id}"> Exportar</label><button class="icon-button" data-edit-invoice="${invoice.id}" title="Editar">✎</button><button class="icon-button danger" data-delete-invoice="${invoice.id}" title="Eliminar">×</button></div></article>`).join("");
    list.querySelectorAll("[data-edit-invoice]").forEach(button => button.addEventListener("click", () => editInvoice(button.dataset.editInvoice)));
    list.querySelectorAll("[data-delete-invoice]").forEach(button => button.addEventListener("click", async () => { if (confirm("Eliminar esta fatura?")) { await deleteInvoice(button.dataset.deleteInvoice); await refresh(); } }));
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

  function readFile(file) {
    if (!file) return;
    selectedImage = file;
    $("#image-preview").src = URL.createObjectURL(file);
    $("#image-preview-wrap").classList.remove("hidden");
  }

  function formInvoice() {
    return { id: $("#invoice-id").value || crypto.randomUUID(), number: $("#invoice-number").value.trim(), date: $("#invoice-date").value, supplier: $("#invoice-supplier").value.trim(), vatNumber: $("#invoice-vat-number").value.trim(), subtotal: parseMoney($("#invoice-subtotal").value), vat: parseMoney($("#invoice-vat").value), total: parseMoney($("#invoice-total").value), image: selectedImage || null, updatedAt: new Date().toISOString() };
  }

  function validateInvoice(invoice) {
    if (!invoice.date || !invoice.supplier || !invoice.total) return "Preenche a data, o fornecedor e o total.";
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
    if (mode === "dates") return invoices.filter(invoice => (!$("#export-start").value || invoice.date >= $("#export-start").value) && (!$("#export-end").value || invoice.date <= $("#export-end").value));
    if (mode === "supplier") { const key = $("#export-supplier").value; return key ? invoices.filter(invoice => (invoice.vatNumber || invoice.supplier) === key) : []; }
    return invoices;
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
    const values = [header, ...rows.map(invoice => [invoice.number, invoice.date, invoice.supplier, invoice.vatNumber, invoice.subtotal.toFixed(2), invoice.vat.toFixed(2), invoice.total.toFixed(2)]), ["", "", "", "", "", "Total", rows.reduce((sum, invoice) => sum + invoice.total, 0).toFixed(2)]];
    const sheetRows = values.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, cellIndex) => `<c r="${String.fromCharCode(65 + cellIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`).join("")}</row>`).join("");
    const files = [{ name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' }, { name: "_rels/.rels", data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' }, { name: "xl/workbook.xml", data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Faturas" sheetId="1" r:id="rId1"/></sheets></workbook>' }, { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' }, { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:G${values.length - 1}"/></worksheet>` }];
    const url = URL.createObjectURL(zip(files)); const link = document.createElement("a"); link.href = url; link.download = `faturas-${new Date().toISOString().slice(0, 10)}.xlsx`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  async function refresh() { invoices = await getInvoices(); updateDashboard(); renderHistory(); updateExport(); }

  document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
  $("#invoice-camera").addEventListener("change", event => readFile(event.target.files[0]));
  $("#invoice-image").addEventListener("change", event => readFile(event.target.files[0]));
  $("#remove-image").addEventListener("click", () => { selectedImage = null; $("#image-preview").removeAttribute("src"); $("#image-preview-wrap").classList.add("hidden"); });
  $("#clear-form").addEventListener("click", () => { $("#invoice-form").reset(); $("#invoice-id").value = ""; selectedImage = null; $("#image-preview-wrap").classList.add("hidden"); $("#form-error").textContent = ""; });
  $("#invoice-form").addEventListener("submit", async event => { event.preventDefault(); const invoice = formInvoice(); const error = validateInvoice(invoice); $("#form-error").textContent = error; if (error) return; await saveInvoice(invoice); await refresh(); $("#clear-form").click(); showPage("history"); });
  $("#history-search").addEventListener("input", renderHistory); $("#history-clear").addEventListener("click", () => { $("#history-search").value = ""; renderHistory(); });
  ["#export-mode", "#export-start", "#export-end", "#export-supplier"].forEach(selector => $(selector).addEventListener("change", updateExport));
  $("#export-button").addEventListener("click", exportXlsx);

  const themeButton = $("#theme-toggle"); const savedTheme = localStorage.getItem("invoice-theme"); if (savedTheme === "dark") document.documentElement.dataset.theme = "dark";
  themeButton?.addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; if (next === "dark") document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme; localStorage.setItem("invoice-theme", next); });
  const connection = $("#connection-status"); const updateConnection = () => { const online = navigator.onLine; connection.classList.toggle("offline", !online); connection.innerHTML = `<span class="status-dot"></span>${online ? "Ligação disponível" : "A trabalhar offline"}`; }; window.addEventListener("online", updateConnection); window.addEventListener("offline", updateConnection); updateConnection();
  if ("serviceWorker" in navigator && location.protocol !== "file:") window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(console.error));
  const initialPage = location.hash.replace("#", ""); showPage(pages.includes(initialPage) ? initialPage : "dashboard");
  refresh().catch(error => { console.error(error); $("#storage-note").textContent = "Não foi possível abrir o armazenamento local"; });
})();
