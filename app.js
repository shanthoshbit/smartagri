/**
 * SmartAgri – app.js
 * ESP32 Agriculture Automation Dashboard
 *
 * Architecture:
 *  - Firebase Modular SDK (v10+)
 *  - Firebase Authentication (email / password)
 *  - Firebase Realtime Database (onValue listeners)
 *  - Water Pump timer uses absolute endTime stored in Firebase
 *    so the ESP32 can enforce shutoff independently of the browser.
 *
 * GPIO Map:
 *  16 → Water Pump
 *  17 → Solenoid Valve 1
 *  18 → Solenoid Valve 2
 *  19 → Solenoid Valve 3
 *  25 → Agriculture Light
 *  26 → Exhaust / Farm Fan
 */

/* ============================================================
   1. FIREBASE CONFIGURATION
   ============================================================ */
import { initializeApp }                     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword,
         signOut, onAuthStateChanged }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, onValue, set,
         update, serverTimestamp }            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/** Firebase project configuration (no password stored here) */
const firebaseConfig = {
    apiKey:            "AIzaSyD6y_ybBXjnSQ2uhv265U3c7rGW0V6tOA0",
    authDomain:        "smartagri-8bd16.firebaseapp.com",
    databaseURL:       "https://smartagri-8bd16-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "smartagri-8bd16",
    storageBucket:     "smartagri-8bd16.firebasestorage.app",
    messagingSenderId: "946746280886",
    appId:             "1:946746280886:web:efde01fbcc93b85cc78f17"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

/* ============================================================
   2. DOM ELEMENT REFERENCES
   ============================================================ */
const $ = id => document.getElementById(id);

// Screens
const loadingScreen  = $("loading-screen");
const loginScreen    = $("login-screen");
const dashboard      = $("dashboard");

// Login form
const loginForm      = $("login-form");
const loginEmail     = $("login-email");
const loginPassword  = $("login-password");
const togglePwdBtn   = $("toggle-password");
const loginBtn       = $("login-btn");
const loginError     = $("login-error");

// Header
const headerEmail    = $("header-email");
const logoutBtn      = $("logout-btn");
const headerFbBadge  = $("header-firebase-badge");
const headerTime     = $("header-time");

// Status bar
const sbFirebase     = $("sb-firebase");
const sbEsp32        = $("sb-esp32");
const sbActiveCount  = $("sb-active-count");
const sbLastSeen     = $("sb-last-seen");
const firebaseErrBanner = $("firebase-error-banner");

// Device toggles
const deviceToggles = {
    pump:   $("pump-toggle"),
    valve1: $("valve1-toggle"),
    valve2: $("valve2-toggle"),
    valve3: $("valve3-toggle"),
    light:  $("light-toggle"),
    fan:    $("fan-toggle"),
};

// Device status elements
const deviceStatusDots = {
    pump:   $("pump-status-dot"),
    valve1: $("valve1-status-dot"),
    valve2: $("valve2-status-dot"),
    valve3: $("valve3-status-dot"),
    light:  $("light-status-dot"),
    fan:    $("fan-status-dot"),
};
const deviceStatusLabels = {
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

// Timer UI elements
const presetBtns         = document.querySelectorAll(".preset-btn");
const timerHoursInput    = $("timer-hours");
const timerMinutesInput  = $("timer-minutes");
const timerSecondsInput  = $("timer-seconds");
const startTimerBtn      = $("start-timer-btn");
const stopTimerBtn       = $("stop-timer-btn");
const timerActiveDisplay = $("timer-active-display");
const timerRemaining     = $("timer-remaining");
const timerProgressBar   = $("timer-progress-bar");
const timerCompletedDisp = $("timer-completed-display");
const pumpModeBadge      = $("pump-mode-badge");

/* ============================================================
   3. APPLICATION STATE
   ============================================================ */
let firebaseConnected   = false;  // tracks DB connectivity
let timerIntervalId     = null;   // JS countdown interval (display only)
let timerEndTime        = 0;      // absolute timestamp (ms) from Firebase
let timerDuration       = 0;      // total duration (seconds) from Firebase
let ignorePumpToggleOnce = false; // prevents feedback loop when Firebase → UI

// Map of device key → Firebase path segment
const DEVICE_PATHS = {
    pump:   "waterPump",
    valve1: "valve1",
    valve2: "valve2",
    valve3: "valve3",
    light:  "light",
    fan:    "fan",
};

/* ============================================================
   4. UTILITIES
   ============================================================ */

/** Show / hide an element */
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

/** Format milliseconds remaining into HH:MM:SS */
function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

/** Format a Unix timestamp to a human-readable time */
function formatTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ============================================================
   5. TOAST NOTIFICATIONS
   ============================================================ */

const TOAST_ICONS = {
    success: "✅",
    error:   "❌",
    warning: "⚠️",
    info:    "ℹ️",
};

/**
 * Show a toast notification.
 * @param {string} message  - Main message text
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {string} [title]  - Optional bold title
 * @param {number} [duration] - Auto-dismiss ms (default 3500)
 */
function showToast(message, type = "info", title = "", duration = 3500) {
    const container = $("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "alert");

    toast.innerHTML = `
        <span class="toast-icon" aria-hidden="true">${TOAST_ICONS[type] ?? "ℹ️"}</span>
        <div class="toast-body">
            ${title ? `<div class="toast-title">${title}</div>` : ""}
            <div class="toast-msg">${message}</div>
        </div>
        <button class="toast-close" aria-label="Dismiss notification">✕</button>
    `;

    // Close on click
    toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));

    container.appendChild(toast);

    // Auto dismiss
    const timer = setTimeout(() => dismissToast(toast), duration);

    // Cancel auto-dismiss if manually closed
    toast.querySelector(".toast-close").addEventListener("click", () => clearTimeout(timer), { once: true });
}

function dismissToast(toast) {
    toast.classList.add("toast-exit");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
}

/* ============================================================
   6. LOADING + SCREEN TRANSITIONS
   ============================================================ */

function hideLoading() {
    loadingScreen.classList.add("fade-out");
}

function showLoginScreen() {
    hideLoading();
    show(loginScreen);
    hide(dashboard);
}

function showDashboard(user) {
    hideLoading();
    hide(loginScreen);
    show(dashboard);
    // Set logged-in email in header
    headerEmail.textContent = user.email ?? "Unknown User";
    // Start clock
    startClock();
}

/* ============================================================
   7. CLOCK (header)
   ============================================================ */
function startClock() {
    function tick() {
        headerTime.textContent = new Date().toLocaleTimeString([], {
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        });
    }
    tick();
    setInterval(tick, 1000);
}

/* ============================================================
   8. FIREBASE CONNECTION INDICATOR
   ============================================================ */

/**
 * Monitor Firebase .info/connected to reflect real-time
 * connectivity in the header and status bar.
 */
function watchFirebaseConnection() {
    const connRef = ref(db, ".info/connected");
    onValue(connRef, (snapshot) => {
        firebaseConnected = snapshot.val() === true;

        if (firebaseConnected) {
            setFirebaseStatus("connected");
            showToast("Firebase connected", "success", "Connection", 2500);
            enableControls();
        } else {
            setFirebaseStatus("disconnected");
            showToast("Firebase connection lost", "error", "Connection", 4000);
            disableControls();
        }
    });
}

function setFirebaseStatus(status) {
    // Header badge
    headerFbBadge.className = `status-badge status-${status}`;
    headerFbBadge.querySelector(".status-label").textContent =
        status === "connected" ? "Connected" :
        status === "disconnected" ? "Disconnected" : "Connecting";

    // Status bar pill
    sbFirebase.className = `status-pill status-${status}`;
    sbFirebase.querySelector("span:last-child").textContent =
        status === "connected" ? "Connected" :
        status === "disconnected" ? "Disconnected" : "Connecting…";

    // Error banner
    if (status === "disconnected") {
        show(firebaseErrBanner);
    } else {
        hide(firebaseErrBanner);
    }
}

function enableControls() {
    document.getElementById("cards-grid").classList.remove("controls-disabled");
}

function disableControls() {
    document.getElementById("cards-grid").classList.add("controls-disabled");
}

/* ============================================================
   9. ESP32 ONLINE STATUS
   ============================================================ */

/**
 * The ESP32 periodically writes a timestamp to /system/lastSeen.
 * If lastSeen is within 15 seconds, we consider it online.
 */
function watchEsp32Status() {
    const sysRef = ref(db, "system");
    onValue(sysRef, (snapshot) => {
        const data = snapshot.val() ?? {};
        const lastSeen = data.lastSeen ?? 0;
        const now = Date.now();
        const isOnline = (now - lastSeen) < 15000;

        sbEsp32.className = `status-pill status-${isOnline ? "online" : "offline"}`;
        sbEsp32.querySelector("span:last-child").textContent = isOnline ? "Online" : "Offline";

        sbLastSeen.textContent = lastSeen ? formatTime(lastSeen) : "—";
    });
}

/* ============================================================
   10. DEVICE STATE HELPERS
   ============================================================ */

/**
 * Update a device card's visual state (status dot, label, toggle, card class).
 * @param {string} deviceKey - e.g. "pump", "valve1"
 * @param {boolean} state
 */
function updateDeviceUI(deviceKey, state) {
    const dot    = deviceStatusDots[deviceKey];
    const label  = deviceStatusLabels[deviceKey];
    const toggle = deviceToggles[deviceKey];
    const card   = deviceCards[deviceKey];

    if (!dot || !label || !toggle || !card) return;

    if (state) {
        dot.className    = "status-indicator status-on";
        label.textContent = "ON";
        label.className  = "status-text on";
        card.classList.add("card-active");
    } else {
        dot.className    = "status-indicator status-off";
        label.textContent = "OFF";
        label.className  = "status-text off";
        card.classList.remove("card-active");
    }

    // Sync checkbox without triggering the change handler
    if (toggle.checked !== state) {
        if (deviceKey === "pump") ignorePumpToggleOnce = true;
        toggle.checked = state;
    }
}

/** Recount and display how many devices are active */
function updateActiveCount() {
    let count = 0;
    Object.values(deviceToggles).forEach(t => { if (t.checked) count++; });
    sbActiveCount.textContent = String(count);
}

/* ============================================================
   11. FIREBASE REALTIME LISTENERS
   ============================================================ */

function startDeviceListeners() {
    /* ── Simple devices (valve1, valve2, valve3, light, fan) ── */
    const simpleDevices = ["valve1", "valve2", "valve3", "light", "fan"];
    simpleDevices.forEach(key => {
        const path = DEVICE_PATHS[key];
        onValue(ref(db, `agriculture/${path}/state`), (snap) => {
            const state = snap.val() === true;
            updateDeviceUI(key, state);
            updateActiveCount();
        });
    });

    /* ── Water Pump (state + timer) ── */
    onValue(ref(db, "agriculture/waterPump"), (snap) => {
        const data = snap.val() ?? {};
        const state = data.state === true;
        const mode  = data.mode ?? "manual";
        const timer = data.timer ?? {};

        // Update pump toggle & status indicator
        updateDeviceUI("pump", state);
        updateActiveCount();

        // Mode badge
        pumpModeBadge.textContent = mode === "timer" ? "Timer" : "Manual";
        pumpModeBadge.className   = `mode-badge ${mode === "timer" ? "mode-timer" : "mode-manual"}`;

        // Timer state
        const timerEnabled = timer.enabled === true;
        const fbEndTime    = timer.endTime ?? 0;
        const fbDuration   = timer.duration ?? 0;

        if (timerEnabled && fbEndTime > 0) {
            // Timer is active
            timerEndTime  = fbEndTime;
            timerDuration = fbDuration;

            const remaining = timerEndTime - Date.now();
            if (remaining > 0) {
                showTimerActive();
                startCountdownDisplay();
            } else {
                // Timer already expired
                handleTimerExpired();
            }
        } else {
            // Timer is not active
            stopCountdownDisplay();
            hide(timerActiveDisplay);

            // Show completed message briefly if pump was just turned off by timer
            if (!state && mode === "timer") {
                showTimerCompleted();
            } else {
                hide(timerCompletedDisp);
            }
        }
    });
}

/* ============================================================
   12. DEVICE CONTROL – TOGGLE HANDLERS
   ============================================================ */

/**
 * Generic simple-device toggle handler.
 * @param {string} deviceKey
 * @param {string} firebasePath
 */
function bindSimpleToggle(deviceKey, firebasePath) {
    deviceToggles[deviceKey].addEventListener("change", async (e) => {
        const newState = e.target.checked;
        try {
            await set(ref(db, `agriculture/${firebasePath}/state`), newState);
            showToast(
                `${deviceKey.charAt(0).toUpperCase() + deviceKey.slice(1)} turned ${newState ? "ON" : "OFF"}`,
                newState ? "success" : "info",
                "Device Control"
            );
        } catch (err) {
            console.error(`Toggle ${deviceKey} error:`, err);
            showToast(`Unable to update ${deviceKey}. Check your connection.`, "error", "Error");
            // Revert toggle visually
            e.target.checked = !newState;
        }
    });
}

/**
 * Pump toggle handler (also cancels active timer if turned OFF manually).
 */
function bindPumpToggle() {
    deviceToggles.pump.addEventListener("change", async (e) => {
        // Ignore if this change was triggered by Firebase → UI sync
        if (ignorePumpToggleOnce) {
            ignorePumpToggleOnce = false;
            return;
        }

        const newState = e.target.checked;

        try {
            if (!newState) {
                // Manual OFF → also cancel timer
                await update(ref(db, "agriculture/waterPump"), {
                    state: false,
                    mode:  "manual",
                });
                await update(ref(db, "agriculture/waterPump/timer"), {
                    enabled:   false,
                    startTime: 0,
                    endTime:   0,
                    duration:  0,
                });
                showToast("Water Pump turned OFF", "info", "Device Control");
                stopCountdownDisplay();
            } else {
                // Manual ON (no timer)
                await update(ref(db, "agriculture/waterPump"), {
                    state: true,
                    mode:  "manual",
                });
                showToast("Water Pump turned ON", "success", "Device Control");
            }
        } catch (err) {
            console.error("Pump toggle error:", err);
            showToast("Unable to update Water Pump. Check your connection.", "error", "Error");
            ignorePumpToggleOnce = true;
            e.target.checked = !newState;
        }
    });
}

/* ============================================================
   13. TIMER – PRESET BUTTONS
   ============================================================ */

presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        // Deselect all
        presetBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        // Populate custom inputs with preset value
        const minutes = parseInt(btn.dataset.minutes, 10);
        timerHoursInput.value   = Math.floor(minutes / 60);
        timerMinutesInput.value = minutes % 60;
        timerSecondsInput.value = 0;
    });
});

/* ============================================================
   14. TIMER – START
   ============================================================ */

startTimerBtn.addEventListener("click", async () => {
    const hours   = parseInt(timerHoursInput.value,   10) || 0;
    const minutes = parseInt(timerMinutesInput.value, 10) || 0;
    const seconds = parseInt(timerSecondsInput.value, 10) || 0;
    const totalSec = hours * 3600 + minutes * 60 + seconds;

    if (totalSec <= 0) {
        showToast("Please select or enter a valid timer duration.", "warning", "Timer");
        return;
    }

    const now       = Date.now();
    const endTime   = now + totalSec * 1000;

    try {
        // Write timer data to Firebase atomically
        await update(ref(db, "agriculture/waterPump"), {
            state: true,
            mode:  "timer",
        });
        await update(ref(db, "agriculture/waterPump/timer"), {
            enabled:   true,
            startTime: now,
            endTime:   endTime,
            duration:  totalSec,
        });

        const label = formatDurationLabel(hours, minutes, seconds);
        showToast(`Timer started for ${label}`, "success", "Pump Timer");

        // Clear preset selection
        presetBtns.forEach(b => b.classList.remove("active"));

    } catch (err) {
        console.error("Start timer error:", err);
        showToast("Unable to start timer. Check your connection.", "error", "Error");
    }
});

/** Build a human-readable label like "1 hour 15 min 30 sec" */
function formatDurationLabel(h, m, s) {
    const parts = [];
    if (h) parts.push(`${h} hr`);
    if (m) parts.push(`${m} min`);
    if (s) parts.push(`${s} sec`);
    return parts.join(" ") || "0 sec";
}

/* ============================================================
   15. TIMER – STOP
   ============================================================ */

stopTimerBtn.addEventListener("click", async () => {
    try {
        await update(ref(db, "agriculture/waterPump"), {
            state: false,
            mode:  "manual",
        });
        await update(ref(db, "agriculture/waterPump/timer"), {
            enabled:   false,
            startTime: 0,
            endTime:   0,
            duration:  0,
        });
        showToast("Timer stopped. Water Pump OFF.", "info", "Pump Timer");
        stopCountdownDisplay();
    } catch (err) {
        console.error("Stop timer error:", err);
        showToast("Unable to stop timer. Check your connection.", "error", "Error");
    }
});

/* ============================================================
   16. TIMER – COUNTDOWN DISPLAY (browser side)
   ============================================================ */

/** Show the active timer UI */
function showTimerActive() {
    show(timerActiveDisplay);
    hide(timerCompletedDisp);
}

/** Start the visual JS countdown interval */
function startCountdownDisplay() {
    // Avoid duplicate intervals
    stopCountdownDisplay();

    timerIntervalId = setInterval(() => {
        const remaining = timerEndTime - Date.now();

        if (remaining <= 0) {
            handleTimerExpired();
            return;
        }

        // Update countdown text
        timerRemaining.textContent = formatCountdown(remaining);

        // Update progress bar width
        const elapsed  = timerEndTime - timerDuration * 1000 - Date.now() + timerDuration * 1000;
        const progress = Math.min(100, ((timerDuration * 1000 - remaining) / (timerDuration * 1000)) * 100);
        timerProgressBar.style.width = `${100 - progress}%`;

    }, 500);
}

/** Stop JS countdown interval */
function stopCountdownDisplay() {
    if (timerIntervalId) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
    }
    timerRemaining.textContent = "00:00:00";
    timerProgressBar.style.width = "100%";
}

/**
 * Called when the countdown reaches 0 in the browser.
 * The ESP32 is the authoritative source for turning the pump OFF;
 * this just updates the display.
 */
function handleTimerExpired() {
    stopCountdownDisplay();
    hide(timerActiveDisplay);
    showTimerCompleted();
    showToast("Water Pump timer completed – Pump OFF", "success", "Timer Complete", 5000);
}

function showTimerCompleted() {
    show(timerCompletedDisp);
    // Auto-hide after 8 seconds
    setTimeout(() => hide(timerCompletedDisp), 8000);
}

/* ============================================================
   17. LOGIN
   ============================================================ */

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(loginError);

    const email    = loginEmail.value.trim();
    const password = loginPassword.value;

    if (!email || !password) {
        showLoginError("Please enter both email and password.");
        return;
    }

    // Show spinner
    loginBtn.disabled = true;
    loginBtn.querySelector(".btn-text").classList.add("hidden");
    loginBtn.querySelector(".btn-spinner").classList.remove("hidden");

    try {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged will handle the UI transition
    } catch (err) {
        console.error("Login error:", err.code, err.message);
        showLoginError(friendlyAuthError(err.code));
    } finally {
        loginBtn.disabled = false;
        loginBtn.querySelector(".btn-text").classList.remove("hidden");
        loginBtn.querySelector(".btn-spinner").classList.add("hidden");
    }
});

function showLoginError(msg) {
    loginError.textContent = msg;
    show(loginError);
}

/** Convert Firebase auth error codes to user-friendly messages */
function friendlyAuthError(code) {
    const map = {
        "auth/invalid-email":          "The email address is not valid.",
        "auth/user-disabled":          "This account has been disabled.",
        "auth/user-not-found":         "No account found with this email.",
        "auth/wrong-password":         "Incorrect password. Please try again.",
        "auth/invalid-credential":     "Invalid credentials. Please check your email and password.",
        "auth/too-many-requests":      "Too many failed attempts. Please wait and try again.",
        "auth/network-request-failed": "Network error. Please check your internet connection.",
    };
    return map[code] ?? `Authentication error (${code}). Please try again.`;
}

/* ── Password visibility toggle ── */
togglePwdBtn.addEventListener("click", () => {
    const isText = loginPassword.type === "text";
    loginPassword.type        = isText ? "password" : "text";
    togglePwdBtn.textContent  = isText ? "👁" : "🙈";
});

/* ============================================================
   18. LOGOUT
   ============================================================ */

logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        showToast("Logged out successfully.", "info", "Auth");
    } catch (err) {
        console.error("Logout error:", err);
    }
});

/* ============================================================
   19. AUTH STATE OBSERVER
   ============================================================ */

onAuthStateChanged(auth, (user) => {
    if (user) {
        // User is signed in
        showDashboard(user);
        initDashboard();
    } else {
        // User is signed out — clean up listeners handled by Firebase SDK
        stopCountdownDisplay();
        showLoginScreen();
    }
});

/* ============================================================
   20. DASHBOARD INITIALIZATION
   ============================================================ */

let dashboardInitialized = false;

function initDashboard() {
    if (dashboardInitialized) return;
    dashboardInitialized = true;

    // Bind device toggle handlers
    bindPumpToggle();
    bindSimpleToggle("valve1", "valve1");
    bindSimpleToggle("valve2", "valve2");
    bindSimpleToggle("valve3", "valve3");
    bindSimpleToggle("light",  "light");
    bindSimpleToggle("fan",    "fan");

    // Start Firebase listeners
    watchFirebaseConnection();
    watchEsp32Status();
    startDeviceListeners();

    // Ensure initial database structure exists (only if nodes are missing)
    ensureDbStructure();
}

/* ============================================================
   21. ENSURE FIREBASE DATABASE STRUCTURE
   ============================================================ */

/**
 * Write default values only if the node does not yet exist.
 * Uses a one-time read so we don't overwrite existing states.
 */
async function ensureDbStructure() {
    const { get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");

    const agriRef = ref(db, "agriculture");
    const snap    = await get(agriRef).catch(() => null);

    if (snap && snap.exists()) return; // Already set up

    const defaultData = {
        agriculture: {
            waterPump: {
                state: false,
                mode:  "manual",
                timer: { enabled: false, startTime: 0, endTime: 0, duration: 0 },
            },
            valve1: { state: false },
            valve2: { state: false },
            valve3: { state: false },
            light:  { state: false },
            fan:    { state: false },
        },
        system: {
            esp32Online: false,
            lastSeen:    0,
        },
    };

    await set(ref(db, "/"), defaultData).catch(err =>
        console.warn("Could not write default structure:", err)
    );
}

/* ============================================================
   22. PREVENT PAGE UNLOAD DURING ACTIVE TIMER (UX hint)
   ============================================================ */

window.addEventListener("beforeunload", (e) => {
    if (timerIntervalId) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but the dialog still shows.
        e.returnValue = "A pump timer is still running. The ESP32 will continue the timer, but are you sure you want to leave?";
    }
});