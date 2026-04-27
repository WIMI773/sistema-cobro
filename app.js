import { db, logout, onAuthChange } from "./firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  setDoc,
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let clientes = [];
let prestamos = [];
let pagos = [];

let clienteSeleccionadoId = null;
let terminoBusqueda = "";
let userId = null;

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

  await cargarDatosUsuario();
});

async function cargarDatosUsuario() {
  await Promise.all([cargarClientes(), cargarPrestamos(), cargarPagos()]);
}

async function cargarClientes() {
  if (!userId) return;

  const consulta = query(
    collection(db, "clientes"),
    where("userId", "==", userId)
  );
  const snapshot = await getDocs(consulta);
  clientes = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  renderClientes();
}

async function cargarPrestamos() {
  if (!userId) return;

  const consulta = query(collection(db, "prestamos"), where("userId", "==", userId));
  const snapshot = await getDocs(consulta);
  prestamos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function cargarPagos() {
  if (!userId) return;

  const consulta = query(collection(db, "pagos"), where("userId", "==", userId));
  const snapshot = await getDocs(consulta);
  pagos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function hoy() {
  return new Date().toISOString().split("T")[0];
}

async function guardarCliente() {
  let nombre = document.getElementById("nombre").value.trim();
  let cedula = document.getElementById("cedula").value.trim();
  let telefono = document.getElementById("telefono").value.trim();
  let direccion = document.getElementById("direccion").value.trim();
  let foto = document.getElementById("foto").value.trim();

  if (!nombre || !cedula) {
    alert("Nombre y cédula son obligatorios");
    return;
  }

  const id = Date.now().toString();
  const cliente = {
    nombre,
    cedula,
    telefono,
    direccion,
    foto,
    userId
  };

  await setDoc(doc(db, "clientes", id), cliente);
  clientes.push({ id, ...cliente });

  document.getElementById("nombre").value = "";
  document.getElementById("cedula").value = "";
  document.getElementById("telefono").value = "";
  document.getElementById("direccion").value = "";
  document.getElementById("foto").value = "";

  clienteSeleccionadoId = id;
  await cargarClientes();
  ocultarNuevoCliente();
}

function buscarClientes() {
  terminoBusqueda = document.getElementById("buscarCliente").value;
  renderClientes();
}

function toggleNuevoCliente() {
  let card = document.getElementById("nuevoClienteCard");
  card.classList.toggle("hidden");
}

function ocultarNuevoCliente() {
  let card = document.getElementById("nuevoClienteCard");
  card.classList.add("hidden");
}

function renderClientes() {
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
      <tr class="${seleccionado} clickable" onclick="seleccionarCliente('${c.id}')">
        <td>${c.nombre}</td>
        <td>${c.cedula}</td>
        <td>${c.telefono || "-"}</td>
        <td class="action-group">
          <button class="small btn-danger" onclick="event.stopPropagation(); eliminarCliente('${c.id}')">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

async function eliminarCliente(id) {
  if (!confirm("¿Eliminar cliente?")) return;

  await deleteDoc(doc(db, "clientes", id));

  const prestamosDelCliente = prestamos.filter(p => p.clienteId === id);
  await Promise.all(prestamosDelCliente.map(p => deleteDoc(doc(db, "prestamos", p.id))));

  const pagosDelCliente = pagos.filter(pg => pg.clienteId === id);
  await Promise.all(pagosDelCliente.map(pg => deleteDoc(doc(db, "pagos", pg.id))));

  clienteSeleccionadoId = clienteSeleccionadoId === id ? null : clienteSeleccionadoId;
  await cargarDatosUsuario();
}

function seleccionarCliente(id) {
  clienteSeleccionadoId = id;
  renderClientes();
  window.location.href = `detalle.html?clienteId=${id}`;
}

window.buscarClientes = buscarClientes;
window.toggleNuevoCliente = toggleNuevoCliente;
window.ocultarNuevoCliente = ocultarNuevoCliente;
window.guardarCliente = guardarCliente;
window.seleccionarCliente = seleccionarCliente;
window.eliminarCliente = eliminarCliente;
