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

// --- DIAGNOSTYKA ZMIENNYCH (NOWOŚĆ) ---
// Wejdź na adres /debug-config po wgraniu tego kodu
app.get('/debug-config', (req, res) => {
    const report = {
        sheet_id_exists: !!process.env.SHEET_ID,
        sheet_id_value: process.env.SHEET_ID ? process.env.SHEET_ID.substring(0, 5) + '...' : 'BRAK',
        creds_exists: !!process.env.GOOGLE_CREDENTIALS,
        creds_parsing: null,
        private_key_analysis: null
    };

    if (process.env.GOOGLE_CREDENTIALS) {
        try {
            const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            report.creds_parsing = "OK (JSON poprawny)";
            report.client_email = creds.client_email;

            if (creds.private_key) {
                const pk = creds.private_key;
                report.private_key_analysis = {
                    exists: true,
                    length: pk.length,
                    starts_with: pk.substring(0, 15) + '...',
                    // SPRAWDZAMY FORMATOWANIE KLUCZA
                    contains_literal_slash_n: pk.includes('\\n'), // Czy ma tekst "\n"?
                    contains_real_newline: pk.includes('\n'),     // Czy ma prawdziwy enter?
                    fixed_version_preview: pk.replace(/\\n/g, '\n').substring(25, 40) + '...'
                };
            } else {
                report.private_key_analysis = "BRAK POLA private_key W JSON";
            }
        } catch (e) {
            report.creds_parsing = "BŁĄD PARSOWANIA JSON: " + e.message;
            report.raw_preview = process.env.GOOGLE_CREDENTIALS.substring(0, 20);
        }
    } else {
        report.creds_parsing = "Brak zmiennej GOOGLE_CREDENTIALS";
    }

    res.json(report);
});
// ----------------------------------------

// --- KONFIGURACJA AUTH Z NAPRAWĄ KLUCZA ---
let authClient;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

try {
    if (process.env.GOOGLE_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        // Magiczna naprawa klucza:
        const privateKey = credentials.private_key.replace(/\\n/g, '\n');

        authClient = new google.auth.JWT(
            credentials.client_email,
            null,
            privateKey,
            SCOPES
        );
        console.log("🔒 Auth Client utworzony.");
    } else {
        // Fallback lokalny
        const credentialsPath = path.join(__dirname, 'credentials.json');
        if (fs.existsSync(credentialsPath)) {
            authClient = new google.auth.JWT({ keyFile: credentialsPath, scopes: SCOPES });
        }
    }
} catch (error) {
    console.error("Błąd auth:", error.message);
}

const sheets = google.sheets({ version: 'v4', auth: authClient });

// --- TRASY ---

app.get('/:token', async (req, res) => {
    const { token } = req.params;
    if (token === 'favicon.ico' || token === 'debug-config') return; // Ignoruj specjalne trasy

    try {
        if (!authClient) throw new Error("Błąd konfiguracji Auth (serwer nie zalogowany)");

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Arkusz1!A:D',
        });

        const rows = response.data.values;
        const userRow = rows?.find(row => row[0] === token);

        if (userRow) {
            res.render('index', { user: { token: userRow[0], title: userRow[1], name: userRow[2], surname: userRow[3] } });
        } else {
            res.status(404).render('404');
        }
    } catch (error) {
        res.status(500).send(`BŁĄD SERWERA (Sprawdź /debug-config): ${error.message}`);
    }
});

app.post('/confirm/:token', async (req, res) => {
    // ... (kod bez zmian) ...
    const { token } = req.params;
    const { status, comment } = req.body;
    try {
        if (!authClient) throw new Error("Auth Error");
        const getRows = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: 'Arkusz1!A:A' });
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
        res.status(500).json({ success: false, error: error.message });
    }
});

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Serwer: http://localhost:${PORT}`));
}

module.exports = app;