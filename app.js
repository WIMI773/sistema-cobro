let clientes = JSON.parse(localStorage.getItem("clientes")) || [];
let prestamos = JSON.parse(localStorage.getItem("prestamos")) || [];
let pagos = JSON.parse(localStorage.getItem("pagos")) || [];

// ==================== FECHAS ====================
function hoy() {
  return new Date().toISOString().split("T")[0];
}

function sumarDias(fecha, dias) {
  let f = new Date(fecha);
  f.setDate(f.getDate() + dias);
  return f.toISOString().split("T")[0];
}

// ==================== SECCIONES ====================
function mostrarSeccion(id) {
  document.querySelectorAll(".seccion").forEach(sec => sec.classList.add("oculto"));
  document.getElementById(id).classList.remove("oculto");

  actualizarMoras();
  cargarPrestamos();
  cargarPagos();
}

// ==================== CLIENTES ====================
function guardarCliente() {
  let nombre = document.getElementById("nombre").value.trim();
  let cedula = document.getElementById("cedula").value.trim();
  let telefono = document.getElementById("telefono").value.trim();
  let direccion = document.getElementById("direccion").value.trim();

  if (!nombre || !cedula) {
    alert("Nombre y cédula son obligatorios");
    return;
  }

  let cliente = {
    id: Date.now(),
    nombre,
    cedula,
    telefono,
    direccion
  };

  clientes.push(cliente);
  localStorage.setItem("clientes", JSON.stringify(clientes));

  document.getElementById("nombre").value = "";
  document.getElementById("cedula").value = "";
  document.getElementById("telefono").value = "";
  document.getElementById("direccion").value = "";

  cargarClientes();
}

function cargarClientes() {
  let tabla = document.getElementById("tablaClientes");
  if (!tabla) return;

  tabla.innerHTML = "";

  clientes.forEach(c => {
    tabla.innerHTML += `
      <tr>
        <td>${c.nombre}</td>
        <td>${c.cedula}</td>
        <td>${c.telefono}</td>
        <td>${c.direccion}</td>
        <td><button class="btn-danger" onclick="eliminarCliente(${c.id})">Eliminar</button></td>
      </tr>
    `;
  });

  cargarSelectClientes();
}

function eliminarCliente(id) {
  if (!confirm("¿Eliminar cliente?")) return;

  clientes = clientes.filter(c => c.id !== id);
  localStorage.setItem("clientes", JSON.stringify(clientes));

  cargarClientes();
}

// ==================== SELECT CLIENTES ====================
function cargarSelectClientes() {
  let select = document.getElementById("clientePrestamo");
  if (!select) return;

  select.innerHTML = "";

  if (clientes.length === 0) {
    select.innerHTML = `<option value="">No hay clientes</option>`;
    return;
  }

  clientes.forEach(c => {
    select.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
  });

  cargarSelectPrestamos();
}

// ==================== CREAR PRESTAMO (CUOTA AUTOMATICA) ====================
function crearPrestamo() {
  let clienteId = parseInt(document.getElementById("clientePrestamo").value);
  let monto = parseFloat(document.getElementById("monto").value);
  let interes = parseFloat(document.getElementById("interes").value);
  let numCuotas = parseInt(document.getElementById("cuotas").value);

  if (!clienteId || isNaN(monto) || isNaN(interes) || isNaN(numCuotas)) {
    alert("Complete todos los datos correctamente");
    return;
  }

  // Total con interés
  let total = monto + (monto * interes / 100);
  total = Math.round(total);

  // Cuota base
  let valorCuotaBase = Math.floor(total / numCuotas);

  // Ajuste para que el total sea exacto
  let resto = total - (valorCuotaBase * numCuotas);

  let listaCuotas = [];
  let fechaInicio = hoy();

  for (let i = 0; i < numCuotas; i++) {
    let valorCuota = valorCuotaBase;

    // Última cuota ajustada
    if (i === numCuotas - 1) {
      valorCuota = valorCuotaBase + resto;
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
    valorCuota: valorCuotaBase,
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

  cargarPrestamos();
  cargarSelectPrestamos();
}

// ==================== ELIMINAR PRESTAMO ====================
function eliminarPrestamo(id) {
  if (!confirm("¿Eliminar este préstamo?")) return;

  prestamos = prestamos.filter(p => p.id !== id);
  pagos = pagos.filter(pg => pg.prestamoId !== id);

  localStorage.setItem("prestamos", JSON.stringify(prestamos));
  localStorage.setItem("pagos", JSON.stringify(pagos));

  document.getElementById("detallePrestamo").classList.add("oculto");

  cargarPrestamos();
  cargarPagos();
}

// ==================== MORA ====================
function actualizarMoras() {
  let fechaHoy = hoy();

  prestamos.forEach(p => {
    if (p.estado !== "Activo") return;

    if (!Array.isArray(p.cuotas)) {
      p.cuotas = [];
      for (let i = 0; i < p.numeroCuotas; i++) {
        p.cuotas.push({
          numero: i + 1,
          fecha: sumarDias(p.fechaInicio, i),
          valor: p.valorCuota,
          estado: "pendiente"
        });
      }
    }

    p.cuotas.forEach(c => {
      if (c.estado === "pendiente" && c.fecha < fechaHoy) {
        c.estado = "mora";
      }
    });

    let faltantes = p.cuotas.filter(c => c.estado !== "pagada").length;
    if (faltantes === 0) {
      p.estado = "Pagado";
    }
  });

  localStorage.setItem("prestamos", JSON.stringify(prestamos));
}

// ==================== CALCULOS ====================
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

// ==================== MOSTRAR PRESTAMOS ====================
function cargarPrestamos() {
  actualizarMoras();

  let tabla = document.getElementById("tablaPrestamos");
  if (!tabla) return;

  tabla.innerHTML = "";

  prestamos.forEach(p => {
    let cliente = clientes.find(c => c.id === p.clienteId);

    let pagado = totalPagado(p);
    let saldo = saldoPendiente(p);
    let mora = cuotasEnMora(p);

    tabla.innerHTML += `
      <tr>
        <td>${cliente ? cliente.nombre : "Desconocido"}</td>
        <td>${Math.round(p.total)}</td>
        <td>${pagado}</td>
        <td>${saldo}</td>
        <td class="${mora > 0 ? 'mora' : ''}">${mora}</td>
        <td>${p.estado}</td>
        <td>
          <button onclick="verPrestamo(${p.id})">Ver</button>
          <button class="btn-danger" onclick="eliminarPrestamo(${p.id})">Eliminar</button>
        </td>
      </tr>
    `;
  });

  cargarSelectPrestamos();
}

// ==================== DETALLE PRESTAMO ====================
function cerrarDetalle() {
  document.getElementById("detallePrestamo").classList.add("oculto");
}

function verPrestamo(prestamoId) {
  let prestamo = prestamos.find(p => p.id === prestamoId);
  if (!prestamo) return;

  let cliente = clientes.find(c => c.id === prestamo.clienteId);

  let detalle = document.getElementById("detallePrestamo");
  if (!detalle) return;

  detalle.classList.remove("oculto");

  let cuotasHTML = "";
  prestamo.cuotas.forEach(c => {
    cuotasHTML += `
      <tr class="${c.estado === 'mora' ? 'mora' : ''}">
        <td>${c.numero}</td>
        <td>${c.fecha}</td>
        <td>${c.valor}</td>
        <td>${c.estado}</td>
      </tr>
    `;
  });

  detalle.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
      <h3 style="margin:0;">Detalle Préstamo</h3>
      <button class="btn-secondary" onclick="cerrarDetalle()">Cerrar</button>
    </div>

    <p><b>Cliente:</b> ${cliente ? cliente.nombre : ""}</p>
    <p><b>Total:</b> ${Math.round(prestamo.total)}</p>
    <p><b>Pagado:</b> ${totalPagado(prestamo)}</p>
    <p><b>Saldo:</b> ${saldoPendiente(prestamo)}</p>

    <h4>Cuotas</h4>
    <div class="table-container">
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
  `;
}

// ==================== SELECT PRESTAMOS PARA PAGAR ====================
function cargarSelectPrestamos() {
  let select = document.getElementById("prestamoPago");
  if (!select) return;

  select.innerHTML = "";

  let activos = prestamos.filter(p => p.estado === "Activo");

  if (activos.length === 0) {
    select.innerHTML = `<option value="">No hay préstamos activos</option>`;
    return;
  }

  activos.forEach(p => {
    let cliente = clientes.find(c => c.id === p.clienteId);
    let saldo = saldoPendiente(p);

    select.innerHTML += `
      <option value="${p.id}">
        ${cliente ? cliente.nombre : ""} | Saldo: ${saldo}
      </option>
    `;
  });
}

// ==================== PAGAR CUOTA ====================
function pagarCuotaHoy() {
  let prestamoId = parseInt(document.getElementById("prestamoPago").value);
  let prestamo = prestamos.find(p => p.id === prestamoId);

  if (!prestamo) {
    alert("Seleccione un préstamo");
    return;
  }

  let fechaHoy = hoy();

  let cuota = prestamo.cuotas.find(c =>
    c.fecha === fechaHoy && (c.estado === "pendiente" || c.estado === "mora")
  );

  if (!cuota) {
    cuota = prestamo.cuotas.find(c => c.estado === "mora" || c.estado === "pendiente");
  }

  if (!cuota) {
    alert("Préstamo ya pagado");
    prestamo.estado = "Pagado";
    localStorage.setItem("prestamos", JSON.stringify(prestamos));
    cargarPrestamos();
    return;
  }

  cuota.estado = "pagada";

  pagos.push({
    id: Date.now(),
    prestamoId: prestamo.id,
    clienteId: prestamo.clienteId,
    cuotaNumero: cuota.numero,
    valor: cuota.valor,
    fecha: fechaHoy
  });

  let faltantes = prestamo.cuotas.filter(c => c.estado !== "pagada").length;
  if (faltantes === 0) {
    prestamo.estado = "Pagado";
  }

  localStorage.setItem("prestamos", JSON.stringify(prestamos));
  localStorage.setItem("pagos", JSON.stringify(pagos));

  cargarPrestamos();
  cargarPagos();

  alert("Cuota pagada correctamente");
}

// ==================== MOSTRAR PAGOS ====================
function cargarPagos() {
  let tabla = document.getElementById("tablaPagos");
  if (!tabla) return;

  tabla.innerHTML = "";

  pagos.forEach(p => {
    let cliente = clientes.find(c => c.id === p.clienteId);

    tabla.innerHTML += `
      <tr>
        <td>${cliente ? cliente.nombre : "Desconocido"}</td>
        <td>${p.cuotaNumero}</td>
        <td>${p.valor}</td>
        <td>${p.fecha}</td>
      </tr>
    `;
  });
}

// ==================== INICIO ====================
document.addEventListener("DOMContentLoaded", () => {
  cargarClientes();
  cargarPrestamos();
  cargarPagos();
});