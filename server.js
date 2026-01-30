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

// --- FUNKCJA AUTH (JEDNA ZMIENNA) ---
function getGoogleAuth() {


    try {
        const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

        // SCENARIUSZ 1: VERCEL (Cały JSON w jednej zmiennej)
        if (process.env.GOOGLE_CREDENTIALS) {

            // 1. Parsujemy cały JSON ze zmiennej
            const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);

            // 2. Wyciągamy klucz i naprawiamy entery (To jest kluczowe!)
            // Vercel przekazuje \n jako tekst, a Google chce znaku nowej linii.
            const privateKey = creds.private_key.replace(/\\n/g, '\n');

            // 3. Tworzymy autoryzację
            return new google.auth.JWT({
                email: creds.client_email,
                keyFile: null,
                key: privateKey,
                scopes: SCOPES,
            });
        }

        // SCENARIUSZ 2: LOKALNIE (Plik)
        const credentialsPath = path.join(__dirname, 'credentials.json');
        if (fs.existsSync(credentialsPath)) {
            return new google.auth.JWT({
                keyFile: credentialsPath,
                scopes: SCOPES
            });
        }
    } catch (error) {
        console.error("❌ Błąd Auth:", error.message);
        return null;
    }
    return null;
}

// --- TRASY ---

app.get('/:token', async (req, res) => {
    const { token } = req.params;
    if (token === 'favicon.ico') return res.status(204).end();

    try {
        const auth = getGoogleAuth();
        if (!auth) throw new Error("Błąd: Nie udało się odczytać GOOGLE_CREDENTIALS");

        const sheets = google.sheets({ version: 'v4', auth });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Arkusz1!A:D',
        });

        const rows = response.data.values;
        const userRow = rows?.find(row => row[0] === token);

        const userData = {
                    token: userRow[0],
                    title: userRow[1] || '',
                    name:  userRow[2] || '',
                    wedding: userRow[3] || ''
        }

        if (userRow) {
            if(userData.wedding === 'TAK'){
                res.render('index2', user = userData);
            } else {
                res.render('index', user = userData);
            }
        } else {
            res.status(404).render('404');
        }
    } catch (error) {
        console.error("Błąd GET:", error.message);
        res.status(500).send(`Błąd: ${error.message}`);
    }
});

app.get('/', (req, res) => {
    res.status(404).render('404');
});

app.post('/confirm/:token', async (req, res) => {
    const { token } = req.params;
    const { status, comment } = req.body;

    try {
        const auth = getGoogleAuth();
        if (!auth) throw new Error("Błąd Auth");

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