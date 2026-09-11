# Smart Agriculture - ESP32 Firebase LED Control

This project provides a complete responsive web application to remotely control an ESP32's built-in LED via Firebase Realtime Database.

## Project Structure
```
smartagri/
├── index.html        # Main HTML layout for Login and Dashboard
├── style.css         # Styling for modern IoT dashboard interface
├── app.js            # Firebase connection, authentication, and database logic
└── README.md         # This setup and documentation file
```

## Running the Web Application Locally

1. Open your terminal and navigate to the project directory:
   ```bash
   cd /Users/vijaykrish/Desktop/smartagri
   ```
2. Start a local HTTP server. You can use Python or Node.js.
   Using Python 3:
   ```bash
   python3 -m http.server 8000
   ```
3. Open your browser and navigate to: `http://localhost:8000`

## Firebase Setup Instructions

### 1. Firebase Authentication
1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Select the `smartagri-8bd16` project.
3. Click on **Authentication** in the left sidebar, then click **Get Started**.
4. Go to the **Sign-in method** tab.
5. Enable **Email/Password**.
6. Go to the **Users** tab and click **Add user**.
7. Create the authorized user:
   - **Email:** `shanthosh7646@gmail.com`
   - **Password:** Create a secure password (You will use this password to log in on the web dashboard).

*Note on Security: The Firebase Web API Key in `app.js` identifies your project to Google and is safe to be in public frontend code. However, NEVER hard-code the Firebase account password in the code.*

### 2. Firebase Realtime Database
1. In the Firebase Console, go to **Realtime Database** in the left sidebar.
2. Click **Create Database**.
3. Choose the region (already set to `asia-southeast1`) and click Next.
4. Start in **Locked Mode**.
5. Go to the **Rules** tab and replace the contents with the following rules to ensure only authenticated users can read and write:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```
6. Click **Publish**.

---

## ESP32 Arduino Code

This code runs on your ESP32. It connects to Wi-Fi, authenticates with Firebase (using your email/password to respect the database rules), reads the `/esp32/led/state` node, and updates the built-in LED on GPIO 2.

### Required Libraries
In Arduino IDE, go to **Sketch > Include Library > Manage Libraries**, and install:
1. `Firebase ESP32 Client` (by Mobizt) or `FirebaseClient` (by Mobizt). The code below uses `Firebase ESP32 Client` syntax.

### Arduino Sketch (`esp32_firebase.ino`)

```cpp
#include <WiFi.h>
#include <FirebaseESP32.h>

// 1. Wi-Fi Credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// 2. Firebase Credentials
#define FIREBASE_HOST "smartagri-8bd16-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "YOUR_FIREBASE_DATABASE_SECRET_OR_API_KEY"
// Note: If using Firebase Auth with Email/Password for the ESP32:
#define API_KEY "AIzaSyD6y_ybBXjnSQ2uhv265U3c7rGW0V6tOA0"
#define USER_EMAIL "shanthosh7646@gmail.com"
#define USER_PASSWORD "YOUR_FIREBASE_PASSWORD"

// 3. Hardware Definitions
#define LED_PIN 2

// Define LED active state (Some ESP32 boards use active-LOW)
#define LED_ON_STATE HIGH
#define LED_OFF_STATE LOW

// Firebase objects
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

void setup() {
  Serial.begin(115200);
  
  // Initialize LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LED_OFF_STATE);

  // Connect to Wi-Fi
  Serial.print("Connecting to Wi-Fi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }
  Serial.println("\nConnected to Wi-Fi!");

  // Setup Firebase
  config.api_key = API_KEY;
  config.database_url = FIREBASE_HOST;
  
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  Serial.println("Connecting to Firebase...");
}

void loop() {
  if (Firebase.ready()) {
    // Read the boolean value from database
    if (Firebase.getBool(fbdo, "/esp32/led/state")) {
      bool ledState = fbdo.boolData();
      Serial.print("LED State from DB: ");
      Serial.println(ledState ? "ON" : "OFF");
      
      // Update LED hardware
      if (ledState) {
        digitalWrite(LED_PIN, LED_ON_STATE);
      } else {
        digitalWrite(LED_PIN, LED_OFF_STATE);
      }
    } else {
      Serial.print("Error reading Firebase: ");
      Serial.println(fbdo.errorReason());
    }
  }
  
  // Wait before next check
  delay(1000); 
}
```

### Important Notes on ESP32 Setup
- Replace `YOUR_WIFI_SSID` and `YOUR_WIFI_PASSWORD` with your local network details.
- Replace `YOUR_FIREBASE_PASSWORD` with the password you created for the `shanthosh7646@gmail.com` user in the Firebase Console.
- **Active-Low LEDs:** The code uses `LED_ON_STATE` as `HIGH`. If your specific ESP32 board uses an active-LOW LED (where `LOW` turns it on), simply swap `HIGH` and `LOW` in the definitions.
