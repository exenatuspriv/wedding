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

// --- FUNKCJA TWORZĄCA AUTH (Bezpieczna) ---
async function getGoogleAuth() {
    try {
        // 1. TRYB VERCEL (Zmienna)
        if (process.env.GOOGLE_CREDENTIALS) {
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            // Naprawa klucza - Vercel czasem zamienia \n na tekst
            const privateKey = credentials.private_key.replace(/\\n/g, '\n');

            console.log('pokaż mi co tutaj mam' + credentials.client_email + '<br/> a tutaj' + privateKey);


            const auth = new google.auth.JWT(
                credentials.client_email,
                null,
                privateKey,
                ['https://www.googleapis.com/auth/spreadsheets']
            );
            return auth;
        }
        // 2. TRYB LOKALNY (Plik)
        else {
            const credentialsPath = path.join(__dirname, 'credentials.json');
            if (fs.existsSync(credentialsPath)) {
                return new google.auth.JWT({
                    keyFile: credentialsPath,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets']
                });
            }
        }
    } catch (error) {
        console.error("Auth Error:", error.message);
    }
    return null;
}

// --- TRASY ---

app.get('/:token', async (req, res) => {
    const { token } = req.params;
    if (token === 'favicon.ico') return res.status(204).end();

    try {
        const auth = await getGoogleAuth();
        if (!auth) throw new Error("Błąd konfiguracji kluczy Google (Auth failed)");

        const sheets = google.sheets({ version: 'v4', auth });

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
        res.status(500).send(`Błąd serwera: ${error.message}`);
    }
});

app.post('/confirm/:token', async (req, res) => {
    const { token } = req.params;
    const { status, comment } = req.body;

    try {
        const auth = await getGoogleAuth();
        if (!auth) throw new Error("Błąd konfiguracji kluczy Google (Auth failed)");

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