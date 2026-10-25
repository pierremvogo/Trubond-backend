# TRUEBOND — Plan d'architecture backend

## 1. Synthèse exécutive

TRUEBOND est, techniquement, une application de **séquestre financier** qui repose sur un jeu relationnel. Le test lui-même est une simple comparaison de numéros de téléphone ; le vrai sujet d'ingénierie ici est le **flux d'argent** : encaissement mobile money ou carte, blocage des fonds, versement ou remboursement automatique, factures, réconciliation et conformité. L'architecture ci-dessous est dimensionnée autour de ce constat.

### Décisions structurantes

1. **Architecture Monolithe modulaire NestJS (Node.js / TypeScript)**, découpé en domaines étanches et prêt à être scindé en microservices.
2. **Base de données PostgreSQL comme source de vérité unique**, avec un **grand livre comptable à double entrée**, append-only, pour tout mouvement d'argent.
3. **Couche d'abstraction des paiements** (adapters) : Orange Money, MTN MoMo, Flutterwave, Stripe, Paystack interchangeables, avec webhooks signés, idempotence et réconciliation quotidienne.
4. **Traitements asynchrones fiables** (pattern Outbox + files BullMQ) pour paiements, versements, remboursements, notifications, PDF et exports.
5. **AWS avec ECS Fargate, RDS Multi-AZ, ElastiCache, S3, CloudWatch**, déploiement via GitHub Actions.
6. **Sécurité par design** : OTP avec architecture « 2FA-ready », chiffrement AES-256 via KMS, numéros de téléphone comparés par HMAC pour éviter les timing attacks, journal d'audit immuable, endpoints de collecte pour le SIEM.

---

## 2. Analyse du cahier des charges

### 2.1 Exigences et implications techniques

| Exigence du cahier des charges | Implication technique |
|---|---|
| Séquestre d'un montant par l'initiateur | Ledger à double entrée, une « bulle » (compte séquestre) par test, états explicites et transitions contrôlées. |
| Récompense automatique en cas de réussite, remboursement automatique en cas d'échec | Machine à états + sagas, jobs de reprise, idempotence de bout en bout. |
| Coût d'un test 2 500 FCFA, récompense minimale 20 000 FCFA | Table de configuration tarifaire versionnée par pays et devise ; validations côté serveur ; montants stockés en entiers (unités mineures). |
| Le testé ne voit pas l'identité de l'initiateur | DTO séparés par rôle, code de test opaque, aucun identifiant de l'initiateur dans les réponses destinées au testé avant validation. |
| Le testé n'est pas forcément inscrit | Flux « invité » : invitation par SMS/lien, OTP sur le numéro du destinataire, compte léger créé à la volée. |
| Interface multilingue FR/EN | i18n côté API : Accept-Language, templates SMS/email/PDF localisés, codes d'erreur stables traduits côté client. |
| Paiement sécurisé, preuve de transaction, facture | Paiements via PSP, jamais de données de carte sur nos serveurs ; facture PDF générée par un worker, numérotation sans trou. |
| OTP maintenant, 2FA plus tard | Modèle `auth_factors` extensible et moteur de politique d'authentification (step-up) dès le départ. |
| Microservices, AWS, Kubernetes envisageable | Trajectoire progressive : monolithe modulaire → extraction ciblée. |
| Logs collectables par endpoints pour un SIEM | Endpoint de collecte sécurisé + export CloudWatch. |
| Export CSV / PDF des tests et logs | Jobs asynchrones, génération en flux, livraison par URL S3 présignée de courte durée. |
| Opérations financières atomiques | Transactions SQL ACID, outbox, ledger équilibré, réconciliation. |
| RGPD, PIPEDA, normes africaines, AES-256, consentement explicite | Chiffrement par champ, journal de consentements, rétention, droits d'accès et d'effacement (§14). |
| Lancement Cameroun et Canada | Multi-devise (XAF, CAD), multi-pays, fournisseurs de paiement et de SMS routés par pays. |

### 2.2 Hypothèses retenues

- Le numéro à deviner est celui de l'initiateur, enregistré sur la plateforme et vérifié par OTP.
- Une seule tentative par test, avec une expiration par défaut de 72 heures (paramétrable).
- Les frais de 2 500 FCFA ne sont pas remboursés en cas d'échec ou d'expiration, sauf défaillance technique de notre côté.
- Les frais des opérateurs et PSP sur les versements et remboursements sont déduits automatiquement en fonction du montant de la récompense.
- Devise principale XAF, CAD pour le Canada ; la conversion éventuelle est hors périmètre du MVP.
- Pour recevoir la récompense, le testé fournit un moyen de versement (numéro mobile money) après une réponse correcte.

---

## 3. Stack technologique

| Couche | Choix recommandé | Rôle / justification |
|---|---|---|
| Runtime & langage | Node.js LTS (≥ 22), TypeScript strict | Conforme au cahier des charges, productivité, typage de bout en bout. |
| Framework API | NestJS + Fastify | Modularité, DI, guards, interceptors, Swagger intégré. |
| ORM / accès données | Prisma + SQL brut ciblé | Prisma pour 90 % des requêtes ; SQL brut pour verrous `FOR UPDATE`, ledger et rapports. |
| Base de données | PostgreSQL 16+ (RDS Multi-AZ) | Transactions ACID, contraintes, JSONB, partitionnement, réplicas de lecture. |
| Cache / files / rate limit | Redis (ElastiCache) + BullMQ | Files de jobs, limitation de débit, cache de configuration. |
| Validation & contrat | class-validator ou Zod, @nestjs/swagger | Validation stricte des entrées ; contrat OpenAPI partagé avec l'équipe Flutter. |
| Authentification | OTP maison ou Twilio Verify, JWT (EdDSA/RS256), argon2, otplib (TOTP) | OTP SMS/WhatsApp, jetons courts, rotation des refresh tokens, 2FA prêt. |
| Génération PDF | pdfmake ou PDFKit (worker) | Léger, déterministe, sans navigateur headless. |
| Stockage objets | Amazon S3 (SSE-KMS, versioning) | Factures, exports, archives de logs. |
| Notifications | FCM (push), OneSignal (campagnes), Twilio (SMS), Amazon SES (email) | Conforme au cahier des charges ; prévoir un agrégateur SMS local ou régional en fallback. |
| Secrets & clés | AWS Secrets Manager + KMS | Rotation, chiffrement enveloppe, aucun secret dans le code ni les images. |
| Observabilité | pino (JSON), CloudWatch, OpenTelemetry → X-Ray, Sentry | Logs structurés, métriques métier, traces, erreurs applicatives. |
| Infrastructure | Terraform, Docker, ECR, ECS Fargate, ALB, CloudFront, WAF | Infrastructure reproductible et auditée. |
| CI/CD | GitHub Actions (OIDC vers AWS) | Conforme au cahier des charges : GitHub pour sources et CI/CD. |
| Qualité & sécurité | Jest, Supertest, Testcontainers, fast-check, k6, ESLint, CodeQL, Trivy, Dependabot, OWASP ZAP | Tests à tous les niveaux, SAST/SCA/DAST dans le pipeline. |

---

## 4. Découpage en modules

| Module | Responsabilités | Données possédées |
|---|---|---|
| identity | OTP, sessions, JWT, refresh tokens, facteurs d'authentification, appareils, politique 2FA. | `auth_factors`, `otp_challenges`, `sessions`, `devices` |
| users | Profil, numéro vérifié, langue, pays, consentements, niveau KYC, demandes RGPD. | `users`, `consents`, `kyc_profiles`, `data_requests` |
| tests (cœur) | Création, machine à états, invitation, tentative de réponse, expiration, anonymat. | `tests`, `test_attempts`, `test_events` |
| ledger | Comptes, écritures à double entrée, séquestre, soldes, invariants comptables. | `ledger_accounts`, `ledger_transactions`, `ledger_entries` |
| payments | Adapters PSP, intentions de paiement, webhooks, versements, remboursements, réconciliation. | `payments`, `payouts`, `refunds`, `webhook_events`, `reconciliation_breaks` |
| risk | Règles de fraude, plafonds, vélocité, listes de blocage, files de revue manuelle. | `risk_rules`, `risk_cases`, `blocklist` |
| notifications | SMS, push, email, templates localisés, préférences, journal d'envoi. | `notification_templates`, `notification_log` |
| invoicing | Factures PDF, numérotation séquentielle, archivage. | `invoices`, `invoice_counters` |
| admin | API du back-office : utilisateurs, transactions, litiges, exports, statistiques, support. | `admin_users`, `roles`, `disputes`, `export_jobs` |
| audit | Journal d'audit immuable, endpoint SIEM. | `audit_log` |
| config | Frais, plafonds, devises, pays, feature flags. | `fee_schedules`, `countries`, `feature_flags` |

Chaque module suit la même structure interne : **controller → application service → domain → repository**. Les modules `ledger` et `payments` adoptent une architecture hexagonale (ports et adapters) pour isoler la logique métier des fournisseurs externes.

---

## 5. Domaine métier : cycle de vie d'un test

### 5.1 Machine à états

| État | Signification | Transitions possibles | Effet financier |
|---|---|---|---|
| `DRAFT` | Test créé, non payé. | `PAYMENT_PENDING`, `CANCELLED` | Aucun. |
| `PAYMENT_PENDING` | Paiement initié chez le PSP. | `FUNDED`, `EXPIRED`, `CANCELLED` | Aucun tant que le PSP n'a pas confirmé. |
| `FUNDED` | Fonds encaissés et placés en séquestre. | `SENT`, `REFUND_PENDING` | Écriture d'encaissement. |
| `SENT` | Invitation envoyée au destinataire ; délai d'expiration actif. | `SUCCESS`, `FAILURE`, `EXPIRED`, `DISPUTED` | Frais de service acquis à l'envoi. |
| `SUCCESS` | Numéro correct. | `PAYOUT_PENDING` | Transfert séquestre → versement en attente. |
| `FAILURE` | Numéro incorrect. | `REFUND_PENDING` | Transfert séquestre → remboursement en attente. |
| `EXPIRED` | Aucune réponse avant l'échéance. | `REFUND_PENDING` | Idem échec. |
| `PAYOUT_PENDING` | Versement demandé au PSP. | `COMPLETED`, `PAYOUT_FAILED` (reprise) | Règlement uniquement sur confirmation PSP. |
| `REFUND_PENDING` | Remboursement demandé au PSP. | `REFUNDED`, `REFUND_FAILED` (reprise) | Règlement uniquement sur confirmation PSP. |
| `COMPLETED` / `REFUNDED` | États finaux. | — | Séquestre soldé à zéro. |
| `DISPUTED` | Gel manuel par l'administration. | États finaux ou reprise | Fonds bloqués, aucune écriture automatique. |

Les transitions sont codées dans une **table de transitions autorisées unique**. Toute autre transition est rejetée, et chaque changement d'état écrit une ligne dans `test_events` (qui, quand, pourquoi). Un champ `version` assure le verrouillage optimiste.

### 5.2 Flux principaux

#### A. Création et financement

1. L'initiateur (authentifié par OTP) appelle `POST /api/tests` avec le numéro du destinataire et le montant, avec un en-tête `Idempotency-Key`.
2. Le serveur valide les règles : montant ≥ 20 000 FCFA, plafonds, niveau KYC, règles de risque, destinataire différent de l'initiateur.
3. Le test passe en `DRAFT` ; l'initiateur consent explicitement (consentement horodaté et versionné).
4. `POST /api/tests/{id}/payments` crée une intention de paiement et renvoie l'URL ou le jeton du PSP ; état `PAYMENT_PENDING`.
5. Le PSP notifie par webhook. Le serveur vérifie la signature, re-vérifie le statut par appel API au PSP, puis, dans une seule transaction SQL, passe le test en `FUNDED`, écrit les écritures du ledger et insère l'événement dans l'outbox.
6. Un worker envoie l'invitation SMS/push au destinataire et le test passe en `SENT`.

#### B. Réponse du testé

1. Le destinataire ouvre le lien d'invitation. L'API ne renvoie que des informations anonymisées (existence du test, montant en jeu, délai restant).
2. Il s'authentifie par OTP sur son propre numéro, puis consent explicitement au test.
3. Il saisit le numéro qu'il pense être celui de son partenaire : `POST /api/invitations/{code}/answer`.
4. Le serveur verrouille la ligne du test (`SELECT … FOR UPDATE`), vérifie l'état et qu'aucune tentative n'a déjà eu lieu, compare par HMAC, enregistre la tentative et change l'état dans la même transaction.
5. La réponse du serveur est un simple booléen. L'identité de l'initiateur n'est révélée qu'après validation, via un endpoint dédié.

#### C. Réussite : versement automatique

Le test passe en `SUCCESS` puis `PAYOUT_PENDING`. Le testé fournit son moyen de versement ; un worker appelle le PSP avec une référence unique (`payout_id`). Le webhook de confirmation clôture le test en `COMPLETED` et écrit l'écriture de règlement. En cas d'échec, le worker retente avec backoff, puis alerte et ouvre un cas manuel.

#### D. Échec ou expiration : remboursement automatique

Un job planifié (toutes les minutes) sélectionne les tests `SENT` dont le champ `expires_at` est dépassé, avec `FOR UPDATE SKIP LOCKED` pour éviter les doublons entre workers, les passe en `EXPIRED` puis `REFUND_PENDING`. Le remboursement suit le même schéma que le versement.

### 5.3 Anonymat et comparaison des numéros

- **Normalisation** : tout numéro est converti au format E.164 (libphonenumber-js) avant stockage ou comparaison, ce qui tolère `+237 6XX…`, `6XX…`, les espaces, etc.
- **Double représentation** : `phone_hmac = HMAC-SHA256(poivre, E.164)` pour la comparaison et les index ; `phone_enc = AES-256-GCM` (clé de données KMS) pour l'affichage et l'envoi de SMS.
- **Comparaison côté serveur uniquement**, en temps constant (`timingSafeEqual`). Le client n'a jamais accès au numéro attendu.
- **Anti-bruteforce** : une seule tentative, jeton d'invitation à usage unique, limitation de débit par IP, appareil et numéro, détection d'énumération.
- **DTO distincts par rôle** (`InitiatorTestView`, `RecipientInvitationView`) : l'anonymat est garanti par le typage, pas par des `if` dispersés.

---

## 6. Modèle de données

### Tables principales

| Table | Colonnes clés | Exigences |
|---|---|---|
| `users` | id (uuid), phone_hmac (unique), phone_enc, country, locale, status, kyc_level, created_at | Numéro jamais stocké en clair. |
| `auth_factors` | id, user_id, type (SMS_OTP, TOTP, PASSKEY), secret_enc, verified_at, last_used_at | Support du 2FA futur. |
| `sessions` | id, user_id, device_id, refresh_hash, expires_at, revoked_at, reuse_flag | Rotation et détection de rejeu. |
| `tests` | id, public_code (unique), initiator_id, recipient_hmac, recipient_enc, reward_minor, fee_minor, currency, status, expires_at, answered_at, version | Index (status, expires_at) pour les expirations. |
| `test_attempts` | id, test_id (unique), entered_hmac, matched, ip_hash, device_id, created_at | Une seule tentative par test. |
| `test_events` | id, test_id, from_status, to_status, actor, reason, created_at | Historique complet, utile aux litiges. |
| `ledger_accounts` | id, code (unique), type, currency | Créé à la volée pour les séquestres. |
| `ledger_transactions` | id, test_id, kind, idempotency_key (unique), created_at | Regroupe les écritures. |
| `ledger_entries` | id, transaction_id, account_id, direction, amount_minor, created_at | Append-only ; partitionnable par mois. |
| `payments` / `payouts` / `refunds` | id, test_id, provider, provider_ref, amount_minor, currency, status, attempts, last_error | UNIQUE (test_id, kind) pour payouts et refunds. |
| `webhook_events` | id, provider, event_id, payload, signature_ok, processed_at | UNIQUE (provider, event_id). |
| `outbox_events` | id, aggregate, type, payload, created_at, published_at | Relayé vers BullMQ. |
| `idempotency_keys` | key, user_id, request_hash, response, expires_at | TTL 24 à 48 h. |
| `consents` | id, user_id, test_id, type, version, locale, created_at | Consentement explicite par test. |
| `invoices` | id, test_id, number (unique), pdf_key, sha256, issued_at | Numérotation sans trou. |
| `audit_log` | id, actor_type, actor_id, action, target, ip_hash, metadata, created_at | UPDATE/DELETE révoqués. |

---

## 7. Conception de l'API

### Endpoints principaux

| Méthode | Route | Description | Accès |
|---|---|---|---|
| POST | `/api/auth/otp/request` | Demande d'OTP sur un numéro | Public (rate limited) |
| POST | `/api/auth/otp/verify` | Vérification de l'OTP, émission des jetons | Public |
| POST | `/api/auth/refresh` · `/logout` | Rotation et révocation des jetons | Authentifié |
| POST | `/api/auth/2fa/enroll` · `/verify` | Activation du 2FA (futur, route réservée) | Authentifié |
| GET · PATCH | `/api/me` | Profil, langue, préférences | Utilisateur |
| POST | `/api/me/consents` | Enregistrement d'un consentement | Utilisateur |
| DELETE | `/api/me` | Demande d'effacement (RGPD) | Utilisateur |
| POST | `/api/tests` | Création d'un test (Idempotency-Key) | Initiateur |
| GET | `/api/tests` · `/api/tests/{id}` | Liste et détail de mes tests | Initiateur |
| POST | `/api/tests/{id}/payments` | Initier le paiement du test | Initiateur |
| POST | `/api/tests/{id}/cancel` | Annulation avant envoi | Initiateur |
| GET | `/api/tests/{id}/invoice` | Facture PDF | Initiateur |
| GET | `/api/invitations/{code}` | Informations anonymisées du test | Invité |
| POST | `/api/invitations/{code}/answer` | Soumission du numéro deviné | Invité authentifié par OTP |
| PUT | `/api/invitations/{code}/payoutmethod` | Moyen de versement de la récompense | Invité |
| GET | `/api/tests/{id}/reveal` | Identité de l'initiateur après validation | Testé |
| POST | `/api/webhooks/{provider}` | Réception des événements PSP | Signature + allowlist IP |
| GET | `/api/admin/users` · `/tests` · `/transactions` | Consultation backoffice | Admin (RBAC) |
| POST | `/api/admin/tests/{id}/refund` | Remboursement manuel (double validation) | Admin finance |
| POST · GET | `/api/admin/exports` | Création et suivi d'un export CSV/PDF | Admin |
| GET | `/api/admin/stats/overview` | Indicateurs du tableau de bord | Admin |
| GET | `/api/siem/events?cursor=` | Collecte des journaux pour le SIEM | Compte de service |

---

## 8. Authentification et autorisation

### 8.1 Flux OTP

1. `POST /api/auth/otp/request` : limitation par numéro, IP et appareil ; réponse identique que le compte existe ou non (anti-énumération).
2. Génération d'un code à 6 chiffres via un CSPRNG ; seul son HMAC est stocké, avec une durée de vie de 5 minutes et 5 tentatives maximum.
3. Envoi par SMS, avec bascule WhatsApp ou fournisseur secondaire en cas d'échec de livraison.
4. `POST /api/auth/otp/verify` : émission d'un access token de 15 minutes (EdDSA ou RS256) et d'un refresh token opaque, lié à l'appareil, haché en base.
5. Rotation du refresh token à chaque usage ; la réutilisation d'un ancien jeton révoque toute la famille de sessions.

### 8.2 Administration et autorisation

- **Rôles RBAC** : `SUPPORT`, `FINANCE`, `RISK`, `AUDITOR`, `ADMIN`, avec une matrice de permissions explicite.
- **TOTP obligatoire** pour tous les comptes admin dès le MVP, même si le 2FA utilisateur vient plus tard. SSO via OIDC (Google Workspace ou Cognito) recommandé.
- **Double validation (four-eyes)** pour les remboursements manuels et les déblocages de litiges au-dessus d'un seuil.
- Données personnelles masquées par défaut ; la révélation d'un numéro exige une permission et est journalisée.

---

## 9. Intégrations externes

### 9.1 Abstraction des paiements

Aucun code métier n'est lié à un PSP en particulier. Tous passent par une interface commune ; un routeur choisit le fournisseur par pays, moyen de paiement, devise et disponibilité.

### 9.2 Fournisseurs de paiement

| Fournisseur | Usage prévu | Zone | Remarque (couverture à valider) |
|---|---|---|---|
| Orange Money | Collecte et versement mobile money | Cameroun | Contrat opérateur et KYC entreprise ; délais d'agrément à anticiper. |
| MTN Mobile Money | Collecte et versement (API Collection et Disbursement) | Cameroun | Sandbox disponible ; mêmes contraintes contractuelles. |
| Flutterwave | Agrégateur mobile money, cartes et transferts | Afrique multipays | Bon candidat pour accélérer le MVP ; vérifier la couverture XAF et les versements. |

### 9.3 Messagerie et notifications

- **SMS** : Twilio (ou Twilio Verify pour les OTP) avec un agrégateur local ou régional en secours pour la qualité des routes dans notre pays.
- **Email** : Amazon SES avec SPF, DKIM et DMARC.
- **Push** : Firebase Cloud Messaging pour le transactionnel, OneSignal pour les campagnes et la segmentation.
- Templates localisés FR/EN, versionnés ; journal d'envoi et statut de livraison.

---

## 10. Plateforme d'administration

| Fonction | Conception |
|---|---|
| Tableau de bord | Indicateurs sur un réplica de lecture ou des vues matérialisées : tests créés, taux de réussite, volumes, revenus, taux de succès des paiements par PSP. |
| Gestion utilisateurs | Recherche, suspension, historique, demandes RGPD ; données masquées par défaut. |
| Transactions et ledger | Vue du séquestre par test, historique des écritures, écarts de réconciliation. |
| Litiges | Workflow : ouverture → gel des fonds → instruction → décision → écritures. Délais et pièces tracés. |
| Remboursements manuels | Double validation, motif obligatoire, écritures dédiées, journalisées. |
| Fraude et support | Files de revue, liste de blocage, vue support en lecture seule. L'usurpation d'identité (« se connecter en tant que ») est interdite. |
| Exports CSV / PDF | Job asynchrone (BullMQ), génération en flux, dépôt sur S3, URL présignée de 15 minutes, chaque export est journalisé. |
| Hébergement | Application Next.js séparée, derrière CloudFront + WAF, accès par SSO et restriction IP/VPN, domaine dédié. Le cahier des charges laisse l'hébergeur à définir : AWS Amplify ou ECS conviennent. |
| Isolation | Même base de code backend, mais le trafic admin peut tourner sur un service ECS distinct (mêmes images, mode ADMIN), avec ses propres limites et règles WAF. |

---

## 11. Sécurité

### 11.1 Modèle de menaces

| Menace | Contre-mesures |
|---|---|
| Double paiement ou double versement | Idempotence, contraintes d'unicité, verrous de ligne, états explicites. |
| Webhook falsifié | Signature HMAC, liste blanche d'IP, re-vérification du statut auprès du PSP. |
| Bruteforce du numéro à deviner | Tentative unique, jeton à usage unique, limitation par IP/appareil/numéro, détection d'énumération. |
| Énumération de comptes | Réponses uniformes, OTP envoyé selon la même logique que le compte existe ou non. |
| Abus d'OTP / SMS pumping | Quotas, liste blanche de pays, Fraud Guard, alertes de coût. |
| Fraude, collusion, blanchiment | Règles de vélocité, plafonds par niveau KYC, liaison par appareil/IP, listes de blocage, revue manuelle, rapports d'activité suspecte. |
| Fuite de données | Chiffrement KMS, minimisation, masquage, moindre privilège, base en sous-réseau privé, aucun accès public. |
| Failles API (OWASP API Top 10) | Validation stricte des DTO, requêtes paramétrées, contrôle de propriété (BOLA), liste blanche des champs modifiables (mass assignment). |
| Vol de jetons | Access tokens courts, rotation des refresh tokens, détection de rejeu, révocation. |
| Menace interne | RBAC, double validation, audit immuable (export S3 Object Lock), journalisation des accès aux données personnelles. |
| Chaîne d'approvisionnement | Lockfile, Dependabot, npm audit, SBOM, images minimales, Trivy, versions épinglées. |
| Déni de service | CloudFront, règles de débit WAF, Shield Standard, auto-scaling, files tampon. |

### 11.2 Chiffrement et gestion des clés

- **En transit** : TLS 1.2 minimum (1.3 préféré), HSTS, certificats gérés par ACM.
- **Au repos** : RDS, S3 et EBS chiffrés par KMS.
- **Par champ** (AES-256-GCM, chiffrement enveloppe) : numéros de téléphone, moyens de versement, secrets TOTP. Clés de données dérivées d'une CMK KMS, rotation annuelle.
- **Poivre HMAC** stocké dans Secrets Manager, jamais dans le code ni les variables d'environnement en clair.

### 11.3 Topologie

- Comptes AWS séparés par environnement (AWS Organizations) : dev, staging, prod, plus un compte security/logging.
- VPC sur 2 zones ; sous-réseaux privés pour ECS, RDS et ElastiCache ; seul l'ALB est public ; VPC endpoints pour S3, ECR, Secrets Manager et CloudWatch.
- ECS Fargate : services `api`, `admin-api` (optionnel) et `worker`, avec auto-scaling (CPU, requêtes, profondeur des files).
- RDS PostgreSQL Multi-AZ, RDS Proxy ou PgBouncer pour les connexions, réplica de lecture pour l'admin et les statistiques.
- ElastiCache Redis, S3 (versioning, SSE-KMS), CloudFront + WAF, Secrets Manager, KMS, GuardDuty, Security Hub, CloudTrail.

---

## 12. Pipeline CI/CD (GitHub Actions)

1. **Pull request** : lint, typecheck, tests unitaires, tests d'intégration (Testcontainers), CodeQL, scan des dépendances, vérification des migrations Prisma, vérification des frontières de modules.
2. **Merge sur `main`** : build Docker, scan Trivy, push vers ECR, déploiement dev puis staging, tests de fumée et end-to-end.
3. **Production** : approbation manuelle, déploiement blue/green (CodeDeploy pour ECS) avec retour arrière automatique sur alarmes CloudWatch.
4. **Migrations de base** : approche *expand / contract* (rétro-compatible), exécutées par une tâche ECS ponctuelle avant le déploiement applicatif.
5. **Infrastructure** : Terraform, état distant dans S3 avec verrouillage, revue de plan obligatoire en pull request, authentification GitHub → AWS par OIDC (aucune clé longue durée).

---

## 13. Dimensionnement

Même à un million de tests par mois, la partie transactionnelle représente moins d'une requête par seconde en moyenne. Le défi n'est pas le débit mais :

- les **pics de trafic viraux** qui peuvent multiplier le trafic par 50 à 100 en quelques heures : auto-scaling, files tampon, limitation de débit, pages dégradées gracieuses ;
- la **fiabilité des paiements**, qui dépend de PSP externes et non de notre capacité de calcul ;
- les **coûts SMS** et la fraude associée.

**Leviers de montée en charge** : API sans état (scaling horizontal), workers dimensionnés sur la profondeur des files, réplicas de lecture, cache Redis, partitionnement mensuel de `ledger_entries` et `audit_log`.
