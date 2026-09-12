/**
 * SmartAgri – app.js  v2.2
 * ESP32 Agriculture Automation Dashboard
 *
 * Changes in v2.2:
 *  - Removed floating toast popups; introduced minimal in-card notifications
 *  - Controls lock: device toggles can only be operated when BOTH ESP32 & Firebase are connected
 *  - Top bar system status indicator showing SYSTEM ONLINE / OFFLINE
 *  - Attached hardware image integrations with dynamic active states
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
const headerEmail         = $("header-email");
const logoutBtn           = $("logout-btn");
const headerSystemStatus  = $("header-system-status");
const systemStatusText    = $("system-status-text");
const headerTime          = $("header-time");

// Status strip & Lock banner
const sbFirebase       = $("sb-firebase");
const sbEsp32          = $("sb-esp32");
const sbActiveCount    = $("sb-active-count");
const sbLastSeen       = $("sb-last-seen");
const systemLockBanner = $("system-lock-banner");
const lockBannerMsg    = $("lock-banner-msg");
const cardsGrid        = $("cards-grid");

// Device toggles
const deviceToggles = {
    pump:   $("pump-toggle"),
    valve1: $("valve1-toggle"),
    valve2: $("valve2-toggle"),
    valve3: $("valve3-toggle"),
    light:  $("light-toggle"),
    fan:    $("fan-toggle"),
};

// Device toggle wrappers (for click handling when locked)
const toggleWrappers = {
    pump:   $("wrap-toggle-pump"),
    valve1: $("wrap-toggle-valve1"),
    valve2: $("wrap-toggle-valve2"),
    valve3: $("wrap-toggle-valve3"),
    light:  $("wrap-toggle-light"),
    fan:    $("wrap-toggle-fan"),
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

// Minimal In-Card Notice Elements
const cardNotices = {
    pump:   $("notice-pump"),
    valve1: $("notice-valve1"),
    valve2: $("notice-valve2"),
    valve3: $("notice-valve3"),
    light:  $("notice-light"),
    fan:    $("notice-fan"),
};

// Pump-specific elements
const pumpModeBadge       = $("pump-mode-badge");
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
let firebaseConnected    = false;
let esp32Online          = false;
let esp32LastSeen        = 0;
let timerIntervalId      = null;
let timerEndTime         = 0;   // absolute ms
let timerDuration        = 0;   // seconds
let ignorePumpToggle     = false;
let dashboardInitialized = false;
const noticeTimeouts     = {};

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
const show = el => el && el.classList.remove("hidden");
const hide = el => el && el.classList.add("hidden");

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

function deviceLabel(key) {
    const map = {
        pump:   "Water Pump",
        valve1: "Solenoid Valve 1",
        valve2: "Solenoid Valve 2",
        valve3: "Solenoid Valve 3",
        light:  "Agriculture Light",
        fan:    "Exhaust Fan"
    };
    return map[key] ?? key;
}

/* ═══════════════════════════════════════════════════════════
   5. MINIMAL IN-CARD NOTIFICATIONS (Replaces Floating Toasts)
═══════════════════════════════════════════════════════════ */
const NOTICE_ICONS = {
    success: "✓",
    info:    "ℹ",
    warn:    "⚠",
    error:   "✕"
};

/**
 * Show a sleek, minimal notification banner directly inside the target device card.
 * @param {string} key - device key (pump, valve1, etc.)
 * @param {string} message - text to display
 * @param {'success'|'info'|'warn'|'error'} type
 * @param {number} duration - ms before auto-fade
 */
function showCardNotice(key, message, type = "info", duration = 3000) {
    const el = cardNotices[key];
    if (!el) return;

    if (noticeTimeouts[key]) {
        clearTimeout(noticeTimeouts[key]);
    }

    const icon = NOTICE_ICONS[type] ?? "ℹ";
    el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    el.className = `card-inline-notice notice-${type}`;
    show(el);

    noticeTimeouts[key] = setTimeout(() => {
        hide(el);
        delete noticeTimeouts[key];
    }, duration);
}

/* ═══════════════════════════════════════════════════════════
   6. DUAL-CONNECTION SYSTEM STATUS (ESP32 + Firebase)
═══════════════════════════════════════════════════════════ */
/**
 * Updates the Top Bar System Status and locks/unlocks controls.
 * Buttons can turn ONLY when BOTH device ESP32 & Firebase are connected.
 */
function updateSystemConnectionState() {
    const isSystemOnline = firebaseConnected && esp32Online;

    // 1. Top Bar System Indicator
    if (isSystemOnline) {
        headerSystemStatus.className = "system-status-pill status-online";
        systemStatusText.textContent = "SYSTEM ONLINE";
        headerSystemStatus.title     = "ESP32 hardware & Firebase connected";
    } else {
        headerSystemStatus.className = "system-status-pill status-offline";
        if (!firebaseConnected && !esp32Online) {
            systemStatusText.textContent = "SYSTEM OFFLINE";
            headerSystemStatus.title     = "Both ESP32 and Firebase are disconnected";
        } else if (!firebaseConnected) {
            systemStatusText.textContent = "SYSTEM OFFLINE (Firebase)";
            headerSystemStatus.title     = "Firebase connection lost";
        } else {
            systemStatusText.textContent = "SYSTEM OFFLINE (ESP32)";
            headerSystemStatus.title     = "ESP32 hardware is offline or waiting for heartbeat";
        }
    }

    // 2. Lock / Unlock Cards and Controls
    if (isSystemOnline) {
        cardsGrid.classList.remove("controls-locked");
        hide(systemLockBanner);
        Object.values(deviceToggles).forEach(toggle => {
            if (toggle) toggle.disabled = false;
        });
        if (startTimerBtn) startTimerBtn.disabled = false;
        if (stopTimerBtn)  stopTimerBtn.disabled = false;
    } else {
        cardsGrid.classList.add("controls-locked");
        show(systemLockBanner);

        // Customize lock banner message
        if (!firebaseConnected && !esp32Online) {
            lockBannerMsg.textContent = "Controls locked: Both ESP32 device & Firebase must be connected to toggle switches.";
        } else if (!firebaseConnected) {
            lockBannerMsg.textContent = "Controls locked: Reconnecting to Firebase database...";
        } else {
            lockBannerMsg.textContent = "Controls locked: Waiting for ESP32 hardware to connect and send heartbeat.";
        }

        Object.values(deviceToggles).forEach(toggle => {
            if (toggle) toggle.disabled = true;
        });
        if (startTimerBtn) startTimerBtn.disabled = true;
        if (stopTimerBtn)  stopTimerBtn.disabled = true;
    }
}

/* ═══════════════════════════════════════════════════════════
   7. SCREEN TRANSITIONS & CLOCK
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
   8. FIREBASE CONNECTION LISTENER
═══════════════════════════════════════════════════════════ */
function watchFirebaseConnection() {
    onValue(ref(db, ".info/connected"), snap => {
        firebaseConnected = snap.val() === true;

        sbFirebase.className = "";
        sbFirebase.classList.add("ss-pill", firebaseConnected ? "pill-connected" : "pill-disconnected");
        sbFirebase.innerHTML = `<span class="ss-dot"></span><span>${firebaseConnected ? "Connected" : "Disconnected"}</span>`;

        updateSystemConnectionState();
    });
}

/* ═══════════════════════════════════════════════════════════
   9. ESP32 STATUS & HEARTBEAT
═══════════════════════════════════════════════════════════ */
function evaluateEsp32Online(data) {
    if (!data) return false;
    // Check direct boolean flags if ESP32 writes them
    if (data.esp32Online === true || data.online === true) {
        return true;
    }
    // Check heartbeat timestamp (within last 60 seconds)
    // Allow negative ageMs to account for slight clock skew between client and server
    const ts = data.lastSeen ?? 0;
    if (ts > 0) {
        // Support either epoch milliseconds or epoch seconds
        const ageMs = (ts < 10000000000) ? (Date.now() - ts * 1000) : (Date.now() - ts);
        return ageMs < 60000;
    }
    return false;
}

function watchEsp32Status() {
    onValue(ref(db, "system"), snap => {
        const data     = snap.val() ?? {};
        esp32LastSeen  = data.lastSeen ?? 0;
        esp32Online    = evaluateEsp32Online(data);

        sbEsp32.className = "";
        sbEsp32.classList.add("ss-pill", esp32Online ? "pill-online" : "pill-offline");
        sbEsp32.innerHTML = `<span class="ss-dot"></span><span>${esp32Online ? "Online" : "Offline"}</span>`;
        sbLastSeen.textContent = esp32LastSeen ? formatTime(esp32LastSeen) : "—";

        updateSystemConnectionState();
    });

    // Heartbeat ticker: If no new ping arrives within 60 seconds, mark ESP32 offline
    // Clock skew allowed (no ageMs >= 0 check)
    setInterval(() => {
        if (esp32LastSeen > 0) {
            const ageMs = (esp32LastSeen < 10000000000) ? (Date.now() - esp32LastSeen * 1000) : (Date.now() - esp32LastSeen);
            const stillAlive = ageMs < 60000;
            if (esp32Online !== stillAlive) {
                esp32Online = stillAlive;
                sbEsp32.className = "";
                sbEsp32.classList.add("ss-pill", esp32Online ? "pill-online" : "pill-offline");
                sbEsp32.innerHTML = `<span class="ss-dot"></span><span>${esp32Online ? "Online" : "Offline"}</span>`;
                updateSystemConnectionState();
            }
        }
    }, 3000);
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
    Object.values(deviceToggles).forEach(t => { if (t && t.checked) n++; });
    sbActiveCount.textContent = String(n);
}

/* ═══════════════════════════════════════════════════════════
   11. FIREBASE REALTIME LISTENERS FOR DEVICES
═══════════════════════════════════════════════════════════ */
function startDeviceListeners() {
    // Simple devices (valves, light, fan)
    ["valve1", "valve2", "valve3", "light", "fan"].forEach(key => {
        onValue(ref(db, `agriculture/${DEVICE_PATHS[key]}/state`), snap => {
            updateDeviceUI(key, snap.val() === true);
            updateActiveCount();
        });
    });

    // Water pump (state + mode + timer)
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

        // Timer state from database
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
            if (state) {
                hide(timerCompletedDiv);
            }
        }
    });
}

/* ═══════════════════════════════════════════════════════════
   12. DEVICE TOGGLE HANDLERS WITH DUAL-CONNECTION GUARD
═══════════════════════════════════════════════════════════ */
function bindSimpleToggle(key, path) {
    const toggle = deviceToggles[key];
    const wrap   = toggleWrappers[key];

    // Tap on row / toggle wrapper when locked
    if (wrap) {
        wrap.addEventListener("click", e => {
            if (!firebaseConnected || !esp32Online) {
                showCardNotice(key, "⚠️ Locked: Connect ESP32 & Firebase", "warn", 2500);
            }
        });
    }

    toggle.addEventListener("change", async e => {
        // Enforce dual-connection constraint
        if (!firebaseConnected || !esp32Online) {
            e.preventDefault();
            e.target.checked = !e.target.checked;
            showCardNotice(key, "⚠️ Both ESP32 & Firebase must be online", "warn", 3000);
            return;
        }

        const on = e.target.checked;
        try {
            await set(ref(db, `agriculture/${path}/state`), on);
            showCardNotice(key, `${deviceLabel(key)} turned ${on ? "ON" : "OFF"}`, on ? "success" : "info", 2500);
        } catch (err) {
            console.error(err);
            showCardNotice(key, "Sync failed. Check connection.", "error", 3500);
            e.target.checked = !on;
        }
    });
}

function bindPumpToggle() {
    const toggle = deviceToggles.pump;
    const wrap   = toggleWrappers.pump;

    if (wrap) {
        wrap.addEventListener("click", () => {
            if (!firebaseConnected || !esp32Online) {
                showCardNotice("pump", "⚠️ Locked: Connect ESP32 & Firebase", "warn", 2500);
            }
        });
    }

    toggle.addEventListener("change", async e => {
        if (ignorePumpToggle) { ignorePumpToggle = false; return; }

        // Enforce dual-connection constraint
        if (!firebaseConnected || !esp32Online) {
            e.preventDefault();
            ignorePumpToggle = true;
            e.target.checked = !e.target.checked;
            showCardNotice("pump", "⚠️ Both ESP32 & Firebase must be online", "warn", 3000);
            return;
        }

        const on = e.target.checked;
        try {
            if (!on) {
                // Manual OFF — also cancel any active timer
                await update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" });
                await update(ref(db, "agriculture/waterPump/timer"),
                    { enabled: false, startTime: 0, endTime: 0, duration: 0 });
                showCardNotice("pump", "Water Pump turned OFF", "info", 2500);
                stopCountdown();
            } else {
                await update(ref(db, "agriculture/waterPump"), { state: true, mode: "manual" });
                showCardNotice("pump", "Water Pump turned ON", "success", 2500);
            }
        } catch (err) {
            console.error(err);
            showCardNotice("pump", "Sync failed. Check connection.", "error", 3500);
            ignorePumpToggle = true;
            e.target.checked = !on;
        }
    });
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
    if (!firebaseConnected || !esp32Online) {
        showCardNotice("pump", "⚠️ Locked: Connect ESP32 & Firebase", "warn", 3000);
        return;
    }

    const h   = parseInt(timerHoursInput.value, 10) || 0;
    const m   = parseInt(timerMinsInput.value,  10) || 0;
    const s   = parseInt(timerSecsInput.value,  10) || 0;
    const tot = h * 3600 + m * 60 + s;

    if (tot <= 0) {
        showCardNotice("pump", "Select or enter a valid duration first", "warn", 2500);
        return;
    }

    const now   = Date.now();
    const endTs = now + tot * 1000;

    try {
        await update(ref(db, "agriculture/waterPump"), { state: true, mode: "timer" });
        await update(ref(db, "agriculture/waterPump/timer"), {
            enabled: true, startTime: now, endTime: endTs, duration: tot
        });
        showCardNotice("pump", `Timer started: ${durationLabel(h, m, s)}`, "success", 3000);
        presetBtns.forEach(b => b.classList.remove("active"));
    } catch (err) {
        console.error(err);
        showCardNotice("pump", "Could not start timer. Check connection.", "error", 3500);
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
        showCardNotice("pump", "Timer stopped — Pump OFF", "info", 2500);
        stopCountdown();
    } catch (err) {
        console.error(err);
        showCardNotice("pump", "Could not stop timer. Check connection.", "error", 3500);
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
    stopCountdown();
    timerIntervalId = setInterval(() => {
        const rem = timerEndTime - Date.now();
        if (rem <= 0) { handleTimerExpired(); return; }

        pumpRemainingInline.textContent = formatHMS(rem);

        const pct = (rem / (timerDuration * 1000)) * 100;
        pumpProgressBar.style.width = `${Math.max(0, pct)}%`;
    }, 500);
}

function stopCountdown() {
    if (timerIntervalId) { clearInterval(timerIntervalId); timerIntervalId = null; }
    pumpRemainingInline.textContent = "00:00:00";
    pumpProgressBar.style.width     = "100%";
}

function handleTimerExpired() {
    stopCountdown();
    hidePumpTimerActive();
    showTimerDone();
    showCardNotice("pump", "Timer completed — Pump OFF", "success", 5000);
    
    // Auto-turn OFF pump in Firebase
    update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" }).catch(console.error);
    update(ref(db, "agriculture/waterPump/timer"), { enabled: false, startTime: 0, endTime: 0, duration: 0 }).catch(console.error);
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
    const showType = loginPwd.type === "password";
    loginPwd.type            = showType ? "text" : "password";
    togglePwdBtn.textContent = showType ? "🙈" : "👁";
});

/* ═══════════════════════════════════════════════════════════
   19. LOGOUT
═══════════════════════════════════════════════════════════ */
logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
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

    // Initial system connection status
    updateSystemConnectionState();

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
        if (snap && snap.exists()) return;

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
   23. UNLOAD GUARD
═══════════════════════════════════════════════════════════ */
window.addEventListener("beforeunload", e => {
    if (timerIntervalId) {
        e.preventDefault();
        e.returnValue = "A pump timer is running. The ESP32 will continue automatically.";
    }
});