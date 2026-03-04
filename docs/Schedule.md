# Global Session Schedule Strategy

## Objective
To maximize user density ("liquidity") in session rooms while providing convenient evening hours for a global audience. The strategy focuses on three key "prime time" windows that cover approximately 80% of the valuable global market.

## The "Golden Trio" (24-Hour Coverage)

All times are listed in **Mountain Standard Time (MST)**, the server's local time.

### 1. The Americas Slot (Primary Focus)
*   **Target:** US East Coast, US West Coast, Latin America
*   **Optimal Time:** **19:00 MST (7:00 PM)**
*   **Conversions:**
    *   New York (EST): 9:00 PM
    *   Los Angeles (PST): 6:00 PM
    *   São Paulo (BRT): 11:00 PM

### 2. The EMEA Slot (Atlantic Bridge)
*   **Target:** UK, Western Europe, Middle East, Africa
*   **Optimal Time:** **12:00 MST (Noon)**
*   **Conversions:**
    *   London (GMT): 7:00 PM
    *   Berlin/Paris (CET): 8:00 PM
    *   Dubai (GST): 11:00 PM
    *   New York (EST): 2:00 PM (Lunch break crossover)

### 3. The APAC Slot (Pacific Bridge)
*   **Target:** Japan, Australia, Singapore, India
*   **Optimal Time:** **04:00 MST (4:00 AM)**
*   **Conversions:**
    *   Tokyo (JST): 8:00 PM
    *   Sydney (AEDT): 10:00 PM
    *   Singapore (SGT): 7:00 PM
    *   Mumbai (IST): 4:30 PM

---

## Phased Rollout Plan

To prevent user dilution, sessions should be enabled in phases based on demand.

### Phase 1: Optimize Americas (Immediate)
*   **Action:** Shift current 8:00 PM MST session to **7:00 PM MST**.
*   **Benefit:** Captures US East Coast prime time (9 PM) without losing West Coast users (6 PM).

### Phase 2: The "Atlantic Bridge" (Growth)
*   **Trigger:** >100 active daily users from Europe/Africa.
*   **Action:** Enable **12:00 PM MST** session.
*   **Benefit:** Unlocks the European market evening and provides a lunch-time slot for North American users.

### Phase 3: The "Pacific Bridge" (Scale)
*   **Trigger:** Significant traffic logs from Asia/Australia.
*   **Action:** Enable **04:00 AM MST** session.
*   **Benefit:** Complete 24-hour global coverage.

---

## Summary Reference Table

| Session Name | MST (Server) | London (GMT) | New York (EST) | Los Angeles (PST) | Tokyo (JST) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Europe Prime** | **12:00 PM** | 7:00 PM | 2:00 PM | 11:00 AM | 4:00 AM |
| **Americas Prime** | **7:00 PM** | 2:00 AM | 9:00 PM | 6:00 PM | 11:00 AM |
| **APAC Prime** | **4:00 AM** | 11:00 AM | 6:00 AM | 3:00 AM | 8:00 PM |
