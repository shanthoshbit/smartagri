#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

/* ── WIFI CREDENTIALS ── */
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

/* ── FIREBASE CREDENTIALS (Modular for future replacement) ── */
#define FIREBASE_HOST "YOUR_PROJECT.firebaseio.com"
#define FIREBASE_AUTH "YOUR_DATABASE_SECRET" 
#define USER_EMAIL "controller@smartagri.local"
#define USER_PASSWORD "esp32_secure_password"

/* ── ARCHITECTURE DEFINITIONS ── */
#define FARM_ID "farm_001"
#define CONTROLLER_ID "esp32_main"
#define CONFIG_VERSION "2.0"
#define FW_VERSION "3.1.0" // Modular refactor

/* ── NTP / TIME ── */
#define NTP_SERVER "pool.ntp.org"
// Asia/Kolkata is UTC+5:30. POSIX string: UTC-5:30
#define TZ_INFO "UTC-5:30" 

/* ── SAFETY / WATCHDOG ── */
#define WDT_TIMEOUT_SEC 15
#define FB_HEARTBEAT_INTERVAL_MS 15000
#define SCHEDULE_CHECK_INTERVAL_MS 1000

/* ── GPIO DEFINITIONS ── */
// System Pins
#define GPIO_PUMP 16
#define GPIO_VALVE1 17
#define GPIO_VALVE2 18
#define GPIO_VALVE3 19
#define GPIO_LIGHT 25
#define GPIO_FAN 26

// Max allowed custom devices
#define MAX_CUSTOM_DEVICES 12

// Safety validation lists
const int CUSTOM_DEVICE_GPIOS[] = {4, 13, 14, 23, 27};
const int SYSTEM_DEVICE_GPIOS[] = {16, 17, 18, 19, 25, 26};
const int I2C_GPIOS[]           = {21, 22};
const int SENSOR_GPIOS[]        = {32, 33, 34, 35, 36, 39};
const int RESERVED_GPIOS[]      = {0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15};

#endif
