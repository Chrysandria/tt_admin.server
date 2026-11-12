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

La migration initiale est destinée à une base vide ; les migrations suivantes
ajoutent les fonctionnalités du catalogue et de sécurité. Vérifiez la base
ciblée avant de les lancer : n’effacez pas l’historique de migrations et ne
faites pas de reset sur une base contenant des données.

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

## Sécurité du compte

Les nouveaux comptes reçoivent par e-mail un mot de passe provisoire aléatoire
de 8 caractères. Dans la rubrique **Sécurité** du frontend, un utilisateur peut
demander un changement de mot de passe en saisissant son mot de passe actuel.
Un code OTP à 6 chiffres est envoyé à l’adresse de son compte ; il expire après
10 minutes et cinq tentatives incorrectes au maximum sont autorisées. Le
changement n’est appliqué qu’après confirmation du code. Configurez les
variables SMTP décrites dans `.env.example` pour permettre l’envoi des codes.

## Facebook / Meta

La rubrique `/facebook` du frontend permet aux administrateurs de configurer le
message d’accueil. Les publications se font depuis `/produits`. Les messages et
commentaires reconnus par mots-clés créent une commande pour un seul produit et
réservent le stock. Si un message demande plusieurs produits, le client est
invité à envoyer une demande distincte pour chaque produit. Aucun paiement n’est
effectué automatiquement.

Les commandes conservent le nom, le téléphone et l’adresse de livraison du
client, ainsi que la date/heure à laquelle elles sont marquées comme livrées.
Les coordonnées reçues via Facebook doivent être complétées manuellement : les
webhooks de commentaires et Messenger ne fournissent pas automatiquement ces
informations de livraison.

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
