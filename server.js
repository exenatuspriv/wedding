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

// --- FUNKCJA POMOCNICZA: POBIERZ AUTORYZACJĘ ---
// Ta funkcja uruchamia się przy KAŻDYM zapytaniu, gwarantując świeże dane.
function getGoogleAuth() {
    const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

    try {
        // 1. SPRAWDZAMY VERCEL (ZMIENNA)
        if (process.env.GOOGLE_CREDENTIALS) {
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

            // NAPRAWA KLUCZA (Vercel Newline Fix)
            const privateKey = credentials.private_key
                ? credentials.private_key.replace(/\\n/g, '\n')
                : undefined;

            if (!privateKey) throw new Error("Brak private_key w zmiennej GOOGLE_CREDENTIALS");

            return new google.auth.JWT(
                credentials.client_email,
                null,
                privateKey,
                SCOPES
            );
        }
        // 2. SPRAWDZAMY LOKALNIE (PLIK)
        else {
            const credentialsPath = path.join(__dirname, 'credentials.json');
            if (fs.existsSync(credentialsPath)) {
                return new google.auth.JWT({
                    keyFile: credentialsPath,
                    scopes: SCOPES
                });
            }
        }
    } catch (error) {
        console.error("❌ Błąd tworzenia obiektu Auth:", error.message);
        return null;
    }
    return null;
}

// --- TRASY ---

app.get('/:token', async (req, res) => {
    const { token } = req.params;
    // Ignoruj requesty o ikonę i mapy źródłowe
    if (token === 'favicon.ico' || token.endsWith('.map')) return res.status(204).end();

    try {
        // 1. POBIERZ AUTH TERAZ (nie globalnie)
        const auth = getGoogleAuth();
        if (!auth) {
            throw new Error("Nie udało się skonfigurować autoryzacji Google (Brak zmiennej lub pliku).");
        }

        // 2. UTWÓRZ KLIENTA SHEETS Z TYM AUTH
        const sheets = google.sheets({ version: 'v4', auth });

        // 3. WYKONAJ ZAPYTANIE
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
        // Wypisz błąd na ekranie, żebyś widział co jest nie tak
        res.status(500).send(`
            <h1>Błąd Serwera</h1>
            <p>${error.message}</p>
            <p>Sprawdź logi Vercel po szczegóły.</p>
        `);
    }
});

app.post('/confirm/:token', async (req, res) => {
    const { token } = req.params;
    const { status, comment } = req.body;

    try {
        const auth = getGoogleAuth();
        if (!auth) throw new Error("Błąd konfiguracji Auth");

        const sheets = google.sheets({ version: 'v4', auth });

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