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
 * Sends an email notification using Resend.
 * Supports both plain-text fallbacks and compiled HTML bodies.
 */
export async function sendEmail(
    addressTo: string,
    stringSubject: string,
    stringBodyText: string,
    stringBodyHtml?: string,
    arrayAttachments?: { filename: string; content: string | Buffer; contentType?: string; }[],
    scheduledAt?: string
) {
    console.debug(`[Notifications][sendEmail] Initiating email dispatch to: ${addressTo} with subject: "${stringSubject}"`);

    if (!process.env.RESEND_API_KEY) {
        console.warn(`[Notifications][sendEmail] RESEND_API_KEY missing. Executing mock dispatch.`);
        console.debug(`[Email MOCK] Address To: ${addressTo}`);
        console.debug(`[Email MOCK] Subject: ${stringSubject}`);
        console.debug(`[Email MOCK] Text Body: ${stringBodyText.substring(0, 50)}...`);
        if (stringBodyHtml) console.debug(`[Email MOCK] HTML Body Provided: Yes, length: ${stringBodyHtml.length} bytes`);
        if (arrayAttachments) console.debug(`[Email MOCK] Attachments Count: ${arrayAttachments.length}`);

        return { success: true, messageId: `mock-email-${Date.now()}` };
    }

    if (process.env.RESEND_API_KEY && !process.env.RESEND_FROM_EMAIL) {
        throw new Error("[Notifications][sendEmail] Configuration Error: RESEND_FROM_EMAIL is required when using Resend API.");
    }

    try {
        const payloadEmail: any = {
            from: process.env.RESEND_FROM_EMAIL || 'community@25thchapter.com',
            to: addressTo,
            subject: stringSubject,
            text: stringBodyText,
            html: stringBodyHtml || stringBodyText.replace(/\n/g, '<br>'),
            scheduledAt: scheduledAt, 
        };

        if (arrayAttachments && arrayAttachments.length > 0) {
            console.debug(`[Notifications][sendEmail] Processing ${arrayAttachments.length} attachments.`);
            payloadEmail.attachments = arrayAttachments.map(paramAttachment => ({
                filename: paramAttachment.filename,
                content: paramAttachment.content,
                contentType: paramAttachment.contentType
            }));
        }

        console.debug(`[Notifications][sendEmail] Transmitting payload to Resend API.`);
        const { data, error: errorResend } = await resend.emails.send(payloadEmail);

        if (errorResend) {
            console.error(`[Notifications][sendEmail] Resend API rejected payload:`, errorResend);
            throw new Error(`Resend API Error: ${errorResend.message}`);
        }

        console.info(`[Notifications][sendEmail] Successfully transmitted email to ${addressTo}. Message ID: ${data?.id}`);
        return { success: true, messageId: data?.id };
    } catch (errorUncaught) {
        console.error(`[Notifications][sendEmail] CRITICAL FAILURE during email transmission to ${addressTo}:`, errorUncaught);
        throw errorUncaught;
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
