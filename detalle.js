import { db, logout, onAuthChange } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let clientes = [];
let prestamos = [];
let pagos = [];

const params = new URLSearchParams(window.location.search);
const clienteId = params.get("clienteId");
let prestamoSeleccionadoId = null;
let pagoModalPrestamoId = null;
let pagoModalCuotaNumero = null;
let userId = null;

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

function hoy() {
  return new Date().toISOString().split("T")[0];
}

function sumarPeriodo(fecha, frecuencia, iteracion) {
  let f = new Date(fecha);
  switch (frecuencia) {
    case "semanal":
      f.setDate(f.getDate() + iteracion * 7);
      break;
    case "quincenal":
      f.setDate(f.getDate() + iteracion * 15);
      break;
    case "mensual":
      f.setMonth(f.getMonth() + iteracion);
      break;
    default:
      f.setDate(f.getDate() + iteracion);
      break;
  }
  return f.toISOString().split("T")[0];
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
        <input type="number" class="manual-cuota-valor" placeholder="Valor" min="1" />
      </div>
    `);
  }

  cont.innerHTML = rows.join("");
}

async function cargarDatosUsuario() {
  console.log('Detalle: cargando datos para clienteId=', clienteId, 'userId=', userId);
  const resultados = await Promise.allSettled([
    cargarClientes(),
    cargarPrestamos(),
    cargarPagos()
  ]);

  resultados.forEach((resultado, index) => {
    const nombre = ['clientes', 'prestamos', 'pagos'][index];
    if (resultado.status === 'rejected') {
      console.error(`Error cargando ${nombre}:`, resultado.reason);
    } else {
      console.log(`${nombre} cargados:`, resultado.value);
    }
  });
}

async function cargarClientes() {
  if (!userId) return;
  try {
    const consulta = query(collection(db, "clientes"), where("userId", "==", userId));
    const snapshot = await getDocs(consulta);
    clientes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error cargando clientes:', error);
    clientes = [];
  }
}

async function cargarPrestamos() {
  if (!userId) return;
  try {
    const consulta = query(collection(db, "prestamos"), where("userId", "==", userId));
    const snapshot = await getDocs(consulta);
    prestamos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error cargando prestamos:', error);
    prestamos = [];
  }
}

async function cargarPagos() {
  if (!userId) return;
  try {
    const consulta = query(collection(db, "pagos"), where("userId", "==", userId));
    const snapshot = await getDocs(consulta);
    pagos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error cargando pagos:', error);
    pagos = [];
  }
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

    let faltantes = p.cuotas.filter(c => c.estado !== "pagada").length;
    let nuevoEstado = faltantes === 0 ? "Pagado" : "Activo";
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

function totalPagado(prestamo) {
  if (!Array.isArray(prestamo.cuotas)) return 0;
  return prestamo.cuotas
    .filter(c => c.estado === "pagada")
    .reduce((sum, c) => sum + c.valor, 0);
}

function saldoPendiente(prestamo) {
  return Math.round(prestamo.total - totalPagado(prestamo));
}

function cuotasEnMora(prestamo) {
  if (!Array.isArray(prestamo.cuotas)) return 0;
  return prestamo.cuotas.filter(c => c.estado === "mora").length;
}

function getCliente() {
  return clientes.find(c => c.id === clienteId);
}

function mostrarError(mensaje) {
  let cont = document.getElementById("detalleContainer");
  cont.innerHTML = `<div class="placeholder"><h2>Error</h2><p>${mensaje}</p><p style="margin-top:12px;color:#9ca3af;">clienteId=${clienteId || 'no definido'}</p></div>`;
}

function mostrarCargando() {
  let cont = document.getElementById("detalleContainer");
  cont.innerHTML = `<div class="placeholder">Cargando información del cliente...<br><small style="color:#9ca3af;">clienteId=${clienteId || 'no definido'}</small></div>`;
}

async function renderDetalleCliente() {
  let cont = document.getElementById("detalleContainer");
  console.log('Detalle: renderDetalleCliente', { clienteId, clientesCount: clientes.length, prestamosCount: prestamos.length, pagosCount: pagos.length });
  if (!clienteId) {
    mostrarError("No se pudo identificar el cliente. Vuelve al panel principal y vuelve a intentarlo.");
    return;
  }
  let cliente = getCliente();

  if (!cliente) {
    console.warn('Detalle: cliente no encontrado para clienteId=', clienteId, 'clientes=', clientes);
    mostrarError("Cliente no encontrado. Vuelve al dashboard y selecciona otro cliente.");
    return;
  }

  await actualizarMoras();

  let prestamosCliente = prestamos.filter(p => p.clienteId === clienteId);
  let totalDeuda = prestamosCliente.reduce((sum, p) => sum + saldoPendiente(p), 0);
  let totalPagadoCliente = prestamosCliente.reduce((sum, p) => sum + totalPagado(p), 0);
  let totalMora = prestamosCliente.reduce((sum, p) => sum + cuotasEnMora(p), 0);

  if (!prestamoSeleccionadoId && prestamosCliente.length) {
    prestamoSeleccionadoId = prestamosCliente[0].id;
  }

  let selectedLoan = prestamosCliente.find(p => p.id === prestamoSeleccionadoId) || null;

  let prestamosHTML = prestamosCliente.length
    ? prestamosCliente.map(p => {
      let pagado = totalPagado(p);
      let saldo = saldoPendiente(p);
      let mora = cuotasEnMora(p);
      let estado = p.estado === "Activo" ? "Activo" : "Pagado";
      return `
        <div class="loan-item ${p.id === prestamoSeleccionadoId ? 'loan-item-active' : ''}" onclick="seleccionarPrestamo('${p.id}')">
          <div class="loan-item-main">
            <div>
              <div class="loan-item-title">Préstamo #${p.id}</div>
              <div class="loan-item-meta">Monto ${Math.round(p.monto)} · Total ${Math.round(p.total)} · Pagado ${pagado} · Saldo ${saldo}</div>
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
        <td>${pg.valor}</td>
        <td>${pg.fecha}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3">No hay pagos registrados.</td></tr>`;

  const telefonoCliente = cliente.telefono ? cliente.telefono.trim() : "";
  const whatsappDigits = telefonoCliente.replace(/\D/g, "");
  const tieneTelefono = telefonoCliente.length > 0;
  const tieneWhatsApp = whatsappDigits.length > 0;
  const accionesContacto = tieneTelefono ? `
    <div class="profile-actions">
      <a class="action-button" href="tel:${encodeURIComponent(telefonoCliente)}">Llamar</a>
      ${tieneWhatsApp ? `<a class="action-button secondary" href="https://wa.me/${whatsappDigits}" target="_blank" rel="noopener">WhatsApp</a>` : ``}
    </div>
  ` : `
    <div class="profile-actions">
      <span class="help-text">Teléfono no disponible</span>
    </div>
  `;

  let selectedLoanSummaryHTML = selectedLoan ? `<div class="stats-card"><span class="badge">Monto préstamo</span><strong>${selectedLoan.monto}</strong></div>` : "";

  let selectedLoanPayCardHTML = selectedLoan ? `
    <div class="loan-card pay-card">
      <h3>Pagar próxima cuota</h3>
      <p class="help-text">Préstamo #${selectedLoan.id} — saldo ${saldoPendiente(selectedLoan)}.</p>
      <button onclick="pagarCuota('${selectedLoan.id}')">Pagar cuota manual</button>
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
        <p><span>Cédula:</span> ${cliente.cedula}</p>
        <p><span>Teléfono:</span> ${cliente.telefono || '-'}</p>
        <p><span>Dirección:</span> ${cliente.direccion || '-'}</p>
        ${accionesContacto}
      </div>
    </div>

    <div class="stats-grid">
      <div class="stats-card"><span class="badge">Préstamos</span><strong>${prestamosCliente.length}</strong></div>
      <div class="stats-card"><span class="badge">Total deuda</span><strong>${totalDeuda}</strong></div>
      <div class="stats-card"><span class="badge">Pagado</span><strong>${totalPagadoCliente}</strong></div>
      <div class="stats-card"><span class="badge">Cuotas en mora</span><strong>${totalMora}</strong></div>
      ${selectedLoanSummaryHTML}
    </div>

    ${selectedLoanPayCardHTML}

    <div class="loan-card">
      <h3>Nuevo préstamo</h3>
      <div class="field-grid">
        <input type="number" id="monto" placeholder="Monto prestado" />
        <input type="number" id="interes" placeholder="Interés (%)" />
      </div>
      <div class="field-grid">
        <input type="number" id="valorCuota" placeholder="Valor cuota (opcional)" />
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
      <div id="manualCuotasSection" class="hidden">
        <button type="button" class="small btn-secondary" onclick="renderManualCuotasRows()">Generar filas de cuotas manuales</button>
        <div id="manualCuotasRows" class="manual-cuotas-grid"></div>
        <p class="help-text">Inserta fecha y valor para cada cuota. Si cambias el número de cuotas, pulsa el botón de nuevo.</p>
      </div>
      <button onclick="crearPrestamoCliente()">Crear préstamo</button>
      <p class="help-text">El sistema calcula automáticamente la fecha de las cuotas según la frecuencia elegida. Si quieres, puedes ingresar el valor de cada cuota manualmente con el campo Valor cuota.</p>
    </div>

    <div class="loan-card">
      <h3>Préstamos de ${cliente.nombre}</h3>
      <div class="loan-list">
        ${prestamosHTML}
      </div>
    </div>

    <div class="payment-history card">
      <h3>Historial de pagos</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>N° cuota</th>
              <th>Valor</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            ${pagosHTML}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function seleccionarPrestamo(id) {
  prestamoSeleccionadoId = id;
  renderDetalleCliente();
}

async function crearPrestamoCliente() {
  if (!clienteId || !userId) return;

  let monto = parseFloat(document.getElementById("monto").value);
  let interes = parseFloat(document.getElementById("interes").value);
  let valorCuotaInput = parseFloat(document.getElementById("valorCuota").value);
  let numCuotas = parseInt(document.getElementById("cuotas").value, 10);
  let frecuencia = document.getElementById("frecuencia").value;

  if (isNaN(monto) || isNaN(interes) || isNaN(numCuotas) || monto <= 0 || numCuotas <= 0) {
    mostrarNotificacion("Complete todos los datos correctamente.", "error");
    return;
  }

  let total = Math.round(monto + (monto * interes / 100));
  let valorCuotaBase = Math.floor(total / numCuotas);
  let resto = total - valorCuotaBase * numCuotas;
  let fechaInicio = hoy();
  let valorCuotaManual = !isNaN(valorCuotaInput) && valorCuotaInput > 0;

  let listaCuotas = [];
  if (frecuencia === "manual") {
    let rows = Array.from(document.querySelectorAll("#manualCuotasRows .manual-cuota-row"));
    if (rows.length !== numCuotas) {
      mostrarNotificacion(`Debes generar y completar exactamente ${numCuotas} cuotas manuales.`, "error");
      return;
    }

    for (let index = 0; index < rows.length; index++) {
      let row = rows[index];
      let fecha = row.querySelector(".manual-cuota-fecha")?.value?.trim();
      let valor = parseFloat(row.querySelector(".manual-cuota-valor")?.value);

      if (!fecha || isNaN(new Date(fecha).getTime())) {
        mostrarNotificacion(`Fecha inválida en la cuota ${index + 1}. Usa YYYY-MM-DD.`, "error");
        return;
      }
      if (isNaN(valor) || valor <= 0) {
        mostrarNotificacion(`Valor de cuota inválido en la cuota ${index + 1}.`, "error");
        return;
      }

      listaCuotas.push({
        numero: index + 1,
        fecha,
        valor,
        estado: "pendiente"
      });
    }

    total = listaCuotas.reduce((sum, cuota) => sum + cuota.valor, 0);
    fechaInicio = listaCuotas[0]?.fecha || fechaInicio;
  } else {
    if (valorCuotaManual) {
      total = valorCuotaInput * numCuotas;
    }

    for (let i = 0; i < numCuotas; i++) {
      let valorCuota = valorCuotaManual ? valorCuotaInput : valorCuotaBase;
      if (!valorCuotaManual && i === numCuotas - 1) {
        valorCuota += resto;
      }
      listaCuotas.push({
        numero: i + 1,
        fecha: sumarPeriodo(fechaInicio, frecuencia, i),
        valor: valorCuota,
        estado: "pendiente"
      });
    }
  }

  const prestamo = {
    clienteId,
    monto,
    interes,
    total,
    numeroCuotas: numCuotas,
    frecuencia,
    fechaInicio,
    estado: "Activo",
    cuotas: listaCuotas,
    userId
  };

  const prestamoId = Date.now().toString();
  await setDoc(doc(db, "prestamos", prestamoId), prestamo);
  prestamos.push({ id: prestamoId, ...prestamo });

  document.getElementById("monto").value = "";
  document.getElementById("interes").value = "";
  document.getElementById("cuotas").value = "";

  prestamoSeleccionadoId = prestamoId;
  await cargarPrestamos();
  renderDetalleCliente();
}

async function pagarCuota(prestamoId) {
  let prestamo = prestamos.find(p => p.id === prestamoId);
  if (!prestamo) {
    mostrarNotificacion("Préstamo no encontrado.", "error");
    return;
  }

  await actualizarMoras();

  let cuota = prestamo.cuotas.find(c => c.estado === "mora" || c.estado === "pendiente");
  if (!cuota) {
    mostrarNotificacion("No hay cuotas pendientes.", "warning");
    prestamo.estado = "Pagado";
    await setDoc(doc(db, "prestamos", prestamo.id), prestamo);
    await cargarPrestamos();
    renderDetalleCliente();
    return;
  }

  pagoModalPrestamoId = prestamo.id;
  pagoModalCuotaNumero = cuota.numero;
  document.getElementById("modalPagoTitle").textContent = `Pagar cuota #${cuota.numero}`;
  document.getElementById("modalPagoTexto").textContent = `Monto: ${cuota.valor}. Vencimiento: ${cuota.fecha}`;
  document.getElementById("modalPagoFecha").value = hoy();
  abrirModalPago();
}

async function confirmarPagoCuota() {
  let fechaPago = document.getElementById("modalPagoFecha").value.trim();
  if (!fechaPago || isNaN(new Date(fechaPago).getTime())) {
    mostrarNotificacion("Fecha inválida. Usa el formato YYYY-MM-DD.", "error");
    return;
  }

  let prestamo = prestamos.find(p => p.id === pagoModalPrestamoId);
  if (!prestamo) {
    cerrarModalPago();
    mostrarNotificacion("Préstamo no encontrado.", "error");
    return;
  }

  let cuota = prestamo.cuotas.find(c => c.numero === pagoModalCuotaNumero);
  if (!cuota) {
    cerrarModalPago();
    mostrarNotificacion("Cuota no encontrada.", "error");
    return;
  }

  cuota.estado = "pagada";
  cuota.fechaPago = fechaPago;

  let faltantes = prestamo.cuotas.filter(c => c.estado !== "pagada").length;
  if (faltantes === 0) {
    prestamo.estado = "Pagado";
  }

  const pago = {
    prestamoId: prestamo.id,
    clienteId: prestamo.clienteId,
    cuotaNumero: cuota.numero,
    valor: cuota.valor,
    fecha: fechaPago,
    userId
  };

  await setDoc(doc(db, "pagos", Date.now().toString()), pago);
  await setDoc(doc(db, "prestamos", prestamo.id), prestamo);

  cerrarModalPago();
  await cargarPrestamos();
  await cargarPagos();
  renderDetalleCliente();
  mostrarNotificacion("Pago registrado correctamente.", "success");
}

window.seleccionarPrestamo = seleccionarPrestamo;
window.crearPrestamoCliente = crearPrestamoCliente;
window.pagarCuota = pagarCuota;
window.toggleManual = toggleManual;
window.confirmarPagoCuota = confirmarPagoCuota;
window.abrirModalPago = abrirModalPago;
window.cerrarModalPago = cerrarModalPago;

onAuthChange(async user => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  userId = user.uid;
  const usuarioEmail = document.getElementById("usuarioEmail");
  if (usuarioEmail) {
    usuarioEmail.textContent = user.email || "";
  }

  const logoutButton = document.getElementById("logoutButton");
  if (logoutButton) {
    logoutButton.onclick = async () => {
      await logout();
      window.location.href = "login.html";
    };
  }

  mostrarCargando();
  await cargarDatosUsuario();
  await renderDetalleCliente();
});
