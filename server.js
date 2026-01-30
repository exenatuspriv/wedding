require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const app = express();

// Konfiguracja Express
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// --- KONFIGURACJA GOOGLE API ---
const credentialsPath = path.join(__dirname, 'credentials.json');

// Sprawdzenie pliku na starcie serwera
if (!fs.existsSync(credentialsPath)) {
    console.error("❌ BŁĄD KRYTYCZNY: Brak pliku credentials.json!");
    process.exit(1);
}

// Inicjalizacja autoryzacji raz dla całego serwera (Zapis + Odczyt)
const authClient = new google.auth.JWT({
    keyFile: credentialsPath,
    // USUNIĘTO .readonly aby móc zapisywać dane (RSVP)
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth: authClient });
// --- KONIEC KONFIGURACJI ---

// TRASA GET: Wyświetlanie zaproszenia
app.get('/:token', async (req, res) => {
    const { token } = req.params;
    if (token === 'favicon.ico') return res.status(204).end();

    console.log(`\n--- [PROCES GET] Użytkownik: ${token} ---`);

    try {
        // Pobieramy kolumny A, B i C (Token, Imię, Nazwisko)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Arkusz1!A:Z',
        });
        const rows = response.data.values;
        const userRow = rows?.find(row => row[0] === token);

        if (userRow) {
            // Mapujemy kolumny na czytelne zmienne
            const userData = {
                token:   userRow[0], // Kolumna A
                title:   userRow[1], // Kolumna B (np. "Sz.P.")
                name:    userRow[2], // Kolumna C (np. "Filipie")
                wedding: userRow[3] || '' // Kolumna D (np. "Kowalski")
            };

            console.log(`✅ Znaleziono: ${userData.title} ${userData.name}`);

            if(userData.wedding === 'NIE') {
                res.render('index', {user: userData});
            } else {
                res.render('index2', {user: userData});
            }
        } else {
            res.status(404).render('404');
        }

    } catch (error) {
        console.error("!!! BŁĄD SERWERA (GET) !!!", error.message);
        res.status(500).send("Wystąpił błąd podczas ładowania strony.");
    }
});

// TRASA POST: Zapisywanie RSVP w Excelu
app.post('/confirm/:token', async (req, res) => {
    const { token } = req.params;
    const { status, comment } = req.body;

    console.log(`\n--- [PROCES POST] RSVP od: ${token} ---`);
    console.log(`Status: ${status}, Komentarz: ${comment}`);

    try {
        // 1. Szukamy wiersza z tokenem
        const getRows = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Arkusz1!A:A',
        });

        const rows = getRows.data.values;
        if (!rows) throw new Error("Brak danych w arkuszu");

        const rowIndex = rows.findIndex(row => row[0] === token) + 1;

        if (rowIndex > 0) {
            // 2. Aktualizujemy kolumny D i E (Potwierdzenie i Komentarz)
            // Zakładamy: D to "Potwierdzenie", E to "Komentarz"
            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SHEET_ID,
                range: `Arkusz1!E${rowIndex}:F${rowIndex}`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[status === 'yes' ? 'TAK' : 'NIE BĘDĘ', comment]]
                }
            });

            console.log(`✅ Zapisano RSVP w wierszu ${rowIndex}`);
            res.json({ success: true });
        } else {
            console.log("❌ Nie znaleziono wiersza do aktualizacji.");
            res.status(404).json({ success: false, message: "Token nie istnieje" });
        }
    } catch (error) {
        console.error("!!! BŁĄD ZAPISU (POST) !!!", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start serwera
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`
    -------------------------------------------
    🚀 Serwer nasłuchuje na http://localhost:${PORT}
    -------------------------------------------
    `);
});