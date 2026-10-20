export default () => ({
  app: {
    port:    parseInt(process.env.API_PORT ?? '3001'),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    webUrl:  process.env.WEB_URL ?? 'http://localhost:3000',
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASS,
    ttl: 300, // default 5 min
  },
  jwt: {
    secret:         process.env.JWT_SECRET        ?? 'change-me',
    expiresIn:      process.env.JWT_EXPIRES_IN    ?? '7d',
    refreshSecret:  process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh',
    refreshExpires: '30d',
  },
  razorpay: {
    keyId:         process.env.RAZORPAY_KEY_ID,
    keySecret:     process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
  whatsapp: {
    provider:    process.env.WHATSAPP_PROVIDER ?? 'twilio',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? 'dentalease-verify',
    // 360Dialog (fallback)
    apiKey:      process.env.WHATSAPP_360DIALOG_API_KEY,
    baseUrl:     process.env.WHATSAPP_360DIALOG_BASE_URL ?? 'https://waba.360dialog.io/v1',
  },
  twilio: {
    accountSid:      process.env.TWILIO_ACCOUNT_SID,
    authToken:       process.env.TWILIO_AUTH_TOKEN,
    whatsappNumber:  process.env.TWILIO_WHATSAPP_FROM ?? '+14155238886',
  },
  aws: {
    region:    process.env.AWS_REGION    ?? 'ap-south-1',
    accessKey: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket:  process.env.AWS_S3_BUCKET,
  },
});
