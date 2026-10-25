-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuthFactorType" AS ENUM ('SMS_OTP', 'TOTP', 'PASSKEY');

-- CreateEnum
CREATE TYPE "AuthFactorStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('SIGN_IN', 'SIGN_UP', 'PHONE_CHANGE', 'INVITATION_ACCEPTANCE', 'PAYOUT_CONFIRMATION');

-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('CREATED', 'SENT', 'VERIFIED', 'EXPIRED', 'LOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('ANDROID', 'IOS', 'WEB', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS', 'PRIVACY', 'TEST_PARTICIPATION', 'PAYMENT_FEES', 'DATA_PROCESSING', 'MARKETING');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'EXPORT', 'ERASURE');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('RECEIVED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('DRAFT', 'PAYMENT_PENDING', 'FUNDED', 'SENT', 'SUCCESS', 'FAILURE', 'EXPIRED', 'PAYOUT_PENDING', 'REFUND_PENDING', 'COMPLETED', 'REFUNDED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TestActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'WORKER');

-- CreateEnum
CREATE TYPE "InvitationChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('CREATED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'OPENED', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('ORANGE_MONEY', 'MTN_MOMO', 'FLUTTERWAVE', 'STRIPE', 'PAYSTACK', 'LYGOS', 'MANUAL');

-- CreateEnum
CREATE TYPE "MessagingProvider" AS ENUM ('TWILIO', 'FCM', 'ONESIGNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "KycProvider" AS ENUM ('MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "LedgerNormalSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerEntrySide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('PAYMENT_CAPTURE', 'ESCROW_FUNDING', 'SERVICE_FEE_RECOGNITION', 'PAYOUT_RESERVATION', 'PAYOUT_SETTLEMENT', 'REFUND_RESERVATION', 'REFUND_SETTLEMENT', 'PSP_FEE', 'REVERSAL', 'ADJUSTMENT', 'REFERRAL_REWARD', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('CREATED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationBreakStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "FeeOperationType" AS ENUM ('COLLECTION', 'PAYOUT', 'REFUND', 'SERVICE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOIDED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'PUSH', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RiskCaseStatus" AS ENUM ('OPEN', 'REVIEWING', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RiskSubjectType" AS ENUM ('USER', 'TEST', 'PAYMENT', 'PAYOUT', 'REFUND', 'DEVICE', 'PHONE');

-- CreateEnum
CREATE TYPE "BlocklistSubjectType" AS ENUM ('PHONE_HMAC', 'DEVICE_HASH', 'USER_ID', 'TRANSACTION_REF');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'WAITING_USER', 'WAITING_PROVIDER', 'RESOLVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('ATTRIBUTED', 'QUALIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING', 'APPROVED', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING_USER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketAuthorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_hmac" VARCHAR(128) NOT NULL,
    "phone_enc" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "locale" VARCHAR(12) NOT NULL DEFAULT 'fr',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "kyc_status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "AuthFactorType" NOT NULL,
    "status" "AuthFactorStatus" NOT NULL DEFAULT 'PENDING',
    "secret_enc" TEXT,
    "provider_ref" VARCHAR(255),
    "verified_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "recipient_hmac" VARCHAR(128) NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "status" "OtpStatus" NOT NULL DEFAULT 'CREATED',
    "provider" "MessagingProvider",
    "provider_ref" VARCHAR(255),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "last_activity_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_hash" VARCHAR(128) NOT NULL,
    "platform" "Platform" NOT NULL,
    "app_version" VARCHAR(40),
    "push_token" VARCHAR(500),
    "push_provider" "MessagingProvider",
    "push_token_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),
    "risk_flag" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "test_id" UUID,
    "type" "ConsentType" NOT NULL,
    "document_version" VARCHAR(80) NOT NULL,
    "locale" VARCHAR(12) NOT NULL,
    "channel" VARCHAR(40) NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "evidence_hash" VARCHAR(128),
    "accepted_at" TIMESTAMPTZ(6),
    "withdrawn_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "reason" VARCHAR(1000),
    "due_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "KycProvider",
    "provider_ref" VARCHAR(255),
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "level" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyc_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tests" (
    "id" UUID NOT NULL,
    "public_code" VARCHAR(64) NOT NULL,
    "initiator_id" UUID NOT NULL,
    "recipient_user_id" UUID,
    "recipient_phone_hmac" VARCHAR(128) NOT NULL,
    "recipient_phone_enc" TEXT,
    "expected_phone_hmac" VARCHAR(128) NOT NULL,
    "status" "TestStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "reward_amount" BIGINT NOT NULL,
    "service_fee_amount" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "fee_schedule_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_attempts" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "answer_hmac" VARCHAR(128) NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(40) NOT NULL,

    CONSTRAINT "test_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_events" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "from_status" "TestStatus",
    "to_status" "TestStatus" NOT NULL,
    "actor_type" "TestActorType" NOT NULL,
    "actor_id" VARCHAR(128),
    "reason" VARCHAR(1000),
    "source" VARCHAR(80) NOT NULL,
    "correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "channel" "InvitationChannel" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'CREATED',
    "expires_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "opened_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "provider_ref" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "method_type" "PaymentMethodType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "fee_schedule_id" UUID,
    "provider_reference" VARCHAR(255),
    "failure_code" VARCHAR(100),
    "failure_message" VARCHAR(500),
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "provider" "PaymentProvider" NOT NULL,
    "method_type" "PaymentMethodType" NOT NULL,
    "operator" VARCHAR(40),
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
    "amount_gross" BIGINT NOT NULL,
    "amount_net" BIGINT NOT NULL,
    "provider_fee_amount" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "destination_enc" TEXT NOT NULL,
    "destination_hmac" VARCHAR(128) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "fee_schedule_id" UUID,
    "provider_reference" VARCHAR(255),
    "failure_code" VARCHAR(100),
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "payment_id" UUID,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "provider" "PaymentProvider" NOT NULL,
    "method_type" "PaymentMethodType",
    "operator" VARCHAR(40),
    "status" "RefundStatus" NOT NULL DEFAULT 'CREATED',
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "destination_enc" TEXT,
    "destination_hmac" VARCHAR(128),
    "idempotency_key" VARCHAR(128) NOT NULL,
    "fee_schedule_id" UUID,
    "provider_reference" VARCHAR(255),
    "requested_by" VARCHAR(128),
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "payload_enc" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "processing_error" VARCHAR(1000),
    "payment_id" UUID,
    "payout_id" UUID,
    "refund_id" UUID,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "normal_side" "LedgerNormalSide" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "owner_type" VARCHAR(40) NOT NULL DEFAULT 'PLATFORM',
    "owner_id" VARCHAR(128) NOT NULL DEFAULT 'PLATFORM',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "type" "LedgerTransactionType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" VARCHAR(500),
    "test_id" UUID,
    "payment_id" UUID,
    "payout_id" UUID,
    "refund_id" UUID,
    "reverses_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "side" "LedgerEntrySide" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "memo" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider",
    "currency" CHAR(3),
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'CREATED',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "summary" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_breaks" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "payment_id" UUID,
    "payout_id" UUID,
    "refund_id" UUID,
    "external_ref" VARCHAR(255),
    "break_type" VARCHAR(100) NOT NULL,
    "amount_expected" BIGINT,
    "amount_actual" BIGINT,
    "currency" CHAR(3),
    "status" "ReconciliationBreakStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to" VARCHAR(128),
    "resolution_note" VARCHAR(2000),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedules" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "provider" "PaymentProvider",
    "operation_type" "FeeOperationType" NOT NULL,
    "fixed_amount" BIGINT NOT NULL DEFAULT 0,
    "rate_bps" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoice_number" VARCHAR(100) NOT NULL,
    "test_id" UUID,
    "recipient_type" VARCHAR(40) NOT NULL,
    "recipient_ref" VARCHAR(128) NOT NULL,
    "amount_subtotal" BIGINT NOT NULL,
    "tax_amount" BIGINT NOT NULL DEFAULT 0,
    "total_amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "object_key" VARCHAR(500),
    "file_sha256" CHAR(64),
    "issued_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "id" UUID NOT NULL,
    "legal_entity" VARCHAR(80) NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" VARCHAR(12) NOT NULL,
    "subject" VARCHAR(250),
    "body_template" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "template_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "recipient_hmac" VARCHAR(128) NOT NULL,
    "provider" "MessagingProvider",
    "provider_ref" VARCHAR(255),
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "cost_amount" BIGINT,
    "currency" CHAR(3),
    "error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "purpose" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_rules" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_by" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_cases" (
    "id" UUID NOT NULL,
    "subject_type" "RiskSubjectType" NOT NULL,
    "subject_ref" VARCHAR(128) NOT NULL,
    "user_id" UUID,
    "test_id" UUID,
    "status" "RiskCaseStatus" NOT NULL DEFAULT 'OPEN',
    "score" INTEGER,
    "signals" JSONB,
    "decision" VARCHAR(1000),
    "assigned_to" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "risk_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocklist" (
    "id" UUID NOT NULL,
    "subject_type" "BlocklistSubjectType" NOT NULL,
    "subject_hash" VARCHAR(128) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "created_by" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "ledger_transaction_id" UUID,
    "opened_by" VARCHAR(128) NOT NULL,
    "reason_code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(3000),
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to" VARCHAR(128),
    "due_at" TIMESTAMPTZ(6),
    "decision" VARCHAR(2000),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "user_id" UUID,
    "test_id" UUID,
    "dispute_id" UUID,
    "assigned_admin_id" UUID,
    "subject" VARCHAR(250) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_type" "TicketAuthorType" NOT NULL,
    "author_user_id" UUID,
    "author_admin_id" UUID,
    "body" TEXT NOT NULL,
    "internal_note" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_type" VARCHAR(40) NOT NULL,
    "user_id" UUID,
    "admin_user_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80),
    "target_id" VARCHAR(128),
    "correlation_id" VARCHAR(128),
    "ip_hmac" VARCHAR(128),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" VARCHAR(128) NOT NULL,
    "dedupe_key" VARCHAR(180) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "key" VARCHAR(180) NOT NULL,
    "actor_type" VARCHAR(40) NOT NULL,
    "actor_ref" VARCHAR(128) NOT NULL,
    "user_id" UUID,
    "request_hash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_code" INTEGER,
    "response_body" JSONB,
    "resource_type" VARCHAR(80),
    "resource_id" VARCHAR(128),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(180),
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "totp_secret_enc" TEXT,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user_roles" (
    "admin_user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by" VARCHAR(128),
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_roles_pkey" PRIMARY KEY ("admin_user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "admin_approvals" (
    "id" UUID NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(128) NOT NULL,
    "requester_id" UUID NOT NULL,
    "approver_id" UUID,
    "amount" BIGINT,
    "currency" CHAR(3),
    "reason" VARCHAR(1000) NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decision_note" VARCHAR(1000),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "user_id" UUID,
    "filters" JSONB NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "object_key" VARCHAR(500),
    "expires_at" TIMESTAMPTZ(6),
    "error_message" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "default_currency" CHAR(3) NOT NULL,
    "min_reward_amount" BIGINT NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "country_code" CHAR(2),
    "rollout_percent" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "campaign_key" VARCHAR(100),
    "terms_version" VARCHAR(80),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referral_code_id" UUID NOT NULL,
    "referrer_id" UUID NOT NULL,
    "referred_user_id" UUID NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'ATTRIBUTED',
    "attributed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualified_at" TIMESTAMPTZ(6),
    "evidence" JSONB,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" UUID NOT NULL,
    "referral_id" UUID NOT NULL,
    "test_id" UUID,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING',
    "rule_version" VARCHAR(80) NOT NULL,
    "ledger_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_at" TIMESTAMPTZ(6),

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_hmac_key" ON "users"("phone_hmac");

-- CreateIndex
CREATE INDEX "users_status_created_at_idx" ON "users"("status", "created_at");

-- CreateIndex
CREATE INDEX "users_country_code_status_idx" ON "users"("country_code", "status");

-- CreateIndex
CREATE INDEX "auth_factors_user_id_status_idx" ON "auth_factors"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "auth_factors_user_id_type_key" ON "auth_factors"("user_id", "type");

-- CreateIndex
CREATE INDEX "otp_challenges_recipient_hmac_purpose_created_at_idx" ON "otp_challenges"("recipient_hmac", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_status_expires_at_idx" ON "otp_challenges"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "sessions_family_id_revoked_at_idx" ON "sessions"("family_id", "revoked_at");

-- CreateIndex
CREATE INDEX "devices_device_hash_idx" ON "devices"("device_hash");

-- CreateIndex
CREATE INDEX "devices_user_id_last_seen_at_idx" ON "devices"("user_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_device_hash_key" ON "devices"("user_id", "device_hash");

-- CreateIndex
CREATE INDEX "consents_user_id_type_created_at_idx" ON "consents"("user_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "consents_test_id_type_created_at_idx" ON "consents"("test_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "data_requests_status_due_at_idx" ON "data_requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "data_requests_user_id_created_at_idx" ON "data_requests"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_profiles_user_id_key" ON "kyc_profiles"("user_id");

-- CreateIndex
CREATE INDEX "kyc_profiles_status_expires_at_idx" ON "kyc_profiles"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "tests_public_code_key" ON "tests"("public_code");

-- CreateIndex
CREATE INDEX "tests_initiator_id_created_at_idx" ON "tests"("initiator_id", "created_at");

-- CreateIndex
CREATE INDEX "tests_recipient_user_id_created_at_idx" ON "tests"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "tests_status_expires_at_idx" ON "tests"("status", "expires_at");

-- CreateIndex
CREATE INDEX "tests_recipient_phone_hmac_created_at_idx" ON "tests"("recipient_phone_hmac", "created_at");

-- CreateIndex
CREATE INDEX "tests_status_updated_at_idx" ON "tests"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "test_attempts_test_id_key" ON "test_attempts"("test_id");

-- CreateIndex
CREATE INDEX "test_attempts_test_id_submitted_at_idx" ON "test_attempts"("test_id", "submitted_at");

-- CreateIndex
CREATE INDEX "test_attempts_submitted_at_idx" ON "test_attempts"("submitted_at");

-- CreateIndex
CREATE INDEX "test_events_test_id_created_at_idx" ON "test_events"("test_id", "created_at");

-- CreateIndex
CREATE INDEX "test_events_correlation_id_idx" ON "test_events"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_test_id_created_at_idx" ON "invitations"("test_id", "created_at");

-- CreateIndex
CREATE INDEX "invitations_status_expires_at_idx" ON "invitations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "payments_test_id_created_at_idx" ON "payments"("test_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_idempotency_key_key" ON "payments"("provider", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_reference_key" ON "payments"("provider", "provider_reference");

-- CreateIndex
CREATE INDEX "payouts_test_id_status_idx" ON "payouts"("test_id", "status");

-- CreateIndex
CREATE INDEX "payouts_status_created_at_idx" ON "payouts"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_provider_idempotency_key_key" ON "payouts"("provider", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_provider_provider_reference_key" ON "payouts"("provider", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_test_id_attempt_key" ON "payouts"("test_id", "attempt");

-- CreateIndex
CREATE INDEX "refunds_test_id_created_at_idx" ON "refunds"("test_id", "created_at");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_idempotency_key_key" ON "refunds"("provider", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_provider_reference_key" ON "refunds"("provider", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_test_id_attempt_key" ON "refunds"("test_id", "attempt");

-- CreateIndex
CREATE INDEX "webhook_events_processed_at_received_at_idx" ON "webhook_events"("processed_at", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_payment_id_idx" ON "webhook_events"("payment_id");

-- CreateIndex
CREATE INDEX "webhook_events_payout_id_idx" ON "webhook_events"("payout_id");

-- CreateIndex
CREATE INDEX "webhook_events_refund_id_idx" ON "webhook_events"("refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "ledger_accounts_type_currency_is_active_idx" ON "ledger_accounts"("type", "currency", "is_active");

-- CreateIndex
CREATE INDEX "ledger_accounts_owner_type_owner_id_idx" ON "ledger_accounts"("owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_currency_owner_type_owner_id_key" ON "ledger_accounts"("code", "currency", "owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_transactions_test_id_created_at_idx" ON "ledger_transactions"("test_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_transactions_payment_id_idx" ON "ledger_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_payout_id_idx" ON "ledger_transactions"("payout_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_refund_id_idx" ON "ledger_transactions"("refund_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_type_created_at_idx" ON "ledger_transactions"("type", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_currency_created_at_idx" ON "ledger_entries"("currency", "created_at");

-- CreateIndex
CREATE INDEX "reconciliation_runs_status_created_at_idx" ON "reconciliation_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "reconciliation_runs_provider_period_start_period_end_idx" ON "reconciliation_runs"("provider", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "reconciliation_breaks_run_id_status_idx" ON "reconciliation_breaks"("run_id", "status");

-- CreateIndex
CREATE INDEX "reconciliation_breaks_status_created_at_idx" ON "reconciliation_breaks"("status", "created_at");

-- CreateIndex
CREATE INDEX "reconciliation_breaks_payment_id_idx" ON "reconciliation_breaks"("payment_id");

-- CreateIndex
CREATE INDEX "reconciliation_breaks_payout_id_idx" ON "reconciliation_breaks"("payout_id");

-- CreateIndex
CREATE INDEX "reconciliation_breaks_refund_id_idx" ON "reconciliation_breaks"("refund_id");

-- CreateIndex
CREATE INDEX "fee_schedules_country_code_currency_operation_type_active_e_idx" ON "fee_schedules"("country_code", "currency", "operation_type", "active", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "fee_schedules_country_code_currency_operation_type_version_key" ON "fee_schedules"("country_code", "currency", "operation_type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_recipient_type_recipient_ref_created_at_idx" ON "invoices"("recipient_type", "recipient_ref", "created_at");

-- CreateIndex
CREATE INDEX "invoices_test_id_idx" ON "invoices"("test_id");

-- CreateIndex
CREATE INDEX "invoices_status_issued_at_idx" ON "invoices"("status", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_counters_legal_entity_country_code_year_key" ON "invoice_counters"("legal_entity", "country_code", "year");

-- CreateIndex
CREATE INDEX "notification_templates_key_active_idx" ON "notification_templates"("key", "active");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_version_channel_locale_key" ON "notification_templates"("key", "version", "channel", "locale");

-- CreateIndex
CREATE INDEX "notification_log_user_id_created_at_idx" ON "notification_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_log_status_created_at_idx" ON "notification_log"("status", "created_at");

-- CreateIndex
CREATE INDEX "notification_log_recipient_hmac_created_at_idx" ON "notification_log"("recipient_hmac", "created_at");

-- CreateIndex
CREATE INDEX "notification_preferences_user_id_enabled_idx" ON "notification_preferences"("user_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_channel_purpose_key" ON "notification_preferences"("user_id", "channel", "purpose");

-- CreateIndex
CREATE INDEX "risk_rules_active_key_idx" ON "risk_rules"("active", "key");

-- CreateIndex
CREATE UNIQUE INDEX "risk_rules_key_version_key" ON "risk_rules"("key", "version");

-- CreateIndex
CREATE INDEX "risk_cases_status_created_at_idx" ON "risk_cases"("status", "created_at");

-- CreateIndex
CREATE INDEX "risk_cases_subject_type_subject_ref_idx" ON "risk_cases"("subject_type", "subject_ref");

-- CreateIndex
CREATE INDEX "risk_cases_user_id_status_idx" ON "risk_cases"("user_id", "status");

-- CreateIndex
CREATE INDEX "risk_cases_test_id_status_idx" ON "risk_cases"("test_id", "status");

-- CreateIndex
CREATE INDEX "blocklist_expires_at_idx" ON "blocklist"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "blocklist_subject_type_subject_hash_key" ON "blocklist"("subject_type", "subject_hash");

-- CreateIndex
CREATE INDEX "disputes_status_due_at_idx" ON "disputes"("status", "due_at");

-- CreateIndex
CREATE INDEX "disputes_test_id_created_at_idx" ON "disputes"("test_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_reference_key" ON "support_tickets"("reference");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_created_at_idx" ON "support_tickets"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_created_at_idx" ON "support_tickets"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_test_id_idx" ON "support_tickets"("test_id");

-- CreateIndex
CREATE INDEX "support_tickets_assigned_admin_id_status_idx" ON "support_tickets"("assigned_admin_id", "status");

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_type_created_at_idx" ON "audit_log"("actor_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_created_at_idx" ON "audit_log"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_correlation_id_idx" ON "audit_log"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedupe_key_key" ON "outbox_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_status_updated_at_idx" ON "idempotency_keys"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_actor_type_actor_ref_key_key" ON "idempotency_keys"("scope", "actor_type", "actor_ref", "key");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_subject_key" ON "admin_users"("subject");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_status_idx" ON "admin_users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "admin_user_roles_role_id_idx" ON "admin_user_roles"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "admin_approvals_status_created_at_idx" ON "admin_approvals"("status", "created_at");

-- CreateIndex
CREATE INDEX "admin_approvals_target_type_target_id_idx" ON "admin_approvals"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "export_jobs_status_created_at_idx" ON "export_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "export_jobs_requested_by_id_created_at_idx" ON "export_jobs"("requested_by_id", "created_at");

-- CreateIndex
CREATE INDEX "export_jobs_user_id_idx" ON "export_jobs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE INDEX "feature_flags_country_code_enabled_idx" ON "feature_flags"("country_code", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_user_id_key" ON "referral_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE INDEX "referral_codes_active_expires_at_idx" ON "referral_codes"("active", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_user_id_key" ON "referrals"("referred_user_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_status_attributed_at_idx" ON "referrals"("referrer_id", "status", "attributed_at");

-- CreateIndex
CREATE INDEX "referrals_status_qualified_at_idx" ON "referrals"("status", "qualified_at");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referrer_id_referred_user_id_key" ON "referrals"("referrer_id", "referred_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_ledger_transaction_id_key" ON "referral_rewards"("ledger_transaction_id");

-- CreateIndex
CREATE INDEX "referral_rewards_status_created_at_idx" ON "referral_rewards"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_referral_id_rule_version_key" ON "referral_rewards"("referral_id", "rule_version");

-- AddForeignKey
ALTER TABLE "auth_factors" ADD CONSTRAINT "auth_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_events" ADD CONSTRAINT "test_events_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_breaks" ADD CONSTRAINT "reconciliation_breaks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_breaks" ADD CONSTRAINT "reconciliation_breaks_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_breaks" ADD CONSTRAINT "reconciliation_breaks_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_breaks" ADD CONSTRAINT "reconciliation_breaks_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_cases" ADD CONSTRAINT "risk_cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_cases" ADD CONSTRAINT "risk_cases_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_admin_id_fkey" FOREIGN KEY ("author_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_approvals" ADD CONSTRAINT "admin_approvals_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_approvals" ADD CONSTRAINT "admin_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referral_code_id_fkey" FOREIGN KEY ("referral_code_id") REFERENCES "referral_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
