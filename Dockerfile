
# ==========================================
# STAGE 1 : BUILD
# ==========================================

FROM node:22-alpine AS build

WORKDIR /app

# Installer les dépendances
COPY package*.json ./

RUN npm ci --no-audit --no-fund

# Copier le projet
COPY . .

# Générer Prisma Client
RUN npx prisma generate

# Compiler NestJS
RUN npm run build


# ==========================================
# STAGE 2 : RUNTIME
# ==========================================

FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Copier les dépendances et les fichiers
# nécessaires depuis l'étape build.
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts

# Exécuter avec un utilisateur non-root
USER node

EXPOSE 3000

# Démarrer NestJS
CMD ["node", "dist/main.js"]
