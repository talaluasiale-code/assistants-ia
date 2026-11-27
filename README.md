# Assistants IA — app web minimale (Mistral)

Application web de chat propulsée par [l'API Mistral](https://docs.mistral.ai/) via le SDK TypeScript officiel (`@mistralai/mistralai`), avec le modèle `mistral-small-latest`.

Une seule app, **plusieurs assistants spécialisés** (les prompts système sont définis côté serveur, jamais exposés au navigateur) :

- 🎙️ **Coach d'entretien** — simule un recruteur et donne un feedback structuré
- ✉️ **E-mails pro** — rédige des e-mails prêts à envoyer avec objet et variantes
- 📚 **Tuteur de révision** — explique puis quiz pour vérifier la compréhension
- 💬 **Assistant général** — questions libres

- **Interface de chat simple** (une seule page HTML, sans framework) avec sélecteur d'assistant
- **Clé API 100 % côté serveur** : le navigateur ne voit jamais `MISTRAL_API_KEY` ni les prompts système ; le front appelle uniquement `GET /api/modes` et `POST /api/chat`, le serveur relaie vers l'API Mistral
- Aucun framework : serveur Node natif (`node:http`), seule dépendance = le SDK Mistral

## Structure

```
├── server.mjs          # Serveur HTTP + endpoint /api/chat (clé API ici uniquement)
├── public/index.html   # Interface de chat
├── public/manifest.webmanifest + sw.js + icons/  # PWA (app installable)
├── generate-icons.mjs  # Régénère les icônes PNG (node generate-icons.mjs)
├── .env.example        # Modèle de variable d'environnement
└── package.json
```

## Installation

```bash
npm install
```

## Configuration

Copiez `.env.example` vers `.env` et insérez votre clé API (créable sur [console.mistral.ai](https://console.mistral.ai/)) :

```bash
cp .env.example .env
```

Puis exportez la variable avant de lancer :

```bash
export $(grep -v '^#' .env | xargs)
```

## Exécution locale

```bash
npm start
```

Ouvrez ensuite **http://localhost:3000** dans votre navigateur.

Port personnalisé :

```bash
PORT=8080 npm start
```

## Quota gratuit (freemium)

Chaque adresse IP dispose d'un quota quotidien de messages (10 par défaut, non décomptés en cas d'erreur API). Personnalisez-le :

```bash
DAILY_MESSAGE_LIMIT=25 npm start
```

Quand le quota est atteint, l'API renvoie `429` avec un message invitant à revenir le lendemain ou à passer en premium — point d'accroche naturel pour brancher un paywall (ex. Stripe) : offrir le plan payant aux visiteurs identifiés revient à ignorer le quota pour leur IP/session.

## Installer comme application (PWA)

L'app est installable directement depuis le navigateur, sans store ni validation :

- **Android (Chrome)** : ouvrez l'app → menu ⋮ → **« Installer l'application »** → une icône apparaît sur l'écran d'accueil
- **iPhone/iPad (Safari)** : bouton **Partager** → **« Sur l'écran d'accueil »**
- **Ordinateur (Chrome/Edge)** : icône d'installation dans la barre d'adresse

L'app s'ouvre alors en plein écran, avec son icône orange (bulle de chat), et fonctionne même hors connexion pour l'interface (service worker).

## Déploiement

L'app est un simple serveur Node : elle se déploie sur n'importe quel hébergeur (Railway, Render, Fly.io, VPS…) en configurant deux variables d'environnement dans le panneau de l'hébergeur — **jamais dans le code** :

| Variable | Rôle |
|---|---|
| `MISTRAL_API_KEY` | Clé API Mistral ([console.mistral.ai](https://console.mistral.ai/)) |
| `DAILY_MESSAGE_LIMIT` | Quota quotidien par visiteur (optionnel, 10 par défaut) |

Commande de démarrage : `npm start` (ou `node server.mjs`). L'hébergeur fournit généralement `PORT` automatiquement — le serveur le lit déjà.

## Notes

- L'historique de conversation est conservé côté client et renvoyé à chaque requête (20 derniers messages, 8 000 caractères max par message). Changer d'assistant réinitialise la conversation.
- Pour ajouter un nouvel assistant : ajoutez une entrée dans l'objet `MODES` de `server.mjs`, c'est tout (il apparaîtra automatiquement dans l'interface).
- En cas de clé absente, le serveur refuse de démarrer avec un message explicite.
