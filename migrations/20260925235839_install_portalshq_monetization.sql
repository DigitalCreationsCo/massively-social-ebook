-- Installs the schema owned by @portalshq/monetization.
-- Source: the package's sql/001_monetization.sql, copied verbatim so this file is
-- reviewable in-repo. Update it by re-copying after a package upgrade, not by hand:
--   cp node_modules/@portalshq/monetization/sql/001_monetization.sql <this file>

-- @portalshq/monetization schema.
--
-- Connected accounts are created via Accounts v2 as a **recipient**, for
-- destination charges. The end user's Customer and payment method live on the
-- PLATFORM account, so one payment method is reused across every tenant they
-- pay; funds transfer to the tenant on success.
--
-- `losses_collector: "application"` is required for destination charges: the
-- platform must hold the negative balance so a dispute transfer can be
-- reversed. The accepted cost is that the platform is merchant of record and
-- carries dispute liability across tenant volume.
--
-- This file also replaces the pre-0.2.0 `billing_*` tables, which keyed
-- profiles on channel. No production data was written against those tables, so
-- the change is a clean replacement rather than a migration.

CREATE TABLE IF NOT EXISTS monetization_tenant_profiles (
  tenant_id text PRIMARY KEY,
  owner_id text NOT NULL,
  -- The tenant's own connected account, from `stripe.v2.core.accounts.create`.
  stripe_account_id text NOT NULL,
  -- v2 capability path:
  -- configuration.recipient.capabilities.stripe_balance.stripe_transfers.status.
  -- The deprecated v1 booleans (charges_enabled, payouts_enabled) are not stored.
  transfers_status text NOT NULL DEFAULT 'pending'
    CHECK (transfers_status IN ('active', 'inactive', 'pending')),
  default_currency text NOT NULL,
  country text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
-- Capability changes arrive via account.updated, which carries the account id.
CREATE INDEX IF NOT EXISTS monetization_tenant_profiles_account_idx
  ON monetization_tenant_profiles(stripe_account_id);

CREATE TABLE IF NOT EXISTS monetization_purchases (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES monetization_tenant_profiles(tenant_id),
  -- Attribution only. A tenant may own many channels and is paid once.
  channel_id text NOT NULL,
  -- Fact for session-scoped entitlement rules.
  session_id text,
  buyer_id text NOT NULL,
  -- The platform-account Customer holding this consumer's saved payment method.
  customer_id text,
  product_key text NOT NULL,
  kind text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  platform_fee_amount bigint NOT NULL CHECK (platform_fee_amount >= 0 AND platform_fee_amount <= amount),
  state text NOT NULL,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  stripe_charge_id text UNIQUE,
  -- The Connect transfer to the tenant; reversed on dispute.
  stripe_transfer_id text,
  stripe_application_fee_id text,
  refunded_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
  settled_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
-- Tenant-level rollup across a tenant's applications.
CREATE INDEX IF NOT EXISTS monetization_purchases_tenant_idx
  ON monetization_purchases(tenant_id, created_at);
-- Per-application rollup within a tenant.
CREATE INDEX IF NOT EXISTS monetization_purchases_channel_idx
  ON monetization_purchases(channel_id, created_at);

CREATE TABLE IF NOT EXISTS monetization_stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  created_at timestamptz NOT NULL,
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS monetization_ledger (
  id text PRIMARY KEY,
  purchase_id text NOT NULL REFERENCES monetization_purchases(id),
  stripe_event_id text REFERENCES monetization_stripe_events(id),
  kind text NOT NULL,
  amount bigint NOT NULL,
  currency text NOT NULL,
  stripe_fee bigint,
  net bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  -- Makes double-application of a Stripe event impossible at the database level.
  UNIQUE (stripe_event_id, kind, purchase_id)
);

CREATE TABLE IF NOT EXISTS monetization_outbox (
  id text PRIMARY KEY,
  type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  delivered_at timestamptz,
  -- Set when the event exceeded its attempt budget. The row is retained, never
  -- deleted: a customer who paid still has a settlement event on record, and
  -- requeueDeadOutbox can replay it once the cause is fixed.
  dead_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL
);
-- Pending work only. Dead events are excluded so they cannot be re-claimed.
CREATE INDEX IF NOT EXISTS monetization_outbox_pending_idx
  ON monetization_outbox(created_at) WHERE delivered_at IS NULL AND dead_at IS NULL;
-- Operator view of what needs attention.
CREATE INDEX IF NOT EXISTS monetization_outbox_dead_idx
  ON monetization_outbox(created_at) WHERE dead_at IS NOT NULL;

-- Tenant-configured entitlement rules. `scope` holds the dimensions the tenant
-- named; the dimensions present are both the matcher and the grant's lifetime.
CREATE TABLE IF NOT EXISTS monetization_entitlement_rules (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  kind text NOT NULL,
  scope jsonb NOT NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  quantity integer NOT NULL CHECK (quantity >= 1),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS monetization_entitlement_rules_tenant_idx
  ON monetization_entitlement_rules(tenant_id);

-- Balances, not flags. A rule nothing consumes stays permanently available.
CREATE TABLE IF NOT EXISTS monetization_entitlements (
  id text PRIMARY KEY,
  rule_id text NOT NULL REFERENCES monetization_entitlement_rules(id),
  tenant_id text NOT NULL,
  -- The end user who paid. Distinct from tenant_id, which receives the money.
  consumer_id text NOT NULL,
  kind text NOT NULL,
  scope jsonb NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 1),
  remaining integer NOT NULL CHECK (remaining >= 0 AND remaining <= quantity),
  purchase_id text NOT NULL REFERENCES monetization_purchases(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  -- One grant per rule per purchase: a redelivered settlement event is a no-op.
  UNIQUE (rule_id, purchase_id)
);
CREATE INDEX IF NOT EXISTS monetization_entitlements_lookup_idx
  ON monetization_entitlements(consumer_id, kind) WHERE remaining > 0;
CREATE INDEX IF NOT EXISTS monetization_entitlements_purchase_idx
  ON monetization_entitlements(purchase_id);
