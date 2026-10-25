# TRUEBOND Backend

Socle initial de l'API TRUEBOND : NestJS + Fastify, TypeScript strict, Prisma, PostgreSQL et Redis.

## Prérequis

- Node.js 22 ou plus récent
- npm 10+
- Docker Engine avec le plugin Docker Compose (pour PostgreSQL et Redis)

## Démarrage local

1. Installer les dépendances :

   ```bash
   npm install
   ```

2. Préparer la configuration :

   ```bash
   cp .env.example .env
   ```

   En développement, les valeurs fournies sont locales. Ne réutilisez jamais ces mots de passe en production. Les variables sont validées au démarrage ; une configuration invalide empêche l'application de démarrer.

3. Démarrer PostgreSQL et Redis :

   ```bash
   docker compose up -d postgres redis
   ```

4. Générer le client Prisma et valider le schéma :

   ```bash
   npm run prisma:generate
   npm run prisma:validate
   ```

5. Lancer l'API :

   ```bash
   npm run start:dev
   ```

L'API écoute par défaut sur `http://localhost:3000`. La route de santé est `GET /api/v1/health` et Swagger est disponible sur `http://localhost:3000/api/docs`.

> Le schéma Prisma est volontairement initial et ne contient pas encore les entités métier. Les migrations métier seront ajoutées après validation de la conception.

## Commandes qualité

```bash
npm run build
npm run lint
npm test
npm run format:check
npm run prisma:validate
```

## Configuration

| Variable | Description | Défaut local |
| --- | --- | --- |
| `NODE_ENV` | Environnement | `development` |
| `PORT` | Port HTTP | `3000` |
| `HOST` | Adresse d'écoute | `0.0.0.0` |
| `LOG_LEVEL` | Niveau des logs Pino | `info` |
| `CORS_ORIGINS` | Origines autorisées (réservé à la configuration CORS) | localhost |
| `DATABASE_URL` | URL PostgreSQL | localhost:5432 |
| `REDIS_URL` | URL Redis | localhost:6379 |

## Conventions du socle

- Préfixe REST versionné : `/api/v1`.
- Swagger/OpenAPI : `/api/docs`.
- Validation globale : propriétés inconnues rejetées, transformation contrôlée.
- Erreurs HTTP : enveloppe `{ "error": { "code", "message", "correlationId", "timestamp", "path" } }`.
- Logs structurés JSON avec identifiant de corrélation `x-correlation-id` généré ou propagé. Les en-têtes d'autorisation et cookies sont expurgés.
- Prisma est encapsulé dans un service injectable ; aucune logique métier financière n'est incluse dans cette phase.

## Docker

`docker compose up -d` démarre les services de données. Le Dockerfile construit une image API ; avant un déploiement réel, ajouter les migrations, la stratégie de secrets, les contrôles de sécurité d'image et une configuration d'orchestration adaptée.
