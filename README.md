# Tiako dia Tiako — API

API NestJS et PostgreSQL pour les produits, stocks, commandes, utilisateurs et
l’intégration Facebook/Meta.

## Installation et démarrage

Prérequis : Node.js et PostgreSQL.

```bash
npm install
cp .env.example .env
```

Renseignez au minimum `DATABASE_URL`, `JWT_SECRET` et `CSRF_SECRET` dans `.env`.
Créez deux secrets distincts d’au moins 32 caractères, par exemple avec
`openssl rand -hex 32`.

La migration actuelle est une migration initiale unique destinée à une base
vide. Vérifiez la base ciblée avant de la lancer : n’effacez pas l’historique
de migrations et ne faites pas de reset sur une base contenant des données.

```bash
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

L’API écoute par défaut sur <http://localhost:5000>. Pour créer l’administrateur
initial en développement, définissez `SEED_ADMIN_EMAIL` et
`SEED_ADMIN_PASSWORD` dans `.env`, puis lancez :

```bash
npm run db:seed:admin
```

## Facebook / Meta

La rubrique `/facebook` du frontend permet aux administrateurs de publier sur
la Page et de configurer le message d’accueil. Les messages et commentaires
peuvent être analysés par mots-clés, créer des commandes multi-produits et
réserver le stock. Aucun paiement n’est effectué automatiquement.

Pour activer l’intégration :

1. Configurez une application Meta avec les produits Messenger et Webhooks, puis
   liez-y votre Page et accordez les permissions requises par Meta.
2. Dans Graph API Explorer, récupérez l’ID de la Page et son jeton d’accès Page.
3. Renseignez côté serveur `FACEBOOK_APP_SECRET`, `FACEBOOK_VERIFY_TOKEN`,
   `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` et
   `FACEBOOK_GRAPH_API_VERSION`.
4. Configurez le webhook sur
   `https://<votre-api>/facebook/webhook`, avec les champs Page `feed`,
   `live_comments` et `messages`.

`FACEBOOK_VERIFY_TOKEN` est une valeur secrète de votre choix, à saisir aussi
dans la configuration du webhook Meta. Gardez tous les jetons et secrets dans
les variables d’environnement du serveur ; ne les publiez pas et ne les mettez
pas dans le frontend. Meta peut demander une revue de l’application et un accès
avancé pour les utilisateurs hors des rôles de test.

Les publications organiques peuvent inclure un lien `m.me` vers la conversation
Messenger de la Page. Elles ne prennent pas en charge le bouton natif
« Envoyer un message » via l’API utilisée.

## Vérification

```bash
npm run build
npm run lint
npm test
```

Pour les détails de configuration, consultez `.env.example`.
