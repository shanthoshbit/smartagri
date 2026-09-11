/**
 * SmartAgri – app.js  v2.1
 * ESP32 Agriculture Automation Dashboard
 *
 * Changes in v2.1:
 *  - Timer settings collapsed by default (accordion button)
 *  - Inline remaining-time display on pump card (always visible when active)
 *  - Toast notifications moved to top-right
 *  - Improved mobile UX
 *
 * Firebase Modular SDK v10
 * GPIO Map: 16=Pump · 17=V1 · 18=V2 · 19=V3 · 25=Light · 26=Fan
 */

/* ═══════════════════════════════════════════════════════════
   1. FIREBASE CONFIGURATION
═══════════════════════════════════════════════════════════ */
import { initializeApp }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, onValue, set, update, get }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
    apiKey:            "AIzaSyD6y_ybBXjnSQ2uhv265U3c7rGW0V6tOA0",
    authDomain:        "smartagri-8bd16.firebaseapp.com",
    databaseURL:       "https://smartagri-8bd16-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "smartagri-8bd16",
    storageBucket:     "smartagri-8bd16.firebasestorage.app",
    messagingSenderId: "946746280886",
    appId:             "1:946746280886:web:efde01fbcc93b85cc78f17"
};

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getDatabase(fbApp);

/* ═══════════════════════════════════════════════════════════
   2. DOM REFERENCES
═══════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

// Screens
const elLoading   = $("loading-screen");
const elLogin     = $("login-screen");
const elDashboard = $("dashboard");

// Login
const loginForm    = $("login-form");
const loginEmail   = $("login-email");
const loginPwd     = $("login-password");
const togglePwdBtn = $("toggle-password");
const loginBtn     = $("login-btn");
const loginError   = $("login-error");

// Header
const headerEmail      = $("header-email");
const logoutBtn        = $("logout-btn");
const headerFbBadge    = $("header-firebase-badge");
const headerTime       = $("header-time");

// Status strip
const sbFirebase    = $("sb-firebase");
const sbEsp32       = $("sb-esp32");
const sbActiveCount = $("sb-active-count");
const sbLastSeen    = $("sb-last-seen");
const errBanner     = $("firebase-error-banner");

// Device toggles
const deviceToggles = {
    pump:   $("pump-toggle"),
    valve1: $("valve1-toggle"),
    valve2: $("valve2-toggle"),
    valve3: $("valve3-toggle"),
    light:  $("light-toggle"),
    fan:    $("fan-toggle"),
};

// Device status dots/labels
const statusDots = {
    pump:   $("pump-status-dot"),
    valve1: $("valve1-status-dot"),
    valve2: $("valve2-status-dot"),
    valve3: $("valve3-status-dot"),
    light:  $("light-status-dot"),
    fan:    $("fan-status-dot"),
};
const statusLabels = {
    pump:   $("pump-status-label"),
    valve1: $("valve1-status-label"),
    valve2: $("valve2-status-label"),
    valve3: $("valve3-status-label"),
    light:  $("light-status-label"),
    fan:    $("fan-status-label"),
};
const deviceCards = {
    pump:   $("card-pump"),
    valve1: $("card-valve1"),
    valve2: $("card-valve2"),
    valve3: $("card-valve3"),
    light:  $("card-light"),
    fan:    $("card-fan"),
};

// Pump-specific
const pumpModeBadge   = $("pump-mode-badge");

// Inline timer display (always-visible when active)
const pumpTimerMini       = $("pump-timer-mini");
const pumpRemainingInline = $("pump-remaining-inline");
const pumpProgressWrap    = $("pump-progress-wrap");
const pumpProgressBar     = $("pump-progress-bar");

// Timer accordion
const timerToggleBtn  = $("timer-toggle-btn");
const timerPanel      = $("timer-panel");

// Timer inputs & buttons
const presetBtns        = document.querySelectorAll(".preset-btn");
const timerHoursInput   = $("timer-hours");
const timerMinsInput    = $("timer-minutes");
const timerSecsInput    = $("timer-seconds");
const startTimerBtn     = $("start-timer-btn");
const stopTimerBtn      = $("stop-timer-btn");
const timerCompletedDiv = $("timer-completed-display");

/* ═══════════════════════════════════════════════════════════
   3. STATE
═══════════════════════════════════════════════════════════ */
let firebaseConnected        = false;
let timerIntervalId          = null;
let timerEndTime             = 0;   // absolute ms
let timerDuration            = 0;   // seconds
let ignorePumpToggle         = false;
let dashboardInitialized     = false;

const DEVICE_PATHS = {
    pump:   "waterPump",
    valve1: "valve1",
    valve2: "valve2",
    valve3: "valve3",
    light:  "light",
    fan:    "fan",
};

/* ═══════════════════════════════════════════════════════════
   4. UTILITIES
═══════════════════════════════════════════════════════════ */
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

function formatHMS(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return [h, m, sec].map(n => String(n).padStart(2, "0")).join(":");
}

function formatTime(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function durationLabel(h, m, s) {
    const p = [];
    if (h) p.push(`${h}h`);
    if (m) p.push(`${m}m`);
    if (s) p.push(`${s}s`);
    return p.join(" ") || "0s";
}

/* ═══════════════════════════════════════════════════════════
   5. TOAST NOTIFICATIONS
═══════════════════════════════════════════════════════════ */
const ICONS = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };

function showToast(message, type = "info", title = "", duration = 3500) {
    const container = $("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "alert");
    toast.innerHTML = `
        <span class="toast-icon">${ICONS[type] ?? "ℹ️"}</span>
        <div class="toast-body">
            ${title ? `<div class="toast-title">${title}</div>` : ""}
            <div class="toast-msg">${message}</div>
        </div>
        <button class="toast-close" aria-label="Dismiss">✕</button>`;

    const closeBtn = toast.querySelector(".toast-close");
    const autoTimer = setTimeout(() => dismissToast(toast), duration);
    closeBtn.addEventListener("click", () => { clearTimeout(autoTimer); dismissToast(toast); });

    container.appendChild(toast);
}

function dismissToast(toast) {
    toast.classList.add("toast-exit");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
}

/* ═══════════════════════════════════════════════════════════
   6. SCREEN TRANSITIONS
═══════════════════════════════════════════════════════════ */
function hideLoading() {
    elLoading.classList.add("fade-out");
}

function showLogin() {
    hideLoading();
    show(elLogin);
    hide(elDashboard);
}

function showDashboard(user) {
    hideLoading();
    hide(elLogin);
    show(elDashboard);
    headerEmail.textContent = user.email ?? "";
    startClock();
}

/* ═══════════════════════════════════════════════════════════
   7. CLOCK
═══════════════════════════════════════════════════════════ */
function startClock() {
    const tick = () => {
        headerTime.textContent = new Date().toLocaleTimeString([], {
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        });
    };
    tick();
    setInterval(tick, 1000);
}

/* ═══════════════════════════════════════════════════════════
   8. FIREBASE CONNECTION STATUS
═══════════════════════════════════════════════════════════ */
function watchFirebaseConnection() {
    onValue(ref(db, ".info/connected"), snap => {
        firebaseConnected = snap.val() === true;

        const status = firebaseConnected ? "connected" : "disconnected";
        setConnectionBadge(headerFbBadge, "conn", status,
            firebaseConnected ? "Connected" : "Disconnected");
        setConnectionBadge(sbFirebase, "pill", status,
            firebaseConnected ? "Connected" : "Disconnected");

        if (firebaseConnected) {
            hide(errBanner);
            document.getElementById("cards-grid").classList.remove("controls-disabled");
            showToast("Firebase connected", "success", "Connection", 2500);
        } else {
            show(errBanner);
            document.getElementById("cards-grid").classList.add("controls-disabled");
            showToast("Firebase connection lost", "error", "Connection", 4000);
        }
    });
}

/**
 * Update a badge/pill element's class and label text.
 * @param {HTMLElement} el
 * @param {'conn'|'pill'} prefix   - CSS class prefix
 * @param {string} status          - e.g. "connected"
 * @param {string} labelText
 */
function setConnectionBadge(el, prefix, status, labelText) {
    // Remove old status class
    el.classList.forEach(c => { if (c.startsWith(`${prefix}-`)) el.classList.remove(c); });
    el.classList.add(`${prefix}-${status}`);
    const span = el.querySelector("span:last-child");
    if (span) span.textContent = labelText;
}

/* ═══════════════════════════════════════════════════════════
   9. ESP32 STATUS
═══════════════════════════════════════════════════════════ */
function watchEsp32Status() {
    onValue(ref(db, "system"), snap => {
        const data     = snap.val() ?? {};
        const lastSeen = data.lastSeen ?? 0;
        const online   = (Date.now() - lastSeen) < 15000;

        sbEsp32.className = "";
        sbEsp32.classList.add("ss-pill", online ? "pill-online" : "pill-offline");
        sbEsp32.innerHTML = `<span class="ss-dot"></span><span>${online ? "Online" : "Offline"}</span>`;
        sbLastSeen.textContent = lastSeen ? formatTime(lastSeen) : "—";
    });
}

/* ═══════════════════════════════════════════════════════════
   10. DEVICE UI HELPERS
═══════════════════════════════════════════════════════════ */
function updateDeviceUI(key, state) {
    const dot    = statusDots[key];
    const label  = statusLabels[key];
    const toggle = deviceToggles[key];
    const card   = deviceCards[key];
    if (!dot || !label || !toggle || !card) return;

    dot.className   = `state-dot ${state ? "dot-on" : "dot-off"}`;
    label.className = `state-label ${state ? "lbl-on" : "lbl-off"}`;
    label.textContent = state ? "ON" : "OFF";
    card.classList.toggle("card-active", state);

    if (toggle.checked !== state) {
        if (key === "pump") ignorePumpToggle = true;
        toggle.checked = state;
    }
}

function updateActiveCount() {
    let n = 0;
    Object.values(deviceToggles).forEach(t => { if (t.checked) n++; });
    sbActiveCount.textContent = String(n);
}

/* ═══════════════════════════════════════════════════════════
   11. FIREBASE REALTIME LISTENERS
═══════════════════════════════════════════════════════════ */
function startDeviceListeners() {
    // Simple devices
    ["valve1", "valve2", "valve3", "light", "fan"].forEach(key => {
        onValue(ref(db, `agriculture/${DEVICE_PATHS[key]}/state`), snap => {
            updateDeviceUI(key, snap.val() === true);
            updateActiveCount();
        });
    });

    // Water pump (state + timer)
    onValue(ref(db, "agriculture/waterPump"), snap => {
        const data  = snap.val() ?? {};
        const state = data.state === true;
        const mode  = data.mode ?? "manual";
        const timer = data.timer ?? {};

        updateDeviceUI("pump", state);
        updateActiveCount();

        // Mode badge
        pumpModeBadge.textContent = mode === "timer" ? "Timer" : "Manual";
        pumpModeBadge.className   = `mode-chip ${mode === "timer" ? "chip-timer" : "chip-manual"}`;

        // Timer
        const timerEnabled = timer.enabled === true;
        const fbEnd        = timer.endTime   ?? 0;
        const fbDur        = timer.duration  ?? 0;

        if (timerEnabled && fbEnd > 0) {
            timerEndTime  = fbEnd;
            timerDuration = fbDur;
            const rem = timerEndTime - Date.now();
            if (rem > 0) {
                showPumpTimerActive();
                startCountdown();
            } else {
                handleTimerExpired();
            }
        } else {
            stopCountdown();
            hidePumpTimerActive();
            if (!state && mode === "timer") {
                showTimerDone();
            } else {
                hide(timerCompletedDiv);
            }
        }
    });
}

/* ═══════════════════════════════════════════════════════════
   12. DEVICE TOGGLE HANDLERS
═══════════════════════════════════════════════════════════ */
function bindSimpleToggle(key, path) {
    deviceToggles[key].addEventListener("change", async e => {
        const on = e.target.checked;
        try {
            await set(ref(db, `agriculture/${path}/state`), on);
            showToast(
                `${deviceLabel(key)} turned ${on ? "ON" : "OFF"}`,
                on ? "success" : "info",
                "Device Control"
            );
        } catch (err) {
            console.error(err);
            showToast(`Unable to update ${deviceLabel(key)}. Check connection.`, "error", "Error");
            e.target.checked = !on;
        }
    });
}

function bindPumpToggle() {
    deviceToggles.pump.addEventListener("change", async e => {
        if (ignorePumpToggle) { ignorePumpToggle = false; return; }
        const on = e.target.checked;
        try {
            if (!on) {
                // Manual OFF — also cancel any timer
                await update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" });
                await update(ref(db, "agriculture/waterPump/timer"),
                    { enabled: false, startTime: 0, endTime: 0, duration: 0 });
                showToast("Water Pump turned OFF", "info", "Device Control");
                stopCountdown();
            } else {
                await update(ref(db, "agriculture/waterPump"), { state: true, mode: "manual" });
                showToast("Water Pump turned ON", "success", "Device Control");
            }
        } catch (err) {
            console.error(err);
            showToast("Unable to update Water Pump. Check connection.", "error", "Error");
            ignorePumpToggle = true;
            e.target.checked = !on;
        }
    });
}

function deviceLabel(key) {
    const map = { pump:"Water Pump", valve1:"Valve 1", valve2:"Valve 2",
                  valve3:"Valve 3", light:"Light", fan:"Fan" };
    return map[key] ?? key;
}

/* ═══════════════════════════════════════════════════════════
   13. TIMER ACCORDION
═══════════════════════════════════════════════════════════ */
function initTimerAccordion() {
    timerToggleBtn.addEventListener("click", () => {
        const isOpen = timerToggleBtn.getAttribute("aria-expanded") === "true";
        timerToggleBtn.setAttribute("aria-expanded", String(!isOpen));
        timerPanel.setAttribute("aria-hidden", String(isOpen));
        timerPanel.classList.toggle("collapsed", isOpen);
    });
}

/** Auto-open accordion when timer is active so user can see STOP button */
function openTimerAccordion() {
    timerToggleBtn.setAttribute("aria-expanded", "true");
    timerPanel.setAttribute("aria-hidden", "false");
    timerPanel.classList.remove("collapsed");
}

/* ═══════════════════════════════════════════════════════════
   14. PRESET BUTTONS
═══════════════════════════════════════════════════════════ */
presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        presetBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const mins = parseInt(btn.dataset.minutes, 10);
        timerHoursInput.value = Math.floor(mins / 60);
        timerMinsInput.value  = mins % 60;
        timerSecsInput.value  = 0;
    });
});

/* ═══════════════════════════════════════════════════════════
   15. TIMER — START
═══════════════════════════════════════════════════════════ */
startTimerBtn.addEventListener("click", async () => {
    const h   = parseInt(timerHoursInput.value, 10) || 0;
    const m   = parseInt(timerMinsInput.value,  10) || 0;
    const s   = parseInt(timerSecsInput.value,  10) || 0;
    const tot = h * 3600 + m * 60 + s;

    if (tot <= 0) {
        showToast("Select or enter a valid duration first.", "warning", "Timer");
        return;
    }

    const now    = Date.now();
    const endTs  = now + tot * 1000;

    try {
        await update(ref(db, "agriculture/waterPump"), { state: true, mode: "timer" });
        await update(ref(db, "agriculture/waterPump/timer"), {
            enabled: true, startTime: now, endTime: endTs, duration: tot
        });
        showToast(`Timer started — ${durationLabel(h, m, s)}`, "success", "Pump Timer");
        presetBtns.forEach(b => b.classList.remove("active"));
    } catch (err) {
        console.error(err);
        showToast("Unable to start timer. Check connection.", "error", "Error");
    }
});

/* ═══════════════════════════════════════════════════════════
   16. TIMER — STOP
═══════════════════════════════════════════════════════════ */
stopTimerBtn.addEventListener("click", async () => {
    try {
        await update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" });
        await update(ref(db, "agriculture/waterPump/timer"),
            { enabled: false, startTime: 0, endTime: 0, duration: 0 });
        showToast("Timer stopped — Pump OFF", "info", "Pump Timer");
        stopCountdown();
    } catch (err) {
        console.error(err);
        showToast("Unable to stop timer. Check connection.", "error", "Error");
    }
});

/* ═══════════════════════════════════════════════════════════
   17. TIMER — COUNTDOWN DISPLAY
═══════════════════════════════════════════════════════════ */
function showPumpTimerActive() {
    show(pumpTimerMini);
    show(pumpProgressWrap);
    openTimerAccordion();
}

function hidePumpTimerActive() {
    hide(pumpTimerMini);
    hide(pumpProgressWrap);
}

function startCountdown() {
    stopCountdown();   // prevent duplicates
    timerIntervalId = setInterval(() => {
        const rem = timerEndTime - Date.now();
        if (rem <= 0) { handleTimerExpired(); return; }

        // Update inline display
        pumpRemainingInline.textContent = formatHMS(rem);

        // Progress bar — shrinks from 100% → 0%
        const pct = (rem / (timerDuration * 1000)) * 100;
        pumpProgressBar.style.width = `${Math.max(0, pct)}%`;
    }, 500);
}

function stopCountdown() {
    if (timerIntervalId) { clearInterval(timerIntervalId); timerIntervalId = null; }
    pumpRemainingInline.textContent  = "00:00:00";
    pumpProgressBar.style.width = "100%";
}

function handleTimerExpired() {
    stopCountdown();
    hidePumpTimerActive();
    showTimerDone();
    showToast("Water Pump timer complete — Pump OFF", "success", "Timer Complete", 5000);
}

function showTimerDone() {
    show(timerCompletedDiv);
    setTimeout(() => hide(timerCompletedDiv), 8000);
}

/* ═══════════════════════════════════════════════════════════
   18. LOGIN
═══════════════════════════════════════════════════════════ */
loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    hide(loginError);

    const email    = loginEmail.value.trim();
    const password = loginPwd.value;
    if (!email || !password) { showError("Please enter both email and password."); return; }

    loginBtn.disabled = true;
    loginBtn.querySelector(".btn-text").classList.add("hidden");
    loginBtn.querySelector(".btn-spin").classList.remove("hidden");

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        showError(friendlyError(err.code));
    } finally {
        loginBtn.disabled = false;
        loginBtn.querySelector(".btn-text").classList.remove("hidden");
        loginBtn.querySelector(".btn-spin").classList.add("hidden");
    }
});

function showError(msg) { loginError.textContent = msg; show(loginError); }

function friendlyError(code) {
    return {
        "auth/invalid-email":          "The email address is not valid.",
        "auth/user-disabled":          "This account has been disabled.",
        "auth/user-not-found":         "No account found with this email.",
        "auth/wrong-password":         "Incorrect password.",
        "auth/invalid-credential":     "Invalid credentials. Check email and password.",
        "auth/too-many-requests":      "Too many attempts. Please wait and try again.",
        "auth/network-request-failed": "Network error. Check your connection.",
    }[code] ?? `Auth error (${code}). Please try again.`;
}

// Password eye toggle
togglePwdBtn.addEventListener("click", () => {
    const show = loginPwd.type === "password";
    loginPwd.type            = show ? "text" : "password";
    togglePwdBtn.textContent = show ? "🙈" : "👁";
});

/* ═══════════════════════════════════════════════════════════
   19. LOGOUT
═══════════════════════════════════════════════════════════ */
logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        showToast("Logged out.", "info", "Auth");
    } catch (err) { console.error(err); }
});

/* ═══════════════════════════════════════════════════════════
   20. AUTH STATE OBSERVER
═══════════════════════════════════════════════════════════ */
onAuthStateChanged(auth, user => {
    if (user) {
        showDashboard(user);
        initDashboard();
    } else {
        stopCountdown();
        dashboardInitialized = false;
        showLogin();
    }
});

/* ═══════════════════════════════════════════════════════════
   21. DASHBOARD INIT
═══════════════════════════════════════════════════════════ */
function initDashboard() {
    if (dashboardInitialized) return;
    dashboardInitialized = true;

    // Toggle handlers
    bindPumpToggle();
    bindSimpleToggle("valve1", "valve1");
    bindSimpleToggle("valve2", "valve2");
    bindSimpleToggle("valve3", "valve3");
    bindSimpleToggle("light",  "light");
    bindSimpleToggle("fan",    "fan");

    // Timer accordion
    initTimerAccordion();

    // Firebase listeners
    watchFirebaseConnection();
    watchEsp32Status();
    startDeviceListeners();

    // Seed DB structure if first run
    ensureDbStructure();
}

/* ═══════════════════════════════════════════════════════════
   22. SEED DATABASE STRUCTURE (first-run only)
═══════════════════════════════════════════════════════════ */
async function ensureDbStructure() {
    try {
        const snap = await get(ref(db, "agriculture"));
        if (snap && snap.exists()) return;   // already set up

        await set(ref(db, "/"), {
            agriculture: {
                waterPump: { state: false, mode: "manual",
                    timer: { enabled: false, startTime: 0, endTime: 0, duration: 0 } },
                valve1: { state: false },
                valve2: { state: false },
                valve3: { state: false },
                light:  { state: false },
                fan:    { state: false },
            },
            system: { esp32Online: false, lastSeen: 0 },
        });
    } catch (err) { console.warn("DB seed skipped:", err.message); }
}

/* ═══════════════════════════════════════════════════════════
   23. UNLOAD GUARD (active timer warning)
═══════════════════════════════════════════════════════════ */
window.addEventListener("beforeunload", e => {
    if (timerIntervalId) {
        e.preventDefault();
        e.returnValue = "A pump timer is running. The ESP32 will continue automatically.";
    }
});