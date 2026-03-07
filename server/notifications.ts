import { Resend } from 'resend';
import * as admin from 'firebase-admin';

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);
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
export async function sendEmail(
    to: string, 
    subject: string, 
    body: string,
    attachments?: { filename: string; content: string | Buffer; contentType?: string }[]
) {
    if (!process.env.RESEND_API_KEY) {
        console.log(`[Email MOCK] Sending to: ${to}`);
        console.log(`[Email MOCK] Subject: ${subject}`);
        console.log(`[Email MOCK] Body: ${body.substring(0, 50)}...`);
        if (attachments) {
            console.log(`[Email MOCK] Attachments: ${attachments.length}`);
        }
        return { success: true, messageId: `mock-email-${Date.now()}` };
    }

    try {
        const payload: any = {
            from: process.env.RESEND_FROM_EMAIL || 'community@the25thchapter.com',
            to,
            subject,
            text: body,
            html: body.replace(/\n/g, '<br>'),
        };

        if (attachments) {
            payload.attachments = attachments.map(att => ({
                filename: att.filename,
                content: att.content,
                contentType: att.contentType
            }));
        }

        const { data, error } = await resend.emails.send(payload);

        if (error) {
            console.error('[Email] Resend Error:', error);
            throw new Error(error.message);
        }

        console.log(`[Email] Sent successfully to ${to}. Message ID: ${data?.id}`);
        return { success: true, messageId: data?.id };
    } catch (err) {
        console.error('[Email] Exception caught during sending:', err);
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
