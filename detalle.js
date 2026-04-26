let clientes = JSON.parse(localStorage.getItem("clientes")) || [];
let prestamos = JSON.parse(localStorage.getItem("prestamos")) || [];
let pagos = JSON.parse(localStorage.getItem("pagos")) || [];

const params = new URLSearchParams(window.location.search);
const clienteId = parseInt(params.get("clienteId"), 10);
let prestamoSeleccionadoId = null;
let pagoModalPrestamoId = null;
let pagoModalCuotaNumero = null;

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

function confirmarPagoCuota() {
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
  pagos.push({
    id: Date.now(),
    prestamoId: prestamo.id,
    clienteId: prestamo.clienteId,
    cuotaNumero: cuota.numero,
    valor: cuota.valor,
    fecha: fechaPago
  });

  let faltantes = prestamo.cuotas.filter(c => c.estado !== "pagada").length;
  if (faltantes === 0) {
    prestamo.estado = "Pagado";
  }

  localStorage.setItem("prestamos", JSON.stringify(prestamos));
  localStorage.setItem("pagos", JSON.stringify(pagos));

  cerrarModalPago();
  renderDetalleCliente();
  mostrarNotificacion("Pago registrado correctamente.", "success");
}

function hoy() {
  return new Date().toISOString().split("T")[0];
}

function sumarDias(fecha, dias) {
  let f = new Date(fecha);
  f.setDate(f.getDate() + dias);
  return f.toISOString().split("T")[0];
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

function togglePersonalizado(valor) {
  let nodo = document.getElementById("fechasPersonalizadas");
  if (!nodo) return;
  nodo.classList.toggle("hidden", valor !== "personalizado");
}

function actualizarMoras() {
  let fechaHoy = hoy();
  prestamos.forEach(p => {
    if (!Array.isArray(p.cuotas)) return;
    p.cuotas.forEach(c => {
      if (c.estado === "pendiente" && c.fecha < fechaHoy) {
        c.estado = "mora";
      }
    });
    let faltantes = p.cuotas.filter(c => c.estado !== "pagada").length;
    p.estado = faltantes === 0 ? "Pagado" : "Activo";
  });
  localStorage.setItem("prestamos", JSON.stringify(prestamos));
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
  cont.innerHTML = `<div class="placeholder"><h2>Error</h2><p>${mensaje}</p></div>`;
}

function renderDetalleCliente() {
  let cont = document.getElementById("detalleContainer");
  let cliente = getCliente();

  if (!cliente) {
    mostrarError("Cliente no encontrado. Vuelve al dashboard y selecciona otro cliente.");
    return;
  }

  actualizarMoras();

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
        <div class="loan-item ${p.id === prestamoSeleccionadoId ? 'loan-item-active' : ''}" onclick="seleccionarPrestamo(${p.id})">
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
            <button class="small btn-secondary" onclick="event.stopPropagation(); seleccionarPrestamo(${p.id})">Ver</button>
            <button class="small" onclick="event.stopPropagation(); pagarCuota(${p.id})">Pagar cuota</button>
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

  let selectedLoanSummaryHTML = selectedLoan ? `<div class="stats-card"><span class="badge">Monto préstamo</span><strong>${selectedLoan.monto}</strong></div>` : "";

  let selectedLoanPayCardHTML = selectedLoan ? `
    <div class="loan-card pay-card">
      <h3>Pagar próxima cuota</h3>
      <p class="help-text">Préstamo #${selectedLoan.id} — saldo ${saldoPendiente(selectedLoan)}.</p>
      <button onclick="pagarCuota(${selectedLoan.id})">Pagar cuota manual</button>
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
        <input type="number" id="cuotas" placeholder="Número de cuotas" />
        <select id="frecuencia" onchange="togglePersonalizado(this.value)" aria-label="Frecuencia de pago">
          <option value="diario">Diario</option>
          <option value="semanal">Semanal</option>
          <option value="quincenal">Quincenal</option>
          <option value="mensual">Mensual</option>
          <option value="personalizado">Personalizado</option>
        </select>
      </div>
      <div id="fechasPersonalizadas" class="hidden">
        <textarea id="fechasPersonalizadasInput" rows="4" placeholder="Escribe las fechas separadas por comas o líneas, por ejemplo 2026-05-01, 2026-05-15"></textarea>
        <p class="help-text">Agrega una fecha para cada cuota. El formato recomendado es YYYY-MM-DD.</p>
      </div>
      <button onclick="crearPrestamoCliente()">Crear préstamo</button>
      <p class="help-text">El sistema calcula automáticamente el calendario de cuotas según la frecuencia elegida.</p>
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

function crearPrestamoCliente() {
  if (!clienteId) return;

  let monto = parseFloat(document.getElementById("monto").value);
  let interes = parseFloat(document.getElementById("interes").value);
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

  let listaCuotas = [];
  if (frecuencia === "personalizado") {
    let fechasTexto = document.getElementById("fechasPersonalizadasInput").value;
    let fechas = fechasTexto
      .split(/[,\n;]+/)
      .map(item => item.trim())
      .filter(Boolean);

    if (fechas.length !== numCuotas) {
      mostrarNotificacion(`Debes ingresar exactamente ${numCuotas} fechas para el pago personalizado.`, "error");
      return;
    }

    let fechasValidas = fechas.every(fecha => !isNaN(new Date(fecha).getTime()));
    if (!fechasValidas) {
      mostrarNotificacion("Asegúrate de ingresar fechas válidas en formato YYYY-MM-DD.", "error");
      return;
    }

    fechas.forEach((fecha, index) => {
      let valorCuota = valorCuotaBase;
      if (index === numCuotas - 1) {
        valorCuota += resto;
      }
      listaCuotas.push({
        numero: index + 1,
        fecha,
        valor: valorCuota,
        estado: "pendiente"
      });
    });
    fechaInicio = fechas[0] || fechaInicio;
  } else {
    for (let i = 0; i < numCuotas; i++) {
      let valorCuota = valorCuotaBase;
      if (i === numCuotas - 1) {
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

  let prestamo = {
    id: Date.now(),
    clienteId,
    monto,
    interes,
    total,
    numeroCuotas: numCuotas,
    frecuencia,
    fechaInicio,
    estado: "Activo",
    cuotas: listaCuotas
  };

  prestamos.push(prestamo);
  localStorage.setItem("prestamos", JSON.stringify(prestamos));

  document.getElementById("monto").value = "";
  document.getElementById("interes").value = "";
  document.getElementById("cuotas").value = "";

  prestamoSeleccionadoId = prestamo.id;
  renderDetalleCliente();
}

function pagarCuota(prestamoId) {
  let prestamo = prestamos.find(p => p.id === prestamoId);
  if (!prestamo) {
    mostrarNotificacion("Préstamo no encontrado.", "error");
    return;
  }

  actualizarMoras();

  let cuota = prestamo.cuotas.find(c => c.estado === "mora" || c.estado === "pendiente");
  if (!cuota) {
    mostrarNotificacion("No hay cuotas pendientes.", "warning");
    prestamo.estado = "Pagado";
    localStorage.setItem("prestamos", JSON.stringify(prestamos));
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

document.addEventListener("DOMContentLoaded", () => {
  renderDetalleCliente();
});
