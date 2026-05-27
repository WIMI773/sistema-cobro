import { db, logout, onAuthChange } from "./firebase.js";
import {
  collection,
  query,
  where,
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

// Carga todo en paralelo y LUEGO renderiza una sola vez
async function cargarDatosUsuario() {
  await Promise.all([cargarClientes(), cargarPrestamos(), cargarPagos()]);
  renderClientes(); // unico punto donde se llama render
}

async function cargarClientes() {
  if (!userId) return;
  const consulta = query(
    collection(db, "clientes"),
    where("userId", "==", userId)
  );
  const snapshot = await getDocs(consulta);
  clientes = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

async function cargarPrestamos() {
  if (!userId) return;
  const consulta = query(collection(db, "prestamos"), where("userId", "==", userId));
  const snapshot = await getDocs(consulta);
  prestamos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function cargarPagos() {
  if (!userId) return;
  const consulta = query(collection(db, "pagos"), where("userId", "==", userId));
  const snapshot = await getDocs(consulta);
  pagos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Fecha de hoy en formato YYYY-MM-DD usando hora LOCAL (no UTC)
function hoy() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Normaliza fecha que puede ser string "YYYY-MM-DD" o Timestamp de Firestore
function normalizarFecha(fecha) {
  if (!fecha) return "";
  if (typeof fecha === 'object' && typeof fecha.toDate === 'function') {
    const fd = fecha.toDate();
    const yyyy = fd.getFullYear();
    const mm = String(fd.getMonth() + 1).padStart(2, '0');
    const dd = String(fd.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  // Puede llegar como "2026-04-28T00:00:00Z", recortar al segmento de fecha
  return String(fecha).slice(0, 10);
}

// Verifica si el cliente tiene al menos un pago registrado hoy
function clientePagoHoy(clienteId) {
  const fechaHoy = hoy();
  console.log('=== clientePagoHoy ===');
  console.log('Buscando clienteId:', clienteId);
  console.log('Fecha hoy:', fechaHoy);
  console.log('Total pagos en memoria:', pagos.length);
  
  pagos.forEach(p => {
    const fechaNorm = normalizarFecha(p.fecha);
    console.log(`  pago clienteId:${p.clienteId} fecha raw:${JSON.stringify(p.fecha)} normalizada:${fechaNorm} coincide:${p.clienteId === clienteId && fechaNorm === fechaHoy}`);
  });

  return pagos.some(p => p.clienteId === clienteId && normalizarFecha(p.fecha) === fechaHoy);
}

// Verifica si el cliente es un "clavo" (cuota sin pagar hace más de 3 meses)
function esClavo(clienteId) {
  const prestamosDelCliente = prestamos.filter(p => p.clienteId === clienteId && p.estado === 'Activo');
  
  if (prestamosDelCliente.length === 0) return false;
  
  const fechaHoy = new Date();
  const hace3Meses = new Date(fechaHoy.getFullYear(), fechaHoy.getMonth() - 3, fechaHoy.getDate());
  
  // Busca si hay alguna cuota vencida hace más de 3 meses
  for (let prestamo of prestamosDelCliente) {
    if (!Array.isArray(prestamo.cuotas)) continue;
    
    for (let cuota of prestamo.cuotas) {
      // Si la cuota está pendiente o en mora
      if (cuota.estado === 'pendiente' || cuota.estado === 'mora') {
        const fechaCuota = normalizarFecha(cuota.fecha);
        const [año, mes, día] = fechaCuota.split('-');
        const fechaCuotaObj = new Date(parseInt(año), parseInt(mes) - 1, parseInt(día));
        
        // Si la cuota es anterior a hace 3 meses, es un clavo
        if (fechaCuotaObj < hace3Meses) {
          console.log(`Cliente ${clienteId} es CLAVO: cuota vencida desde ${fechaCuota}`);
          return true;
        }
      }
    }
  }
  
  return false;
}

async function guardarCliente() {
  let nombre = document.getElementById("nombre").value.trim();
  let cedula = document.getElementById("cedula").value.trim();
  let telefono = document.getElementById("telefono").value.trim();
  let direccion = document.getElementById("direccion").value.trim();
  let foto = clienteFotoDataUrl || "";

  if (!nombre || !cedula) {
    alert("Nombre y cedula son obligatorios");
    return;
  }

  const id = Date.now().toString();
  const cliente = { nombre, cedula, telefono, direccion, foto, userId };

  await setDoc(doc(db, "clientes", id), cliente);

  document.getElementById("nombre").value = "";
  document.getElementById("cedula").value = "";
  document.getElementById("telefono").value = "";
  document.getElementById("direccion").value = "";

  clienteFotoDataUrl = "";
  const preview = document.getElementById("fotoPreview");
  if (preview) {
    preview.src = "";
    preview.classList.add("hidden");
  }
  const fotoSeleccionada = document.getElementById("fotoSeleccionada");
  if (fotoSeleccionada) fotoSeleccionada.textContent = "No hay foto seleccionada";

  clienteSeleccionadoId = id;
  await cargarDatosUsuario();
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
    alert("Selecciona una imagen valida.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const MAX = 400;
      let w = img.width;
      let h = img.height;
      if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      else if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      clienteFotoDataUrl = canvas.toDataURL("image/jpeg", 0.75);

      const preview = document.getElementById("fotoPreview");
      if (preview) {
        preview.src = clienteFotoDataUrl;
        preview.classList.remove("hidden");
      }
      const fotoSeleccionada = document.getElementById("fotoSeleccionada");
      if (fotoSeleccionada) {
        fotoSeleccionada.textContent = file.name ? `Foto lista: ${file.name}` : "Foto lista para subir";
      }
    };
    img.onerror = () => alert("No se pudo procesar la imagen.");
    img.src = e.target.result;
  };
  reader.onerror = () => alert("No se pudo leer la imagen. Intenta otra vez.");
  reader.readAsDataURL(file);
  event.target.value = "";
}

function toggleNuevoCliente() {
  document.getElementById("nuevoClienteCard").classList.toggle("hidden");
}

function ocultarNuevoCliente() {
  document.getElementById("nuevoClienteCard").classList.add("hidden");
}

function renderClientes() {
  const listaCont = document.getElementById("listaClientes");
  if (!listaCont) return;

  const filtro = terminoBusqueda.trim().toLowerCase();
  const lista = clientes.filter(c => {
    if (!filtro) return true;
    return c.nombre.toLowerCase().includes(filtro) || c.cedula.toLowerCase().includes(filtro);
  });

  if (lista.length === 0) {
    listaCont.innerHTML = `<div class="placeholder">No se encontraron clientes</div>`;
    return;
  }

  listaCont.innerHTML = lista.map(c => {
    const pagoHoy = clientePagoHoy(c.id);
    const clavo = esClavo(c.id);
    const fotoCliente = c.foto || 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80';
    
    let claseExtra = '';
    let badge = '';
    
    if (clavo) {
      claseExtra = ' client-card--clavo';
      badge = `<span class="badge-clavo">⚠️ CLAVO - No prestar</span>`;
    } else if (pagoHoy) {
      claseExtra = ' client-card--pagado';
      badge = `<span class="badge-pagado">&#10003; Pago hoy</span>`;
    }

    return `
      <article class="client-card${claseExtra}" onclick="seleccionarCliente('${c.id}')">
        <img class="client-card-avatar" src="${fotoCliente}" alt="Foto de ${c.nombre}" />
        <div class="client-card-content">
          <h3>${c.nombre} ${badge}</h3>
          <p><strong>Telefono:</strong> ${c.telefono || "-"}</p>
          <p><strong>Direccion:</strong> ${c.direccion || "-"}</p>
        </div>
        <div class="client-card-actions">
          <button class="small btn-danger" onclick="event.stopPropagation(); eliminarCliente('${c.id}')">Eliminar</button>
        </div>
      </article>
    `;
  }).join("");
}

async function eliminarCliente(id) {
  const confirmar = confirm(
    "⚠️ ¿Seguro que deseas eliminar este cliente?\n\n" +
    "Se borrarán también TODOS sus préstamos y pagos.\n" +
    "Esta acción NO se puede deshacer."
  );

  if (!confirmar) return;

  try {
    await deleteDoc(doc(db, "clientes", id));

    const prestamosDelCliente = prestamos.filter(p => p.clienteId === id);
    await Promise.all(prestamosDelCliente.map(p => deleteDoc(doc(db, "prestamos", p.id))));

    const pagosDelCliente = pagos.filter(pg => pg.clienteId === id);
    await Promise.all(pagosDelCliente.map(pg => deleteDoc(doc(db, "pagos", pg.id))));

    clienteSeleccionadoId = clienteSeleccionadoId === id ? null : clienteSeleccionadoId;

    alert("✅ Cliente eliminado correctamente");

    await cargarDatosUsuario();

  } catch (error) {
    console.error(error);
    alert("❌ Error al eliminar el cliente");
  }
}

function seleccionarCliente(id) {
  clienteSeleccionadoId = id;
  window.location.href = `detalle.html?clienteId=${id}`;
}

window.buscarClientes = buscarClientes;
window.toggleNuevoCliente = toggleNuevoCliente;
window.ocultarNuevoCliente = ocultarNuevoCliente;
window.guardarCliente = guardarCliente;
window.seleccionarCliente = seleccionarCliente;
window.eliminarCliente = eliminarCliente;
window.handleClienteFotoFile = handleClienteFotoFile;

// Cuando el usuario vuelve con el boton Atras, el navegador puede restaurar
// la pagina desde bfcache sin re-ejecutar el JS. Esto fuerza recargar los
// datos frescos de Firestore cada vez que la pagina vuelve a ser visible.
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    // La pagina vino del bfcache: recargar datos y re-renderizar
    if (userId) cargarDatosUsuario();
  }
});

// Alternativa para navegadores que no disparan pageshow correctamente
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && userId) {
    cargarDatosUsuario();
  }
});