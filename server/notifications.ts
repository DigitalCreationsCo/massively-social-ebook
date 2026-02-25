import sgMail from '@sendgrid/mail';
import * as admin from 'firebase-admin';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
    console.warn('[Notifications] SENDGRID_API_KEY missing, email will be mocked.');
}

// Initialize Firebase Admin for Push Notifications
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (err) {
        console.error('[Notifications] Failed to initialize Firebase Admin:', err);
    }
} else {
    console.warn('[Notifications] FIREBASE_SERVICE_ACCOUNT missing, push will be mocked.');
}

/**
 * Notification utilities for multi-channel communication.
 */

/**
 * Sends an email notification using SendGrid.
 */
export async function sendEmail(to: string, subject: string, body: string) {
    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
        console.log(`[Email MOCK] Sending to: ${to}`);
        console.log(`[Email MOCK] Subject: ${subject}`);
        console.log(`[Email MOCK] Body: ${body.substring(0, 50)}...`);
        return { success: true, messageId: `mock-email-${Date.now()}` };
    }

    const msg = {
        to,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject,
        text: body,
        html: body.replace(/\n/g, '<br>'),
    };

    try {
        const [ response ] = await sgMail.send(msg);
        console.log(`[Email] Sent successfully to ${to}. Message ID: ${response.headers[ 'x-message-id' ]}`);
        return { success: true, messageId: response.headers[ 'x-message-id' ] };
    } catch (err) {
        console.error('[Email] SendGrid Error:', err);
        throw err;
    }
}

/**
 * Sends a push notification using Firebase Cloud Messaging (FCM).
 */
export async function sendPushNotification(token: string, title: string, body: string) {
    if (admin.apps.length === 0) {
        console.log(`[Push MOCK] Sending to token: ${token}`);
        console.log(`[Push MOCK] Title: ${title}`);
        console.log(`[Push MOCK] Body: ${body}`);
        return { success: true, pushId: `mock-push-${Date.now()}` };
    }

    const message = {
        notification: {
            title,
            body,
        },
        token,
    };

    try {
        const response = await admin.messaging().send(message);
        console.log(`[Push] Successfully sent message to ${token}:`, response);
        return { success: true, pushId: response };
    } catch (err) {
        console.error('[Push] FCM Error:', err);
        throw err;
    }
}
