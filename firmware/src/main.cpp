#include <Arduino.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <Preferences.h>
#include <NTPClient.h>
#include <WiFiUdp.h>
#include <esp_task_wdt.h>
#include <vector>

#include "Config.h"
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

/* ──────────────────────────────────────────
   GLOBALS & CORE SERVICES
────────────────────────────────────────── */
FirebaseAuth auth;
FirebaseConfig config;
FirebaseData fbdoStream;
FirebaseData fbdo;

Preferences nvs;
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, NTP_SERVER);

bool timeValid = false;
bool emergencyStopActive = false;
unsigned long lastHeartbeat = 0;
unsigned long lastTimeSync = 0;

int wifiReconnects = 0;
int firebaseReconnects = 0;
String lastError = "";

// Forward declarations
void triggerEmergencyStop();
void clearEmergencyStop();

/* ──────────────────────────────────────────
   NVS MANAGER
────────────────────────────────────────── */
namespace NVSManager {
    void init() {
        nvs.begin("smartagri", false);
    }
    
    void saveScheduleLastTriggered(const String &scheduleId, const String &dateKey) {
        String key = "sch_" + scheduleId;
        nvs.putString(key.c_str(), dateKey);
    }
    
    bool hasScheduleTriggered(const String &scheduleId, const String &dateKey) {
        String key = "sch_" + scheduleId;
        String last = nvs.getString(key.c_str(), "");
        return (last == dateKey);
    }
    
    void saveTimer(const String &deviceId, unsigned long epochEndTime) {
        String key = "tmr_" + deviceId;
        nvs.putUInt(key.c_str(), epochEndTime);
    }
    
    unsigned long getTimer(const String &deviceId) {
        String key = "tmr_" + deviceId;
        return nvs.getUInt(key.c_str(), 0);
    }
}

/* ──────────────────────────────────────────
   TIME MANAGER
────────────────────────────────────────── */
namespace TimeManager {
    void init() {
        timeClient.begin();
        configTime(0, 0, NTP_SERVER);
        setenv("TZ", TZ_INFO, 1);
        tzset();
        
        if (WiFi.status() == WL_CONNECTED) {
            timeClient.update();
            if (timeClient.getEpochTime() > 1600000000) {
                timeValid = true;
                Serial.println("[TIME] Synced via NTP.");
            }
        }
    }
    
    void update() {
        if (WiFi.status() == WL_CONNECTED && millis() - lastTimeSync > 3600000) {
            timeClient.update();
            if (timeClient.getEpochTime() > 1600000000) timeValid = true;
            lastTimeSync = millis();
        }
    }
    
    String getHHMM() {
        if (!timeValid) return "00:00";
        time_t now = timeClient.getEpochTime();
        struct tm* ptm = localtime(&now);
        char buf[6];
        snprintf(buf, sizeof(buf), "%02d:%02d", ptm->tm_hour, ptm->tm_min);
        return String(buf);
    }
    
    int getDayOfWeek() {
        if (!timeValid) return 0;
        time_t now = timeClient.getEpochTime();
        struct tm* ptm = localtime(&now);
        return ptm->tm_wday; // 0=Sunday
    }
    
    String getDateKey() {
        if (!timeValid) return "";
        time_t now = timeClient.getEpochTime();
        struct tm* ptm = localtime(&now);
        char buf[12];
        snprintf(buf, sizeof(buf), "%04d-%02d-%02d", ptm->tm_year + 1900, ptm->tm_mon + 1, ptm->tm_mday);
        return String(buf);
    }
}

/* ──────────────────────────────────────────
   DEVICE MANAGER (Hybrid Timer & NVS)
────────────────────────────────────────── */
enum DeviceState { SAFE_OFF, OFF, ON, FAULT };

struct Device {
    String id;
    String type;
    int gpio;
    bool enabled;
    bool activeHigh;
    bool safeHigh;
    bool desiredState;
    bool actualState;
    DeviceState state;
    
    uint32_t maxOnDurationSec;
    unsigned long turnOnTimeMs;       // Monotonic start time for max runtime
    
    // Hybrid Timer
    bool timerActive;
    unsigned long timerDurationMs;    // Monotonic fallback duration
    unsigned long timerStartMs;       // Monotonic start time
    unsigned long timerEpochEndTime;  // Absolute NTP end time for NVS recovery
    
    String lastCommandId;
    bool hasFault;
    String faultCode;
    
    // Manual Override
    unsigned long manualOverrideUntilMs;
};

std::vector<Device> devices;

Device* getDevice(String id) {
    for (auto &d : devices) {
        if (d.id == id) return &d;
    }
    return nullptr;
}

namespace DeviceManager {
    void applySafeLevel(Device &dev) {
        digitalWrite(dev.gpio, dev.safeHigh ? HIGH : LOW);
    }

    void applyActiveLevel(Device &dev) {
        digitalWrite(dev.gpio, dev.activeHigh ? HIGH : LOW);
    }

    void writeDeviceStatus(Device &dev) {
        if (!Firebase.ready()) return;
        String basePath = String("farms/") + FARM_ID + "/controllers/" + CONTROLLER_ID + "/devices/" + dev.id + "/status";
        FirebaseJson json;
        json.set("actualState", dev.actualState);
        json.set("lastCommandId", dev.lastCommandId);
        json.set("fault", dev.hasFault);
        json.set("faultCode", dev.faultCode);
        
        Firebase.RTDB.updateNodeAsync(&fbdo, basePath.c_str(), &json);
    }
    
    void turnOffSafe(Device &dev, String reason) {
        Serial.printf("[%s] %s -> OFF\n", dev.id.c_str(), reason.c_str());
        dev.desiredState = false;
        dev.actualState = false;
        dev.timerActive = false;
        dev.timerEpochEndTime = 0;
        NVSManager::saveTimer(dev.id, 0); // Clear NVS timer
        dev.state = dev.hasFault ? FAULT : OFF;
        applySafeLevel(dev);
        writeDeviceStatus(dev);
    }
    
    void turnOn(Device &dev, unsigned long epochDurationSec = 0) {
        Serial.printf("[%s] ON\n", dev.id.c_str());
        dev.desiredState = true;
        dev.actualState = true;
        dev.turnOnTimeMs = millis();
        dev.state = ON;
        
        if (epochDurationSec > 0 && timeValid) {
            dev.timerActive = true;
            dev.timerStartMs = millis();
            dev.timerDurationMs = epochDurationSec * 1000;
            dev.timerEpochEndTime = timeClient.getEpochTime() + epochDurationSec;
            NVSManager::saveTimer(dev.id, dev.timerEpochEndTime);
        } else {
            dev.timerActive = false;
            dev.timerEpochEndTime = 0;
        }
        
        applyActiveLevel(dev);
        writeDeviceStatus(dev);
    }

    void init() {
        devices.push_back({"pump",   "pump",  GPIO_PUMP,   true, true, false, false, false, SAFE_OFF, 7200, 0, false, 0, 0, 0, "", false, "", 0});
        devices.push_back({"valve1", "valve", GPIO_VALVE1, true, true, false, false, false, SAFE_OFF, 3600, 0, false, 0, 0, 0, "", false, "", 0});
        devices.push_back({"valve2", "valve", GPIO_VALVE2, true, true, false, false, false, SAFE_OFF, 3600, 0, false, 0, 0, 0, "", false, "", 0});
        devices.push_back({"valve3", "valve", GPIO_VALVE3, true, true, false, false, false, SAFE_OFF, 3600, 0, false, 0, 0, 0, "", false, "", 0});
        devices.push_back({"light",  "light", GPIO_LIGHT,  true, true, false, false, false, SAFE_OFF, 43200,0, false, 0, 0, 0, "", false, "", 0});
        devices.push_back({"fan",    "fan",   GPIO_FAN,    true, true, false, false, false, SAFE_OFF, 28800,0, false, 0, 0, 0, "", false, "", 0});

        for (auto &dev : devices) {
            pinMode(dev.gpio, OUTPUT);
            applySafeLevel(dev);
            
            // Check NVS for recovered timers
            unsigned long recoveredEpoch = NVSManager::getTimer(dev.id);
            if (recoveredEpoch > 0) {
                dev.timerEpochEndTime = recoveredEpoch;
                dev.timerActive = true;
                Serial.printf("[RECOVERY] Found active timer for %s (Expires: %lu)\n", dev.id.c_str(), recoveredEpoch);
                // We don't act on it immediately until Time is valid, 
                // handled in update() below.
            }
        }
    }

    void update() {
        unsigned long nowMs = millis();
        unsigned long epochNow = timeValid ? timeClient.getEpochTime() : 0;
        
        for (auto &dev : devices) {
            if (!dev.enabled) continue;

            // 1. Emergency Stop Override
            if (emergencyStopActive && !dev.hasFault) {
                if (dev.actualState) {
                    dev.hasFault = true;
                    dev.faultCode = "EMERGENCY_STOP";
                    turnOffSafe(dev, "EMERGENCY_STOP");
                }
                continue;
            }

            // 2. Max Runtime (Monotonic, works offline)
            if (dev.actualState && dev.maxOnDurationSec > 0) {
                uint32_t runTimeSec = (nowMs - dev.turnOnTimeMs) / 1000;
                if (runTimeSec >= dev.maxOnDurationSec) {
                    dev.hasFault = true;
                    dev.faultCode = "MAX_RUNTIME";
                    turnOffSafe(dev, "MAX_RUNTIME_EXCEEDED");
                    continue;
                }
            }

            // 3. Hybrid Timer (Offline monotonic + Online NTP recovery)
            if (dev.actualState && dev.timerActive) {
                bool expired = false;
                
                // If NTP is valid, authoritative check:
                if (timeValid && epochNow >= dev.timerEpochEndTime) {
                    expired = true;
                } 
                // Fallback: if time invalid but we have a monotonic duration tracking
                else if (!timeValid && dev.timerDurationMs > 0 && (nowMs - dev.timerStartMs >= dev.timerDurationMs)) {
                    expired = true;
                }
                
                if (expired) {
                    turnOffSafe(dev, "TIMER_EXPIRED");
                }
            }
            
            // 4. Timer Recovery Boot Execution
            if (!dev.actualState && dev.timerActive && timeValid) {
                if (epochNow < dev.timerEpochEndTime) {
                    // Recovering from reboot while timer still active!
                    unsigned long remainingSec = dev.timerEpochEndTime - epochNow;
                    Serial.printf("[RECOVERY] Resuming %s for remaining %lu sec\n", dev.id.c_str(), remainingSec);
                    turnOn(dev, remainingSec);
                } else {
                    // Recovering from reboot but timer already expired while offline
                    Serial.printf("[RECOVERY] Timer for %s expired while offline. Clearing.\n", dev.id.c_str());
                    dev.timerActive = false;
                    dev.timerEpochEndTime = 0;
                    NVSManager::saveTimer(dev.id, 0);
                }
            }

            // 5. Sync Desired -> Actual
            if (dev.desiredState != dev.actualState && !dev.hasFault && !emergencyStopActive) {
                if (dev.desiredState) {
                    turnOn(dev);
                } else {
                    turnOffSafe(dev, "USER_COMMAND");
                }
            }
        }
    }
}

/* ──────────────────────────────────────────
   LOCAL SCHEDULER
────────────────────────────────────────── */
struct Schedule {
    String id;
    String deviceId;
    String timeHHMM;
    int durationMin;
    bool enabled;
    std::vector<int> days;
};

std::vector<Schedule> schedules;

namespace Scheduler {
    unsigned long lastCheckMs = 0;
    
    // Called when Firebase updates /schedules/
    void updateScheduleCache(FirebaseJson &jsonObj) {
        schedules.clear();
        size_t count = jsonObj.iteratorBegin();
        for (size_t i = 0; i < count; i++) {
            FirebaseJson::IteratorValue value = jsonObj.valueAt(i);
            if (value.type == FirebaseJson::JSON_OBJECT) {
                FirebaseJson schJson;
                schJson.setJsonData(value.value);
                
                Schedule s;
                s.id = value.key;
                
                FirebaseJsonData data;
                schJson.get(data, "device"); if (data.success) s.deviceId = data.stringValue;
                schJson.get(data, "time"); if (data.success) s.timeHHMM = data.stringValue;
                schJson.get(data, "durationMin"); if (data.success) s.durationMin = data.intValue;
                schJson.get(data, "enabled"); if (data.success) s.enabled = data.boolValue;
                
                schJson.get(data, "days");
                if (data.success && data.type == "array") {
                    FirebaseJsonArray daysArr;
                    daysArr.setJsonArrayData(data.stringValue);
                    for (size_t j = 0; j < daysArr.size(); j++) {
                        FirebaseJsonData dVal;
                        daysArr.get(dVal, j);
                        if (dVal.success) s.days.push_back(dVal.intValue);
                    }
                }
                
                schedules.push_back(s);
            }
        }
        jsonObj.iteratorEnd();
        Serial.printf("[SCHEDULER] Cached %d schedules.\n", schedules.size());
    }
    
    void update() {
        if (!timeValid || emergencyStopActive) return;
        if (millis() - lastCheckMs < SCHEDULE_CHECK_INTERVAL_MS) return;
        lastCheckMs = millis();
        
        String currentHHMM = TimeManager::getHHMM();
        int currentDay = TimeManager::getDayOfWeek();
        String dateKey = TimeManager::getDateKey() + "_" + currentHHMM;
        
        for (auto &s : schedules) {
            if (!s.enabled) continue;
            if (s.timeHHMM != currentHHMM) continue;
            
            bool dayMatch = false;
            for (int d : s.days) { if (d == currentDay) dayMatch = true; }
            if (!dayMatch) continue;
            
            // Deduplication via NVS
            if (NVSManager::hasScheduleTriggered(s.id, dateKey)) continue;
            
            Device* dev = getDevice(s.deviceId);
            if (!dev) continue;
            
            // Manual Override Check
            if (millis() < dev->manualOverrideUntilMs) {
                Serial.printf("[SCHEDULER] Skipping %s due to Manual Override.\n", s.id.c_str());
                NVSManager::saveScheduleLastTriggered(s.id, dateKey); // Mark executed so we don't retry
                continue;
            }
            
            Serial.printf("[SCHEDULER] Executing Schedule %s on %s\n", s.id.c_str(), s.deviceId.c_str());
            
            // Trigger device ON with timer duration
            DeviceManager::turnOn(*dev, s.durationMin * 60);
            
            // Mark executed
            NVSManager::saveScheduleLastTriggered(s.id, dateKey);
        }
    }
}

/* ──────────────────────────────────────────
   SENSOR MANAGER
────────────────────────────────────────── */
namespace SensorManager {
    // Boilerplate for ADC polling (GPIO32-39)
    unsigned long lastSample = 0;
    
    void init() {
        // analogReadResolution(12); // ESP32 default
    }
    
    void update() {
        if (millis() - lastSample < 5000) return;
        lastSample = millis();
        
        // Example: Non-blocking analog read
        // int raw = analogRead(32);
        // int mapped = map(raw, 0, 4095, 0, 100);
        // if (mapped < 0 || mapped > 100) return; // Fault detection
        // write to firebase if changed significantly
    }
}

/* ──────────────────────────────────────────
   FIREBASE MANAGER
────────────────────────────────────────── */
void streamCallback(FirebaseStream data) {
    String path = data.dataPath();
    String eventType = data.eventType();
    String dataType = data.dataType();
    
    if (path.startsWith("/safety/emergencyStop")) {
        bool wasActive = emergencyStopActive;
        emergencyStopActive = data.boolData();
        if (emergencyStopActive && !wasActive) {
            Serial.println("🚨 EMERGENCY STOP TRIGGERED VIA FIREBASE");
            // Handled in DeviceManager::update()
        } else if (!emergencyStopActive && wasActive) {
            Serial.println("✅ EMERGENCY STOP CLEARED");
            for(auto &d : devices) {
                if (d.faultCode == "EMERGENCY_STOP") {
                    d.hasFault = false;
                    d.faultCode = "";
                }
            }
        }
    } 
    else if (path.startsWith("/devices/")) {
        int firstSlash = path.indexOf('/', 9); 
        if (firstSlash == -1) return;
        
        String devId = path.substring(9, firstSlash);
        String subPath = path.substring(firstSlash);
        
        Device* dev = getDevice(devId);
        if (!dev) return; 
        
        if (subPath == "/desired/desiredState") {
            bool state = data.boolData();
            if (state != dev->actualState) {
                dev->desiredState = state;
                // Track manual override if user clicks UI
                dev->manualOverrideUntilMs = millis() + (60 * 60 * 1000); // 1 hour override
            }
        } 
        else if (subPath == "/desired/commandId") {
            String newCmd = data.stringData();
            if (newCmd == dev->lastCommandId) {
                Serial.println("[STREAM] Deduplicating command.");
            } else {
                dev->lastCommandId = newCmd;
                if (dev->hasFault && dev->faultCode == "MAX_RUNTIME") {
                    dev->hasFault = false;
                    dev->faultCode = "";
                }
            }
        }
        else if (subPath == "/timer") {
            if (dataType == "json") {
                FirebaseJsonData jsonData;
                data.jsonObject().get(jsonData, "active");
                if (jsonData.success && jsonData.boolValue) {
                    data.jsonObject().get(jsonData, "endTime");
                    if (jsonData.success) {
                        dev->timerEpochEndTime = jsonData.intValue;
                        dev->timerActive = true;
                        NVSManager::saveTimer(dev->id, dev->timerEpochEndTime);
                    }
                }
            }
        }
    }
}

void streamTimeoutCallback(bool timeout) {
    if (timeout) Serial.println("[STREAM] Timeout, resuming...");
}

// Separate callback for Schedules (which are at farm level, not controller level in Phase 2)
void scheduleStreamCallback(FirebaseStream data) {
    if (data.dataType() == "json") {
        FirebaseJson json;
        json.setJsonData(data.jsonString());
        Scheduler::updateScheduleCache(json);
    }
}

void initFirebase() {
    config.host = FIREBASE_HOST;
    config.signer.tokens.legacy_token = FIREBASE_AUTH; // Note: Modular design allows swapping to config.api_key & auth.user.email later
    
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
    
    fbdo.setResponseSize(1024);
    fbdoStream.setResponseSize(2048);
    
    String streamPath = String("farms/") + FARM_ID + "/controllers/" + CONTROLLER_ID;
    if (!Firebase.RTDB.beginStream(&fbdoStream, streamPath.c_str())) {
        Serial.printf("[FB] Controller stream failed: %s\n", fbdoStream.errorReason().c_str());
        lastError = "FB_STREAM_FAIL";
    }
    Firebase.RTDB.setStreamCallback(&fbdoStream, streamCallback, streamTimeoutCallback);
    
    // Fetch initial schedules snapshot manually, stream will catch future updates
    String schedPath = String("farms/") + FARM_ID + "/schedules";
    FirebaseData fbdoSched;
    if (Firebase.RTDB.getJSON(&fbdoSched, schedPath.c_str())) {
        FirebaseJson json;
        json.setJsonData(fbdoSched.jsonString());
        Scheduler::updateScheduleCache(json);
    }
}

void processHeartbeat() {
    if (!Firebase.ready() || millis() - lastHeartbeat < FB_HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeat = millis();
    
    String hbPath = String("farms/") + FARM_ID + "/controllers/" + CONTROLLER_ID + "/heartbeat";
    FirebaseJson hb;
    hb.set("online", true);
    hb.set("lastSeen", timeValid ? (int)timeClient.getEpochTime() : 0);
    hb.set("uptime", (int)(millis() / 1000));
    hb.set("rssi", WiFi.RSSI());
    hb.set("freeHeap", ESP.getFreeHeap());
    hb.set("firmwareVersion", FW_VERSION);
    hb.set("configVersion", CONFIG_VERSION);
    hb.set("wifiReconnects", wifiReconnects);
    hb.set("firebaseReconnects", firebaseReconnects);
    hb.set("lastError", lastError);
    // hb.set("resetReason", esp_reset_reason()); // Optional ESP-IDF metric
    
    Firebase.RTDB.updateNodeAsync(&fbdo, hbPath.c_str(), &hb);
}

/* ──────────────────────────────────────────
   WIFI MANAGER
────────────────────────────────────────── */
void initWiFi() {
    Serial.printf("Connecting to %s ", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    uint32_t startMs = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startMs < 15000) {
        delay(500);
        Serial.print(".");
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\nConnected. IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\nWiFi Failed. Continuing offline...");
        lastError = "WIFI_INIT_FAIL";
    }
}

/* ──────────────────────────────────────────
   SETUP & LOOP
────────────────────────────────────────── */
void setup() {
    Serial.begin(115200);
    Serial.println("\n[SYS] Booting SmartAgri v3.1");

    NVSManager::init();
    DeviceManager::init();
    SensorManager::init();
    
    esp_task_wdt_init(WDT_TIMEOUT_SEC, true);
    esp_task_wdt_add(NULL);

    initWiFi();
    TimeManager::init();
    
    if (WiFi.status() == WL_CONNECTED) {
        initFirebase();
    }
}

void loop() {
    esp_task_wdt_reset();
    
    if (WiFi.status() != WL_CONNECTED) {
        WiFi.reconnect();
        wifiReconnects++;
    }
    
    TimeManager::update();
    SensorManager::update();
    Scheduler::update();
    DeviceManager::update();
    processHeartbeat();
    
    if (Firebase.ready()) {
        Firebase.RTDB.readStream(&fbdoStream);
    }
    
    delay(10);
}
