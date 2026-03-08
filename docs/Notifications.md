# Proposed Multi-Channel Notification Scheme

This documentation outlines the communication lifecycle for The 25th Chapter:

1. The Weekly Digest (Email)

Trigger: Sunday 15:00 (Local Server Time).

Format: Multi-session list in plain-text (consider upgrading this to a React-Email template).

Goal: Drive long-term intent and habit formation.

2. The On-Demand Reminder (Email - New)

Trigger: User-initiated "Remind Me" click in-app.

Strategy: Link-First + Attachment Fallback.

Content: Rich HTML with Google/Outlook/Office 365 deep links and an .ics attachment for native mobile/desktop support.

Tracking: Uses Resend webhooks to monitor "Add to Calendar" clicks, allowing the system to refine future engagement based on user commitment.

3. The Session Warning (Push)

Trigger: 5 minutes prior to session start.

Channel: Firebase Cloud Messaging (FCM) to user.pushToken.

Goal: Immediate conversion/app open for the live session.

4. The Scheduled Follow-up (Resend API)

Implementation: For sessions scheduled >24 hours out, use Resend’s scheduledAt to deliver an email reminder exactly 1 hour before the session starts.