# Installation Guide

Step-by-step instructions for setting up Arc CMS locally and deploying to production.

---

## Prerequisites

- **Node.js** >= 20.19.1 ([download](https://nodejs.org/))
- **npm** >= 10.0.0 (comes with Node.js)
- **Firebase CLI** — Install globally:
  ```bash
  npm install -g firebase-tools
  ```
- **Git** — [download](https://git-scm.com/)
- A **Firebase account** — [console.firebase.google.com](https://console.firebase.google.com)

---

## 1. Clone the Repository

```bash
git clone https://github.com/quadralyst/arccms.git
cd arccms
```

---

## 2. Install Dependencies

Install both frontend and Cloud Functions dependencies:

```bash
npm install
cd functions && npm install && cd ..
```

---

## 3. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **Add project** and follow the wizard
3. Enable the following services:

### Firestore Database
- Navigate to **Build > Firestore Database**
- Click **Create database**
- Choose **Start in production mode** (security rules are already configured in the repo)
- Select your preferred region

### Authentication
- Navigate to **Build > Authentication**
- Click **Get started**
- Enable the **Email/Password** sign-in provider

### Cloud Storage
- Navigate to **Build > Storage**
- Click **Get started**
- Accept the default rules (the repo includes custom rules)

### Register a Web App
- Go to **Project Settings > General**
- Under **Your apps**, click the Web icon (`</>`)
- Register your app (hosting setup is optional at this step)
- Copy the Firebase config object — you'll need it next

---

## 4. Configure Environment Files

1. Copy the example environment file:
   ```bash
   cp src/environments/environment.example.ts src/environments/environment.ts
   cp src/environments/environment.example.ts src/environments/environment.prod.ts
   ```

2. Edit `src/environments/environment.ts` and paste your **development** Firebase config:
   ```typescript
   export const environment = {
       production: false,
       firebaseConfig: {
           apiKey: 'your-api-key',
           authDomain: 'your-project.firebaseapp.com',
           databaseURL: 'https://your-project.firebaseio.com',
           projectId: 'your-project-id',
           storageBucket: 'your-project.appspot.com',
           messagingSenderId: 'your-sender-id',
           appId: 'your-app-id',
           measurementId: 'G-your-measurement-id',
       },
   };
   ```

3. Edit `src/environments/environment.prod.ts` with your **production** Firebase config and set:
   ```typescript
   production: true,
   ```

---

## 5. Configure Firebase CLI

Link your local project to your Firebase project:

```bash
firebase login
firebase use --add
```

When prompted, select your Firebase project and give it an alias (e.g., `default`).

Update `.firebaserc` if needed:
```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

---

## 6. Deploy Firestore Rules and Indexes

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage
```

---

## 7. Start the Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173/`.

On first run, Arc CMS will detect an empty database and redirect you to the **Onboarding Wizard** to create your admin account.

---

## 8. Build for Production

```bash
npm run build
```

This outputs:
- `dist/analog/public` — Static files for Firebase Hosting
- `dist/analog/server` — Server-side rendering assets

---

## 9. Deploy Cloud Functions

Build and deploy the Cloud Functions:

```bash
cd functions && npm run build && cd ..
firebase deploy --only functions
```

Or deploy everything at once:

```bash
npm run build
cd functions && npm run build && cd ..
firebase deploy
```

---

## 10. Deploy to Firebase Hosting

Deploy the full application:

```bash
firebase deploy
```

Or deploy only hosting:

```bash
firebase deploy --only hosting
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on port 5173 |
| `npm run build` | Build frontend for production |
| `npm run test` | Run all tests (frontend + functions) with Vitest |
| `npm run deploy:dev` | Build and deploy to development project |
| `npm run deploy:prod` | Build and deploy to production project |

### Functions Scripts

Run these from the `functions/` directory:

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run build:watch` | Compile in watch mode |
| `npm run serve` | Build and start Firebase emulators |
| `npm run deploy` | Deploy functions only |
| `npm run logs` | View function logs |

---

## Optional: Google Analytics Integration

1. Enable Google Analytics in your Firebase project
2. Go to **Admin > Settings > Analytics** in Arc CMS
3. Connect your Google Analytics property
4. Analytics data will appear in the admin dashboard

---

## Optional: Email Provider Configuration

Arc CMS supports multiple email providers for transactional emails (waitlist welcome, broadcasts, etc.). Configure via **Admin > Settings > Email** in the admin panel.

Supported providers:
- **SMTP** — Any SMTP server (e.g., Mailgun, SendGrid, Amazon SES)
- **Gmail** — Google Workspace or Gmail accounts
- **Resend** — [resend.com](https://resend.com)

---

## Troubleshooting

### Port 5173 is already in use
Kill the existing process or use a different port:
```bash
npx vite --port 5174
```

### Firebase CLI not found
Ensure Firebase CLI is installed globally:
```bash
npm install -g firebase-tools
```

### Firestore permission denied
Make sure you've deployed the security rules:
```bash
firebase deploy --only firestore:rules
```

### Functions deployment fails
Check that Node.js 22 is installed (required for Cloud Functions):
```bash
node --version
```
