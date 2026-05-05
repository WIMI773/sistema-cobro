import { db, logout, onAuthChange } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(error => {
    console.warn('Service worker registration failed:', error);
  });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    window.deferredInstallPrompt = event;
  });
}

let clientes = [];
let prestamos = [];
let pagos = [];

const params = new URLSearchParams(window.location.search);
const clienteId = params.get("clienteId");
let prestamoSeleccionadoId = null;
let pagoModalPrestamoId = null;
let pagoModalCuotaNumero = null;
let detalleTab = "info";
let userId = null;

// ─── Formato peso colombiano ───────────────────────────────────────────────
function formatCOP(valor) {
  if (valor === null || valor === undefined || isNaN(valor)) return "$0";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(valor);
}

function getRawNumber(inputEl) {
  const raw = (inputEl.dataset.rawValue || inputEl.value).replace(/\D/g, "");
  return parseFloat(raw);
}

function aplicarFormatoInputCOP(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const clone = input.cloneNode(true);
  input.parentNode.replaceChild(clone, input);
  clone.addEventListener("input", function () {
    const raw = this.value.replace(/\D/g, "");
    this.dataset.rawValue = raw;
    const num = parseInt(raw, 10);
    this.value = isNaN(num) ? "" : num.toLocaleString("es-CO");
  });
}

function iniciarFormatoModalMonto() {
  const input = document.getElementById("modalPagoMonto");
  if (!input || input.dataset.formatoAplicado) return;
  input.dataset.formatoAplicado = "1";
  input.addEventListener("input", function () {
    const raw = this.value.replace(/\D/g, "");
    this.dataset.rawValue = raw;
    const num = parseInt(raw, 10);
    this.value = isNaN(num) ? "" : num.toLocaleString("es-CO");
  });
}
// ──────────────────────────────────────────────────────────────────────────

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function diaSiguiente(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatearFecha(f) {
  if (!f) return '-';
  const [y, m, d] = f.split('-');
  return `${d}/${m}/${y}`;
}

function mostrarNotificacion(mensaje, tipo = "info") {
  let toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = mensaje;
  toast.className = `toast show ${tipo}`;
  clearTimeout(toast.hideTimeout);
  toast.hideTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

function abrirModalPago() {
  let modal = document.getElementById("modalPago");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function cerrarModalPago() {
  let modal = document.getElementById("modalPago");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  pagoModalPrestamoId = null;
  pagoModalCuotaNumero = null;
}

// ─── Modal editar cliente ─────────────────────────────────────────────────
function abrirModalEditar() {
  const cliente = getCliente();
  if (!cliente) return;

  document.getElementById("editNombre").value    = cliente.nombre    || "";
  document.getElementById("editCedula").value    = cliente.cedula    || "";
  document.getElementById("editTelefono").value  = cliente.telefono  || "";
  document.getElementById("editDireccion").value = cliente.direccion || "";
  document.getElementById("editFoto").value      = cliente.foto      || "";

  const modal = document.getElementById("modalEditarCliente");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function cerrarModalEditar() {
  const modal = document.getElementById("modalEditarCliente");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function guardarEdicionCliente() {
  const nombre    = document.getElementById("editNombre").value.trim();
  const cedula    = document.getElementById("editCedula").value.trim();
  const telefono  = document.getElementById("editTelefono").value.trim();
  const direccion = document.getElementById("editDireccion").value.trim();
  const foto      = document.getElementById("editFoto").value.trim();

  if (!nombre) {
    mostrarNotificacion("El nombre es obligatorio.", "error"); return;
  }

  try {
    await updateDoc(doc(db, "clientes", clienteId), {
      nombre, cedula, telefono, direccion, foto
    });

    // Actualizar localmente para no recargar todo
    const idx = clientes.findIndex(c => c.id === clienteId);
    if (idx !== -1) {
      clientes[idx] = { ...clientes[idx], nombre, cedula, telefono, direccion, foto };
    }

    cerrarModalEditar();
    mostrarNotificacion("Datos del cliente actualizados.", "success");
    renderDetalleCliente();
  } catch(e) {
    console.error(e);
    mostrarNotificacion("Error al guardar. Intenta de nuevo.", "error");
  }
}
// ─────────────────────────────────────────────────────────────────────────

function setDetalleTab(tab) {
  detalleTab = tab;
  renderDetalleCliente();
}

function abrirTabPrestamo() {
  setDetalleTab("prestamo");
}

function sumarPeriodo(fecha, frecuencia, iteracion) {
  let f = new Date(fecha + "T00:00:00");
  switch (frecuencia) {
    case "semanal":   f.setDate(f.getDate() + iteracion * 7);  break;
    case "quincenal": f.setDate(f.getDate() + iteracion * 15); break;
    case "mensual":   f.setMonth(f.getMonth() + iteracion);    break;
    default:          f.setDate(f.getDate() + iteracion);      break;
  }
  return `${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,'0')}-${String(f.getDate()).padStart(2,'0')}`;
}

function toggleManual(valor) {
  let nodo = document.getElementById("manualCuotasSection");
  if (!nodo) return;
  nodo.classList.toggle("hidden", valor !== "manual");
}

function renderManualCuotasRows() {
  let numCuotas = parseInt(document.getElementById("cuotas").value, 10);
  let cont = document.getElementById("manualCuotasRows");
  if (!cont) return;

  if (isNaN(numCuotas) || numCuotas <= 0) {
    cont.innerHTML = `<div class="help-text">Ingresa el número de cuotas y luego pulsa el botón.</div>`;
    return;
  }

  let rows = [];
  for (let i = 1; i <= numCuotas; i++) {
    rows.push(`
      <div class="manual-cuota-row">
        <label>Cuota ${i}</label>
        <input type="date" class="manual-cuota-fecha" placeholder="Fecha" />
        <input type="text" class="manual-cuota-valor" placeholder="Valor" inputmode="numeric" />
      </div>
    `);
  }
  cont.innerHTML = rows.join("");

  cont.querySelectorAll(".manual-cuota-valor").forEach(input => {
    input.addEventListener("input", function () {
      const raw = this.value.replace(/\D/g, "");
      this.dataset.rawValue = raw;
      const num = parseInt(raw, 10);
      this.value = isNaN(num) ? "" : num.toLocaleString("es-CO");
    });
  });
}

async function cargarDatosUsuario() {
  const resultados = await Promise.allSettled([
    cargarClientes(), cargarPrestamos(), cargarPagos()
  ]);
  resultados.forEach((r, i) => {
    if (r.status === 'rejected')
      console.error(`Error cargando ${ ['clientes','prestamos','pagos'][i] }:`, r.reason);
  });
}

async function cargarClientes() {
  if (!userId) return;
  try {
    const snap = await getDocs(query(collection(db, "clientes"), where("userId", "==", userId)));
    clientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { console.error(e); clientes = []; }
}

async function cargarPrestamos() {
  if (!userId) return;
  try {
    const snap = await getDocs(query(collection(db, "prestamos"), where("userId", "==", userId)));
    prestamos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { console.error(e); prestamos = []; }
}

async function cargarPagos() {
  if (!userId) return;
  try {
    const snap = await getDocs(query(collection(db, "pagos"), where("userId", "==", userId)));
    pagos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { console.error(e); pagos = []; }
}

async function actualizarMoras() {
  if (!userId) return;
  let fechaHoy = hoy();
  let actualizaciones = [];

  prestamos.forEach(p => {
    if (!Array.isArray(p.cuotas)) return;
    let cambió = false;

    p.cuotas.forEach(c => {
      if (c.estado === "pendiente" && c.fecha < fechaHoy) {
        c.estado = "mora";
        cambió = true;
      }
    });

    const cobradoTotal = totalPagadoReal(p);
    const nuevoEstado = cobradoTotal >= p.total ? "Pagado" : "Activo";
    if (nuevoEstado !== p.estado) {
      p.estado = nuevoEstado;
      cambió = true;
    }

    if (cambió) {
      actualizaciones.push(updateDoc(doc(db, "prestamos", p.id), { cuotas: p.cuotas, estado: p.estado }));
    }
  });

  if (actualizaciones.length) {
    await Promise.all(actualizaciones);
    await cargarPrestamos();
  }
}

function totalPagadoReal(prestamo) {
  return pagos
    .filter(pg => pg.prestamoId === prestamo.id)
    .reduce((sum, pg) => sum + Number(pg.valor || 0), 0);
}

function saldoPendiente(prestamo) {
  return Math.max(0, Math.round(prestamo.total - totalPagadoReal(prestamo)));
}

function cuotasEnMora(prestamo) {
  if (!Array.isArray(prestamo.cuotas)) return 0;
  return prestamo.cuotas.filter(c => c.estado === "mora").length;
}

function getCliente() {
  return clientes.find(c => c.id === clienteId);
}

function mostrarError(mensaje) {
  document.getElementById("detalleContainer").innerHTML =
    `<div class="placeholder"><h2>Error</h2><p>${mensaje}</p></div>`;
}

function mostrarCargando() {
  document.getElementById("detalleContainer").innerHTML =
    `<div class="placeholder">Cargando información del cliente...</div>`;
}

function generarEnlaceWhatsApp(cliente, prestamosCliente) {
  const whatsappDigits = (cliente.telefono || "").replace(/\D/g, "");
  if (!whatsappDigits) return null;

  let proximaCuota = null;
  let prestamoConCuota = null;
  for (const p of prestamosCliente) {
    if (p.estado !== "Activo") continue;
    const cuota = p.cuotas?.find(c => c.estado === "mora" || c.estado === "pendiente" || c.estado === "parcial");
    if (cuota) { proximaCuota = cuota; prestamoConCuota = p; break; }
  }

  const saldoTotal = prestamosCliente.reduce((s, p) => s + saldoPendiente(p), 0);
  const mora = prestamosCliente.reduce((s, p) => s + cuotasEnMora(p), 0);

  let mensaje = `Hola ${cliente.nombre} 👋, le recordamos que tiene un saldo pendiente con nosotros.\n\n`;

  if (proximaCuota && prestamoConCuota) {
    const [y, m, d] = proximaCuota.fecha.split("-");
    mensaje += `📋 *Próxima cuota:* ${formatCOP(proximaCuota.valor)}\n`;
    mensaje += `📅 *Vencimiento:* ${d}/${m}/${y}\n`;
  }

  mensaje += `💰 *Saldo total pendiente:* ${formatCOP(saldoTotal)}\n`;
  if (mora > 0) mensaje += `⚠️ *Cuotas en mora:* ${mora}\n`;
  mensaje += `\nPor favor realice su pago a la mayor brevedad posible. ¡Gracias! 🙏`;

  return `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(mensaje)}`;
}

async function renderDetalleCliente() {
  let cont = document.getElementById("detalleContainer");
  if (!clienteId) { mostrarError("No se pudo identificar el cliente."); return; }
  let cliente = getCliente();
  if (!cliente) { mostrarError("Cliente no encontrado."); return; }

  await actualizarMoras();

  let prestamosCliente = prestamos.filter(p => p.clienteId === clienteId);
  let totalDeuda         = prestamosCliente.reduce((s, p) => s + saldoPendiente(p), 0);
  let totalPagadoCliente = prestamosCliente.reduce((s, p) => s + totalPagadoReal(p), 0);
  let totalMora          = prestamosCliente.reduce((s, p) => s + cuotasEnMora(p), 0);

  if (!prestamoSeleccionadoId && prestamosCliente.length) {
    prestamoSeleccionadoId = prestamosCliente[0].id;
  }

  let selectedLoan = prestamosCliente.find(p => p.id === prestamoSeleccionadoId) || null;

  let prestamosHTML = prestamosCliente.length
    ? prestamosCliente.map(p => {
        let pagado = totalPagadoReal(p);
        let saldo  = saldoPendiente(p);
        let mora   = cuotasEnMora(p);
        let estado = p.estado === "Activo" ? "Activo" : "Pagado";
        const fechaMostrar = p.fechaPrestamo || p.fechaInicio || null;

        return `
          <div class="loan-item ${p.id === prestamoSeleccionadoId ? 'loan-item-active' : ''}" onclick="seleccionarPrestamo('${p.id}')">
            <div class="loan-item-main">
              <div>
                <div class="loan-item-title">Préstamo #${p.id}</div>
                ${fechaMostrar ? `<div style="font-size:0.75rem;color:#6b7280;margin-bottom:2px;">📅 Fecha préstamo: ${formatearFecha(fechaMostrar)}</div>` : ''}
                <div class="loan-item-meta">Monto ${formatCOP(p.monto)} · Total ${formatCOP(p.total)} · Pagado ${formatCOP(pagado)} · Saldo ${formatCOP(saldo)}</div>
              </div>
              <span class="badge ${mora > 0 ? 'mora' : ''}">${estado}</span>
            </div>
            <div class="loan-item-grid">
              <div><strong>Cuotas</strong><span>${p.numeroCuotas}</span></div>
              <div><strong>Mora</strong><span>${mora}</span></div>
              <div><strong>Interés</strong><span>${p.interes}%</span></div>
            </div>
            <div class="loan-item-actions">
              <button class="small btn-secondary" onclick="event.stopPropagation(); seleccionarPrestamo('${p.id}')">Ver</button>
              <button class="small" onclick="event.stopPropagation(); pagarCuota('${p.id}')">Pagar cuota</button>
              <button class="small btn-danger" onclick="event.stopPropagation(); eliminarPrestamo('${p.id}')">Eliminar préstamo</button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="placeholder">No hay préstamos para este cliente.</div>`;

  let pagosCliente = selectedLoan
    ? pagos.filter(pg => pg.prestamoId === selectedLoan.id)
    : pagos.filter(pg => pg.clienteId === clienteId);

  let pagosHTML = pagosCliente.length
    ? pagosCliente.map(pg => `
        <tr>
          <td>${pg.cuotaNumero}</td>
          <td>${formatCOP(pg.valor)}</td>
          <td>${pg.fecha}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="3">No hay pagos registrados.</td></tr>`;

  const telefonoCliente = cliente.telefono ? cliente.telefono.trim() : "";
  const tieneTelefono   = telefonoCliente.length > 0;
  const enlaceWhatsApp  = generarEnlaceWhatsApp(cliente, prestamosCliente);

  const accionesContacto = tieneTelefono ? `
    <div class="profile-actions">
      <a class="action-button" href="tel:${encodeURIComponent(telefonoCliente)}">Llamar</a>
      ${enlaceWhatsApp ? `<a class="action-button secondary" href="${enlaceWhatsApp}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
      <button class="action-button secondary" onclick="abrirModalEditar()">✏️ Editar</button>
    </div>
  ` : `
    <div class="profile-actions">
      <button class="action-button secondary" onclick="abrirModalEditar()">✏️ Editar cliente</button>
    </div>
  `;

  let selectedLoanSummaryHTML = selectedLoan
    ? `<div class="stats-card"><span class="badge">Monto préstamo</span><strong>${formatCOP(selectedLoan.monto)}</strong></div>`
    : "";

  let selectedLoanPayCardHTML = selectedLoan ? `
    <div class="loan-card pay-card">
      <h3>Pagar próxima cuota</h3>
      <p class="help-text">Préstamo #${selectedLoan.id} — saldo ${formatCOP(saldoPendiente(selectedLoan))}.</p>
      <button onclick="pagarCuota('${selectedLoan.id}')">Pagar cuota</button>
    </div>
  ` : `
    <div class="loan-card pay-card">
      <h3>Pagar próxima cuota</h3>
      <p class="placeholder">Selecciona un préstamo para ver la cuota pendiente.</p>
    </div>
  `;

  cont.innerHTML = `
    <div class="profile-card">
      <img src="${cliente.foto || 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80'}" alt="Foto de ${cliente.nombre}" />
      <div class="profile-info">
        <h2>${cliente.nombre}</h2>
        <p><span>Cédula:</span> ${cliente.cedula || '-'}</p>
        <p><span>Teléfono:</span> ${cliente.telefono || '-'}</p>
        <p><span>Dirección:</span> ${cliente.direccion || '-'}</p>
        ${accionesContacto}
      </div>
    </div>

    <div class="tabs">
      <button class="tab-button ${detalleTab === "info" ? "active" : ""}" type="button" onclick="setDetalleTab('info')">Información</button>
      <button class="tab-button ${detalleTab === "prestamo" ? "active" : ""}" type="button" onclick="setDetalleTab('prestamo')">Nuevo préstamo</button>
    </div>

    <div class="tab-pane ${detalleTab === "info" ? 'active' : ''}" id="tab-info">
      <div class="stats-grid">
        <div class="stats-card"><span class="badge">Préstamos</span><strong>${prestamosCliente.length}</strong></div>
        <div class="stats-card"><span class="badge">Total deuda</span><strong>${formatCOP(totalDeuda)}</strong></div>
        <div class="stats-card"><span class="badge">Pagado</span><strong>${formatCOP(totalPagadoCliente)}</strong></div>
        <div class="stats-card"><span class="badge">Cuotas en mora</span><strong>${totalMora}</strong></div>
        ${selectedLoanSummaryHTML}
      </div>

      ${selectedLoanPayCardHTML}

      <div class="loan-card">
        <h3>Préstamos de ${cliente.nombre}</h3>
        <div class="loan-list">${prestamosHTML}</div>
      </div>

      <div class="payment-history card">
        <h3>Historial de pagos</h3>
        <div class="table-container">
          <table>
            <thead><tr><th>N° cuota</th><th>Valor</th><th>Fecha</th></tr></thead>
            <tbody>${pagosHTML}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="tab-pane ${detalleTab === "prestamo" ? 'active' : ''}" id="tab-prestamo">
      <div class="loan-card">
        <h3>Nuevo préstamo</h3>
        <div class="field-grid">
          <input type="text" id="monto" placeholder="Monto prestado" inputmode="numeric" />
          <input type="number" id="interes" placeholder="Interés (%)" />
        </div>
        <div class="field-grid">
          <input type="text" id="valorCuota" placeholder="Valor cuota (opcional)" inputmode="numeric" />
          <input type="number" id="cuotas" placeholder="Número de cuotas" />
        </div>
        <div class="field-grid">
          <select id="frecuencia" onchange="toggleManual(this.value)" aria-label="Frecuencia de pago">
            <option value="diario">Diario</option>
            <option value="semanal">Semanal</option>
            <option value="quincenal">Quincenal</option>
            <option value="mensual">Mensual</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div class="field-grid">
          <div>
            <label style="font-size:0.82rem;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Fecha del préstamo</label>
            <input type="date" id="fechaPrestamo" value="${hoy()}" />
            <small style="color:#9ca3af;font-size:0.75rem;">La primera cuota se cobra al día siguiente de esta fecha.</small>
          </div>
        </div>
        <div id="manualCuotasSection" class="hidden">
          <button type="button" class="small btn-secondary" onclick="renderManualCuotasRows()">Generar filas de cuotas manuales</button>
          <div id="manualCuotasRows" class="manual-cuotas-grid"></div>
          <p class="help-text">Inserta fecha y valor para cada cuota.</p>
        </div>
        <button onclick="crearPrestamoCliente()">Crear préstamo</button>
        <button type="button" class="btn-secondary small" onclick="setDetalleTab('info')">Volver a información</button>
        <p class="help-text">Las cuotas se generan automáticamente desde el día siguiente a la fecha del préstamo.</p>
      </div>
    </div>
  `;

  aplicarFormatoInputCOP("monto");
  aplicarFormatoInputCOP("valorCuota");
  iniciarFormatoModalMonto();
}

function seleccionarPrestamo(id) {
  prestamoSeleccionadoId = id;
  renderDetalleCliente();
}

async function crearPrestamoCliente() {
  if (!clienteId || !userId) return;

  const montoEl      = document.getElementById("monto");
  const valorCuotaEl = document.getElementById("valorCuota");

  let monto           = getRawNumber(montoEl);
  let interes         = parseFloat(document.getElementById("interes").value);
  let valorCuotaInput = getRawNumber(valorCuotaEl);
  let numCuotas       = parseInt(document.getElementById("cuotas").value, 10);
  let frecuencia      = document.getElementById("frecuencia").value;

  const fechaPrestamoInput = document.getElementById("fechaPrestamo");
  const fechaPrestamo = fechaPrestamoInput?.value?.trim() || hoy();

  if (!fechaPrestamo || isNaN(new Date(fechaPrestamo).getTime())) {
    mostrarNotificacion("La fecha del préstamo no es válida.", "error"); return;
  }

  if (isNaN(monto) || isNaN(interes) || isNaN(numCuotas) || monto <= 0 || numCuotas <= 0) {
    mostrarNotificacion("Complete todos los datos correctamente.", "error"); return;
  }

  let total           = Math.round(monto + (monto * interes / 100));
  let valorCuotaBase  = Math.floor(total / numCuotas);
  let resto           = total - valorCuotaBase * numCuotas;
  let valorCuotaManual = !isNaN(valorCuotaInput) && valorCuotaInput > 0;

  const fechaPrimeraCuota = diaSiguiente(fechaPrestamo);

  let listaCuotas = [];

  if (frecuencia === "manual") {
    let rows = Array.from(document.querySelectorAll("#manualCuotasRows .manual-cuota-row"));
    if (rows.length !== numCuotas) {
      mostrarNotificacion(`Debes generar exactamente ${numCuotas} cuotas manuales.`, "error"); return;
    }
    for (let i = 0; i < rows.length; i++) {
      let fecha = rows[i].querySelector(".manual-cuota-fecha")?.value?.trim();
      const vEl = rows[i].querySelector(".manual-cuota-valor");
      let valor = parseFloat((vEl?.dataset?.rawValue || vEl?.value || "").replace(/\D/g, ""));
      if (!fecha || isNaN(new Date(fecha).getTime())) {
        mostrarNotificacion(`Fecha inválida en cuota ${i + 1}.`, "error"); return;
      }
      if (isNaN(valor) || valor <= 0) {
        mostrarNotificacion(`Valor inválido en cuota ${i + 1}.`, "error"); return;
      }
      listaCuotas.push({ numero: i + 1, fecha, valor, estado: "pendiente" });
    }
    total = listaCuotas.reduce((s, c) => s + c.valor, 0);
  } else {
    if (valorCuotaManual) total = valorCuotaInput * numCuotas;
    for (let i = 0; i < numCuotas; i++) {
      let vc = valorCuotaManual ? valorCuotaInput : valorCuotaBase;
      if (!valorCuotaManual && i === numCuotas - 1) vc += resto;
      listaCuotas.push({
        numero: i + 1,
        fecha: sumarPeriodo(fechaPrimeraCuota, frecuencia, i),
        valor: vc,
        estado: "pendiente"
      });
    }
  }

  const prestamo = {
    clienteId, monto, interes, total,
    numeroCuotas: numCuotas, frecuencia,
    fechaPrestamo,
    fechaInicio: fechaPrimeraCuota,
    estado: "Activo", cuotas: listaCuotas, userId
  };

  const prestamoId = Date.now().toString();
  await setDoc(doc(db, "prestamos", prestamoId), prestamo);
  prestamos.push({ id: prestamoId, ...prestamo });

  ["monto","interes","cuotas","valorCuota"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  if (fechaPrestamoInput) fechaPrestamoInput.value = hoy();

  prestamoSeleccionadoId = prestamoId;
  await cargarPrestamos();
  renderDetalleCliente();
  mostrarNotificacion("Préstamo creado. Primera cuota: " + formatearFecha(fechaPrimeraCuota), "success");
}

async function pagarCuota(prestamoId) {
  let prestamo = prestamos.find(p => p.id === prestamoId);
  if (!prestamo) { mostrarNotificacion("Préstamo no encontrado.", "error"); return; }

  await actualizarMoras();

  const saldo = saldoPendiente(prestamo);
  if (saldo <= 0) {
    mostrarNotificacion("Este préstamo ya está completamente pagado.", "warning");
    prestamo.estado = "Pagado";
    await setDoc(doc(db, "prestamos", prestamo.id), prestamo);
    await cargarPrestamos();
    renderDetalleCliente();
    return;
  }

  let cuota = prestamo.cuotas.find(c => c.estado === "mora" || c.estado === "pendiente" || c.estado === "parcial");

  pagoModalPrestamoId  = prestamo.id;
  pagoModalCuotaNumero = cuota ? cuota.numero : null;

  document.getElementById("modalPagoTitle").textContent =
    cuota ? `Pagar cuota #${cuota.numero}` : "Registrar pago";
  document.getElementById("modalPagoTexto").textContent =
    cuota
      ? `Cuota fija: ${formatCOP(cuota.valor)} — Saldo total pendiente: ${formatCOP(saldo)}`
      : `Saldo total pendiente: ${formatCOP(saldo)}`;
  document.getElementById("modalPagoFecha").value = hoy();

  const montoInput = document.getElementById("modalPagoMonto");
  const valorSugerido = cuota ? (cuota.valor - Number(cuota.abonado || 0)) : saldo;
  montoInput.dataset.rawValue = String(valorSugerido);
  montoInput.value = Number(valorSugerido).toLocaleString("es-CO");

  iniciarFormatoModalMonto();
  abrirModalPago();
}

async function eliminarPrestamo(prestamoId) {
  if (!confirm("¿Eliminar este préstamo?")) return;

  await deleteDoc(doc(db, "prestamos", prestamoId));
  await Promise.all(
    pagos.filter(pg => pg.prestamoId === prestamoId)
         .map(pg => deleteDoc(doc(db, "pagos", pg.id)))
  );

  prestamos = prestamos.filter(p => p.id !== prestamoId);
  pagos     = pagos.filter(pg => pg.prestamoId !== prestamoId);
  if (prestamoSeleccionadoId === prestamoId) prestamoSeleccionadoId = null;

  mostrarNotificacion("Préstamo eliminado.", "success");
  await cargarPrestamos();
  await cargarPagos();
  renderDetalleCliente();
}

async function confirmarPagoCuota() {
  let fechaPago = document.getElementById("modalPagoFecha").value.trim();
  if (!fechaPago || isNaN(new Date(fechaPago).getTime())) {
    mostrarNotificacion("Fecha inválida.", "error"); return;
  }

  const montoInput  = document.getElementById("modalPagoMonto");
  const montoRaw    = (montoInput.dataset.rawValue || montoInput.value).replace(/\D/g, "");
  const montoPagado = parseFloat(montoRaw);

  if (isNaN(montoPagado) || montoPagado <= 0) {
    mostrarNotificacion("Ingresa un monto válido.", "error"); return;
  }

  let prestamo = prestamos.find(p => p.id === pagoModalPrestamoId);
  if (!prestamo) {
    cerrarModalPago(); mostrarNotificacion("Préstamo no encontrado.", "error"); return;
  }

  const saldoActual = saldoPendiente(prestamo);
  if (montoPagado > saldoActual) {
    mostrarNotificacion(`El monto (${formatCOP(montoPagado)}) supera el saldo pendiente (${formatCOP(saldoActual)}).`, "error");
    return;
  }

  let restoPago = montoPagado;
  let cuotasActualizadas = [...prestamo.cuotas];

  for (let i = 0; i < cuotasActualizadas.length && restoPago > 0; i++) {
    const c = cuotasActualizadas[i];
    if (c.estado === "pagada") continue;
    const yaAbonado  = Number(c.abonado || 0);
    const faltaCuota = c.valor - yaAbonado;
    if (restoPago >= faltaCuota) {
      cuotasActualizadas[i] = { ...c, estado: "pagada", fechaPago, abonado: c.valor };
      restoPago -= faltaCuota;
    } else {
      cuotasActualizadas[i] = { ...c, estado: "parcial", abonado: yaAbonado + restoPago };
      restoPago = 0;
    }
  }

  prestamo.cuotas = cuotasActualizadas;

  const totalCobradoTrasEste = totalPagadoReal(prestamo) + montoPagado;
  if (totalCobradoTrasEste >= prestamo.total) prestamo.estado = "Pagado";

  const pago = {
    prestamoId: prestamo.id, clienteId: prestamo.clienteId,
    cuotaNumero: pagoModalCuotaNumero, valor: montoPagado,
    fecha: fechaPago, userId
  };

  await setDoc(doc(db, "pagos", Date.now().toString()), pago);
  await setDoc(doc(db, "prestamos", prestamo.id), prestamo);

  cerrarModalPago();
  await cargarPrestamos();
  await cargarPagos();
  renderDetalleCliente();
  mostrarNotificacion(`Pago de ${formatCOP(montoPagado)} registrado correctamente.`, "success");
}

window.seleccionarPrestamo    = seleccionarPrestamo;
window.crearPrestamoCliente   = crearPrestamoCliente;
window.pagarCuota             = pagarCuota;
window.eliminarPrestamo       = eliminarPrestamo;
window.toggleManual           = toggleManual;
window.renderManualCuotasRows = renderManualCuotasRows;
window.confirmarPagoCuota     = confirmarPagoCuota;
window.abrirModalPago         = abrirModalPago;
window.cerrarModalPago        = cerrarModalPago;
window.abrirModalEditar       = abrirModalEditar;
window.cerrarModalEditar      = cerrarModalEditar;
window.guardarEdicionCliente  = guardarEdicionCliente;
window.setDetalleTab          = setDetalleTab;
window.abrirTabPrestamo       = abrirTabPrestamo;

onAuthChange(async user => {
  if (!user) { window.location.href = "login.html"; return; }
  userId = user.uid;
  const usuarioEmail = document.getElementById("usuarioEmail");
  if (usuarioEmail) usuarioEmail.textContent = user.email || "";
  const logoutButton = document.getElementById("logoutButton");
  if (logoutButton) {
    logoutButton.onclick = async () => { await logout(); window.location.href = "login.html"; };
  }
  mostrarCargando();
  await cargarDatosUsuario();
  await renderDetalleCliente();
});