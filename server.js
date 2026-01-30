require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const app = express();

// --- KONFIGURACJA EXPRESS ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- KONFIGURACJA GOOGLE SHEETS (POPRAWIONA) ---
let authClient;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

try {
    // SCENARIUSZ 1: VERCEL (Zmienna środowiskowa)
    if (process.env.GOOGLE_CREDENTIALS) {
        console.log("🔒 Start: Wykryto zmienną środowiskową (Tryb Vercel)");

        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

        // --- KLUCZOWA POPRAWKA ---
        // Naprawiamy klucz prywatny, zamieniając literalne "\n" na prawdziwe znaki nowej linii.
        // Bez tego Vercel widzi klucz jako jedną linię i wyrzuca błąd.
        const privateKey = credentials.private_key.replace(/\\n/g, '\n');
        // -------------------------

        authClient = new google.auth.JWT(
            credentials.client_email,
            null,
            privateKey, // Używamy naprawionego klucza
            SCOPES
        );
    }
    // SCENARIUSZ 2: LOKALNIE (Plik na dysku)
    else {
        const credentialsPath = path.join(__dirname, 'credentials.json');

        if (fs.existsSync(credentialsPath)) {
            console.log("📂 Start: Wykryto plik credentials.json (Tryb Lokalny)");
            authClient = new google.auth.JWT({
                keyFile: credentialsPath,
                scopes: SCOPES
            });
        } else {
            console.error("⚠️ OSTRZEŻENIE: Brak konfiguracji Google Auth.");
        }
    }
} catch (error) {
    console.error("❌ Błąd konfiguracji Google:", error.message);
}

const sheets = google.sheets({ version: 'v4', auth: authClient });

// --- TRASY ---

// 1. GET
app.get('/:token', async (req, res) => {
    const { token } = req.params;
    if (token === 'favicon.ico') return res.status(204).end();

    try {
        if (!authClient) throw new Error("Błąd autoryzacji Google (authClient is null)");

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
        console.error("Błąd GET:", error.message);
        // Wyświetlamy błąd na ekranie, żebyś wiedział co się dzieje
        res.status(500).send(`Błąd serwera: ${error.message}`);
    }
});

// 2. POST
app.post('/confirm/:token', async (req, res) => {
    const { token } = req.params;
    const { status, comment } = req.body;

    try {
        if (!authClient) throw new Error("Błąd autoryzacji Google");

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
                requestBody: {
                    values: [[
                        status === 'yes' ? 'TAK' : 'NIE BĘDĘ',
                        comment,
                        timestamp
                    ]]
                }
            });
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: "Nie znaleziono tokenu" });
        }
    } catch (error) {
        console.error("Błąd POST:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- START ---
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Serwer: http://localhost:${PORT}`);
    });
}

module.exports = app;