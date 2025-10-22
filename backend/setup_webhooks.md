# Setting Up Stripe Webhooks for Local Development

## Quick Setup (Run these commands):

### 1. Login to Stripe CLI
```bash
stripe login
```
This will open your browser to authenticate with Stripe.

### 2. Start Webhook Forwarding
```bash
stripe listen --forward-to localhost:8000/api/stripe/webhook
```

This command will:
- Forward all Stripe events to your local backend
- Print a **webhook signing secret** (starts with `whsec_`)
- Keep running in the background (don't close this terminal)

### 3. Copy the Webhook Secret
When you run `stripe listen`, you'll see output like:
```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx (^C to quit)
```

Copy that `whsec_xxxxxxxxxxxxx` value and update your `.env` file:
```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

### 4. Restart Backend
After updating `.env`, restart your backend server so it picks up the new webhook secret.

## Testing the Integration

Once webhooks are set up, test by:

1. Go to pricing page and click "Upgrade to Pro"
2. Complete checkout with test card: `4242 4242 4242 4242`
3. You should see webhook events in the `stripe listen` terminal
4. Credits should be automatically added to your account
5. Your plan should update in the database

## What Happens After Payment?

When a payment succeeds, Stripe sends a `checkout.session.completed` event to your webhook:

### For Subscriptions (Pro/Business):
- Creates/updates Stripe customer in database
- Sets `plan_type` to 'pro' or 'business'
- Sets `stripe_subscription_id`
- Grants initial monthly credits (2,500 or 6,000)
- Sets `monthly_credit_allowance`

### For Credit Packs:
- Adds credits to account immediately
- No plan change (stays on current plan)
- Creates transaction record

## Production Setup

For production (when deploying to a real server):

1. Create a webhook endpoint in Stripe Dashboard:
   - Go to: https://dashboard.stripe.com/webhooks
   - Click "Add endpoint"
   - URL: `https://yourdomain.com/api/stripe/webhook`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`

2. Copy the webhook signing secret from the dashboard
3. Update your production `.env` with the production webhook secret
4. Use live API keys instead of test keys
