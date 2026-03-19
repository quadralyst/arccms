export const constant = {
  isProduction: true,
  live_url: '',
  local_url: 'http://localhost:5173/',

  // Base URL for the email open-tracking Cloud Function.
  // Set this to your deployed trackEmailOpen function URL.
  TRACKING_PIXEL_URL: '',

  REFERRAL_STATUS: {
    COMPLETED: 'completed',
    PENDING: 'pending',
  },
};
