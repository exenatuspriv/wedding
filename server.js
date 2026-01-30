require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- KONFIGURACJA Z DIAGNOSTYKĄ ---
let authClient;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

try {
    if (process.env.GOOGLE_CREDENTIALS) {
        console.log("🔒 Start: Próba odczytu zmiennej z Vercel...");

        let credentials;
        try {
            credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        } catch (e) {
            console.error("❌ BŁĄD JSON: Zmienna GOOGLE_CREDENTIALS ma zły format! Sprawdź cudzysłowy w Vercel.");
            throw e;
        }

        // --- DIAGNOSTYKA ---
        if (!credentials.client_email) console.error("❌ BŁĄD: W JSON brakuje pola 'client_email'");
        else console.log("✅ Email wykryty:", credentials.client_email);

        if (!credentials.private_key) console.error("❌ BŁĄD: W JSON brakuje pola 'private_key'");
        else console.log("✅ Klucz prywatny wykryty (długość):", credentials.private_key.length);
        // -------------------

        const privateKey = credentials.private_key.replace(/\\n/g, '\n');

        authClient = new google.auth.JWT(
            credentials.client_email,
            null,
            privateKey,
            SCOPES
        );
    } else {
        // Tryb lokalny
        const credentialsPath = path.join(__dirname, 'credentials.json');
        if (fs.existsSync(credentialsPath)) {
            console.log("📂 Start: Tryb Lokalny (plik znaleziony)");
            authClient = new google.auth.JWT({ keyFile: credentialsPath, scopes: SCOPES });
        } else {
            console.error("⚠️ FATAL: Brak credentials.json i brak zmiennej ENV!");
        }
    }
} catch (error) {
    console.error("❌ Błąd krytyczny auth:", error.message);
}

const sheets = google.sheets({ version: 'v4', auth: authClient });

// --- TRASY ---

app.get('/:token', async (req, res) => {
    const { token } = req.params;
    if (token === 'favicon.ico') return res.status(204).end();

    try {
        // Test czy authClient w ogóle istnieje
        if (!authClient) {
            throw new Error("Klient Auth nie został utworzony (błąd konfiguracji).");
        }

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Arkusz1!A:D',
        });

        const rows = response.data.values;
        const userRow = rows?.find(row => row[0] === token);

        if (userRow) {
            res.render('index', {
                user: {
                    token: userRow[0],
                    title: userRow[1] || '',
                    name:  userRow[2] || '',
                    surname: userRow[3] || ''
                }
            });
        } else {
            res.status(404).render('404');
        }
    } catch (error) {
        console.error("🔥 Błąd GET:", error.message);
        // Jeśli błąd to "unregistered callers", to znaczy że API Sheets nie jest włączone w Cloud Console
        res.status(500).send(`Błąd połączenia z Google: ${error.message}`);
    }
});

app.post('/confirm/:token', async (req, res) => {
    const { token } = req.params;
    const { status, comment } = req.body;

    try {
        const getRows = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Arkusz1!A:A',
        });

        const rows = getRows.data.values;
        const rowIndex = rows.findIndex(row => row[0] === token) + 1;

        if (rowIndex > 0) {
            const timestamp = new Date().toLocaleString('pl-PL');
            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SHEET_ID,
                range: `Arkusz1!E${rowIndex}:G${rowIndex}`,
                valueInputOption: 'RAW',
                requestBody: { values: [[ status === 'yes' ? 'TAK' : 'NIE BĘDĘ', comment, timestamp ]] }
            });
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (error) {
        console.error("Błąd POST:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Serwer: http://localhost:${PORT}`));
}

module.exports = app;