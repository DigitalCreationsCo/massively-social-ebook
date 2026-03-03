import mixpanel from 'mixpanel-browser';

const isProduction = import.meta.env.PROD;
const MIXPANEL_TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN;

// Initialize Mixpanel
export const initAnalytics = () => {
  if (MIXPANEL_TOKEN) {
    mixpanel.init(MIXPANEL_TOKEN, {
      debug: !isProduction,
      track_pageview: true,
      persistence: 'localStorage',
    });
  } else {
    console.warn('Mixpanel token not found. Analytics disabled.');
  }
};

// Track an event
export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  if (MIXPANEL_TOKEN) {
    mixpanel.track(eventName, properties);
  } else if (!isProduction) {
    console.log(`[Analytics] Track: ${eventName}`, properties);
  }
};

// Identify a user
export const identifyUser = (userId: string, traits?: Record<string, any>) => {
  if (MIXPANEL_TOKEN) {
    mixpanel.identify(userId);
    if (traits) {
      mixpanel.people.set(traits);
    }
  } else if (!isProduction) {
    console.log(`[Analytics] Identify: ${userId}`, traits);
  }
};

// Reset user identity (logout)
export const resetAnalytics = () => {
  if (MIXPANEL_TOKEN) {
    mixpanel.reset();
  }
};
