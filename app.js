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

let clienteSeleccionadoId = null;
let terminoBusqueda = "";
let clienteFotoDataUrl = "";
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
  let foto = clienteFotoDataUrl;

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
  clienteFotoDataUrl = "";
  const fotoSeleccionada = document.getElementById("fotoSeleccionada");
  if (fotoSeleccionada) {
    fotoSeleccionada.textContent = "No hay foto seleccionada";
  }

  clienteSeleccionadoId = id;
  await cargarClientes();
  ocultarNuevoCliente();
}

function buscarClientes() {
  terminoBusqueda = document.getElementById("buscarCliente").value;
  renderClientes();
}

function handleClienteFotoFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Selecciona una imagen válida.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    clienteFotoDataUrl = reader.result;
    const fotoSeleccionada = document.getElementById("fotoSeleccionada");
    if (fotoSeleccionada) {
      fotoSeleccionada.textContent = file.name ? `Foto lista: ${file.name}` : "Foto lista para subir";
    }
  };
  reader.onerror = () => {
    alert("No se pudo leer la imagen. Intenta otra vez.");
  };
  reader.readAsDataURL(file);
  event.target.value = "";
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
  let listaCont = document.getElementById("listaClientes");
  if (!listaCont) return;

  let filtro = terminoBusqueda.trim().toLowerCase();
  let lista = clientes.filter(c => {
    if (!filtro) return true;
    return c.nombre.toLowerCase().includes(filtro) || c.cedula.toLowerCase().includes(filtro);
  });

  listaCont.innerHTML = "";

  if (lista.length === 0) {
    listaCont.innerHTML = `<div class="placeholder">No se encontraron clientes</div>`;
    return;
  }

  lista.forEach(c => {
    let fotoCliente = c.foto || 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80';
    listaCont.innerHTML += `
      <article class="client-card" onclick="seleccionarCliente('${c.id}')">
        <img class="client-card-avatar" src="${fotoCliente}" alt="Foto de ${c.nombre}" />
        <div class="client-card-content">
          <h3>${c.nombre}</h3>
          <p><strong>Teléfono:</strong> ${c.telefono || "-"}</p>
          <p><strong>Dirección:</strong> ${c.direccion || "-"}</p>
        </div>
        <div class="client-card-actions">
          <button class="small btn-danger" onclick="event.stopPropagation(); eliminarCliente('${c.id}')">Eliminar</button>
        </div>
      </article>
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
