import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    getDatabase,
    ref,
    set,
    onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


// =====================================================
// FIREBASE CONFIGURATION
// =====================================================

const firebaseConfig = {
    apiKey: "AIzaSyD6y_ybBXjnSQ2uhv265U3c7rGW0V6tOA0",
    authDomain: "smartagri-8bd16.firebaseapp.com",
    databaseURL: "https://smartagri-8bd16-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "smartagri-8bd16",
    storageBucket: "smartagri-8bd16.firebasestorage.app",
    messagingSenderId: "946746280886",
    appId: "1:946746280886:web:efde01fbcc93b85cc78f17"
};


// =====================================================
// INITIALIZE FIREBASE
// =====================================================

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getDatabase(app);


// =====================================================
// DOM ELEMENTS
// =====================================================

const loaderScreen = document.getElementById("loader");

const loginScreen = document.getElementById("login-screen");

const dashboardScreen = document.getElementById("dashboard-screen");

const loginForm = document.getElementById("login-form");

const emailInput = document.getElementById("email");

const passwordInput = document.getElementById("password");

const loginError = document.getElementById("login-error");

const loginBtn = document.getElementById("login-btn");

const btnSpinner = document.querySelector(".btn-spinner");

const btnText = document.querySelector(".btn-text");

const userEmailDisplay = document.getElementById("user-email");

const logoutBtn = document.getElementById("logout-btn");

const connStatus = document.getElementById("connection-status");

const ledIndicator = document.getElementById("led-indicator");

const ledStateText = document.getElementById("led-state-text");

const btnOn = document.getElementById("btn-on");

const btnOff = document.getElementById("btn-off");

const rawDbState = document.getElementById("raw-db-state");

const lastUpdateTime = document.getElementById("last-update-time");


// =====================================================
// FIREBASE DATABASE PATH
// =====================================================

const ledRef = ref(db, "esp32/led/state");


// =====================================================
// VARIABLES
// =====================================================

let controlsDisabled = true;

let unsubscribeDatabase = null;


// =====================================================
// AUTHENTICATION STATE
// =====================================================

onAuthStateChanged(auth, (user) => {

    loaderScreen.classList.add("hidden");

    if (user) {

        console.log("User logged in:", user.email);

        userEmailDisplay.textContent = user.email;

        loginScreen.classList.add("hidden");

        dashboardScreen.classList.remove("hidden");

        setupDatabaseListener();

    } else {

        console.log("User logged out");

        dashboardScreen.classList.add("hidden");

        loginScreen.classList.remove("hidden");

        disableControls();

        if (unsubscribeDatabase) {
            unsubscribeDatabase();
            unsubscribeDatabase = null;
        }
    }
});


// =====================================================
// LOGIN
// =====================================================

loginForm.addEventListener("submit", async (event) => {

    event.preventDefault();

    const email = emailInput.value.trim();

    const password = passwordInput.value;

    loginError.classList.add("hidden");

    btnText.classList.add("hidden");

    btnSpinner.classList.remove("hidden");

    loginBtn.disabled = true;

    try {

        await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

        console.log("Login successful");

    } catch (error) {

        console.error("Login error:", error);

        if (
            error.code === "auth/invalid-credential" ||
            error.code === "auth/invalid-login-credentials" ||
            error.code === "auth/wrong-password" ||
            error.code === "auth/user-not-found"
        ) {

            loginError.textContent =
                "Invalid email or password.";

        } else {

            loginError.textContent =
                error.message;
        }

        loginError.classList.remove("hidden");

    } finally {

        btnText.classList.remove("hidden");

        btnSpinner.classList.add("hidden");

        loginBtn.disabled = false;
    }
});


// =====================================================
// LOGOUT
// =====================================================

logoutBtn.addEventListener("click", async () => {

    try {

        await signOut(auth);

        console.log("Logged out successfully");

    } catch (error) {

        console.error("Logout error:", error);
    }
});


// =====================================================
// FIREBASE DATABASE LISTENER
// =====================================================

function setupDatabaseListener() {

    // Remove previous listener
    if (unsubscribeDatabase) {

        unsubscribeDatabase();

        unsubscribeDatabase = null;
    }

    connStatus.textContent = "Connecting...";

    connStatus.className =
        "status-badge connecting";

    disableControls();


    unsubscribeDatabase = onValue(

        ledRef,

        (snapshot) => {

            console.log(
                "Firebase data received:",
                snapshot.val()
            );

            const state = snapshot.val();

            connStatus.textContent =
                "Connected to Firebase";

            connStatus.className =
                "status-badge connected";

            enableControls();

            updateUI(state === true);
        },

        (error) => {

            console.error(
                "Firebase read error:",
                error
            );

            connStatus.textContent =
                "Firebase Error";

            connStatus.className =
                "status-badge connecting";

            disableControls();
        }
    );
}


// =====================================================
// UPDATE UI
// =====================================================

function updateUI(isLedOn) {

    // LED indicator
    ledIndicator.className =
        `led-indicator ${isLedOn ? "on" : "off"}`;


    // State text
    ledStateText.textContent =
        isLedOn ? "LED ON" : "LED OFF";

    ledStateText.className =
        `state-text ${isLedOn ? "on-text" : "off-text"}`;


    // Buttons
    if (isLedOn) {

        btnOn.classList.add("active");

        btnOff.classList.remove("active");

    } else {

        btnOn.classList.remove("active");

        btnOff.classList.add("active");
    }


    // Firebase raw state
    rawDbState.textContent =
        isLedOn ? "true" : "false";


    // Last update
    lastUpdateTime.textContent =
        new Date().toLocaleTimeString();
}


// =====================================================
// DISABLE CONTROLS
// =====================================================

function disableControls() {

    controlsDisabled = true;

    btnOn.disabled = true;

    btnOff.disabled = true;
}


// =====================================================
// ENABLE CONTROLS
// =====================================================

function enableControls() {

    controlsDisabled = false;

    btnOn.disabled = false;

    btnOff.disabled = false;
}


// =====================================================
// TURN LED ON
// =====================================================

btnOn.addEventListener("click", async () => {

    if (controlsDisabled) return;

    try {

        await set(ledRef, true);

        console.log(
            "LED ON command sent to Firebase"
        );

    } catch (error) {

        console.error(
            "LED ON write error:",
            error
        );

        alert(
            "Unable to turn LED ON.\n" +
            error.message
        );
    }
});


// =====================================================
// TURN LED OFF
// =====================================================

btnOff.addEventListener("click", async () => {

    if (controlsDisabled) return;

    try {

        await set(ledRef, false);

        console.log(
            "LED OFF command sent to Firebase"
        );

    } catch (error) {

        console.error(
            "LED OFF write error:",
            error
        );

        alert(
            "Unable to turn LED OFF.\n" +
            error.message
        );
    }
});