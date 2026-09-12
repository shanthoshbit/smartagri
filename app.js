/**
 * SmartAgri – app.js  v3.0 (Mobile First)
 * ESP32 Agriculture Automation Dashboard
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, onValue, set, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyD6y_ybBXjnSQ2uhv265U3c7rGW0V6tOA0",
    authDomain: "smartagri-8bd16.firebaseapp.com",
    databaseURL: "https://smartagri-8bd16-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "smartagri-8bd16",
    storageBucket: "smartagri-8bd16.firebasestorage.app",
    messagingSenderId: "946746280886",
    appId: "1:946746280886:web:efde01fbcc93b85cc78f17"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getDatabase(fbApp);

/* ═══════════════════════════════════════════════════════════
   DOM REFERENCES
═══════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

// Screens
const elLoading = $("loading-screen");
const elLogin = $("login-screen");
const elApp = $("app-screen");

// Navigation
const navItems = document.querySelectorAll(".nav-item");
const screens = document.querySelectorAll(".screen");
const btnSeeAll = document.querySelector('[data-nav="control"]');

// Login
const loginForm = $("login-form");
const loginEmail = $("login-email");
const loginPwd = $("login-password");
const togglePwdBtn = $("toggle-password");
const loginBtn = $("login-btn");
const loginError = $("login-error");
const logoutBtn = $("logout-btn");

// Status Indicators
const homeFbStatus = $("home-fb-status");
const homeEspStatus = $("home-esp-status");
const offlineWarning = $("offline-warning");
const monFb = $("mon-fb");
const monEsp = $("mon-esp");
const monLastSeen = $("mon-last-seen");

// Toggles (Home Mini + Control Large)
const toggles = {
    pump: { mini: $("mini-toggle-pump"), large: $("toggle-pump") },
    valve1: { mini: $("mini-toggle-valve1"), large: $("toggle-valve1") },
    valve2: { mini: $("mini-toggle-valve2"), large: $("toggle-valve2") },
    valve3: { mini: $("mini-toggle-valve3"), large: $("toggle-valve3") },
    light: { large: $("toggle-light") }, // No mini on home for light
    fan: { large: $("toggle-fan") }      // No mini on home for fan
};

// Cards styling sync
const cards = {
    pump: { mini: $("mini-card-pump"), large: $("card-pump") },
    valve1: { mini: $("mini-card-valve1"), large: $("card-valve1") },
    valve2: { mini: $("mini-card-valve2"), large: $("card-valve2") },
    valve3: { mini: $("mini-card-valve3"), large: $("card-valve3") },
    light: { large: $("card-light") },
    fan: { large: $("card-fan") }
};

// Pump specific
const btnModeManual = $("btn-mode-manual");
const btnModeTimer = $("btn-mode-timer");
const pumpTimerView = $("pump-timer-view");
const timerActiveDisplay = $("timer-active-display");
const timerSetupDisplay = $("timer-setup-display");
const pumpTimeRem = $("pump-time-rem");
const pumpProgress = $("pump-progress");
const btnStopTimer = $("btn-stop-timer");
const btnStartTimer = $("btn-start-timer");
const tHr = $("t-hr");
const tMin = $("t-min");
const tSec = $("t-sec");
const presets = document.querySelectorAll(".btn-preset");

// Quick Actions
const btnAllOn = $("btn-all-on");
const btnAllOff = $("btn-all-off");

// Toast
const toastContainer = $("toast-container");

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */
let firebaseConnected = false;
let esp32Online = false;
let esp32LastSeen = 0;
let timerIntervalId = null;
let timerEndTime = 0;
let timerDuration = 0;
let ignorePumpToggle = false;
let appInitialized = false;

const DEVICE_PATHS = {
    pump: "waterPump",
    valve1: "valve1",
    valve2: "valve2",
    valve3: "valve3",
    light: "light",
    fan: "fan",
};

/* ═══════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════ */
function showToast(msg, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const icon = type === "success" ? "check_circle" : "error";
    toast.innerHTML = `<span class="material-symbols-outlined">${icon}</span> <span>${msg}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatHMS(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatTime(ts) {
    if (!ts) return "--:--:--";
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ═══════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════ */
function switchTab(targetId) {
    navItems.forEach(item => {
        item.classList.toggle("active", item.dataset.target === targetId);
    });
    screens.forEach(screen => {
        if (screen.id === `screen-${targetId}`) {
            screen.classList.remove("hidden");
            screen.classList.add("active");
        } else {
            screen.classList.add("hidden");
            screen.classList.remove("active");
        }
    });
}

navItems.forEach(item => {
    item.addEventListener("click", () => switchTab(item.dataset.target));
});

if (btnSeeAll) {
    btnSeeAll.addEventListener("click", () => switchTab("control"));
}

/* ═══════════════════════════════════════════════════════════
   SYSTEM STATUS & LOCK
═══════════════════════════════════════════════════════════ */
function updateSystemStatus() {
    const isOnline = firebaseConnected && esp32Online;
    
    // Home Status
    homeFbStatus.className = `status-indicator ${firebaseConnected ? 'connected' : 'offline'}`;
    homeFbStatus.querySelector(".status-text").textContent = firebaseConnected ? "Connected" : "Offline";
    
    homeEspStatus.className = `status-indicator ${esp32Online ? 'connected' : 'offline'}`;
    homeEspStatus.querySelector(".status-text").textContent = esp32Online ? "Online" : "Offline";

    // Monitor Status
    monFb.className = `sys-val badge ${firebaseConnected ? 'green' : 'red'}`;
    monFb.textContent = firebaseConnected ? "Connected" : "Offline";
    
    monEsp.className = `sys-val badge ${esp32Online ? 'green' : 'red'}`;
    monEsp.textContent = esp32Online ? "Online" : "Offline";
    
    monLastSeen.textContent = formatTime(esp32LastSeen);

    // Lock/Unlock
    if (isOnline) {
        offlineWarning.classList.add("hidden");
        setControlsDisabled(false);
    } else {
        offlineWarning.classList.remove("hidden");
        setControlsDisabled(true);
    }
}

function setControlsDisabled(disabled) {
    Object.values(toggles).forEach(group => {
        if(group.mini) group.mini.disabled = disabled;
        if(group.large) group.large.disabled = disabled;
    });
    btnStartTimer.disabled = disabled;
    btnStopTimer.disabled = disabled;
    btnAllOn.disabled = disabled;
    btnAllOff.disabled = disabled;
}

/* ═══════════════════════════════════════════════════════════
   ESP32 HEARTBEAT
═══════════════════════════════════════════════════════════ */
function checkEsp32Online(data) {
    if (!data) return false;
    if (data.esp32Online === true || data.online === true) return true;
    const ts = data.lastSeen ?? 0;
    if (ts > 0) {
        const ageMs = (ts < 10000000000) ? (Date.now() - ts * 1000) : (Date.now() - ts);
        return ageMs < 60000;
    }
    return false;
}

setInterval(() => {
    if (esp32LastSeen > 0) {
        const ageMs = (esp32LastSeen < 10000000000) ? (Date.now() - esp32LastSeen * 1000) : (Date.now() - esp32LastSeen);
        const stillAlive = ageMs < 60000;
        if (esp32Online !== stillAlive) {
            esp32Online = stillAlive;
            updateSystemStatus();
        }
    }
}, 3000);

/* ═══════════════════════════════════════════════════════════
   FIREBASE LISTENERS
═══════════════════════════════════════════════════════════ */
function startListeners() {
    onValue(ref(db, ".info/connected"), snap => {
        firebaseConnected = snap.val() === true;
        updateSystemStatus();
    });

    onValue(ref(db, "system"), snap => {
        const data = snap.val() ?? {};
        esp32LastSeen = data.lastSeen ?? 0;
        esp32Online = checkEsp32Online(data);
        updateSystemStatus();
    });

    ["valve1", "valve2", "valve3", "light", "fan"].forEach(key => {
        onValue(ref(db, `agriculture/${DEVICE_PATHS[key]}/state`), snap => {
            const state = snap.val() === true;
            syncDeviceUI(key, state);
        });
    });

    onValue(ref(db, "agriculture/waterPump"), snap => {
        const data = snap.val() ?? {};
        const state = data.state === true;
        const mode = data.mode ?? "manual";
        const timer = data.timer ?? {};

        syncDeviceUI("pump", state);

        // Update Pump Timer UI
        if(mode === "timer") {
            btnModeTimer.classList.add("active");
            btnModeManual.classList.remove("active");
            pumpTimerView.classList.remove("hidden");
        } else {
            btnModeManual.classList.add("active");
            btnModeTimer.classList.remove("active");
            pumpTimerView.classList.add("hidden");
        }

        const timerEnabled = timer.enabled === true;
        const fbEnd = timer.endTime ?? 0;
        const fbDur = timer.duration ?? 0;

        if (timerEnabled && fbEnd > 0) {
            timerEndTime = fbEnd;
            timerDuration = fbDur;
            if (timerEndTime - Date.now() > 0) {
                timerActiveDisplay.classList.remove("hidden");
                timerSetupDisplay.classList.add("hidden");
                startCountdown();
            } else {
                handleTimerExpired();
            }
        } else {
            stopCountdown();
            timerActiveDisplay.classList.add("hidden");
            timerSetupDisplay.classList.remove("hidden");
        }
    });
}

function syncDeviceUI(key, state) {
    if (toggles[key].mini && toggles[key].mini.checked !== state) toggles[key].mini.checked = state;
    if (toggles[key].large && toggles[key].large.checked !== state) {
        if(key === "pump") ignorePumpToggle = true;
        toggles[key].large.checked = state;
    }
    
    if(cards[key].mini) cards[key].mini.classList.toggle("active", state);
    if(cards[key].large) cards[key].large.classList.toggle("active", state);
}

/* ═══════════════════════════════════════════════════════════
   DEVICE TOGGLES
═══════════════════════════════════════════════════════════ */
function bindToggles() {
    ["valve1", "valve2", "valve3", "light", "fan"].forEach(key => {
        const handle = async (e) => {
            if (!firebaseConnected || !esp32Online) {
                e.preventDefault();
                e.target.checked = !e.target.checked;
                showToast("System offline. Controls locked.", "error");
                return;
            }
            const on = e.target.checked;
            try {
                await set(ref(db, `agriculture/${DEVICE_PATHS[key]}/state`), on);
            } catch (err) {
                e.target.checked = !on;
                showToast("Failed to sync", "error");
            }
        };
        if (toggles[key].mini) toggles[key].mini.addEventListener("change", handle);
        if (toggles[key].large) toggles[key].large.addEventListener("change", handle);
    });

    const handlePump = async (e) => {
        if (ignorePumpToggle) { ignorePumpToggle = false; return; }
        if (!firebaseConnected || !esp32Online) {
            e.preventDefault();
            e.target.checked = !e.target.checked;
            ignorePumpToggle = true;
            showToast("System offline. Controls locked.", "error");
            return;
        }
        const on = e.target.checked;
        try {
            if (!on) {
                await update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" });
                await update(ref(db, "agriculture/waterPump/timer"), { enabled: false, startTime: 0, endTime: 0, duration: 0 });
            } else {
                await update(ref(db, "agriculture/waterPump"), { state: true, mode: "manual" });
            }
        } catch (err) {
            e.target.checked = !on;
            ignorePumpToggle = true;
            showToast("Failed to sync", "error");
        }
    };
    toggles.pump.mini.addEventListener("change", handlePump);
    toggles.pump.large.addEventListener("change", handlePump);
}

// Quick Actions
btnAllOn.addEventListener("click", () => setAllValves(true));
btnAllOff.addEventListener("click", () => setAllValves(false));

async function setAllValves(state) {
    if (!firebaseConnected || !esp32Online) return showToast("System Offline", "error");
    try {
        const updates = {
            "agriculture/valve1/state": state,
            "agriculture/valve2/state": state,
            "agriculture/valve3/state": state
        };
        await update(ref(db), updates);
        showToast(`All valves turned ${state ? 'ON' : 'OFF'}`);
    } catch(e) { showToast("Failed to sync", "error"); }
}

/* ═══════════════════════════════════════════════════════════
   PUMP TIMER LOGIC
═══════════════════════════════════════════════════════════ */
btnModeManual.addEventListener("click", () => {
    update(ref(db, "agriculture/waterPump/mode"), "manual");
});
btnModeTimer.addEventListener("click", () => {
    update(ref(db, "agriculture/waterPump/mode"), "timer");
});

presets.forEach(btn => {
    btn.addEventListener("click", () => {
        presets.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const mins = parseInt(btn.dataset.min);
        tHr.value = Math.floor(mins / 60);
        tMin.value = mins % 60;
        tSec.value = 0;
    });
});

btnStartTimer.addEventListener("click", async () => {
    const h = parseInt(tHr.value || 0);
    const m = parseInt(tMin.value || 0);
    const s = parseInt(tSec.value || 0);
    const tot = h * 3600 + m * 60 + s;
    if (tot <= 0) return showToast("Enter a duration", "error");
    
    const now = Date.now();
    try {
        await update(ref(db, "agriculture/waterPump"), { state: true, mode: "timer" });
        await update(ref(db, "agriculture/waterPump/timer"), { enabled: true, startTime: now, endTime: now + tot * 1000, duration: tot });
        showToast("Timer Started");
    } catch (e) { showToast("Failed to start timer", "error"); }
});

btnStopTimer.addEventListener("click", async () => {
    try {
        await update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" });
        await update(ref(db, "agriculture/waterPump/timer"), { enabled: false, startTime: 0, endTime: 0, duration: 0 });
    } catch(e) {}
});

function startCountdown() {
    stopCountdown();
    timerIntervalId = setInterval(() => {
        const rem = timerEndTime - Date.now();
        if (rem <= 0) { handleTimerExpired(); return; }
        pumpTimeRem.textContent = formatHMS(rem);
        const pct = (rem / (timerDuration * 1000)) * 100;
        pumpProgress.style.width = `${Math.max(0, pct)}%`;
    }, 500);
}

function stopCountdown() {
    if (timerIntervalId) clearInterval(timerIntervalId);
    pumpTimeRem.textContent = "00:00";
    pumpProgress.style.width = "100%";
}

function handleTimerExpired() {
    stopCountdown();
    update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" });
    update(ref(db, "agriculture/waterPump/timer"), { enabled: false, startTime: 0, endTime: 0, duration: 0 });
}

/* ═══════════════════════════════════════════════════════════
   AUTH & INIT
═══════════════════════════════════════════════════════════ */
loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    loginError.classList.add("hidden");
    const eVal = loginEmail.value.trim();
    const pVal = loginPwd.value;
    if (!eVal || !pVal) return;
    
    loginBtn.disabled = true;
    loginBtn.querySelector(".btn-text").classList.add("hidden");
    loginBtn.querySelector(".btn-spinner").classList.remove("hidden");

    try {
        await signInWithEmailAndPassword(auth, eVal, pVal);
    } catch (err) {
        loginError.textContent = err.message;
        loginError.classList.remove("hidden");
    } finally {
        loginBtn.disabled = false;
        loginBtn.querySelector(".btn-text").classList.remove("hidden");
        loginBtn.querySelector(".btn-spinner").classList.add("hidden");
    }
});

togglePwdBtn.addEventListener("click", () => {
    loginPwd.type = loginPwd.type === "password" ? "text" : "password";
});

logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, user => {
    if (user) {
        elLoading.classList.add("fade-out");
        elLogin.classList.add("hidden");
        elApp.classList.remove("hidden");
        if (!appInitialized) {
            appInitialized = true;
            bindToggles();
            startListeners();
        }
    } else {
        elLoading.classList.add("fade-out");
        elLogin.classList.remove("hidden");
        elApp.classList.add("hidden");
        stopCountdown();
    }
});