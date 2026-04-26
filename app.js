let clientes = JSON.parse(localStorage.getItem("clientes")) || [];
let prestamos = JSON.parse(localStorage.getItem("prestamos")) || [];
let pagos = JSON.parse(localStorage.getItem("pagos")) || [];

let clienteSeleccionadoId = null;
let terminoBusqueda = "";

function hoy() {
  return new Date().toISOString().split("T")[0];
}

function guardarCliente() {
  let nombre = document.getElementById("nombre").value.trim();
  let cedula = document.getElementById("cedula").value.trim();
  let telefono = document.getElementById("telefono").value.trim();
  let direccion = document.getElementById("direccion").value.trim();
  let foto = document.getElementById("foto").value.trim();

  if (!nombre || !cedula) {
    alert("Nombre y c�dula son obligatorios");
    return;
  }

  let cliente = {
    id: Date.now(),
    nombre,
    cedula,
    telefono,
    direccion,
    foto
  };

  clientes.push(cliente);
  localStorage.setItem("clientes", JSON.stringify(clientes));

  document.getElementById("nombre").value = "";
  document.getElementById("cedula").value = "";
  document.getElementById("telefono").value = "";
  document.getElementById("direccion").value = "";
  document.getElementById("foto").value = "";

  clienteSeleccionadoId = cliente.id;
  cargarClientes();
}

function buscarClientes() {
  terminoBusqueda = document.getElementById("buscarCliente").value;
  cargarClientes();
}

function cargarClientes() {
  let tabla = document.getElementById("tablaClientes");
  if (!tabla) return;

  let filtro = terminoBusqueda.trim().toLowerCase();
  let lista = clientes.filter(c => {
    if (!filtro) return true;
    return c.nombre.toLowerCase().includes(filtro) || c.cedula.toLowerCase().includes(filtro);
  });

  tabla.innerHTML = "";

  if (lista.length === 0) {
    tabla.innerHTML = `
      <tr>
        <td colspan="4">No se encontraron clientes</td>
      </tr>
    `;
    return;
  }

  lista.forEach(c => {
    let seleccionado = c.id === clienteSeleccionadoId ? "activo" : "";
    tabla.innerHTML += `
      <tr class="${seleccionado}">
        <td>${c.nombre}</td>
        <td>${c.cedula}</td>
        <td>${c.telefono || "-"}</td>
        <td class="action-group">
          <button class="small" onclick="seleccionarCliente(${c.id})">Abrir</button>
          <button class="small btn-danger" onclick="eliminarCliente(${c.id})">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function eliminarCliente(id) {
  if (!confirm("�Eliminar cliente?")) return;

  clientes = clientes.filter(c => c.id !== id);
  prestamos = prestamos.filter(p => p.clienteId !== id);
  pagos = pagos.filter(pg => pg.clienteId !== id);

  localStorage.setItem("clientes", JSON.stringify(clientes));
  localStorage.setItem("prestamos", JSON.stringify(prestamos));
  localStorage.setItem("pagos", JSON.stringify(pagos));

  if (clienteSeleccionadoId === id) {
    clienteSeleccionadoId = null;
  }

  cargarClientes();
}

function seleccionarCliente(id) {
  clienteSeleccionadoId = id;
  cargarClientes();
  window.open(`detalle.html?clienteId=${id}`, '_blank');
}

document.addEventListener("DOMContentLoaded", () => {
  cargarClientes();
});
