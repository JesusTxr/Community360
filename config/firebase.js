require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function obtenerCredencialesFirebase() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (parsed.private_key) {
            parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        return parsed;
    }

    const rutaLocal = process.env.FIREBASE_CREDENTIALS_PATH || './serviceAccountKey.json';
    const rutaAbsoluta = path.resolve(rutaLocal);

    if (fs.existsSync(rutaAbsoluta)) {
        const contenido = fs.readFileSync(rutaAbsoluta, 'utf8');
        return JSON.parse(contenido);
    }

    throw new Error(
        'No se encontraron credenciales de Firebase en FIREBASE_SERVICE_ACCOUNT_JSON ni en serviceAccountKey.json.'
    );
}

if (getApps().length === 0) {
    const serviceAccount = obtenerCredencialesFirebase();
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

module.exports = db;
