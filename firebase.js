import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDuI0DXT3L3t83FHTv9dYS_Xtvy3EsS6Ks",
  authDomain: "sistema-cobro-diario.firebaseapp.com",
  projectId: "sistema-cobro-diario",
  storageBucket: "sistema-cobro-diario.firebasestorage.app",
  messagingSenderId: "147660078815",
  appId: "1:147660078815:web:f6a9991da3e5832328b36a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function registerWithEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

function logout() {
  return signOut(auth);
}

function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export { auth, db, registerWithEmail, loginWithEmail, logout, onAuthChange };
