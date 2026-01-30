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
app.set('views', path.join(__dirname, 'views')); // Dla pewności na Vercel

// --- KONFIGURACJA GOOGLE SHEETS (HYBRYDOWA) ---
let authClient;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

try {
    // SCENARIUSZ 1: VERCEL (Zmienna środowiskowa)
    if (process.env.GOOGLE_CREDENTIALS) {
        console.log("🔒 Start: Wykryto zmienną środowiskową GOOGLE_CREDENTIALS (Tryb Vercel)");

        // Parsujemy treść JSON ze zmiennej
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

        authClient = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
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
            // Jeśli nie ma ani zmiennej, ani pliku - rzucamy błąd, ale nie zabijamy procesu od razu
            console.error("⚠️ OSTRZEŻENIE: Brak konfiguracji Google Auth (Zmienna lub Plik). Aplikacja może nie działać poprawnie.");
        }
    }
} catch (error) {
    console.error("❌ Błąd krytyczny konfiguracji Google:", error.message);
}

// Inicjalizacja klienta Arkuszy
const sheets = google.sheets({ version: 'v4', auth: authClient });

// --- TRASY (ROUTES) ---

// 1. Wyświetlanie zaproszenia (GET)
app.get('/:token', async (req, res) => {
    const { token } = req.params;

    // Ignoruj prośby o ikonkę
    if (token === 'favicon.ico') return res.status(204).end();

    try {
        if (!process.env.SHEET_ID) throw new Error("Brak zmiennej SHEET_ID");

        // Pobieramy dane użytkownika (Kolumny A-D: Token, Tytuł, Imię, Nazwisko)
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
        console.error("Błąd trasy GET:", error.message);
        res.status(500).send(`Wystąpił błąd serwera: ${error.message}`);
    }
});

// 2. Obsługa formularza RSVP (POST)
app.post('/confirm/:token', async (req, res) => {
    const { token } = req.params;
    const { status, comment } = req.body;

    try {
        if (!authClient) throw new Error("Brak autoryzacji Google");

        // Pobieramy kolumnę A, żeby znaleźć numer wiersza
        const getRows = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Arkusz1!A:A',
        });

        const rows = getRows.data.values;
        const rowIndex = rows.findIndex(row => row[0] === token) + 1; // +1 bo Arkusze liczą od 1

        if (rowIndex > 0) {
            const timestamp = new Date().toLocaleString('pl-PL');

            // Zapisujemy: Status, Komentarz, Datę (Kolumny E, F, G)
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

            console.log(`✅ Zapisano RSVP dla tokenu: ${token}`);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: "Nie znaleziono tokenu" });
        }
    } catch (error) {
        console.error("Błąd trasy POST:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- START SERWERA (VERCEL COMPATIBLE) ---
// Vercel wymaga eksportu aplikacji, a lokalnie chcemy nasłuchiwać na porcie.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Serwer uruchomiony lokalnie: http://localhost:${PORT}`);
    });
}

module.exports = app;