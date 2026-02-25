import { storage } from "./storage";

/**
 * Captures user identity and engagement data for CRM/Analytics.
 * Provides a hook for future integration with Segment, Mixpanel, etc.
 */
export async function trackUserEmail(email: string, source: string) {
    console.log(`[Analytics] Capturing email: ${email} from source: ${source}`);
    
    try {
        // Principal Engineer Note: Decouple analytics from primary storage 
        // using a message queue (e.g., Redis/Kafka) in higher-traffic environments.
        await storage.createUser({
            email,
            pushToken: null // Initial capture via email
        });
        console.log(`[Analytics] Successfully stored user ${email} in datastore.`);
    } catch (err) {
        // Silently fail or log if user already exists (unique constraint)
        console.warn(`[Analytics] User ${email} already tracked or storage error:`, err);
    }
}
