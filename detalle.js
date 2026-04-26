let clientes = JSON.parse(localStorage.getItem("clientes")) || [];
let prestamos = JSON.parse(localStorage.getItem("prestamos")) || [];
let pagos = JSON.parse(localStorage.getItem("pagos")) || [];

const params = new URLSearchParams(window.location.search);
const clienteId = parseInt(params.get("clienteId"), 10);
let prestamoSeleccionadoId = null;

function hoy() {
  return new Date().toISOString().split("T")[0];
}

function sumarDias(fecha, dias) {
  let f = new Date(fecha);
  f.setDate(f.getDate() + dias);
  return f.toISOString().split("T")[0];
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
        <tr class="${p.id === prestamoSeleccionadoId ? 'activo' : ''}">
          <td>${p.id}</td>
          <td>${Math.round(p.total)}</td>
          <td>${pagado}</td>
          <td>${saldo}</td>
          <td class="${mora > 0 ? 'mora' : ''}">${mora}</td>
          <td>${estado}</td>
          <td class="action-group">
            <button class="small" onclick="seleccionarPrestamo(${p.id})">Ver</button>
          </td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="7">No hay préstamos para este cliente.</td></tr>`;

  let cuotasHTML = "";
  let pagoBoton = "<p class='placeholder'>Selecciona un préstamo para ver sus cuotas.</p>";

  if (selectedLoan) {
    cuotasHTML = selectedLoan.cuotas.map(c => `
      <tr class="${c.estado === 'mora' ? 'mora' : ''}">
        <td>${c.numero}</td>
        <td>${c.fecha}</td>
        <td>${c.valor}</td>
        <td>${c.estado}</td>
      </tr>
    `).join("");
    pagoBoton = `<button onclick="pagarCuota(${selectedLoan.id})">Pagar próxima cuota</button>`;
  }

  let pagosCliente = pagos.filter(pg => pg.clienteId === clienteId);
  let pagosHTML = pagosCliente.length
    ? pagosCliente.map(pg => `
      <tr>
        <td>${pg.cuotaNumero}</td>
        <td>${pg.valor}</td>
        <td>${pg.fecha}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3">No hay pagos registrados.</td></tr>`;

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
    </div>

    <div class="loan-card">
      <h3>Nuevo préstamo</h3>
      <input type="number" id="monto" placeholder="Monto prestado" />
      <input type="number" id="interes" placeholder="Interés (%)" />
      <input type="number" id="cuotas" placeholder="Número de cuotas diarias" />
      <button onclick="crearPrestamoCliente()">Crear préstamo</button>
    </div>

    <div class="loan-card">
      <h3>Préstamos de ${cliente.nombre}</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Total</th>
              <th>Pagado</th>
              <th>Saldo</th>
              <th>Mora</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${prestamosHTML}
          </tbody>
        </table>
      </div>
    </div>

    <div class="loan-detail card">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px;">
        <h3>Detalle del préstamo</h3>
      </div>
      ${selectedLoan ? `
        <p><span>Total:</span> ${Math.round(selectedLoan.total)}</p>
        <p><span>Pagado:</span> ${totalPagado(selectedLoan)}</p>
        <p><span>Saldo:</span> ${saldoPendiente(selectedLoan)}</p>
        ${pagoBoton}
        <div class="table-container" style="margin-top:18px;">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th>Valor</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${cuotasHTML}
            </tbody>
          </table>
        </div>
      ` : `<p class="placeholder">Selecciona un préstamo para ver los detalles.</p>`}
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

  if (isNaN(monto) || isNaN(interes) || isNaN(numCuotas) || monto <= 0 || numCuotas <= 0) {
    alert("Complete todos los datos correctamente.");
    return;
  }

  let total = Math.round(monto + (monto * interes / 100));
  let valorCuotaBase = Math.floor(total / numCuotas);
  let resto = total - valorCuotaBase * numCuotas;
  let fechaInicio = hoy();

  let listaCuotas = [];
  for (let i = 0; i < numCuotas; i++) {
    let valorCuota = valorCuotaBase;
    if (i === numCuotas - 1) {
      valorCuota += resto;
    }
    listaCuotas.push({
      numero: i + 1,
      fecha: sumarDias(fechaInicio, i),
      valor: valorCuota,
      estado: "pendiente"
    });
  }

  let prestamo = {
    id: Date.now(),
    clienteId,
    monto,
    interes,
    total,
    numeroCuotas: numCuotas,
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
    alert("Préstamo no encontrado.");
    return;
  }

  actualizarMoras();

  let cuota = prestamo.cuotas.find(c => c.estado === "mora" || c.estado === "pendiente");
  if (!cuota) {
    alert("No hay cuotas pendientes.");
    prestamo.estado = "Pagado";
    localStorage.setItem("prestamos", JSON.stringify(prestamos));
    renderDetalleCliente();
    return;
  }

  cuota.estado = "pagada";
  pagos.push({
    id: Date.now(),
    prestamoId: prestamo.id,
    clienteId: prestamo.clienteId,
    cuotaNumero: cuota.numero,
    valor: cuota.valor,
    fecha: hoy()
  });

  let faltantes = prestamo.cuotas.filter(c => c.estado !== "pagada").length;
  if (faltantes === 0) {
    prestamo.estado = "Pagado";
  }

  localStorage.setItem("prestamos", JSON.stringify(prestamos));
  localStorage.setItem("pagos", JSON.stringify(pagos));

  renderDetalleCliente();
  alert("Cuota pagada correctamente.");
}

document.addEventListener("DOMContentLoaded", () => {
  renderDetalleCliente();
});
