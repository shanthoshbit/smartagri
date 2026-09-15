/**
 * SmartAgri – app.js  v4.0
 * ESP32 Agriculture Automation Dashboard
 * Optimized: debounced writes, friendly error messages, clean state management
 */

import { initializeApp }                       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
                                                from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, onValue, set, update, push, remove }
                                                from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ──────────────────────────────────────────
   FIREBASE CONFIG
────────────────────────────────────────── */
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

/* ──────────────────────────────────────────
   DOM HELPERS
────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

/* ──────────────────────────────────────────
   STATE
────────────────────────────────────────── */
const state = {
    firebaseConnected: false,
    esp32Online:       false,
    esp32LastSeen:     0,
    esp32StartTime:    0,
    timerIntervalId:   null,
    timerEndTime:      0,
    timerDuration:     0,
    appInitialized:    false,
    pumpRunSeconds:    0,       // tracks seconds pump was ON today
    pumpRunIntervalId: null,
};

/* Firebase paths */
const PATHS = {
    pump:   "waterPump",
    valve1: "valve1",
    valve2: "valve2",
    valve3: "valve3",
    light:  "light",
    fan:    "fan",
};

/* Firebase-friendly error messages */
const FB_ERRORS = {
    "auth/invalid-email":        "Invalid email address.",
    "auth/user-not-found":       "No account found with this email.",
    "auth/wrong-password":       "Incorrect password. Please try again.",
    "auth/too-many-requests":    "Too many attempts. Please wait a moment.",
    "auth/network-request-failed": "Network error. Check your connection.",
};

/* ──────────────────────────────────────────
   DOM ELEMENTS
────────────────────────────────────────── */
const elLoading  = $("loading-screen");
const elLogin    = $("login-screen");
const elApp      = $("app-screen");

// Nav
const navItems = document.querySelectorAll(".nav-item");
const screens  = document.querySelectorAll(".screen");

// Login
const loginForm    = $("login-form");
const loginEmail   = $("login-email");
const loginPwd     = $("login-password");
const togglePwdBtn = $("toggle-password");
const pwdEyeIcon   = $("pwd-eye-icon");
const loginBtn     = $("login-btn");
const loginError   = $("login-error");
const logoutBtn    = $("logout-btn");

// Status
const homeFbStatus   = $("home-fb-status");
const homeEspStatus  = $("home-esp-status");
const offlineWarning = $("offline-warning");
const monFb          = $("mon-fb");
const monEsp         = $("mon-esp");
const monLastSeen    = $("mon-last-seen");
const monUptime      = $("mon-uptime");
const sysOverall     = $("sys-overall-badge");

// Sensor displays
const monTemp     = $("mon-temp");
const monHumidity = $("mon-humidity");
const monSoil     = $("mon-soil");
const monLight    = $("mon-light");
const mHumidity   = $("m-humidity");
const mSoil       = $("m-soil");
const mLight      = $("m-light");

// Pump stat displays
const pumpPowerStatus = $("pump-power-status");
const pumpRuntime     = $("pump-runtime");
const pumpWaterUsage  = $("pump-water-usage");

// Toggles: { mini?, large }
const toggles = {
    pump:   { mini: $("mini-toggle-pump"),   large: $("toggle-pump")   },
    valve1: { mini: $("mini-toggle-valve1"), large: $("toggle-valve1") },
    valve2: { mini: $("mini-toggle-valve2"), large: $("toggle-valve2") },
    valve3: { mini: $("mini-toggle-valve3"), large: $("toggle-valve3") },
    light:  { mini: $("mini-toggle-light"),  large: $("toggle-light")  },
    fan:    { mini: $("mini-toggle-fan"),     large: $("toggle-fan")    },
};

// Cards
const cards = {
    pump:   { mini: $("mini-card-pump"),   large: $("card-pump")   },
    valve1: { mini: $("mini-card-valve1"), large: $("card-valve1") },
    valve2: { mini: $("mini-card-valve2"), large: $("card-valve2") },
    valve3: { mini: $("mini-card-valve3"), large: $("card-valve3") },
    light:  { mini: $("mini-card-light"),  large: $("card-light")  },
    fan:    { mini: $("mini-card-fan"),     large: $("card-fan")    },
};

// Pump timer
const btnModeManual      = $("btn-mode-manual");
const btnModeTimer       = $("btn-mode-timer");
const pumpTimerView      = $("pump-timer-view");
const timerActiveDisplay = $("timer-active-display");
const timerSetupDisplay  = $("timer-setup-display");
const pumpTimeRem        = $("pump-time-rem");
const pumpProgress       = $("pump-progress");
const btnStopTimer       = $("btn-stop-timer");
const btnStartTimer      = $("btn-start-timer");
const tHr                = $("t-hr");
const tMin               = $("t-min");
const tSec               = $("t-sec");
const presets            = document.querySelectorAll(".btn-preset");

// Quick actions
const btnAllOn  = $("btn-all-on");
const btnAllOff = $("btn-all-off");

// Toast
const toastContainer = $("toast-container");

/* ──────────────────────────────────────────
   TOAST
────────────────────────────────────────── */
function showToast(msg, type = "success") {
    const icons = { success: "check_circle", error: "error", info: "info" };
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="material-symbols-outlined">${icons[type] ?? "info"}</span><span>${msg}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("toast-fade-out");
        setTimeout(() => toast.remove(), 320);
    }, 3200);
}

/* ──────────────────────────────────────────
   FORMATTERS
────────────────────────────────────────── */
function fmtHMS(ms) {
    const s   = Math.max(0, Math.ceil(ms / 1000));
    const m   = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtTime(ts) {
    if (!ts) return "--:--:--";
    const d = new Date(ts < 10000000000 ? ts * 1000 : ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtUptime(startTs) {
    if (!startTs) return "--";
    const ms = Date.now() - (startTs < 10000000000 ? startTs * 1000 : startTs);
    if (ms < 0) return "--";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
}

function fmtRuntime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h} h ${m} m`;
}

function estWaterUsage(sec) {
    // ~2 L/min for a typical small pump
    return `${Math.round(sec / 60 * 2)} Liters`;
}

/* ──────────────────────────────────────────
   NAVIGATION
────────────────────────────────────────── */
function switchTab(targetId) {
    navItems.forEach(item => item.classList.toggle("active", item.dataset.target === targetId));
    screens.forEach(screen => {
        const match = screen.id === `screen-${targetId}`;
        screen.classList.toggle("hidden", !match);
        screen.classList.toggle("active", match);
    });
}

navItems.forEach(item => item.addEventListener("click", () => switchTab(item.dataset.target)));

// "See All" shortcut
document.addEventListener("click", e => {
    const nav = e.target.closest("[data-nav]");
    if (nav) switchTab(nav.dataset.nav);
});

/* ──────────────────────────────────────────
   SYSTEM STATUS
────────────────────────────────────────── */
function updateSystemStatus() {
    const online = state.firebaseConnected && state.esp32Online;

    // Home status indicators
    setStatusIndicator(homeFbStatus, state.firebaseConnected);
    setStatusIndicator(homeEspStatus, state.esp32Online);

    // Monitor badges
    setBadge(monFb,  state.firebaseConnected, "Connected", "Offline");
    setBadge(monEsp, state.esp32Online,       "Online",    "Offline");
    monLastSeen.textContent = fmtTime(state.esp32LastSeen);
    monUptime.textContent   = fmtUptime(state.esp32StartTime);

    // Overall badge
    if (sysOverall) {
        sysOverall.textContent = online ? "● Online" : "● Offline";
        sysOverall.classList.toggle("offline", !online);
    }

    // Offline warning + control lock
    offlineWarning.classList.toggle("hidden", online);
    setControlsDisabled(!online);
}

function setStatusIndicator(el, isOk) {
    el.className = `status-indicator ${isOk ? "connected" : "offline"}`;
    el.querySelector(".status-text").textContent = isOk
        ? (el === homeFbStatus ? "Connected" : "Online")
        : "Offline";
}

function setBadge(el, isOk, okLabel, failLabel) {
    el.className = `sys-val badge ${isOk ? "green" : "red"}`;
    el.textContent = isOk ? okLabel : failLabel;
}

function setControlsDisabled(disabled) {
    Object.values(toggles).forEach(({ mini, large }) => {
        if (mini)  mini.disabled  = disabled;
        if (large) large.disabled = disabled;
    });
    [btnStartTimer, btnStopTimer, btnAllOn, btnAllOff].forEach(b => { if (b) b.disabled = disabled; });
}

/* ──────────────────────────────────────────
   ESP32 HEARTBEAT CHECK (every 5s)
────────────────────────────────────────── */
function tsToMs(ts) {
    return ts < 10_000_000_000 ? ts * 1000 : ts;
}

function checkEsp32Online(data) {
    if (!data) return false;
    if (data.esp32Online === true || data.online === true) return true;
    const ts = data.lastSeen ?? 0;
    if (ts > 0) return Date.now() - tsToMs(ts) < 60_000;
    return false;
}

setInterval(() => {
    if (state.esp32LastSeen > 0) {
        const alive = Date.now() - tsToMs(state.esp32LastSeen) < 60_000;
        if (state.esp32Online !== alive) {
            state.esp32Online = alive;
            updateSystemStatus();
        }
    }
    // Update uptime display live
    if (monUptime && state.esp32StartTime) {
        monUptime.textContent = fmtUptime(state.esp32StartTime);
    }
}, 5_000);

/* ──────────────────────────────────────────
   PUMP RUNTIME TRACKER
────────────────────────────────────────── */
function startPumpRunTracker() {
    if (state.pumpRunIntervalId) return;
    state.pumpRunIntervalId = setInterval(() => {
        state.pumpRunSeconds++;
        updatePumpStats(true);
    }, 1000);
}

function stopPumpRunTracker() {
    if (state.pumpRunIntervalId) {
        clearInterval(state.pumpRunIntervalId);
        state.pumpRunIntervalId = null;
    }
}

function updatePumpStats(on) {
    if (pumpPowerStatus) pumpPowerStatus.textContent = on ? "ON"  : "OFF";
    if (pumpRuntime)     pumpRuntime.textContent     = fmtRuntime(state.pumpRunSeconds);
    if (pumpWaterUsage)  pumpWaterUsage.textContent  = estWaterUsage(state.pumpRunSeconds);
}

/* ──────────────────────────────────────────
   FIREBASE LISTENERS
────────────────────────────────────────── */
function startListeners() {
    // Firebase connection
    onValue(ref(db, ".info/connected"), snap => {
        state.firebaseConnected = snap.val() === true;
        updateSystemStatus();
    });

    // System / ESP32 heartbeat
    onValue(ref(db, "system"), snap => {
        const data = snap.val() ?? {};
        state.esp32LastSeen  = data.lastSeen  ?? 0;
        state.esp32StartTime = data.startTime ?? 0;
        state.esp32Online    = checkEsp32Online(data);
        updateSystemStatus();
    });

    // Simple device states (valves, light, fan)
    ["valve1", "valve2", "valve3", "light", "fan"].forEach(key => {
        onValue(ref(db, `agriculture/${PATHS[key]}/state`), snap => {
            syncDeviceUI(key, snap.val() === true);
        });
    });

    // Sensor readings
    onValue(ref(db, "sensors"), snap => {
        const d = snap.val() ?? {};
        updateSensorDisplays(d);
    });

    // Water pump (complex – has mode, timer, state)
    onValue(ref(db, "agriculture/waterPump"), snap => {
        const data  = snap.val() ?? {};
        const on    = data.state === true;
        const mode  = data.mode  ?? "manual";
        const timer = data.timer ?? {};

        syncDeviceUI("pump", on);
        updatePumpStats(on);
        on ? startPumpRunTracker() : stopPumpRunTracker();

        // Mode toggle UI
        const isTimer = mode === "timer";
        btnModeManual.classList.toggle("active", !isTimer);
        btnModeTimer .classList.toggle("active",  isTimer);
        pumpTimerView.classList.toggle("hidden",  !isTimer);

        // Timer display
        const timerEnabled = timer.enabled === true;
        const fbEnd        = timer.endTime  ?? 0;
        const fbDur        = timer.duration ?? 0;

        if (timerEnabled && fbEnd > 0) {
            state.timerEndTime  = fbEnd;
            state.timerDuration = fbDur;
            if (fbEnd - Date.now() > 0) {
                timerActiveDisplay.classList.remove("hidden");
                timerSetupDisplay .classList.add("hidden");
                startCountdown();
            } else {
                handleTimerExpired();
            }
        } else {
            stopCountdown();
            timerActiveDisplay.classList.add("hidden");
            timerSetupDisplay .classList.remove("hidden");
        }
    });
}

/* ──────────────────────────────────────────
   REAL-TIME TEMPERATURE & WEATHER ENGINE
────────────────────────────────────────── */
const weatherState = {
    unit: "C", // 'C' or 'F'
    tempC: null,
    esp32TempC: null,
    location: "Farm Field",
    humidity: 65,
    wind: null,
    weatherCode: 0,
    description: "Clear Sky",
    isRefreshing: false
};

const WMO_CODES = {
    0:  { desc: "Clear Sky", icon: "wb_sunny" },
    1:  { desc: "Mainly Clear", icon: "wb_sunny" },
    2:  { desc: "Partly Cloudy", icon: "partly_cloudy_day" },
    3:  { desc: "Overcast", icon: "cloud" },
    45: { desc: "Foggy", icon: "foggy" },
    48: { desc: "Depositing Rime Fog", icon: "foggy" },
    51: { desc: "Light Drizzle", icon: "rainy" },
    53: { desc: "Moderate Drizzle", icon: "rainy" },
    55: { desc: "Dense Drizzle", icon: "rainy" },
    61: { desc: "Slight Rain", icon: "rainy" },
    63: { desc: "Moderate Rain", icon: "rainy" },
    65: { desc: "Heavy Rain", icon: "thunderstorm" },
    71: { desc: "Slight Snow", icon: "ac_unit" },
    73: { desc: "Moderate Snow", icon: "ac_unit" },
    75: { desc: "Heavy Snow", icon: "ac_unit" },
    80: { desc: "Rain Showers", icon: "rainy" },
    81: { desc: "Moderate Showers", icon: "rainy" },
    82: { desc: "Violent Showers", icon: "thunderstorm" },
    95: { desc: "Thunderstorm", icon: "thunderstorm" },
    96: { desc: "Thunderstorm w/ Hail", icon: "thunderstorm" }
};

function convertTemp(c, unit) {
    if (c == null) return "--";
    return unit === "F" ? Math.round((c * 9/5) + 32) : Math.round(c);
}

function updateHeroWeatherUI() {
    const elTemp = $("hero-temp");
    const elDesc = $("hero-desc");
    const elIcon = $("hero-weather-icon");
    const elSub  = $("hero-weather-sub");
    const elLoc  = $("hero-location-text");
    const elBtn  = $("temp-unit-toggle");

    const displayTempC = weatherState.esp32TempC ?? weatherState.tempC;

    if (elTemp) {
        const val = convertTemp(displayTempC, weatherState.unit);
        elTemp.textContent = val !== "--" ? `${val}°${weatherState.unit}` : "--°C";
    }

    if (elBtn) elBtn.textContent = `°${weatherState.unit}`;
    if (elDesc) elDesc.textContent = weatherState.description;
    if (elLoc) elLoc.textContent = weatherState.location;
    if (elIcon) {
        const info = WMO_CODES[weatherState.weatherCode] ?? { icon: "light_mode" };
        elIcon.textContent = info.icon;
    }
    if (elSub) {
        const hum = weatherState.humidity != null ? `${weatherState.humidity}%` : "--%";
        const wind = weatherState.wind != null ? `${weatherState.wind} km/h` : "-- km/h";
        const sourceLabel = weatherState.esp32TempC != null ? "ESP32 Field Sensor" : "Live Weather";
        elSub.textContent = `Humidity: ${hum} · Wind: ${wind} · ${sourceLabel}`;
    }
}

async function fetchRealtimeWeather(lat = 13.0827, lon = 80.2707, locName = "Farm Field") {
    weatherState.isRefreshing = true;
    const btnRefresh = $("btn-refresh-weather");
    if (btnRefresh) btnRefresh.classList.add("spinning");

    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m`);
        if (res.ok) {
            const data = await res.json();
            const cw = data.current_weather;
            if (cw) {
                weatherState.tempC = cw.temperature;
                weatherState.weatherCode = cw.weathercode;
                weatherState.wind = cw.windspeed;
                const info = WMO_CODES[cw.weathercode] ?? { desc: "Clear Sky" };
                weatherState.description = info.desc;
                weatherState.location = locName;

                if (data.hourly?.relativehumidity_2m?.length > 0) {
                    const hourIdx = new Date().getHours();
                    weatherState.humidity = data.hourly.relativehumidity_2m[hourIdx] ?? weatherState.humidity;
                }
            }
        }
    } catch (err) {
        console.warn("[SmartAgri Weather] Fallback used:", err);
    } finally {
        weatherState.isRefreshing = false;
        if (btnRefresh) btnRefresh.classList.remove("spinning");
        updateHeroWeatherUI();
    }
}

function fetchCurrentWeather() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            async pos => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;

                try {
                    const geoRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
                    if (geoRes.ok) {
                        const geoData = await geoRes.json();
                        const city = geoData.locality || geoData.city || geoData.principalSubdivision || "Farm Field";
                        fetchRealtimeWeather(lat, lon, city);
                        return;
                    }
                } catch (_) {}
                fetchRealtimeWeather(lat, lon, "Local Field");
            },
            () => fetchRealtimeWeather(13.0827, 80.2707, "Farm Field"),
            { timeout: 8000 }
        );
    } else {
        fetchRealtimeWeather(13.0827, 80.2707, "Farm Field");
    }
}

let isRealtimeTempInit = false;
function initRealtimeTemperature() {
    fetchCurrentWeather();
    if (isRealtimeTempInit) return;
    isRealtimeTempInit = true;

    $("temp-unit-toggle")?.addEventListener("click", () => {
        weatherState.unit = weatherState.unit === "C" ? "F" : "C";
        updateHeroWeatherUI();
        showToast(`Temperature unit set to °${weatherState.unit}`, "info");
    });

    $("btn-refresh-weather")?.addEventListener("click", () => {
        fetchCurrentWeather();
        showToast("Refreshing live temperature & weather…", "info");
    });

    setInterval(() => fetchCurrentWeather(), 600_000);
}

/* Update sensor value elements */
function updateSensorDisplays(d) {
    if (d.temperature != null) {
        weatherState.esp32TempC = d.temperature;
        updateHeroWeatherUI();
    }
    const temp  = d.temperature != null ? `${d.temperature}°C`    : null;
    const hum   = d.humidity    != null ? `${d.humidity}%`         : null;
    const soil  = d.soil        != null ? `${d.soil} ppm`          : null;
    const light = d.light       != null ? `${d.light.toLocaleString()} lx` : null;

    if (temp  && monTemp)     monTemp.textContent     = temp;
    if (hum   && monHumidity) monHumidity.textContent = hum;
    if (hum   && mHumidity)   mHumidity.textContent   = hum;
    if (soil  && monSoil)     monSoil.textContent      = soil;
    if (soil  && mSoil)       mSoil.textContent        = soil;
    if (light && monLight)    monLight.textContent     = light;
    if (light && mLight)      mLight.textContent       = light;
    
    if (typeof checkSensorAlerts === "function") checkSensorAlerts(d);
}

/* Sync toggle + card active state from Firebase */
function syncDeviceUI(key, on) {
    const { mini, large } = toggles[key] ?? {};
    const { mini: miniCard, large: largeCard } = cards[key] ?? {};

    if (mini  && mini.checked  !== on) {
        mini.checked = on;
    }
    if (large && large.checked !== on) {
        large.checked = on;
    }
    if (miniCard)  miniCard.classList.toggle("active", on);
    if (largeCard) largeCard.classList.toggle("active", on);
}

/* ──────────────────────────────────────────
   DEVICE TOGGLE BINDING  (debounced writes)
────────────────────────────────────────── */
/** Wraps Firebase set/update with user-friendly error handling */
async function safeWrite(writeFn, rollbackFn) {
    if (!state.firebaseConnected || !state.esp32Online) {
        showToast("System offline — controls locked", "error");
        rollbackFn?.();
        return false;
    }
    try {
        await writeFn();
        return true;
    } catch (err) {
        console.error("[SmartAgri] Write failed:", err);
        showToast("Sync failed. Check connection.", "error");
        rollbackFn?.();
        return false;
    }
}

function bindToggles() {
    // Simple devices: valve1-3, light, fan
    ["valve1", "valve2", "valve3", "light", "fan"].forEach(key => {
        const handler = async (e) => {
            const el = e.target;
            const on = el.checked;
            const ok = await safeWrite(
                () => set(ref(db, `agriculture/${PATHS[key]}/state`), on),
                () => { el.checked = !on; }
            );
            if (ok) {
                showToast(`${friendlyName(key)} turned ${on ? "ON" : "OFF"}`);
                if (typeof logActivity === "function") logActivity(friendlyName(key), `Turned ${on ? "ON" : "OFF"} manually`, "device");
            }
        };
        if (toggles[key].mini)  toggles[key].mini .addEventListener("change", handler);
        if (toggles[key].large) toggles[key].large.addEventListener("change", handler);
    });

    // Pump (has mode + timer awareness)
    const handlePump = async (e) => {
        const el = e.target;
        const on = el.checked;

        const ok = await safeWrite(
            async () => {
                if (on) {
                    await update(ref(db, "agriculture/waterPump"), { state: true, mode: "manual" });
                } else {
                    await update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" });
                    await update(ref(db, "agriculture/waterPump/timer"), { enabled: false, startTime: 0, endTime: 0, duration: 0 });
                }
            },
            () => { el.checked = !on; }
        );
        if (ok) {
            showToast(`Water Pump turned ${on ? "ON" : "OFF"}`);
            if (typeof logActivity === "function") logActivity("Water Pump", `Turned ${on ? "ON" : "OFF"} manually`, "device");
        }
    };
    toggles.pump.mini .addEventListener("change", handlePump);
    toggles.pump.large.addEventListener("change", handlePump);
}

/* Human-friendly device names */
function friendlyName(key) {
    const names = {
        valve1: "Valve 1", valve2: "Valve 2", valve3: "Valve 3",
        light: "Grow Light", fan: "Exhaust Fan", pump: "Water Pump"
    };
    return names[key] ?? key;
}

/* ──────────────────────────────────────────
   QUICK ACTIONS
────────────────────────────────────────── */
btnAllOn ?.addEventListener("click", () => setAllValves(true));
btnAllOff?.addEventListener("click", () => setAllValves(false));

async function setAllValves(on) {
    const ok = await safeWrite(
        () => update(ref(db), {
            "agriculture/valve1/state": on,
            "agriculture/valve2/state": on,
            "agriculture/valve3/state": on,
        })
    );
    if (ok) {
        showToast(`All valves turned ${on ? "ON" : "OFF"}`);
        if (typeof logActivity === "function") logActivity("All Valves", `Turned ${on ? "ON" : "OFF"} manually`, "device");
    }
}

/* ──────────────────────────────────────────
   PUMP MODE BUTTONS
────────────────────────────────────────── */
btnModeManual?.addEventListener("click", async () => {
    const ok = await safeWrite(() => update(ref(db, "agriculture/waterPump"), { mode: "manual" }));
    if (ok) {
        showToast("Switched to Manual mode", "info");
        if (typeof logActivity === "function") logActivity("Water Pump Mode", "Switched to Manual mode", "device");
    }
});
btnModeTimer?.addEventListener("click", async () => {
    const ok = await safeWrite(() => update(ref(db, "agriculture/waterPump"), { mode: "timer" }));
    if (ok) {
        showToast("Switched to Auto/Timer mode", "info");
        if (typeof logActivity === "function") logActivity("Water Pump Mode", "Switched to Timer mode", "device");
    }
});

/* ──────────────────────────────────────────
   PUMP TIMER – PRESETS
────────────────────────────────────────── */
presets.forEach(btn => {
    btn.addEventListener("click", () => {
        presets.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const mins = parseInt(btn.dataset.min, 10);
        tHr.value  = Math.floor(mins / 60);
        tMin.value = mins % 60;
        tSec.value = 0;
    });
});

/* ──────────────────────────────────────────
   PUMP TIMER – START / STOP
────────────────────────────────────────── */
btnStartTimer?.addEventListener("click", async () => {
    const h   = parseInt(tHr.value  || 0, 10);
    const m   = parseInt(tMin.value || 0, 10);
    const s   = parseInt(tSec.value || 0, 10);
    const tot = h * 3600 + m * 60 + s;

    if (tot <= 0) { showToast("Please enter a valid duration", "error"); return; }
    if (tot > 24 * 3600) { showToast("Duration too long (max 24h)", "error"); return; }

    const now = Date.now();
    const ok = await safeWrite(() =>
        Promise.all([
            update(ref(db, "agriculture/waterPump"), { state: true, mode: "timer" }),
            update(ref(db, "agriculture/waterPump/timer"), {
                enabled: true, startTime: now,
                endTime: now + tot * 1000, duration: tot
            }),
        ])
    );
    if (ok) showToast(`Timer set for ${fmtRuntime(tot)}`);
});

btnStopTimer?.addEventListener("click", async () => {
    const ok = await safeWrite(() =>
        Promise.all([
            update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" }),
            update(ref(db, "agriculture/waterPump/timer"), { enabled: false, startTime: 0, endTime: 0, duration: 0 }),
        ])
    );
    if (ok) showToast("Pump stopped");
});

/* ──────────────────────────────────────────
   COUNTDOWN
────────────────────────────────────────── */
function startCountdown() {
    stopCountdown();
    state.timerIntervalId = setInterval(() => {
        const rem = state.timerEndTime - Date.now();
        if (rem <= 0) { handleTimerExpired(); return; }
        pumpTimeRem.textContent   = fmtHMS(rem);
        const pct = (rem / (state.timerDuration * 1000)) * 100;
        pumpProgress.style.width  = `${Math.max(0, pct)}%`;
    }, 500);
}

function stopCountdown() {
    if (state.timerIntervalId) {
        clearInterval(state.timerIntervalId);
        state.timerIntervalId = null;
    }
    if (pumpTimeRem)  pumpTimeRem.textContent = "00:00";
    if (pumpProgress) pumpProgress.style.width = "100%";
}

function handleTimerExpired() {
    stopCountdown();
    update(ref(db, "agriculture/waterPump"), { state: false, mode: "manual" });
    update(ref(db, "agriculture/waterPump/timer"), { enabled: false, startTime: 0, endTime: 0, duration: 0 });
    showToast("Timer complete — pump stopped", "info");
}

/* ──────────────────────────────────────────
   AUTH
────────────────────────────────────────── */
loginForm?.addEventListener("submit", async e => {
    e.preventDefault();
    const email = loginEmail.value.trim();
    const pwd   = loginPwd.value;
    if (!email || !pwd) return;

    setLoginLoading(true);
    loginError.classList.add("hidden");

    try {
        await signInWithEmailAndPassword(auth, email, pwd);
    } catch (err) {
        const msg = FB_ERRORS[err.code] ?? "Login failed. Please try again.";
        loginError.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">error</span><span>${msg}</span>`;
        loginError.classList.remove("hidden");
    } finally {
        setLoginLoading(false);
    }
});

function setLoginLoading(loading) {
    loginBtn.disabled = loading;
    loginBtn.querySelector(".btn-text").classList.toggle("hidden", loading);
    loginBtn.querySelector(".btn-spinner").classList.toggle("hidden", !loading);
}

togglePwdBtn?.addEventListener("click", () => {
    const isText = loginPwd.type === "text";
    loginPwd.type          = isText ? "password" : "text";
    pwdEyeIcon.textContent = isText ? "visibility" : "visibility_off";
});

logoutBtn?.addEventListener("click", () => {
    stopCountdown();
    stopPumpRunTracker();
    if (scheduleEngineInterval) {
        clearInterval(scheduleEngineInterval);
        scheduleEngineInterval = null;
    }
    window._schedSnap = {};
    signOut(auth);
});

/* ──────────────────────────────────────────
   SCHEDULE FEATURE
────────────────────────────────────────── */
const scheduleModal   = $("schedule-modal");
const schForm         = $("sch-form");
const schIdInput      = $("sch-id");
const schDevice       = $("sch-device");
const schTime         = $("sch-time");
const schDuration     = $("sch-duration");
const schDayBtns      = document.querySelectorAll(".day-btn");
const schModalTitle   = $("sch-modal-title");
const btnAddSchedule  = $("btn-add-schedule");
const btnCloseSchModal= $("btn-close-sch-modal");
const schModalOverlay = $("sch-modal-overlay");
const scheduleList    = $("schedule-list");

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DEVICE_LABELS = {
    valve1: "Zone 1",
    valve2: "Zone 2",
    valve3: "Zone 3",
    pump:   "Water Pump",
};
const DEVICE_ICONS = {
    valve1: "water_drop",
    valve2: "water_drop",
    valve3: "water_drop",
    pump:   "water",
};

let scheduleEngineInterval = null;

/* Open/Close Modal */
function openSchModal(editData = null) {
    schModalTitle.textContent = editData ? "Edit Schedule" : "Add Schedule";
    schIdInput.value    = editData?.id      ?? "";
    schDevice.value     = editData?.device  ?? "valve1";
    schTime.value       = editData?.time    ?? "";
    schDuration.value   = editData?.duration?? "";
    // Reset day selection
    schDayBtns.forEach(b => b.classList.toggle("active", editData ? editData.days.includes(Number(b.dataset.day)) : false));
    scheduleModal.classList.remove("hidden");
}

function closeSchModal() {
    scheduleModal.classList.add("hidden");
    schForm.reset();
    schDayBtns.forEach(b => b.classList.remove("active"));
}

btnAddSchedule ?.addEventListener("click", () => openSchModal());
btnCloseSchModal?.addEventListener("click", closeSchModal);
schModalOverlay ?.addEventListener("click", closeSchModal);

/* Day button toggles */
schDayBtns.forEach(btn => {
    btn.addEventListener("click", () => btn.classList.toggle("active"));
});

/* Get selected days */
function getSelectedDays() {
    return Array.from(schDayBtns)
        .filter(b => b.classList.contains("active"))
        .map(b => Number(b.dataset.day));
}

/* Format time HH:MM → 12h string */
function fmtTime12(t) {
    if (!t) return "--:--";
    const [hh, mm] = t.split(":");
    const h = parseInt(hh, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12  = h % 12 || 12;
    return `${h12}:${mm} ${ampm}`;
}

/* Format end time from start + duration */
function fmtEndTime12(startTime, durationMins) {
    if (!startTime) return "--:--";
    const [hh, mm] = startTime.split(":").map(Number);
    const totalMins = hh * 60 + mm + durationMins;
    const eh = Math.floor(totalMins / 60) % 24;
    const em = totalMins % 60;
    return fmtTime12(`${String(eh).padStart(2,"0")}:${String(em).padStart(2,"0")}`);
}

/* Render schedule list from Firebase data */
function renderSchedules(schedulesObj) {
    if (!scheduleList) return;
    if (!schedulesObj || Object.keys(schedulesObj).length === 0) {
        scheduleList.innerHTML = `
            <div class="sch-empty">
                <span class="material-symbols-outlined">calendar_month</span>
                <p>No schedules yet.<br>Tap <strong>Add Schedule</strong> to create one.</p>
            </div>`;
        return;
    }
    scheduleList.innerHTML = Object.entries(schedulesObj).map(([id, s]) => {
        const icon    = DEVICE_ICONS[s.device] ?? "timer";
        const label   = DEVICE_LABELS[s.device] ?? s.device;
        const start12 = fmtTime12(s.time);
        const end12   = fmtEndTime12(s.time, s.duration);
        const dayStr  = s.days && s.days.length > 0
            ? (s.days.length === 7 ? "Daily" : s.days.map(d => DAY_NAMES[d]).join(", "))
            : "No days set";
        const enabled = s.enabled !== false;
        return `
        <div class="schedule-card ${enabled ? "" : "sch-disabled"}" data-sch-id="${id}">
            <div class="sch-top">
                <div class="sch-icon blue">
                    <span class="material-symbols-outlined">${icon}</span>
                </div>
                <div class="sch-info">
                    <h3>${label}</h3>
                    <span class="sch-time">${start12} – ${end12}</span>
                    <span class="sch-days">${dayStr} · ${s.duration} min</span>
                </div>
                <label class="toggle-switch" aria-label="Toggle schedule">
                    <input type="checkbox" class="sch-enable-toggle" data-id="${id}" ${enabled ? "checked" : ""}>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="sch-actions">
                <button class="sch-btn edit" data-id="${id}">
                    <span class="material-symbols-outlined" style="font-size:16px">edit</span> Edit
                </button>
                <button class="sch-btn delete" data-id="${id}">
                    <span class="material-symbols-outlined" style="font-size:16px">delete</span> Delete
                </button>
            </div>
        </div>`;
    }).join("");

    /* Bind schedule card actions */
    scheduleList.querySelectorAll(".sch-enable-toggle").forEach(chk => {
        chk.addEventListener("change", async () => {
            const id = chk.dataset.id;
            await safeWrite(() => update(ref(db, `agriculture/schedules/${id}`), { enabled: chk.checked }));
        });
    });
    scheduleList.querySelectorAll(".sch-btn.edit").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const s  = schedulesObj[id];
            openSchModal({ id, ...s });
        });
    });
    scheduleList.querySelectorAll(".sch-btn.delete").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const ok = await safeWrite(() => remove(ref(db, `agriculture/schedules/${id}`)));
            if (ok) showToast("Schedule deleted");
        });
    });
}

/* Save (create or update) schedule */
schForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const days = getSelectedDays();
    if (days.length === 0) { showToast("Select at least one day", "error"); return; }
    if (!schTime.value)    { showToast("Set a start time", "error"); return; }
    if (!schDuration.value || Number(schDuration.value) < 1) { showToast("Set a duration", "error"); return; }

    const id = schIdInput.value;
    const payload = {
        device:   schDevice.value,
        time:     schTime.value,
        duration: Number(schDuration.value),
        days,
        enabled:  true,
    };

    let ok;
    if (id) {
        ok = await safeWrite(() => update(ref(db, `agriculture/schedules/${id}`), payload));
    } else {
        ok = await safeWrite(() => push(ref(db, "agriculture/schedules"), payload));
    }
    if (ok) {
        closeSchModal();
        showToast(id ? "Schedule updated" : "Schedule added");
    }
});

/* Listen for schedule changes */
function startScheduleListener() {
    onValue(ref(db, "agriculture/schedules"), snap => {
        renderSchedules(snap.val());
    });
}

/* Schedule engine – runs every minute, triggers device ON/OFF */
function startScheduleEngine() {
    if (scheduleEngineInterval) return;
    scheduleEngineInterval = setInterval(async () => {
        if (!state.firebaseConnected || !state.esp32Online) return;
        const now  = new Date();
        const day  = now.getDay(); // 0=Sun
        const hh   = String(now.getHours()).padStart(2, "0");
        const mm   = String(now.getMinutes()).padStart(2, "0");
        const hhmm = `${hh}:${mm}`;
        // Fetch current schedules snapshot – we already have it via listener
        // but for safety use onValue snapshot cached via global
        if (!window._schedSnap) return;
        for (const [id, s] of Object.entries(window._schedSnap)) {
            if (!s.enabled) continue;
            if (!s.days || !s.days.includes(day)) continue;
            if (s.time !== hhmm) continue;
            // Trigger the device ON
            const path = s.device === "pump"
                ? "agriculture/waterPump"
                : `agriculture/${PATHS[s.device]}`;
            if (s.device === "pump") {
                const durMs  = s.duration * 60 * 1000;
                const nowMs  = Date.now();
                await update(ref(db, path), { state: true, mode: "timer" });
                await update(ref(db, `${path}/timer`), { enabled: true, startTime: nowMs, endTime: nowMs + durMs, duration: s.duration * 60 });
            } else {
                await set(ref(db, `${path}/state`), true);
                // Auto-off after duration
                setTimeout(() => set(ref(db, `${path}/state`), false), s.duration * 60 * 1000);
            }
            showToast(`Schedule triggered: ${DEVICE_LABELS[s.device] ?? s.device}`, "info");
        }
    }, 60_000);
}

/* Cache schedules snapshot globally for engine */
function startScheduleListenerWithCache() {
    onValue(ref(db, "agriculture/schedules"), snap => {
        window._schedSnap = snap.val() ?? {};
        renderSchedules(snap.val());
    });
}

/* ──────────────────────────────────────────
   DARK MODE
────────────────────────────────────────── */
function applyTheme(dark) {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const toggle = $("dark-mode-toggle");
    if (toggle) toggle.checked = dark;
    localStorage.setItem("smartagri-theme", dark ? "dark" : "light");
}

// Init from localStorage
applyTheme(localStorage.getItem("smartagri-theme") === "dark");

$("dark-mode-toggle")?.addEventListener("change", e => {
    applyTheme(e.target.checked);
    showToast(e.target.checked ? "Dark mode enabled" : "Light mode enabled", "info");
});

/* ──────────────────────────────────────────
   NEW FEATURES (Activity, Alerts, Pull-to-Refresh)
────────────────────────────────────────── */

/* Pull-to-Refresh */
const elHome = $("screen-home");
const ptrInd = $("ptr-indicator");
let touchStartY = 0, touchCurY = 0, isPulling = false;

elHome?.addEventListener("touchstart", e => {
    if (elHome.scrollTop === 0) {
        touchStartY = e.touches[0].clientY;
        isPulling = true;
    }
}, { passive: true });

elHome?.addEventListener("touchmove", e => {
    if (!isPulling) return;
    touchCurY = e.touches[0].clientY;
    const dy = touchCurY - touchStartY;
    if (dy > 20 && elHome.scrollTop === 0) {
        ptrInd.classList.add("visible");
    }
}, { passive: true });

elHome?.addEventListener("touchend", () => {
    if (!isPulling) return;
    const dy = touchCurY - touchStartY;
    if (dy > 65 && elHome.scrollTop === 0) {
        ptrInd.classList.add("refreshing");
        ptrInd.querySelector(".ptr-text").textContent = "Refreshing...";
        fetchCurrentWeather();
        setTimeout(() => {
            ptrInd.classList.remove("visible", "refreshing");
            ptrInd.querySelector(".ptr-text").textContent = "Pull to refresh";
            showToast("Dashboard refreshed", "success");
            if (typeof logActivity === "function") logActivity("System Dashboard", "Refreshed live data", "device");
        }, 1200);
    } else {
        ptrInd.classList.remove("visible");
    }
    isPulling = false;
    touchStartY = 0;
});

/* Activity Log Engine */
let activityLogs = JSON.parse(localStorage.getItem("smartagri-activity") || "[]");

window.logActivity = function(title, desc, type = "device") {
    const entry = { title, desc, type, time: Date.now() };
    activityLogs.unshift(entry);
    if (activityLogs.length > 50) activityLogs.pop();
    localStorage.setItem("smartagri-activity", JSON.stringify(activityLogs));
    renderActivityLog();
};

function renderActivityLog(filter = "all") {
    const timeline = $("activity-timeline");
    if (!timeline) return;
    
    let filtered = activityLogs;
    if (filter !== "all") {
        filtered = activityLogs.filter(log => log.type === filter);
    }
    
    if (filtered.length === 0) {
        timeline.innerHTML = `
            <div class="activity-empty">
                <span class="material-symbols-outlined activity-empty-icon">history</span>
                <p>No activity yet</p>
                <span class="activity-empty-sub">Device actions and sensor alerts will appear here</span>
            </div>
        `;
        return;
    }
    
    const icons = {
        device: "router",
        sensor: "sensors",
        schedule: "schedule",
        alert: "warning"
    };
    
    timeline.innerHTML = filtered.map(log => `
        <div class="activity-entry">
            <div class="activity-icon-wrap ${log.type}">
                <span class="material-symbols-outlined">${icons[log.type] || "info"}</span>
            </div>
            <div class="activity-info">
                <div class="activity-title">${log.title}</div>
                <div class="activity-desc">${log.desc}</div>
                <div class="activity-time">${fmtTime(log.time)} - ${new Date(log.time).toLocaleDateString()}</div>
            </div>
        </div>
    `).join("");
}

// Bind activity clear & filters
$("btn-clear-activity")?.addEventListener("click", () => {
    if (confirm("Clear all activity logs?")) {
        activityLogs = [];
        localStorage.setItem("smartagri-activity", "[]");
        renderActivityLog();
        showToast("Activity log cleared", "info");
    }
});
document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", e => {
        document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
        e.target.classList.add("active");
        renderActivityLog(e.target.dataset.filter);
    });
});
// Render initial logs
renderActivityLog();

/* Sensor Alert Thresholds Engine */
let alertThresholds = JSON.parse(localStorage.getItem("smartagri-thresholds") || JSON.stringify({
    tempMin: "", tempMax: 40,
    humMin: 30, humMax: 80,
    soilMin: 300, soilMax: ""
}));
let lastAlertTimes = {};

function loadThresholdInputs() {
    $("alert-temp-min").value = alertThresholds.tempMin;
    $("alert-temp-max").value = alertThresholds.tempMax;
    $("alert-hum-min").value  = alertThresholds.humMin;
    $("alert-hum-max").value  = alertThresholds.humMax;
    $("alert-soil-min").value = alertThresholds.soilMin;
    $("alert-soil-max").value = alertThresholds.soilMax;
}

$("set-alerts")?.addEventListener("click", () => {
    loadThresholdInputs();
    $("alert-modal")?.classList.remove("hidden");
});
$("btn-close-alert-modal")?.addEventListener("click", () => $("alert-modal").classList.add("hidden"));
$("alert-modal-overlay")?.addEventListener("click", () => $("alert-modal").classList.add("hidden"));

$("alert-form")?.addEventListener("submit", e => {
    e.preventDefault();
    alertThresholds = {
        tempMin: $("alert-temp-min").value, tempMax: $("alert-temp-max").value,
        humMin: $("alert-hum-min").value,   humMax: $("alert-hum-max").value,
        soilMin: $("alert-soil-min").value, soilMax: $("alert-soil-max").value
    };
    localStorage.setItem("smartagri-thresholds", JSON.stringify(alertThresholds));
    $("alert-modal").classList.add("hidden");
    showToast("Alert thresholds saved", "success");
});

window.checkSensorAlerts = function(d) {
    const now = Date.now();
    const COOLDOWN = 3600000; // 1 hour cooldown per alert type so we don't spam
    
    function triggerAlert(key, title, desc) {
        if (!lastAlertTimes[key] || (now - lastAlertTimes[key] > COOLDOWN)) {
            logActivity(title, desc, "alert");
            showToast(desc, "error");
            
            // Show notification badge
            const badge = $("notif-badge");
            if (badge) {
                badge.classList.remove("hidden");
                // Reset animation
                badge.style.animation = 'none';
                badge.offsetHeight; /* trigger reflow */
                badge.style.animation = null; 
            }
            
            lastAlertTimes[key] = now;
        }
    }
    
    // Check Temperature
    const t = d.temperature;
    let tAlert = false;
    if (t != null) {
        if (alertThresholds.tempMax !== "" && t > Number(alertThresholds.tempMax)) { triggerAlert("tempMax", "High Temperature Alert", `Temperature exceeded ${alertThresholds.tempMax}°C (Currently ${t}°C)`); tAlert = true; }
        if (alertThresholds.tempMin !== "" && t < Number(alertThresholds.tempMin)) { triggerAlert("tempMin", "Low Temperature Alert", `Temperature dropped below ${alertThresholds.tempMin}°C (Currently ${t}°C)`); tAlert = true; }
    }
    
    // Check Humidity
    const h = d.humidity;
    let hAlert = false;
    if (h != null) {
        if (alertThresholds.humMax !== "" && h > Number(alertThresholds.humMax)) { triggerAlert("humMax", "High Humidity Alert", `Humidity exceeded ${alertThresholds.humMax}% (Currently ${h}%)`); hAlert = true; }
        if (alertThresholds.humMin !== "" && h < Number(alertThresholds.humMin)) { triggerAlert("humMin", "Low Humidity Alert", `Humidity dropped below ${alertThresholds.humMin}% (Currently ${h}%)`); hAlert = true; }
    }
    
    // Check Soil
    const s = d.soil;
    let sAlert = false;
    if (s != null) {
        if (alertThresholds.soilMax !== "" && s > Number(alertThresholds.soilMax)) { triggerAlert("soilMax", "High Soil Moisture Alert", `Soil moisture exceeded ${alertThresholds.soilMax}ppm (Currently ${s}ppm)`); sAlert = true; }
        if (alertThresholds.soilMin !== "" && s < Number(alertThresholds.soilMin)) { triggerAlert("soilMin", "Low Soil Moisture Alert", `Soil moisture dropped below ${alertThresholds.soilMin}ppm (Currently ${s}ppm)`); sAlert = true; }
    }
    
    // Update metric card borders (Home)
    if (mHumidity) mHumidity.parentElement.classList.toggle("alert-active", hAlert);
    if (mSoil) mSoil.parentElement.classList.toggle("alert-active", sAlert);
    
    // Update sensor boxes (Monitor)
    if (monTemp) monTemp.parentElement.classList.toggle("alert-active", tAlert);
    if (monHumidity) monHumidity.parentElement.classList.toggle("alert-active", hAlert);
    if (monSoil) monSoil.parentElement.classList.toggle("alert-active", sAlert);
};

// Wire notification bell click to switch to Activity tab
$("btn-notif")?.addEventListener("click", () => {
    switchTab("activity");
    $("notif-badge")?.classList.add("hidden"); // Clear badge on view
});


/* ──────────────────────────────────────────
   SETTINGS ROW TAPS (friendly feedback)
────────────────────────────────────────── */
const settingActions = {
    "set-wifi":   "Wi-Fi & Firebase settings coming soon",
    "set-device": "Device configuration coming soon",
    "set-notif":  "Notification settings coming soon",
    "set-about":  `SmartAgri v4.2\nESP32 IoT Agriculture Automation`,
};
Object.entries(settingActions).forEach(([id, msg]) => {
    $(id)?.addEventListener("click", () => showToast(msg, "info"));
});

/* ──────────────────────────────────────────
   AUTH STATE → INIT
────────────────────────────────────────── */
onAuthStateChanged(auth, user => {
    if (user) {
        elLoading.classList.add("fade-out");
        elLogin.classList.add("hidden");
        elApp.classList.remove("hidden");
        if (!state.appInitialized) {
            state.appInitialized = true;
            bindToggles();
            startListeners();
            startScheduleListenerWithCache();
            startScheduleEngine();
            initRealtimeTemperature();
        }
    } else {
        elLoading.classList.add("fade-out");
        elLogin.classList.remove("hidden");
        elApp.classList.add("hidden");
        stopCountdown();
        stopPumpRunTracker();
        state.appInitialized = false;
    }
});

// Also trigger immediate weather fetch for fast splash load
initRealtimeTemperature();